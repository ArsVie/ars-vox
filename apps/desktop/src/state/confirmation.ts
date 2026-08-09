/**
 * GATE-5 (W0-SLICE) — confirmation surface helpers.
 *
 * Pure mappings between the wire confirmation shapes and the store's
 * pending-confirmation record + chat line text. The store keeps the
 * pending state; these helpers own the shape conversion.
 */

import type {
  ConfirmationRequestedEvent,
  PendingConfirmationSnapshot,
} from "../contracts";
import type { ConfirmationInfo } from "./types";

/** confirmation_requested event -> pending record. */
export function confirmationFromEvent(
  event: ConfirmationRequestedEvent,
): ConfirmationInfo {
  return {
    pendingId: event.pending_id,
    tool: event.tool,
    title: event.title,
    detail: event.detail,
    expiresInS: event.expires_in_s,
  };
}

/** Snapshot pending confirmation -> pending record (null = absent). */
export function pendingConfirmationFromSnapshot(
  pending: PendingConfirmationSnapshot | null,
): ConfirmationInfo | null {
  return pending
    ? {
        pendingId: pending.pending_id,
        tool: pending.tool,
        title: pending.title,
        detail: pending.detail,
        expiresInS: pending.expires_in_s,
      }
    : null;
}

/** confirmation_resolved -> the chat system line's text. */
export function confirmationResolvedMessage(
  status: string,
  message: string | null,
): string {
  return message
    ? `Confirmación ${status}: ${message}`
    : `Confirmación ${status}`;
}
