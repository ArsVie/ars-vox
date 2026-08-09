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

/**
 * W2: the dismiss seam. W2-STORE owns store.ts and is pre-authorized to
 * add `dismissNotification(notificationId: string)`; until it lands the
 * call is a no-op (optional chaining), so the region renders the button
 * without crashing. The TS test pins this seam.
 * TODO(g35r-reminders, store-dismiss): drop the cast once AppState gains
 * dismissNotification — call appStore.getState().dismissNotification(id).
 */
type DismissSeam = AppState & { dismissNotification?: (notificationId: string) => void };

function dismissNotification(notificationId: string): void {
  (appStore.getState() as DismissSeam).dismissNotification?.(notificationId);
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
