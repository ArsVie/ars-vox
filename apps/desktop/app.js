/* The window holds no state: everything on screen is rebuilt from the log.
   Losing the connection therefore costs nothing — we simply ask again for the
   events that came after the last id we saw.
   The poll owns the status: only it knows whether the service is really done,
   which is why a /listen response never sets the status itself. */

const POLL_MS = 700;
const FRESH_MS = 15000; // a media event this recent starts playing; an old one is restored paused
let lastId = 0;
let busy = false;
let recording = false;
let pulling = false;
let polling = null;

// Server events carry local time; the notes this window writes must show the same clock.
function localStamp() {
  const now = new Date();
  const shifted = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return shifted.toISOString();
}

const conversation = document.getElementById("conversation");
const indicator = document.getElementById("indicator");
const statusText = document.getElementById("status-text");
const thinking = document.getElementById("thinking");
const input = document.getElementById("text");
const sendButton = document.getElementById("send");
const stopButton = document.getElementById("stop");
const talkButton = document.getElementById("talk");
const bubbleTemplate = document.getElementById("bubble-template");

function setStatus(nextBusy, label) {
  busy = nextBusy;
  indicator.className = "square " + (busy ? "busy" : "idle");
  statusText.textContent = label || (busy ? "trabajando" : "listo");
  thinking.hidden = !busy || recording; // "pensando…" would be a lie while the microphone is open
  sendButton.disabled = busy;
  talkButton.disabled = busy || !talkButton.dataset.ready;
  stopButton.disabled = !busy;
}

function setEars(available) {
  talkButton.dataset.ready = available ? "1" : "";
  talkButton.disabled = !available;
  talkButton.title = available ? "Hable y le escucho" : "acá no hay micrófono";
  if (!available) setRecording(false);
}

function setRecording(on) {
  recording = on;
  talkButton.classList.toggle("recording", on);
  talkButton.textContent = on ? "ESCUCHANDO…" : "HABLAR";
}

function bubble(role, text, ts, withListen) {
  const node = bubbleTemplate.content.firstElementChild.cloneNode(true);
  node.classList.add(role);
  node.querySelector(".text").textContent = text;
  node.querySelector(".time").textContent = (ts || "").slice(11, 16);
  const listen = node.querySelector(".listen");
  if (!withListen) {
    listen.remove();
  } else {
    listen.addEventListener("click", async () => {
      listen.disabled = true;
      listen.textContent = "…";
      try {
        const response = await fetch("/speak", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        const data = await response.json();
        if (data.url) {
          await new Audio(data.url).play();
          listen.textContent = "escuchar";
        } else {
          listen.textContent = "sin voz";
        }
      } catch (error) {
        listen.textContent = "no pude";
      }
      listen.disabled = false;
    });
  }
  conversation.appendChild(node);
  conversation.scrollTop = conversation.scrollHeight;
  return node;
}

function chip(name, arguments_) {
  const node = document.createElement("div");
  node.className = "chip";
  const values = Object.entries(arguments_ || {})
    .map(([key, value]) => `${key}: ${value}`)
    .join(", ");
  node.textContent = values ? `${name} → ${values}` : name;
  conversation.appendChild(node);
  conversation.scrollTop = conversation.scrollHeight;
}

/* ---- the media panel ----------------------------------------------------
   The panel is a view of the same log: media events say what to show and the
   last one wins. Playback position is not kept anywhere — after a reload the
   player comes back paused, which is the honest thing (a service-side
   playback authority with snapshots was the v1 mistake this replaces). */

const workspace = document.getElementById("workspace");
const panel = document.getElementById("panel");
const panelTitle = document.getElementById("panel-title");
const panelNote = document.getElementById("panel-note");
const panelGrow = document.getElementById("panel-grow");
const panelClose = document.getElementById("panel-close");
const offersBox = document.getElementById("offers");
const stage = document.getElementById("stage");
const controlsBox = document.getElementById("controls");
const ctlPlay = document.getElementById("ctl-play");
const ctlTime = document.getElementById("ctl-time");
const ctlSeek = document.getElementById("ctl-seek");
const ctlDuration = document.getElementById("ctl-duration");
const ctlVolume = document.getElementById("ctl-volume");
const cardTemplate = document.getElementById("card-template");

let engine = null;   // what is on the stage, behind one small adapter
let seeking = false;

function fmtTime(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return h ? `${h}:${mm}:${String(r).padStart(2, "0")}` : `${mm}:${String(r).padStart(2, "0")}`;
}

function setPlayState(playing) {
  ctlPlay.dataset.playing = playing ? "1" : "";
  ctlPlay.textContent = playing ? "❚❚" : "▶";
  ctlPlay.setAttribute("aria-label", playing ? "pausar" : "reproducir");
}

function reportFromEngine(state) {
  if (state.note) {
    // the bar cannot drive this video: say so in plain words, and let it rest
    panelNote.textContent = state.note;
    panelNote.hidden = false;
    ctlPlay.disabled = true;
    ctlSeek.disabled = true;
    ctlVolume.disabled = true;
  }
  if (state.playing !== undefined) setPlayState(state.playing);
  if (state.duration !== undefined && isFinite(state.duration) && state.duration > 0) {
    ctlSeek.max = state.duration;
    ctlDuration.textContent = fmtTime(state.duration);
  }
  if (state.time !== undefined && !seeking) {
    ctlSeek.value = state.time;
    ctlTime.textContent = fmtTime(state.time);
  }
}

/* YouTube's own IFrame API script is the one component allowed to know the
   player protocol: it keeps the handshake working as YouTube evolves it
   (hand-rolled postMessage commands against the modern widget get ignored,
   verified 2026-09 against the live rig). If the script cannot load, the
   embed falls back to carrying its own controls and our bar steps aside. */
let youTubeApiPromise = null;

function loadYouTubeApi() {
  if (youTubeApiPromise) return youTubeApiPromise;
  youTubeApiPromise = new Promise((resolve, reject) => {
    if (window.YT && window.YT.Player) return resolve(window.YT);
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error("la api de YouTube no llegó"));
      }
    }, 9000);
    const prior = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (prior) prior();
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(window.YT);
      }
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.onerror = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error("la api de YouTube no cargó"));
      }
    };
    document.head.appendChild(script);
  });
  return youTubeApiPromise;
}

function youtubeTrouble(code) {
  if (code === 100 || code === 2) return "Ese video ya no está disponible. Elija otra de la lista.";
  if (code === 101 || code === 150) return "Este video no se puede ver acá. Elija otra de la lista.";
  return "No se pudo cargar el video. Elija otra de la lista.";
}

/* The failure also goes to the service. The user never reads an error: what
   happens next is that the assistant speaks first and offers to play the sound.
   One report per mounted player — the note stays on screen, the log keeps one line. */
function reportMediaFailed(payload, code) {
  fetch("/media/failed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: payload.url || "", title: payload.title || "", code: code }),
  }).catch(() => {});
}

function youTubeEngine(payload, report, fresh) {
  const holder = document.createElement("div");
  holder.className = "yt-holder";
  stage.appendChild(holder);

  let player = null;
  let ready = false;
  let finished = false;
  let failedReported = false;

  loadYouTubeApi()
    .then((YT) => {
      if (finished) return;
      player = new YT.Player(holder, {
        videoId: payload.video_id,
        playerVars: { origin: window.location.origin, playsinline: 1, controls: 0, rel: 0 },
        events: {
          onReady: (event) => {
            ready = true;
            report({ duration: event.target.getDuration() });
            if (fresh) event.target.playVideo(); // a just-asked video starts; a rebuilt one waits
          },
          onStateChange: (event) => report({ playing: event.data === 1 }),
          onError: (event) => {
            const message = youtubeTrouble(event.data);
            report({ note: message });
            if (!failedReported) {
              failedReported = true; // one report per mounted player
              reportMediaFailed(payload, event.data);
            }
            // YouTube's own error screen speaks English; the panel speaks hers
            ready = false;
            try {
              if (player && player.destroy) player.destroy();
            } catch (error) {}
            const card = document.createElement("div");
            card.className = "audio-card";
            const glyph = document.createElement("span");
            glyph.className = "glyph";
            glyph.textContent = "▷";
            const line = document.createElement("span");
            line.className = "audio-title";
            line.textContent = message;
            card.append(glyph, line);
            stage.replaceChildren(card);
          },
        },
      });
    })
    .catch(() => {
      if (finished) return;
      // no script: the video keeps its own controls, ours step aside
      const frame = document.createElement("iframe");
      frame.title = payload.title || "video";
      frame.src = `https://www.youtube.com/embed/${encodeURIComponent(payload.video_id)}?playsinline=1&rel=0`;
      stage.replaceChildren(frame);
      report({ note: "Use los botones del video." });
    });

  const tick = setInterval(() => {
    if (!ready || !player || !player.getCurrentTime) return;
    report({ time: player.getCurrentTime(), duration: player.getDuration() });
  }, 1000);

  return {
    play: () => player && player.playVideo && player.playVideo(),
    pause: () => player && player.pauseVideo && player.pauseVideo(),
    seek: (seconds) => player && player.seekTo && player.seekTo(seconds, true),
    setVolume: (value) => player && player.setVolume && player.setVolume(value),
    destroy() {
      finished = true;
      clearInterval(tick);
      try {
        if (player && player.destroy) player.destroy();
      } catch (error) {}
      holder.remove();
    },
  };
}

function html5Engine(payload, report, fresh) {
  const element = document.createElement(payload.kind === "video" ? "video" : "audio");
  element.preload = "metadata";
  element.src = payload.url;
  if (payload.kind === "video") {
    stage.appendChild(element);
  } else {
    const card = document.createElement("div");
    card.className = "audio-card";
    const glyph = document.createElement("span");
    glyph.className = "glyph";
    glyph.textContent = "♪";
    const name = document.createElement("span");
    name.className = "audio-title";
    name.textContent = payload.title || "audio";
    card.append(glyph, name);
    stage.append(card, element); // the element itself renders nothing for audio
  }
  element.addEventListener("timeupdate", () => report({ time: element.currentTime, duration: element.duration }));
  element.addEventListener("durationchange", () => report({ duration: element.duration }));
  element.addEventListener("play", () => report({ playing: true }));
  element.addEventListener("pause", () => report({ playing: false }));
  element.addEventListener("ended", () => report({ playing: false }));
  if (fresh) {
    const attempt = element.play();
    if (attempt && attempt.catch) attempt.catch(() => report({ playing: false }));
  }
  return {
    play: () => {
      const attempt = element.play();
      if (attempt && attempt.catch) attempt.catch(() => {});
    },
    pause: () => element.pause(),
    seek: (seconds) => {
      element.currentTime = seconds;
    },
    setVolume: (value) => {
      element.volume = Math.max(0, Math.min(1, value / 100));
    },
    destroy() {
      element.pause();
      element.remove();
    },
  };
}

function setLayout(mode) {
  workspace.className = mode;
}

function clearPanelBody() {
  if (engine) {
    engine.destroy();
    engine = null;
  }
  offersBox.innerHTML = "";
  stage.innerHTML = "";
  stage.classList.remove("audio-only");
  panel.classList.remove("audio-only");
  offersBox.hidden = true;
  stage.hidden = true;
  controlsBox.hidden = true;
  panelNote.hidden = true;
  panelNote.textContent = "";
  setPlayState(false);
  ctlPlay.disabled = false;
  ctlSeek.disabled = false;
  ctlVolume.disabled = false;
  ctlSeek.max = 0;
  ctlSeek.value = 0;
  ctlTime.textContent = "0:00";
  ctlDuration.textContent = "0:00";
}

function showOffers(payload) {
  clearPanelBody();
  const label = payload.type === "music" ? "Canciones" : "Opciones";
  panelTitle.textContent = payload.query ? `${label}: ${payload.query}` : label;
  for (const item of payload.items || []) {
    const node = cardTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector(".card-title").textContent = item.title || "(sin título)";
    const bits = [];
    if (item.channel) bits.push(item.channel);
    if (item.seconds) bits.push(fmtTime(item.seconds));
    node.querySelector(".card-sub").textContent = bits.join(" · ");
    node.addEventListener("click", async () => {
      node.disabled = true;
      await fetch("/media/play", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: payload.type === "music" ? "music" : "youtube",
          url: item.url,
          title: item.title,
          channel: item.channel,
          seconds: item.seconds,
        }),
      });
      pull(); // the play event comes back through the same log, as everything does
    });
    offersBox.appendChild(node);
  }
  offersBox.hidden = false;
  setLayout(workspace.className === "focus" ? "focus" : "sidecar");
  panel.hidden = false;
}

function showPlayer(payload, fresh) {
  clearPanelBody();
  const audioOnly = payload.source === "music" || (payload.source === "local" && payload.kind === "audio");
  panelTitle.textContent = payload.title || (payload.source === "youtube" ? "Video de YouTube" : "Música");
  stage.classList.toggle("audio-only", audioOnly);
  panel.classList.toggle("audio-only", audioOnly);
  if (payload.source === "youtube" && payload.video_id) {
    engine = youTubeEngine(payload, reportFromEngine, fresh);
  } else if (payload.source === "local" || payload.source === "music") {
    engine = html5Engine(payload, reportFromEngine, fresh);
  } else {
    return; // nothing on the stage to show
  }
  if (engine) engine.setVolume(Number(ctlVolume.value));
  stage.hidden = false;
  controlsBox.hidden = false;
  setLayout(workspace.className === "focus" ? "focus" : "sidecar");
  panel.hidden = false;
}

function hidePanel() {
  clearPanelBody();
  panel.hidden = true;
  grown = false;
  document.body.classList.remove("focus-mode");
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  }
  panelGrow.textContent = "agrandar";
  setLayout("");
}

function applyMedia(payload, fresh) {
  if (payload.action === "play") showPlayer(payload, fresh);
  else if (payload.action === "pause" && engine) engine.pause();
  else if (payload.action === "resume" && engine) engine.play();
  else if (payload.action === "close") hidePanel();
}

async function control(action) {
  await fetch("/media/control", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
  // no pull() here: the event reaches this page through the poll like any other
}

ctlPlay.addEventListener("click", () => {
  if (!engine) return;
  if (ctlPlay.dataset.playing === "1") {
    engine.pause();
    control("pause");
  } else {
    engine.play();
    control("resume");
  }
});

ctlSeek.addEventListener("pointerdown", () => {
  seeking = true;
});
ctlSeek.addEventListener("input", () => {
  ctlTime.textContent = fmtTime(Number(ctlSeek.value));
});
ctlSeek.addEventListener("change", () => {
  seeking = false;
  if (engine) engine.seek(Number(ctlSeek.value));
});
ctlSeek.addEventListener("pointerup", () => {
  seeking = false;
});

ctlVolume.addEventListener("input", () => {
  if (engine) engine.setVolume(Number(ctlVolume.value));
});

panelClose.addEventListener("click", async () => {
  await control("close");
  pull();
});

/* agrandar: the video gets the whole screen, not just more black. The window's
   chrome steps aside, and full screen is the extra mile when the browser allows it
   (a click is a gesture, so it does). */
let grown = false;

function setGrown(on) {
  grown = on;
  setLayout(on ? "focus" : "sidecar");
  document.body.classList.toggle("focus-mode", on);
  panelGrow.textContent = on ? "achicar" : "agrandar";
  if (!on && document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  }
}

panelGrow.addEventListener("click", async () => {
  const next = !grown;
  setGrown(next);
  if (next && !panel.classList.contains("audio-only") && panel.requestFullscreen) {
    try {
      await panel.requestFullscreen();
    } catch (error) {
      // the wide layout already grew; full screen was the extra
    }
  }
});

document.addEventListener("fullscreenchange", () => {
  // Esc lands here too: leaving full screen also means "achicar"
  if (grown && !document.fullscreenElement) setGrown(false);
});

/* ---- the voice ----------------------------------------------------------
   A reply that just arrived is read out loud: the product talks back. The
   "escuchar" button stays on every bubble for hearing it again. */
const speechQueue = [];
let speaking = false;

function speak(text) {
  if (!text) return;
  speechQueue.push(text);
  drainSpeech();
}

function drainSpeech() {
  if (speaking) return;
  const line = speechQueue.shift();
  if (line === undefined) return;
  speaking = true;
  const done = () => {
    speaking = false;
    drainSpeech();
  };
  fetch("/speak", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: line }),
  })
    .then((response) => response.json())
    .then((data) => {
      if (!data.url) return done();
      const audio = new Audio(data.url);
      audio.onended = done;
      audio.onerror = done;
      audio.play().catch(done);
    })
    .catch(done);
}

/* ---- the folders the user can set from the window ----------------------- */

const settingsOpen = document.getElementById("settings-open");
const settingsBox = document.getElementById("settings");
const cfgBooks = document.getElementById("cfg-books");
const cfgMusic = document.getElementById("cfg-music");
const cfgSave = document.getElementById("cfg-save");
const cfgClose = document.getElementById("cfg-close");
const cfgStatus = document.getElementById("cfg-status");

async function openSettings() {
  try {
    const data = await (await fetch("/config")).json();
    const cfg = data.config || {};
    cfgBooks.value = cfg.books_path || "";
    cfgMusic.value = cfg.music_path || "";
    cfgStatus.textContent = "";
  } catch (error) {
    cfgStatus.textContent = "no pude leer los ajustes";
  }
  settingsBox.hidden = false;
}

settingsOpen.addEventListener("click", async () => {
  if (settingsBox.hidden) await openSettings();
  else settingsBox.hidden = true;
});
cfgClose.addEventListener("click", () => {
  settingsBox.hidden = true;
});
settingsBox.addEventListener("click", (event) => {
  if (event.target === settingsBox) settingsBox.hidden = true; // the dim edge closes it
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !settingsBox.hidden) settingsBox.hidden = true;
});
cfgSave.addEventListener("click", async () => {
  try {
    const response = await fetch("/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        books_path: cfgBooks.value.trim(),
        music_path: cfgMusic.value.trim(),
      }),
    });
    const data = await response.json();
    cfgStatus.textContent = data.ok ? "guardado" : "no pude guardar";
  } catch (error) {
    cfgStatus.textContent = "no pude guardar";
  }
});

/* ---- the loop the page lives in ---------------------------------------- */

function render(event, fresh) {
  const { kind, payload, ts } = event;
  if (kind === "user_text") {
    // internal cues wake the model; they never appear as her own words
    if (!payload.internal) bubble("user", payload.text, ts, false);
  }
  else if (kind === "assistant_text") {
    bubble("assistant", payload.text, ts, true);
    if (fresh) speak(payload.text); // fresh replies are read out loud; the button replays
  }
  else if (kind === "tool_call") chip(payload.name, payload.arguments);
  else if (kind === "tool_result" && /^\s*No\b|falló|debe ser|faltan/.test(payload.text || "")) {
    // only clear failures reach the reader; a stray "no" mid-sentence once
    // dumped a whole internal tool result (with its [Meta:] notes) on screen
    bubble("note", payload.text, ts, false);
  } else if (kind === "reminder_fired") chip("recordatorio", { aviso: payload.spoken });
  else if (kind === "stop_requested") chip("detener", {});
  else if (kind === "media_offers") showOffers(payload);
  else if (kind === "media_state") applyMedia(payload, fresh);
}

async function pull() {
  if (pulling) return; // two overlapping polls once rendered the same bubble twice
  pulling = true;
  try {
    const response = await fetch(`/events?after=${lastId}`);
    const data = await response.json();
    const now = Date.now();
    if (data.last_id < lastId) {
      // the service came back with a fresh log (an update reset the database):
      // start over so the window never shows a conversation the log no longer has
      location.reload();
      return;
    }
    for (const event of data.events) {
      const age = event.ts ? now - Date.parse(event.ts) : Infinity;
      render(event, age < FRESH_MS);
      lastId = Math.max(lastId, event.id);
    }
    lastId = Math.max(lastId, data.last_id || 0);
    if (data.busy) setStatus(true, recording ? "escuchando…" : "trabajando");
    else if (busy) setStatus(false, "listo");
  } catch (error) {
    setStatus(true, "sin conexión — reintentando");
  } finally {
    pulling = false;
  }
}

async function health() {
  try {
    const data = await (await fetch("/health")).json();
    setEars(Boolean(data.ears));
    setStatus(data.busy, data.busy ? "trabajando" : "listo");
  } catch (error) {
    setStatus(true, "sin conexión — reintentando");
    setEars(false);
  }
}

async function talk() {
  if (busy || !talkButton.dataset.ready) return;
  setRecording(true);
  setStatus(true, "escuchando…");
  try {
    const response = await fetch("/listen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const data = await response.json();
    if (!data.ok) bubble("note", data.reason || "no escuché nada", localStamp(), false);
  } catch (error) {
    bubble("note", "no pude escuchar: se cortó la conexión", localStamp(), false);
  }
  setRecording(false);
  await pull(); // the poll owns the status: it knows whether a turn is still running
}

async function submit() {
  const text = input.value.trim();
  if (!text || busy) return;
  input.value = "";
  const response = await fetch("/turn", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const data = await response.json();
  if (!data.accepted) {
    bubble("note", data.reason || "no pude empezar", localStamp(), false);
    return;
  }
  setStatus(true, "trabajando");
  pull();
}

sendButton.addEventListener("click", submit);
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter") submit();
});
talkButton.addEventListener("click", talk);
stopButton.addEventListener("click", async () => {
  await fetch("/stop", { method: "POST" });
  pull();
});

async function boot() {
  await health();
  await pull();          // rebuild the whole conversation (and panel) from the log
  polling = setInterval(pull, POLL_MS);
  input.focus();
}

boot();
