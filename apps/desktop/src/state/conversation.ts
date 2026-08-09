/**
 * GATE-5 (W0-SLICE) — conversation surface module.
 *
 * The conversation content bag (`messages`) is the one surface bag the
 * store still routes directly (its events also carry the voice/sequence
 * authority and the delta-append semantics), but the list mechanics live
 * here as pure helpers — the store no longer owns message construction.
 *
 * GATE-5 history directive: the snapshot's `history` is NEVER auto-
 * restored (fresh start = central-mic hero; history is stashed for an
 * explicit resume). The snapshot case in store.ts therefore does not
 * touch `messages` — a same-tab reconnect keeps its in-memory chat, a
 * fresh load starts empty.
 */

import type { AgentMessageEvent, UserMessageEvent } from "../contracts";
import type { ChatMessage } from "./types";

let messageSeq = 0;

/** Monotonic message ids (per renderer process; not wire state). */
export function nextMessageId(prefix: string): string {
  messageSeq += 1;
  return `${prefix}${messageSeq.toString(36)}`;
}

/** Build a system line (confirmation verdicts, notification echoes). */
export function systemMessage(prefix: string, text: string): ChatMessage {
  return { id: nextMessageId(prefix), role: "system", text };
}

/** user_message echo — the server is the single source of truth. */
export function appendUserMessage(
  messages: ChatMessage[],
  event: UserMessageEvent,
): ChatMessage[] {
  return [...messages, { id: event.id, role: "user", text: event.text }];
}

/** agent_message — delta continuations merge into the last assistant
 *  line, complete messages append a new one. */
export function appendAgentMessage(
  messages: ChatMessage[],
  event: AgentMessageEvent,
): ChatMessage[] {
  const last = messages[messages.length - 1];
  if (event.delta && last && last.role === "assistant") {
    const updated = [...messages];
    updated[updated.length - 1] = {
      ...last,
      text: last.text + event.text,
    };
    return updated;
  }
  return [
    ...messages,
    { id: nextMessageId("a"), role: "assistant", text: event.text },
  ];
}
