import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";

import type { PanelId } from "../contracts";
import type { PanelMeta } from "../store";
import { appStore } from "../store";
import { useSurfaceRole } from "../roles/context";
import { MicButton } from "./MicButton";
import { MicHero } from "./MicHero";
import { SendIcon } from "./icons";

/**
 * R43 — suggestion chips are a capability contract, not aspirational copy:
 * every chip must name something the assistant can actually do. Email is
 * NOT implemented, so "Lee mis correos" must never appear.
 */
const SUGGESTIONS = ["Abre un documento", "Dime la hora"];

/** Support-variant window: the latest exchange only (render-only slice —
 *  history stays untouched in the store). */
const SUPPORT_EXCHANGE = 2;

/**
 * UI-202 — conversation adaptive surface.
 *
 * The role host (UI-103 SurfaceHost) hands the surface its semantic role
 * through useSurfaceRole() — the adaptive mount is the ONLY mount. Role
 * changes never remount the component (the host keys by surfaceId), so
 * draft + history survive primary -> companion -> primary. Messages always
 * come from the store — variants only change the render window, never the
 * state.
 *
 * Shell-level assistant state (listening/thinking/stopped, connection,
 * activity, STOP) lives in the shell top bar / StatusBar and is NOT
 * repeated here in any variant.
 */

export function ConversationPanel({ meta, panelId }: { meta?: PanelMeta; panelId: PanelId }) {
  const messages = useStore(appStore, (s) => s.messages);
  const sendText = useStore(appStore, (s) => s.sendText);
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const role = useSurfaceRole().role;

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

  const isCompanion = role === "companion";
  const isSupport = role === "support";
  const visible = isSupport ? messages.slice(-SUPPORT_EXCHANGE) : messages;
  const empty = visible.length === 0;

  return (
    <section
      className={`panel conversation-panel conversation--${role}`}
      aria-label="Conversación"
      data-variant={role}
    >
      {/* R43: the generic CONVERSACIÓN label is container vocabulary —
          redundant when conversation IS the primary surface (its identity
          is the message list / mic hero). Companion keeps its subdued
          subheader: that one identifies a SIDE conversation. */}
      {role === "companion" ? (
        <div className="conversation-subheader">Conversación</div>
      ) : null}
      <div className="message-list" ref={listRef}>
        {empty ? (
          <div className={`empty-state${isCompanion || isSupport ? " empty-state--compact" : ""}`}>
            {role === "primary" ? <MicHero /> : null}
            <p className="empty-title">Di o escribe una petición</p>
            {role === "primary" ? (
              <>
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
              </>
            ) : null}
          </div>
        ) : (
          visible.map((m) => (
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
          aria-label="Escribe una petición"
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
