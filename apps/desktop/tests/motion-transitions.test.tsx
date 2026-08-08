/**
 * UI-206 — Layout transition system (motion) tests.
 *
 * Node env, renderToString (repo convention — no jsdom):
 *   (a) the motion layer is wired: stage gate + transition CSS, and a
 *       layout change keeps the same surface element while its geometry
 *       styles change (resize/move in place, no flash);
 *   (b) no-remount identity contract: slot elements are keyed by
 *       surfaceId (inspectable directly via stageSlotElements), so a
 *       surface moving between slots keeps its React instance — the key
 *       follows the surface, never the slot;
 *   (c) reduced-motion disables animation: matchMedia stub consulted
 *       synchronously at render time (SSR-safe), explicit prop override,
 *       and the CSS reduced-motion block kills the stage transition.
 */
import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";

import type { LayoutSpec } from "../src/adaptive/contracts";
import {
  PLACEHOLDER_REGISTERED_IDS,
  TEMPLATE_FIXTURES,
} from "../src/adaptive/fixtures";
import { computeAdaptiveGeometry } from "../src/layout/adaptiveEngine";
import {
  AdaptiveStage,
  stageSlotElements,
} from "../src/layout/AdaptiveStage";

const CSS_PATH = new URL("../src/styles.css", import.meta.url);
const stylesCss = readFileSync(CSS_PATH, "utf8");

const DESKTOP = { width: 1280, height: 800 };

function geometryOf(spec: LayoutSpec) {
  return computeAdaptiveGeometry(spec, DESKTOP, PLACEHOLDER_REGISTERED_IDS);
}

/** Sidecar at a given proportion (surfaces keep their fixture roles). */
function sidecar(proportion: "narrow" | "balanced" | "wide"): LayoutSpec {
  return { ...TEMPLATE_FIXTURES.sidecar, proportion };
}

const realWindow = globalThis.window;

afterEach(() => {
  if (realWindow === undefined) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).window;
  } else {
    globalThis.window = realWindow;
  }
});

describe("UI-206 motion layer (a): transitions on layout change", () => {
  it("stage carries the motion gate and transition CSS is wired", () => {
    const html = renderToString(
      <AdaptiveStage geometry={geometryOf(sidecar("balanced"))} />,
    );
    expect(html).toContain('data-motion="enabled"');
    // CSS: one transition rule for slot geometry, gated by the stage attr,
    // restrained duration (200-300ms).
    expect(stylesCss).toMatch(
      /\[data-motion="enabled"\] \.panel-slot\s*\{[^}]*transition:/s,
    );
    expect(stylesCss).toMatch(/240ms/);
    expect(stylesCss).toMatch(/transition:\s*none/);
  });

  it("proportion change resizes the SAME surface element in place", () => {
    const narrow = renderToString(
      <AdaptiveStage geometry={geometryOf(sidecar("narrow"))} />,
    );
    const wide = renderToString(
      <AdaptiveStage geometry={geometryOf(sidecar("wide"))} />,
    );
    // Geometry styles change (62% → 82% main)…
    expect(narrow).toContain("width:62%");
    expect(wide).toContain("width:82%");
    // …but each surface appears exactly as the same two identity elements
    // (slot + placeholder carry data-surface-id; no new/duplicated node
    // from the motion layer — the transition targets the existing one).
    expect(narrow.match(/data-surface-id="placeholder\.primary"/g)).toHaveLength(2);
    expect(wide.match(/data-surface-id="placeholder\.primary"/g)).toHaveLength(2);
    expect(narrow.match(/data-surface-id="placeholder\.companion"/g)).toHaveLength(2);
    expect(wide.match(/data-surface-id="placeholder\.companion"/g)).toHaveLength(2);
    expect(narrow.match(/class="panel-slot/g)).toHaveLength(2);
    expect(wide.match(/class="panel-slot/g)).toHaveLength(2);
  });
});

describe("UI-206 motion layer (b): no remount on slot moves", () => {
  it("slot elements are keyed by surfaceId, never by slot", () => {
    const before = stageSlotElements(geometryOf(sidecar("balanced")));
    expect(before.map((el) => el.key)).toEqual([
      "placeholder.primary",
      "placeholder.companion",
    ]);

    const moved: LayoutSpec = {
      template: "sidecar",
      assignments: [
        { surfaceId: "placeholder.companion", role: "primary", slot: "main" },
        { surfaceId: "placeholder.primary", role: "companion", slot: "side" },
      ],
      proportion: "balanced",
    };
    const after = stageSlotElements(geometryOf(moved));
    const keysAfter = after.map((el) => el.key);
    // Same two surfaces — the key set is unchanged; each key now carries
    // the new slot geometry. Keys follow identity, not slot position.
    expect(keysAfter).toEqual([
      "placeholder.companion",
      "placeholder.primary",
    ]);
    expect(new Set(keysAfter)).toEqual(new Set(before.map((el) => el.key)));
    expect(keysAfter).not.toContain("main");
    expect(keysAfter).not.toContain("side");

    // DOM contract on the moved spec: the same data-surface-id element
    // now carries the new slot/role (React reconciles, never remounts).
    const html = renderToString(<AdaptiveStage geometry={geometryOf(moved)} />);
    expect(html).toContain(
      'data-surface-id="placeholder.companion" data-role="primary" data-slot="main"',
    );
    expect(html).toContain(
      'data-surface-id="placeholder.primary" data-role="companion" data-slot="side"',
    );
  });
});

describe("UI-206 motion layer (c): reduced motion", () => {
  it("matchMedia 'reduce' disables the animation layer (SSR-safe gate)", () => {
    // Stub matchMedia BEFORE render: the gate is read synchronously at
    // render time, so renderToString sees the verdict without effects.
    globalThis.window = {
      matchMedia: () => ({ matches: true }) as unknown as MediaQueryList,
    } as unknown as Window & typeof globalThis;
    const html = renderToString(
      <AdaptiveStage geometry={geometryOf(sidecar("balanced"))} />,
    );
    expect(html).toContain('data-motion="reduced"');
    expect(html).not.toContain('data-motion="enabled"');
  });

  it("motion is enabled when no matchMedia exists (SSR first paint)", () => {
    const html = renderToString(
      <AdaptiveStage geometry={geometryOf(sidecar("balanced"))} />,
    );
    expect(html).toContain('data-motion="enabled"');
  });

  it("explicit reducedMotion prop overrides the environment", () => {
    const html = renderToString(
      <AdaptiveStage
        geometry={geometryOf(sidecar("balanced"))}
        reducedMotion
      />,
    );
    expect(html).toContain('data-motion="reduced"');
  });

  it("CSS reduced-motion block kills the stage transition", () => {
    const mediaBlock = stylesCss.slice(
      stylesCss.indexOf("@media (prefers-reduced-motion: reduce)"),
    );
    expect(mediaBlock).toMatch(
      /\[data-motion="enabled"\] \.panel-slot\s*\{[^}]*transition:\s*none/s,
    );
  });
});
