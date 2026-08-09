/**
 * H7 (GATE-2.5) — resolved-assignment rendering + conditional persistent
 * media (App-level SSR coverage).
 *
 * The live adaptive renderer must run on the store's role-RESOLVED
 * assignments (applyAdaptiveSpec -> resolveLayout fallback ladder), never
 * on the raw agent spec, and the shell's persistent media/notifications
 * regions must be conditional — no duplicate media region when media is
 * primary in the layout, no empty "Reproducción en espera" chrome when
 * media is idle.
 *
 * Node env + renderToStaticMarkup (repo convention — no jsdom). App is the
 * REAL shell: StatusBar, AdaptiveStage, PersistentRegions, overlays.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import App from "../src/App";
import type { LayoutSpec } from "../src/adaptive/contracts";
import { registerProductSurfaces } from "../src/adaptive/surfaces";
import { surfaceRegistry } from "../src/roles/registry";
import { appStore, EMPTY_ADAPTIVE } from "../src/store";
import type { ServerEvent } from "../src/contracts";

function ts(): string {
  return new Date().toISOString();
}

/** A playing local-audio MediaStateEvent (the demo_tools shape). */
function seedPlayingMedia(): void {
  appStore.getState().applyEvent({
    type: "media.state",
    state: "playing",
    source: "local",
    kind: "audio",
    title: "Sinfonía Nº 5 — Adagietto",
    url: null,
    video_id: null,
    position_s: 142,
    duration_s: 642,
    volume: 0.8,
    created_at: ts(),
  } as ServerEvent);
}

beforeEach(() => {
  (appStore as unknown as { getServerState: () => unknown }).getServerState =
    () => appStore.getState();
  registerProductSurfaces();
  // Fresh adaptive + content + messages per test (shared singleton store).
  // notifications reset too (A6/R34: rendered list is per-test state).
  appStore.setState({
    adaptive: EMPTY_ADAPTIVE,
    content: {},
    messages: [],
    notifications: [],
  });
});

/** A sidecar spec with the media surface as PRIMARY (in a template slot). */
const MEDIA_PRIMARY_SPEC: LayoutSpec = {
  template: "sidecar",
  proportion: "balanced",
  assignments: [
    { surfaceId: "media", role: "primary", slot: "main" },
    { surfaceId: "conversation", role: "companion", slot: "side" },
  ],
};

/** A sidecar spec WITHOUT media — the persistent bar is its only home. */
const NO_MEDIA_SPEC: LayoutSpec = {
  template: "sidecar",
  proportion: "balanced",
  assignments: [
    { surfaceId: "conversation", role: "primary", slot: "main" },
    { surfaceId: "browser", role: "companion", slot: "side" },
  ],
};

describe("H7: live renderer uses resolved assignments", () => {
  it("fallback through the real App: requested companion renders as the RESOLVED support role", () => {
    // A stub surface that CANNOT render companion (only primary + support):
    // the ladder must resolve companion -> support and the stage must render
    // the RESOLVED role with the request visible for debugging.
    if (!surfaceRegistry.has("surf.stub")) {
      surfaceRegistry.register({
        surfaceId: "surf.stub",
        roles: ["primary", "support"],
      });
    }
    appStore.getState().applyAdaptiveSpec({
      template: "sidecar",
      proportion: "balanced",
      assignments: [
        { surfaceId: "conversation", role: "primary", slot: "main" },
        { surfaceId: "surf.stub", role: "companion", slot: "side" },
      ],
    });

    const assignments = appStore.getState().adaptive.assignments;
    const stub = assignments.find((a) => a.surfaceId === "surf.stub");
    expect(stub?.requestedRole).toBe("companion");
    expect(stub?.role).toBe("support");
    expect(stub?.degraded).toBe(true);

    const html = renderToStaticMarkup(<App />);
    // The slot renders the RESOLVED role (data-role from resolved geometry).
    expect(html).toContain('data-surface-id="surf.stub"');
    expect(html).toContain('data-role="support"');
    // The requested role stays visible for debugging.
    expect(html).toContain('data-requested-role="companion"');
    expect(html).toContain("data-degraded");
    // The capable surface renders exactly what was requested (no degrade).
    expect(html).toContain('data-surface-id="conversation"');
    expect(html).toContain('data-role="primary"');
  });

  it("geometry is computed from the resolved spec (roles survive into slot geometry)", () => {
    if (!surfaceRegistry.has("surf.stub")) {
      surfaceRegistry.register({
        surfaceId: "surf.stub",
        roles: ["primary", "support"],
      });
    }
    appStore.getState().applyAdaptiveSpec({
      template: "sidecar",
      proportion: "balanced",
      assignments: [
        { surfaceId: "conversation", role: "primary", slot: "main" },
        { surfaceId: "surf.stub", role: "companion", slot: "side" },
      ],
    });

    const html = renderToStaticMarkup(<App />);
    // The stub's placeholder fixture also receives the resolved role.
    expect(html).toContain("adaptive-placeholder");
    expect(html).toMatch(/data-surface-id="surf\.stub"[\s\S]*?data-role="support"/);
  });
});

describe("H7: conditional persistent media (no duplicates, no empty chrome)", () => {
  it("media PRIMARY in the layout -> NO persistent duplicate bar", () => {
    appStore.getState().applyAdaptiveSpec(MEDIA_PRIMARY_SPEC);
    seedPlayingMedia();

    const html = renderToStaticMarkup(<App />);
    // The stage hosts the full media player…
    expect(html).toContain("media-dock");
    expect(html).toContain("Sinfonía Nº 5 — Adagietto");
    // …and the shell does NOT additionally mount the persistent bar.
    expect(html).not.toContain("media-dock--persistent");
    expect(html).not.toContain("placeholder.persistent");
    expect(html).not.toContain("Reproducción en espera.");
  });

  it("media active but NOT in a slot -> persistent bar present", () => {
    appStore.getState().applyAdaptiveSpec(NO_MEDIA_SPEC);
    seedPlayingMedia();

    const html = renderToStaticMarkup(<App />);
    expect(html).toContain("media-dock--persistent");
    expect(html).toContain("Sinfonía Nº 5 — Adagietto");
    expect(html).toContain("media-player-bar-title");
    // The stage itself does not host media.
    expect(html).not.toContain('data-surface-id="media"');
  });

  it("media idle -> NO empty 'Reproducción en espera' persistent chrome", () => {
    appStore.getState().applyAdaptiveSpec(NO_MEDIA_SPEC);

    const html = renderToStaticMarkup(<App />);
    expect(html).not.toContain("media-dock--persistent");
    expect(html).not.toContain("placeholder.persistent");
    expect(html).not.toContain("Reproducción en espera.");
  });

  it("media idle and no spec -> no persistent regions at all", () => {
    const html = renderToStaticMarkup(<App />);
    expect(html).not.toContain("app-persistent");
    expect(html).not.toContain("placeholder.persistent");
    expect(html).not.toContain("shell.notifications");
  });

  it("notifications region appears only when there is notification content", () => {
    appStore.getState().applyAdaptiveSpec(NO_MEDIA_SPEC);
    const htmlBefore = renderToStaticMarkup(<App />);
    expect(htmlBefore).not.toContain("shell.notifications");

    appStore.getState().applyEvent({
      type: "ui_command",
      command: {
        action: "notification.show",
        notification_id: "n1",
        kind: "info",
        title: "Recordatorio",
        text: "Regar las plantas",
      },
      created_at: ts(),
    });
    const htmlAfter = renderToStaticMarkup(<App />);
    expect(htmlAfter).toContain('data-surface-id="shell.notifications"');
  });

  it("no notification content -> notifications region stays hidden", () => {
    appStore.getState().applyAdaptiveSpec(NO_MEDIA_SPEC);
    const html = renderToStaticMarkup(<App />);
    expect(html).not.toContain("shell.notifications");
  });
});
