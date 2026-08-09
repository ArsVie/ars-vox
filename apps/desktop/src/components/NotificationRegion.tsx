/**
 * Shell-owned persistent notifications region (GATE-3.5 A6/R34).
 *
 * Renders the store's notification list — the SAME state the live
 * `notification` events and the reconnect snapshot populate — so restored
 * notifications are actually visible after a reconnect/reload, not just
 * carried on the wire. Replaces the UI-101 placeholder. The region is
 * only mounted while there is something to show (App gates it).
 */

import { useStore } from "zustand";

import { appStore } from "../store";

const KIND_LABELS: Record<string, string> = {
  reminder: "Recordatorio",
  alarm: "Alarma",
  info: "Información",
  error: "Error",
};

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
        </div>
      ))}
    </div>
  );
}
