import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import { wsUrl } from "./endpoints";
import { appStore, bindTransport } from "./store";
import { WsClient } from "./ws/client";
import "./styles.css";
import "./content.css";

const ws = new WsClient({
  url: wsUrl(),
  onEvent: (event) => appStore.getState().applyEvent(event),
  onStatus: (connected) => appStore.getState().setConnected(connected),
});

bindTransport((message) => ws.send(message));
ws.connect();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
