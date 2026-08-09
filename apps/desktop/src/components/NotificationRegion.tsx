/**
 * Shell-owned persistent notifications region (GATE-3.5 A6/R34).
 *
 * Renders the store's notification list — the SAME state the live
 * `notification` events and the reconnect snapshot populate — so restored
 * notifications are actually visible after a reconnect/reload, not just
 * carried on the wire. Replaces the UI-101 placeholder. The region is
 * only mounted while there is something to show (App gates it).
 *
 * W2 (GATE-3.5): each notification carries a dismiss button. The store
 * action removes the item from the RENDERER store (server-side
 * resolution is a separate concern — the scheduler's dismiss_top).
 */

import { useStore } from "zustand";

import { appStore, type AppState } from "../store";

const KIND_LABELS: Record<string, string> = {
  reminder: "Recordatorio",
  alarm: "Alarma",
  info: "Información",
  error: "Error",
};

/** ADV-F5 (2026-08-09): the W2 dismiss seam resolved — AppState owns
 *  dismissNotification, so the optional chaining cast is dead weight. */
function dismissNotification(notificationId: string): void {
  appStore.getState().dismissNotification(notificationId);
}

export function NotificationRegion() {
  const notifications = useStore(appStore, (s) => s.notifications);
  return (
    <div
      className="shell-persistent-region shell-notification-region"
      data-kind="notifications"
      data-surface-id="shell.notifications"
      role="region"
      aria-label="Notificaciones"
    >
      {notifications.map((n) => (
        <div
          key={n.notificationId}
          className="shell-notification"
          data-notification-kind={n.kind}
        >
          <span className="shell-notification-kind">
            {KIND_LABELS[n.kind] ?? n.kind}
          </span>
          <span className="shell-notification-title">{n.title}</span>
          {n.text ? <span className="shell-notification-text">{n.text}</span> : null}
          <button
            type="button"
            className="shell-notification-dismiss"
            aria-label={`Descartar ${n.title}`}
            onClick={() => dismissNotification(n.notificationId)}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
