/**
 * GATE-5 (W0-SLICE) — notification surface module.
 *
 * The rendered-notification list mechanics (dedupe by id, cap, snapshot
 * restore, dismissal) — pure helpers the store calls; the notification
 * region renders the list.
 */

import type { StateSnapshotEvent } from "../contracts";
import type { NotificationItem } from "./types";

/** GATE-3.5 (A6/R34): cap for the in-memory notification list. */
export const NOTIFICATIONS_CAP = 20;

/** Append a rendered notification (dedupe by id, capped). Live events
 *  and snapshot restores share this path. */
export function pushNotification(
  notifications: NotificationItem[],
  item: NotificationItem,
): NotificationItem[] {
  const next = [
    ...notifications.filter((n) => n.notificationId !== item.notificationId),
    item,
  ];
  while (next.length > NOTIFICATIONS_CAP) next.shift();
  return next;
}

/** Client-side removal of one rendered notification (dismiss
 *  affordance). Never sent to the server. */
export function dismissNotification(
  notifications: NotificationItem[],
  notificationId: string,
): NotificationItem[] {
  return notifications.filter((n) => n.notificationId !== notificationId);
}

/** Snapshot restore — authoritative (an empty snapshot list clears). */
export function restoreNotifications(
  snap: StateSnapshotEvent,
): NotificationItem[] {
  return snap.notifications.map((n) => ({
    notificationId: n.notification_id,
    kind: n.kind,
    title: n.title,
    text: n.text,
    dueAt: n.due_at ?? null,
  }));
}
