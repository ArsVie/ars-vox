/**
 * GATE-3.5 W3-TRANSPORT — inbound-frame validation.
 *
 * ALL wire-shape validators live in this one file. The renderer WsClient
 * (src/ws/client.ts) runs every inbound frame through these before the
 * cast to ServerEvent: a malformed frame is dropped with a console.warn,
 * never trusted. (The RFC 6455 frame layer is validated separately in
 * electron/wsclient.ts; this file is the event-shape boundary check.)
 */

import type { ServerEvent } from "../contracts";

/**
 * Discriminator check on the wire shape: a ServerEvent is a plain object
 * whose `type` discriminator is a non-empty string. Unknown-but-well-
 * shaped types are accepted (forward compatibility — the store's
 * applyEvent switch ignores unhandled types); anything else is garbage
 * and must not reach the store.
 */
export function isServerEventShape(value: unknown): value is ServerEvent {
  if (typeof value !== "object" || value === null) return false;
  const type = (value as { type?: unknown }).type;
  return typeof type === "string" && type.length > 0;
}
