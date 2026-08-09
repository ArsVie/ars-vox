/**
 * PanelHost render coverage (SSR renderToString — no DOM/jsdom needed):
 * slot classes, density classes, dock mounting, unmapped panels no-crash.
 *
 * NOTE: zustand's useStore uses `api.getServerState || api.getInitialState`
 * as the SSR snapshot, so renderToString always renders the store's
 * creation-time state. We attach a live getServerState in beforeEach so the
 * test can drive the singleton store and render its current layout.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";

import { PanelHost } from "../src/components/PanelHost";
import { computeLayout, type LayoutSpec } from "../src/layout/engine";
import { appStore } from "../src/store";

beforeEach(() => {
  (appStore as unknown as { getServerState: () => unknown }).getServerState = () =>
    appStore.getState();
});

function readingLayout() {
  const spec: LayoutSpec = {
    template: "reading",
    primaryPanel: "document_editor",
    secondaryPanel: "conversation",
    slots: { main: "document_editor", side: "conversation", dock: "media" },
    preserve: true,
  };
  return computeLayout(spec, {
    reducedMotion: false,
    viewport: { width: 1280, height: 800 },
    mounted: new Set(["conversation", "document_editor", "media"]),
    previous: null,
  });
}

describe("PanelHost slot rendering", () => {
  it("mounts a dock region for media in reading", () => {
    appStore.setState({
      layout: readingLayout(),
      panelMeta: { media: { title: "Vídeo de prueba" } },
      fullscreenPanel: null,
    });
    const html = renderToString(<PanelHost />);
    expect(html).toContain("panel-slot--main");
    expect(html).toContain("panel-slot--side");
    expect(html).toContain("panel-slot--dock");
    expect(html).toContain("density-compact"); // dock density
    expect(html).toContain("media-dock");
    expect(html).toContain("Vídeo de prueba");
  });

  it("renders generic content panels for non-specialized types (rail included)", () => {
    const layout = computeLayout(
      {
        template: "dashboard",
        primaryPanel: "conversation",
        secondaryPanel: null,
        slots: { main: "conversation", rail: "notes" },
        preserve: true,
      },
      {
        reducedMotion: false,
        viewport: { width: 1600, height: 900 },
        mounted: new Set(["conversation", "notes"]),
        previous: null,
      },
    );
    appStore.setState({
      layout,
      panelMeta: { notes: { title: "Notas" } },
      fullscreenPanel: null,
    });
    const html = renderToString(<PanelHost />);
    // R43: primary conversation carries its Spanish accessible name instead
    // of the generic CONVERSACIÓN container header label.
    expect(html).toContain('aria-label="Conversación"');
    expect(html).toContain("panel-slot--rail");
    expect(html).toContain("content-panel--notes");
    expect(html).toContain("Notas");
  });
});
