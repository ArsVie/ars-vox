import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import { wsUrl } from "./endpoints";
import { appStore, bindResync, bindTransport } from "./store";
import { WsClient } from "./ws/client";
import "./styles.css";
import "./content.css";

const ws = new WsClient({
  onEvent: (event) => appStore.getState().applyEvent(event),
  onStatus: (connected) => appStore.getState().setConnected(connected),
});

bindTransport((message) => ws.send(message));
// GATE-3.5 (A6/R29): a bus sequence gap forces a reconnect — the fresh
// state_snapshot on connect is the resync mechanism.
bindResync(() => ws.forceReconnect());
ws.connect();

// GATE-3.5 A2/R12: the Electron main process owns the service lifecycle
// (spawn + authenticated health handshake). A startup failure must be a
// CLEAR UI error, not a silent disconnected state; ready clears the
// service-origin error so a recovered launch does not leave a stale banner.
if (window.arsvox) {
  const store = appStore.getState();
  let serviceErrorShown = false;
  window.arsvox.onServiceEvent((status) => {
    if (status.state === "failed") {
      serviceErrorShown = true;
      store.setError({
        message: `El servicio no pudo iniciarse: ${status.detail ?? "error desconocido"}`,
        recoverable: false,
      });
    } else if (status.state === "stopped") {
      serviceErrorShown = true;
      store.setError({
        message: `El servicio se detuvo: ${status.detail ?? "terminó inesperadamente"}`,
        recoverable: false,
      });
    } else if (status.state === "ready" && serviceErrorShown) {
      serviceErrorShown = false;
      store.dismissError();
    }
  });
  // Catch a status that changed before the listener was attached.
  void window.arsvox.serviceStatus().then((status) => {
    if (status.state === "failed" || status.state === "stopped") {
      store.setError({
        message: `El servicio no pudo iniciarse: ${status.detail ?? "error desconocido"}`,
        recoverable: false,
      });
    }
  });
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
