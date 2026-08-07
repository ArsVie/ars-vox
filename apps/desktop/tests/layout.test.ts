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
    viewport: VIEWPORT,
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

describe("template resolution", () => {
  it("resolves all four templates to distinct slot sets", () => {
    const focus = computeLayout(spec({ template: "focus" }), options());
    const split = computeLayout(
      spec({ template: "split", primaryPanel: "document_editor" }),
      options(),
    );
    const reading = computeLayout(
      spec({ template: "reading", primaryPanel: "document_editor" }),
      options({ mounted: new Set(["conversation", "document_editor", "media"]) }),
    );
    const dashboard = computeLayout(
      spec({ template: "dashboard", primaryPanel: "document_editor" }),
      options({
        viewport: { width: 1600, height: 900 },
        mounted: new Set(["conversation", "document_editor", "media", "tasks"]),
      }),
    );
    expect(focus.template).toBe("focus");
    expect(split.template).toBe("split");
    expect(reading.template).toBe("reading");
    expect(dashboard.template).toBe("dashboard");
    const slotSets = [focus, split, reading, dashboard].map((r) =>
      r.panels.filter((p) => p.visible).map((p) => p.slot).sort(),
    );
    expect(new Set(slotSets.map((s) => s.join(","))).size).toBe(4);
  });

  it("maps legacy aliases to canonical templates", () => {
    // reference -> reading (3-zone), background_media -> dashboard (4-zone)
    const ref = computeLayout(
      spec({ template: "reference", primaryPanel: "document_editor" }),
      options({ mounted: new Set(["conversation", "document_editor", "media"]) }),
    );
    expect(ref.template).toBe("reading");
    expect(ref.panels.filter((p) => p.visible).map((p) => p.slot)).toContain("dock");
    const bg = computeLayout(
      spec({ template: "background_media", primaryPanel: "document_editor" }),
      options({
        viewport: { width: 1600, height: 900 },
        mounted: new Set(["conversation", "document_editor", "media", "tasks"]),
      }),
    );
    expect(bg.template).toBe("dashboard");
    expect(bg.panels.filter((p) => p.visible).map((p) => p.slot)).toContain("rail");
  });

  it("degrades an unknown template to focus deterministically", () => {
    const result = computeLayout(
      spec({ template: "wat" as never, primaryPanel: "document_editor" }),
      options(),
    );
    expect(result.template).toBe("focus");
    expect(result.degradedFrom).toBeUndefined();
  });
});

describe("slot geometry", () => {
  it("reading = main widest, side + dock stacked on the right, no overlap", () => {
    const result = computeLayout(
      spec({ template: "reading", primaryPanel: "document_editor" }),
      options({ mounted: new Set(["conversation", "document_editor", "media"]) }),
    );
    const main = panelOf(result, "document_editor");
    const conv = panelOf(result, "conversation");
    const media = panelOf(result, "media");
    expect(main.slot).toBe("main");
    expect(conv.slot).toBe("side");
    expect(media.slot).toBe("dock");
    expect(main.width).toBeGreaterThan(conv.width);
    const rects = [main, conv, media].map((p) => ({
      x: p.x,
      y: p.y,
      w: p.width,
      h: p.height,
    }));
    for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        const a = rects[i];
        const b = rects[j];
        const overlap =
          a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap).toBe(false);
      }
    }
    // side + dock stacked right: same x band, dock below side
    expect(conv.x).toBeCloseTo(media.x, 5);
    expect(media.y).toBeGreaterThan(conv.y + conv.height * 0.9);
  });

  it("dashboard = left rail + center main + right side/dock, rails narrower", () => {
    const result = computeLayout(
      spec({ template: "dashboard", primaryPanel: "document_editor" }),
      options({
        viewport: { width: 1600, height: 900 },
        mounted: new Set(["conversation", "document_editor", "media", "tasks"]),
      }),
    );
    const rail = panelOf(result, "tasks");
    const main = panelOf(result, "document_editor");
    const conv = panelOf(result, "conversation");
    const media = panelOf(result, "media");
    expect(rail.slot).toBe("rail");
    expect(main.slot).toBe("main");
    expect(conv.slot).toBe("side");
    expect(media.slot).toBe("dock");
    expect(rail.width).toBeLessThan(main.width);
    expect(main.width).toBeGreaterThan(conv.width);
    expect(rail.x).toBeLessThan(main.x);
    expect(conv.x).toBeGreaterThan(main.x);
  });
});

describe("px floors and degrade", () => {
  it("keeps dashboard on a wide viewport without degradation", () => {
    const result = computeLayout(
      spec({ template: "dashboard", primaryPanel: "document_editor" }),
      options({ viewport: { width: 1600, height: 900 } }),
    );
    expect(result.template).toBe("dashboard");
    expect(result.degradedFrom).toBeUndefined();
  });

  it("drops rail below its floor: dashboard -> reading", () => {
    const result = computeLayout(
      spec({ template: "dashboard", primaryPanel: "document_editor" }),
      options({ viewport: { width: 1280, height: 800 } }),
    );
    expect(result.template).toBe("reading");
    expect(result.degradedFrom).toBe("dashboard");
    // degraded layout must respect px floors: side >= 280px wide
    const conv = panelOf(result, "conversation");
    expect(conv.width * 1280).toBeGreaterThanOrEqual(280);
  });

  it("collapses reading and split together when the side column is below floor", () => {
    // reading and split share the 31% side column, so both fail at the same
    // width; the ladder resolves straight to focus (deterministic, no slot
    // below floor — the intermediate rungs are geometrically equivalent).
    const result = computeLayout(
      spec({ template: "dashboard", primaryPanel: "document_editor" }),
      options({ viewport: { width: 850, height: 800 } }),
    );
    expect(result.template).toBe("focus");
    expect(result.degradedFrom).toBe("dashboard");
  });

  it("drops main below its floor: split -> focus on a very narrow viewport", () => {
    const result = computeLayout(
      spec({ template: "dashboard", primaryPanel: "document_editor" }),
      options({ viewport: { width: 700, height: 800 } }),
    );
    expect(result.template).toBe("focus");
    expect(result.degradedFrom).toBe("dashboard");
  });

  it("degrade is a pure function of (template, viewport)", () => {
    const a = computeLayout(
      spec({ template: "dashboard", primaryPanel: "document_editor" }),
      options({ viewport: { width: 1280, height: 800 } }),
    );
    const b = computeLayout(
      spec({ template: "dashboard", primaryPanel: "document_editor" }),
      options({ viewport: { width: 1280, height: 800 } }),
    );
    expect(a).toEqual(b);
  });

  it("no visible slot is ever below its px floor", () => {
    for (const width of [1600, 1280, 1000, 850, 700, 500]) {
      const result = computeLayout(
        spec({ template: "dashboard", primaryPanel: "document_editor" }),
        options({ viewport: { width, height: 800 } }),
      );
      for (const panel of result.panels.filter((p) => p.visible)) {
        const floor =
          panel.slot === "main"
            ? { width: 480, height: 360 }
            : panel.slot === "side"
              ? { width: 280, height: 240 }
              : panel.slot === "rail"
                ? { width: 240, height: 240 }
                : { width: 240, height: 64 };
        expect(panel.width * width).toBeGreaterThanOrEqual(floor.width);
        expect(panel.height * 800).toBeGreaterThanOrEqual(floor.height);
      }
    }
  });
});

describe("slot affinity", () => {
  it("keeps the 2 highest-affinity panels in a 2-slot split", () => {
    const result = computeLayout(
      spec({
        template: "split",
        primaryPanel: "document_editor",
        secondaryPanel: "conversation",
      }),
      options({ mounted: new Set(["conversation", "document_editor", "media", "notes"]) }),
    );
    const visible = result.panels.filter((p) => p.visible);
    expect(visible.map((p) => p.panel).sort()).toEqual([
      "conversation",
      "document_editor",
    ]);
    expect(panelOf(result, "media").visible).toBe(false);
    expect(panelOf(result, "notes").visible).toBe(false);
  });

  it("lands media in the dock under reading", () => {
    const result = computeLayout(
      spec({
        template: "reading",
        slots: { main: "document_editor", side: "conversation", dock: null },
      }),
      options({ mounted: new Set(["conversation", "document_editor", "media"]) }),
    );
    expect(panelOf(result, "media").slot).toBe("dock");
    expect(panelOf(result, "media").visible).toBe(true);
  });

  it("corrects semantically wrong placements (media in main -> dock, doc -> main)", () => {
    const result = computeLayout(
      spec({
        template: "reading",
        slots: { main: "media", side: "document_editor" },
      }),
      options({ mounted: new Set(["conversation", "document_editor", "media"]) }),
    );
    expect(panelOf(result, "document_editor").slot).toBe("main");
    expect(panelOf(result, "conversation").slot).toBe("side");
    expect(panelOf(result, "media").slot).toBe("dock");
  });

  it("routes rail-affinity panels to the rail slot in dashboard", () => {
    const result = computeLayout(
      spec({
        template: "dashboard",
        slots: { main: "news", side: "conversation", rail: "tasks", dock: null },
      }),
      options({ viewport: { width: 1600, height: 900 } }),
    );
    expect(panelOf(result, "news").slot).toBe("main");
    expect(panelOf(result, "conversation").slot).toBe("side");
    expect(panelOf(result, "tasks").slot).toBe("rail");
  });

  it("keeps the conversation anchor in a real slot even when over-assigned", () => {
    const result = computeLayout(
      spec({
        template: "dashboard",
        slots: { main: "media", side: "document_editor", dock: "youtube", rail: "tasks" },
      }),
      options({ viewport: { width: 1600, height: 900 } }),
    );
    const conv = panelOf(result, "conversation");
    expect(conv.visible).toBe(true);
    expect(conv.slot).not.toBeNull();
  });
});

describe("chrome density", () => {
  it("rail slot gets rail density; dock gets compact", () => {
    const result = computeLayout(
      spec({ template: "dashboard", primaryPanel: "document_editor" }),
      options({
        viewport: { width: 1600, height: 900 },
        mounted: new Set(["conversation", "document_editor", "media", "tasks"]),
      }),
    );
    expect(panelOf(result, "tasks").density).toBe("rail");
    expect(panelOf(result, "media").density).toBe("compact");
    expect(panelOf(result, "document_editor").density).toBe("full");
  });

  it("narrow side slot is compact; wide side is full", () => {
    // split survives at 1000px wide with a 310px side column (< 360 -> compact)
    const narrow = computeLayout(
      spec({ template: "split", primaryPanel: "document_editor" }),
      options({ viewport: { width: 1000, height: 800 } }),
    );
    expect(panelOf(narrow, "conversation").density).toBe("compact");
    const wide = computeLayout(
      spec({ template: "split", primaryPanel: "document_editor" }),
      options({ viewport: { width: 1280, height: 800 } }),
    );
    expect(panelOf(wide, "conversation").density).toBe("full");
  });

  it("conversation composer never collapses at full density", () => {
    const result = computeLayout(
      spec({ template: "split", primaryPanel: "document_editor" }),
      options({ viewport: { width: 1280, height: 800 } }),
    );
    const conv = panelOf(result, "conversation");
    expect(conv.density).toBe("full");
    expect(conv.composerCollapsed).toBe(false);
  });

  it("conversation composer collapses in compact/rail density", () => {
    const narrow = computeLayout(
      spec({ template: "split", primaryPanel: "document_editor" }),
      options({ viewport: { width: 1000, height: 800 } }),
    );
    expect(panelOf(narrow, "conversation").composerCollapsed).toBe(true);
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
