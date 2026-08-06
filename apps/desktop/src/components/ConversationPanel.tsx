import { useState } from "react";
import { useStore } from "zustand";

import type { PanelMeta } from "../store";
import { appStore } from "../store";
import { MicButton } from "./MicButton";

export function ConversationPanel({ meta }: { meta?: PanelMeta }) {
  const messages = useStore(appStore, (s) => s.messages);
  const voiceState = useStore(appStore, (s) => s.voiceState);
  const sendText = useStore(appStore, (s) => s.sendText);
  const [draft, setDraft] = useState("");

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    sendText(text);
  };

  return (
    <section className="panel conversation-panel" aria-label="Conversation">
      <header className="panel-header">Conversation</header>
      <div className="message-list">
        {messages.length === 0 ? (
          <p className="empty-hint">Say or type a request.</p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`message ${m.role}`}>
              {m.text}
            </div>
          ))
        )}
      </div>
      <div className="composer">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder="Type a request..."
          aria-label="Request"
        />
        <MicButton />
        <button type="button" onClick={submit} disabled={!draft.trim()}>
          Send
        </button>
      </div>
      <div className="panel-footer">voice: {voiceState}</div>
    </section>
  );
}
