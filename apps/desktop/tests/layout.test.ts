/**
 * Layout engine coverage: focus, split, promotion, demotion, hidden
 * panels, invalid panel IDs, and reduced-motion mode.
 */

import { describe, expect, it } from "vitest";

import {
  computeLayout,
  type ComputeLayoutOptions,
  type LayoutSpec,
} from "../src/layout/engine";

const VIEWPORT = { width: 1280, height: 800 };

function spec(overrides: Partial<LayoutSpec>): LayoutSpec {
  return {
    template: "focus",
    primaryPanel: "conversation",
    secondaryPanel: null,
    preserve: true,
    ...overrides,
  };
}

function options(overrides: Partial<ComputeLayoutOptions> = {}): ComputeLayoutOptions {
  return {
    reducedMotion: false,
    mounted: new Set(["conversation", "document_editor"]),
    previous: null,
    ...overrides,
  };
}

function panelOf(result: ReturnType<typeof computeLayout>, id: string) {
  const panel = result.panels.find((p) => p.panel === id);
  if (!panel) throw new Error(`panel ${id} not in layout`);
  return panel;
}

describe("focus layout", () => {
  it("gives the primary panel the full content area", () => {
    const result = computeLayout(
      spec({ template: "focus", primaryPanel: "conversation" }),
      options(),
    );
    expect(result.template).toBe("focus");
    const conv = panelOf(result, "conversation");
    expect(conv.role).toBe("primary");
    expect(conv.visible).toBe(true);
    expect(conv.zIndex).toBe(30);
    expect(conv.width).toBeGreaterThan(0.9);
    expect(conv.height).toBeGreaterThan(0.9);
  });

  it("never renders a secondary panel", () => {
    const result = computeLayout(
      spec({
        template: "focus",
        primaryPanel: "conversation",
        secondaryPanel: "document_editor",
      }),
      options(),
    );
    expect(panelOf(result, "document_editor").role).toBe("hidden");
    expect(panelOf(result, "document_editor").visible).toBe(false);
  });
});

describe("split layout", () => {
  it("sizes primary larger than secondary and orders z by role", () => {
    const result = computeLayout(
      spec({
        template: "split",
        primaryPanel: "document_editor",
        secondaryPanel: "conversation",
      }),
      options(),
    );
    expect(result.template).toBe("split");
    const doc = panelOf(result, "document_editor");
    const conv = panelOf(result, "conversation");
    expect(doc.role).toBe("primary");
    expect(conv.role).toBe("secondary");
    expect(doc.width).toBeGreaterThan(conv.width);
    expect(doc.zIndex).toBeGreaterThan(conv.zIndex);
    expect(doc.visible).toBe(true);
    expect(conv.visible).toBe(true);
  });

  it("mounts panels referenced by the spec even without a prior panel.open", () => {
    const result = computeLayout(
      spec({
        template: "split",
        primaryPanel: "document_editor",
        secondaryPanel: "conversation",
      }),
      options({ mounted: new Set(["conversation"]) }),
    );
    expect(panelOf(result, "document_editor").role).toBe("primary");
  });

  it("defaults the conversation panel to secondary when only a primary is named", () => {
    const result = computeLayout(
      spec({
        template: "split",
        primaryPanel: "document_editor",
        secondaryPanel: null,
      }),
      options(),
    );
    const doc = panelOf(result, "document_editor");
    const conv = panelOf(result, "conversation");
    expect(doc.role).toBe("primary");
    expect(conv.role).toBe("secondary");
    expect(conv.visible).toBe(true);
  });
});

describe("panel promotion and demotion", () => {
  const splitDoc = spec({
    template: "split",
    primaryPanel: "document_editor",
    secondaryPanel: "conversation",
  });
  const splitConv = spec({
    template: "split",
    primaryPanel: "conversation",
    secondaryPanel: "document_editor",
  });

  it("promotes a secondary panel to primary with slide animation", () => {
    const first = computeLayout(splitDoc, options());
    const second = computeLayout(splitConv, options({ previous: first }));
    const conv = panelOf(second, "conversation");
    const doc = panelOf(second, "document_editor");
    expect(conv.role).toBe("primary");
    expect(doc.role).toBe("secondary");
    expect(conv.zIndex).toBeGreaterThan(doc.zIndex);
    expect(conv.animation).toBe("slide");
    expect(doc.animation).toBe("slide");
  });

  it("demotes a primary panel to secondary with slide animation", () => {
    const first = computeLayout(splitConv, options());
    const second = computeLayout(splitDoc, options({ previous: first }));
    const doc = panelOf(second, "document_editor");
    const conv = panelOf(second, "conversation");
    expect(doc.role).toBe("primary");
    expect(conv.role).toBe("secondary");
    expect(doc.animation).toBe("slide");
  });

  it("fades in a panel that was hidden before", () => {
    const first = computeLayout(
      spec({ template: "focus", primaryPanel: "conversation" }),
      options(),
    );
    const second = computeLayout(
      spec({
        template: "split",
        primaryPanel: "document_editor",
        secondaryPanel: "conversation",
      }),
      options({ previous: first }),
    );
    expect(panelOf(second, "document_editor").animation).toBe("fade");
  });
});

describe("hidden panels", () => {
  it("marks mounted-but-unreferenced panels hidden and not visible", () => {
    const result = computeLayout(
      spec({
        template: "split",
        primaryPanel: "document_editor",
        secondaryPanel: "conversation",
      }),
      options({ mounted: new Set(["conversation", "document_editor", "notes"]) }),
    );
    const notes = panelOf(result, "notes");
    expect(notes.role).toBe("hidden");
    expect(notes.visible).toBe(false);
    expect(notes.zIndex).toBe(0);
  });
});

describe("invalid panel IDs", () => {
  it("falls back to the default primary for unknown ids", () => {
    const result = computeLayout(
      spec({ template: "focus", primaryPanel: "garbage_panel" as never }),
      options(),
    );
    expect(panelOf(result, "conversation").role).toBe("primary");
  });

  it("drops an unknown secondary panel", () => {
    const result = computeLayout(
      spec({
        template: "split",
        primaryPanel: "conversation",
        secondaryPanel: "not_a_panel" as never,
      }),
      options(),
    );
    const visible = result.panels.filter((p) => p.visible);
    expect(visible.map((p) => p.panel)).not.toContain("not_a_panel");
  });

  it("treats a non-split template as focus", () => {
    const result = computeLayout(
      spec({ template: "wat" as never, primaryPanel: "document_editor" }),
      options(),
    );
    expect(result.template).toBe("focus");
  });
});

describe("reduced motion", () => {
  it("disables all animations even across role changes", () => {
    const first = computeLayout(
      spec({ template: "split", primaryPanel: "document_editor", secondaryPanel: "conversation" }),
      options(),
    );
    const second = computeLayout(
      spec({ template: "split", primaryPanel: "conversation", secondaryPanel: "document_editor" }),
      options({ previous: first, reducedMotion: true }),
    );
    expect(second.reducedMotion).toBe(true);
    for (const panel of second.panels) {
      expect(panel.animation).toBe("none");
    }
  });
});
