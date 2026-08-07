import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";

import type { PanelId } from "../layout/engine";
import type { PanelMeta } from "../store";
import { appStore } from "../store";
import { MicButton } from "./MicButton";
import { MicHero } from "./MicHero";
import { PanelHeader } from "./PanelHeader";
import { ChatIcon, SendIcon } from "./icons";

const SUGGESTIONS = ["Abre un documento", "Lee mis correos", "Dime la hora"];

export function ConversationPanel({ meta, panelId }: { meta?: PanelMeta; panelId: PanelId }) {
  const messages = useStore(appStore, (s) => s.messages);
  const sendText = useStore(appStore, (s) => s.sendText);
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  // Keep the newest message in view (follow streaming agent replies).
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    sendText(text);
  };

  return (
    <section className="panel conversation-panel" aria-label="Conversation">
      <PanelHeader panelId={panelId} icon={<ChatIcon size={15} />}>
        Conversación
      </PanelHeader>
      <div className="message-list" ref={listRef}>
        {messages.length === 0 ? (
          <div className="empty-state">
            <MicHero />
            <p className="empty-title">Di o escribe una petición</p>
            <p className="empty-hint">
              Toca el micrófono y habla, o escribe abajo — el asistente responderá en voz alta.
            </p>
            <div className="suggestion-row">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="suggestion-chip"
                  onClick={() => sendText(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`message ${m.role}`}>
              {m.role === "assistant" ? (
                <span className="message-role">Asistente</span>
              ) : m.role === "user" ? (
                <span className="message-role">Tú</span>
              ) : null}
              <span className="message-text">{m.text}</span>
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
          placeholder="Escribe una petición..."
          aria-label="Request"
        />
        <MicButton />
        <button type="button" className="send-button" onClick={submit} disabled={!draft.trim()}>
          <SendIcon size={15} />
          <span className="btn-label">Enviar</span>
        </button>
      </div>
    </section>
  );
}
