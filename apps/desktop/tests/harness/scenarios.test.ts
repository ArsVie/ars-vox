/**
 * UI-105 acceptance (d): screenshot fixtures exist for all five templates —
 * the scenario registry (template × proportion matrix + canonical key
 * frames) and the render hook. Real screenshots land at GATE-2 with the
 * shell; until then every scenario validates and resolves to stub geometry.
 */

import { describe, expect, it } from "vitest";

import { STUB_CANVAS } from "./geometry";
import { renderScenario, renderStoryboard, scenarioCatalog, storyboardPayload } from "../../src/adaptive/harness/scenarios";
import { CANONICAL_SURFACES } from "../../src/adaptive/harness/workflows";
import { STORYBOARD_REGISTERED_IDS } from "../../src/adaptive/harness/scenarios";
import { ALL_TEMPLATES } from "../../src/adaptive/harness/fixtures";
import { ALL_PROPORTIONS } from "../../src/adaptive/harness/fixtures";

describe("screenshot scenario registry (acceptance d)", () => {
  it("catalog = 5 templates × 3 proportions + 9 canonical key frames", () => {
    const catalog = scenarioCatalog();
    const matrix = catalog.filter((s) => s.kind === "template-matrix");
    const frames = catalog.filter((s) => s.kind === "canonical-key-frame");
    expect(matrix).toHaveLength(ALL_TEMPLATES.length * ALL_PROPORTIONS.length); // 15
    expect(frames).toHaveLength(9);
    expect(catalog).toHaveLength(24);
  });

  it("the matrix covers every template × proportion combination uniquely", () => {
    const catalog = scenarioCatalog();
    const ids = catalog.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length); // unique ids
    for (const template of ALL_TEMPLATES) {
      for (const proportion of ALL_PROPORTIONS) {
        expect(
          catalog.some((s) => s.id === `matrix-${template}-${proportion}`),
          `missing matrix-${template}-${proportion}`,
        ).toBe(true);
      }
    }
  });

  it("key frames mirror the canonical flow steps", () => {
    const frames = scenarioCatalog().filter((s) => s.kind === "canonical-key-frame");
    expect(frames.map((f) => f.id)).toEqual([
      "flow-start-home",
      "flow-open-browser",
      "flow-open-conversation",
      "flow-start-video",
      "flow-media-in-background",
      "flow-open-book",
      "flow-ask-about-current-activity",
      "flow-create-reminder",
      "flow-return-to-browser",
    ]);
    // the media-in-background frame carries the shell-owned persistent bar
    const mediaFrame = frames.find((f) => f.id === "flow-media-in-background")!;
    expect(mediaFrame.persistent).toEqual([CANONICAL_SURFACES.media]);
  });
});

describe("scenario render hook", () => {
  it("renders every catalog scenario: validates + resolves geometry for all slots", () => {
    const renders = renderStoryboard(STORYBOARD_REGISTERED_IDS);
    expect(renders).toHaveLength(24);
    for (const render of renders) {
      expect(render.applied.primary.length, render.scenario.id).toBeGreaterThan(0);
      expect(render.template).toBe(render.scenario.spec.template);
      // every offered slot has an in-canvas rect
      for (const [slot, rect] of Object.entries(render.slots)) {
        expect(slot.length).toBeGreaterThan(0);
        expect(rect.x).toBeGreaterThanOrEqual(0);
        expect(rect.y).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.width).toBeLessThanOrEqual(STUB_CANVAS.width);
        expect(rect.y + rect.height).toBeLessThanOrEqual(STUB_CANVAS.height);
      }
    }
  });

  it("the render hook throws on a spec that violates the contract", () => {
    expect(() =>
      renderScenario(
        {
          id: "bad-frame",
          title: "bad",
          description: "invalid",
          kind: "template-matrix",
          spec: { template: "focus", assignments: [] },
          expectedPrimary: [],
        },
        STORYBOARD_REGISTERED_IDS,
      ),
    ).toThrow(/at least one assignment/);
  });

  it("persistent bar geometry appears only for frames with persistent surfaces", () => {
    const renders = renderStoryboard(STORYBOARD_REGISTERED_IDS);
    const withBar = renders.filter((r) => r.persistentBar !== null);
    expect(withBar).toHaveLength(1);
    expect(withBar[0].scenario.id).toBe("flow-media-in-background");
    expect(withBar[0].persistentBar!.height).toBeGreaterThan(0);
  });

  it("storyboard payload is JSON-serializable (script input for capture)", () => {
    const payload = storyboardPayload(STORYBOARD_REGISTERED_IDS) as {
      scenarios: unknown[];
      canvas: { width: number; height: number };
    };
    expect(payload.canvas).toEqual({ width: 1280, height: 800 });
    expect(payload.scenarios).toHaveLength(24);
    expect(() => JSON.stringify(payload)).not.toThrow();
  });
});
