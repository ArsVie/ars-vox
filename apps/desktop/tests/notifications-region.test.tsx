/**
 * GATE-3.5 A6 (R34) — notifications are actually RENDERED after restore.
 *
 * The reconnect snapshot carries notifications; the store restores them
 * into `notifications` state (authoritative, R31); the shell-owned
 * persistent notifications region renders that list. This test mounts the
 * region with the singleton store populated via real events (snapshot
 * restore + live notification) and asserts the DOM contains them.
 *
 * Node env + renderToStaticMarkup (repo convention — no jsdom).
 */

import { beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { PersistentRegions } from "../src/components/PersistentRegions";
import { appStore, EMPTY_ADAPTIVE } from "../src/store";
import type { StateSnapshotEvent } from "../src/contracts";

function ts(): string {
  return new Date().toISOString();
}

function snapshot(overrides: Partial<StateSnapshotEvent> = {}): StateSnapshotEvent {
  return {
    type: "state_snapshot",
    sequence: 42,
    voice_state: "listening",
    config: {},
    layout: { panels: [] },
    pending_confirmation: null,
    media: null,
    notifications: [],
    content_keys: [],
    history: [],
    adaptive: { template: null, assignments: [], proportion: null, overrides: {} },
    created_at: ts(),
    ...overrides,
  };
}

beforeEach(() => {
  // Repo SSR convention: server renders read the store through
  // getServerState (zustand v5 + renderToStaticMarkup).
  (appStore as unknown as { getServerState: () => unknown }).getServerState =
    () => appStore.getState();
  appStore.setState({
    content: {},
    messages: [],
    notifications: [],
    adaptive: EMPTY_ADAPTIVE,
  });
});

describe("notifications region (R34)", () => {
  it("renders notifications restored from the reconnect snapshot", () => {
    appStore.getState().applyEvent(
      snapshot({
        notifications: [
          {
            notification_id: "n1",
            kind: "reminder",
            title: "Alarma",
            text: "Reunión en 10 minutos",
            due_at: ts(),
          },
          {
            notification_id: "n2",
            kind: "info",
            title: "Nota",
            text: "Todo guardado",
            due_at: null,
          },
        ],
      }),
    );

    const html = renderToStaticMarkup(
      <PersistentRegions
        surfaces={[{ surfaceId: "shell.notifications", kind: "notifications" }]}
      />,
    );

    expect(html).toContain("Alarma");
    expect(html).toContain("Reunión en 10 minutos");
    expect(html).toContain("Nota");
    expect(html).toContain("Todo guardado");
    expect(html).toContain('data-surface-id="shell.notifications"');
    expect(html).toContain('data-notification-kind="reminder"');
  });

  it("renders live notification events through the same region", () => {
    appStore.getState().applyEvent({
      type: "notification",
      notification_id: "live1",
      kind: "alarm",
      title: "En vivo",
      text: "Evento directo",
      due_at: null,
      created_at: ts(),
    });

    const html = renderToStaticMarkup(
      <PersistentRegions
        surfaces={[{ surfaceId: "shell.notifications", kind: "notifications" }]}
      />,
    );

    expect(html).toContain("En vivo");
    expect(html).toContain("Evento directo");
  });

  it("renders nothing in the region when the restored list is empty (R31)", () => {
    appStore.getState().applyEvent(snapshot({ notifications: [] }));

    const html = renderToStaticMarkup(
      <PersistentRegions
        surfaces={[{ surfaceId: "shell.notifications", kind: "notifications" }]}
      />,
    );

    // the region mounts but carries no notification items
    expect(html).not.toContain("shell-notification-title");
  });
});
