import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useStore } from "zustand";

import { appStore } from "../store";
import { ShieldIcon } from "./icons";

/**
 * W0-DIRECTIVE (GATE-5) — confirmation is a popup INSIDE the chat, not a
 * separate overlay panel. The card portals into the mounted conversation
 * surface (`.conversation-panel`), where it floats above the message list;
 * when conversation is not in the composition the card falls back to a
 * floating popup anchored to the shell. The full-screen `.overlay` wrapper
 * is retired. The host is re-queried after every commit so layout changes
 * re-home the popup.
 *
 * Two-phase confirmation card. Approve executes the stored snapshot.
 * R43: human labels only — the raw `tool:` name stays in store state
 * (A7 semantics) but is never rendered.
 */
export function ConfirmationPanel() {
  const pending = useStore(appStore, (s) => s.pending);
  const confirm = useStore(appStore, (s) => s.confirm);
  const [chatHost, setChatHost] = useState<HTMLElement | null>(null);

  // No dep array: re-run after every commit so the popup follows layout
  // changes (conversation mounting/unmounting). Same-value sets bail out.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const host = document.querySelector<HTMLElement>(".conversation-panel");
    setChatHost((prev) => (prev === host ? prev : host));
  });

  if (!pending) return null;

  const card = (
    <div className="confirmation-popup">
      <div className="confirmation-card" role="alertdialog" aria-label="Confirmación">
        <h2>
          <span className="card-icon">
            <ShieldIcon size={19} />
          </span>
          {pending.title}
        </h2>
        <p className="confirmation-detail">{pending.detail}</p>
        <div className="confirmation-actions">
          <button type="button" className="approve" onClick={() => confirm(true)}>
            Aprobar
          </button>
          <button type="button" className="deny" onClick={() => confirm(false)}>
            Rechazar
          </button>
        </div>
      </div>
    </div>
  );

  // Server-side renders (renderToStaticMarkup, no DOM) and layouts without
  // a conversation surface render the popup inline in the shell tree.
  return chatHost ? createPortal(card, chatHost) : card;
}
