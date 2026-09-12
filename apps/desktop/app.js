/* The window holds no state: everything on screen is rebuilt from the log.
   Losing the connection therefore costs nothing — we simply ask again for the
   events that came after the last id we saw. */

const POLL_MS = 700;
let lastId = 0;
let busy = false;
let polling = null;

const conversation = document.getElementById("conversation");
const indicator = document.getElementById("indicator");
const statusText = document.getElementById("status-text");
const who = document.getElementById("who");
const thinking = document.getElementById("thinking");
const input = document.getElementById("text");
const sendButton = document.getElementById("send");
const stopButton = document.getElementById("stop");
const bubbleTemplate = document.getElementById("bubble-template");

function setStatus(nextBusy, label) {
  busy = nextBusy;
  indicator.className = "square " + (busy ? "busy" : "idle");
  statusText.textContent = label || (busy ? "trabajando" : "listo");
  thinking.hidden = !busy;
  sendButton.disabled = busy;
  stopButton.disabled = !busy;
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
  try {
    const response = await fetch(`/events?after=${lastId}`);
    const data = await response.json();
    for (const event of data.events) {
      render(event);
      lastId = Math.max(lastId, event.id);
    }
    lastId = Math.max(lastId, data.last_id || 0);
    if (data.busy) setStatus(true, "trabajando");
    else if (busy) setStatus(false, "listo");
  } catch (error) {
    setStatus(true, "sin conexión — reintentando");
  }
}

async function health() {
  try {
    const data = await (await fetch("/health")).json();
    who.textContent = data.model + " · " + data.session;
    setStatus(data.busy, data.busy ? "trabajando" : "listo");
  } catch (error) {
    who.textContent = "servicio apagado";
  }
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
    bubble("note", data.reason || "no pude empezar", new Date().toISOString(), false);
    return;
  }
  setStatus(true, "trabajando");
  pull();
}

sendButton.addEventListener("click", submit);
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter") submit();
});
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
