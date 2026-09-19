/* The window holds no state: everything on screen is rebuilt from the log.
   Losing the connection therefore costs nothing — we simply ask again for the
   events that came after the last id we saw.
   The poll owns the status: only it knows whether the service is really done,
   which is why a /listen response never sets the status itself. */

const POLL_MS = 700;
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
const who = document.getElementById("who");
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

function render(event) {
  const { kind, payload, ts } = event;
  if (kind === "user_text") bubble("user", payload.text, ts, false);
  else if (kind === "assistant_text") bubble("assistant", payload.text, ts, true);
  else if (kind === "tool_call") chip(payload.name, payload.arguments);
  else if (kind === "tool_result" && /falló|no |No existe|debe ser|faltan/.test(payload.text || "")) {
    bubble("note", payload.text, ts, false);
  } else if (kind === "reminder_fired") chip("recordatorio", { aviso: payload.spoken });
  else if (kind === "stop_requested") chip("detener", {});
}

async function pull() {
  if (pulling) return; // two overlapping polls once rendered the same bubble twice
  pulling = true;
  try {
    const response = await fetch(`/events?after=${lastId}`);
    const data = await response.json();
    for (const event of data.events) {
      render(event);
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
    who.textContent = data.model + " · " + data.session;
    setEars(Boolean(data.ears));
    setStatus(data.busy, data.busy ? "trabajando" : "listo");
  } catch (error) {
    who.textContent = "servicio apagado";
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
  await pull();          // rebuild the whole conversation from the log
  polling = setInterval(pull, POLL_MS);
  input.focus();
}

boot();
