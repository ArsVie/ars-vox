/**
 * UI-102 — AdaptiveStage render tests (SSR renderToString, node env).
 *
 * Verifies the geometry engine output renders into the DOM: .panel-slot
 * contract kept, placeholder surfaces land in their computed slots, and a
 * surface moving between slots is keyed by surfaceId (same identity, new
 * position) — no remount, no new instance.
 */
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";

import {
  ALL_TEMPLATES,
  PLACEHOLDER_REGISTERED_IDS,
  TEMPLATE_FIXTURES,
} from "../src/adaptive/fixtures";
import type { LayoutSpec } from "../src/adaptive/contracts";
import {
  computeAdaptiveGeometry,
  type AdaptiveGeometry,
} from "../src/layout/adaptiveEngine";
import { AdaptiveStage } from "../src/layout/AdaptiveStage";

const DESKTOP = { width: 1280, height: 800 };

function render(spec: LayoutSpec): string {
  const geometry = computeAdaptiveGeometry(spec, DESKTOP, PLACEHOLDER_REGISTERED_IDS);
  return renderToString(<AdaptiveStage geometry={geometry} />);
}

function geometryOf(spec: LayoutSpec): AdaptiveGeometry {
  return computeAdaptiveGeometry(spec, DESKTOP, PLACEHOLDER_REGISTERED_IDS);
}

describe("AdaptiveStage render (all five templates)", () => {
  it("renders every template fixture with its slots and surfaces", () => {
    for (const template of ALL_TEMPLATES) {
      const html = render(TEMPLATE_FIXTURES[template]);
      expect(html).toContain('class="panel-slot panel-slot--main"');
      expect(html).toContain("placeholder.primary");
      expect(html).toContain(`data-template="${template}"`);
    }
  });

  it("sidecar renders main and side slots with exact fraction styles", () => {
    const html = render(TEMPLATE_FIXTURES.sidecar);
    expect(html).toContain('class="panel-slot panel-slot--main"');
    expect(html).toContain('class="panel-slot panel-slot--side"');
    // 0.72 balanced main: 72% width, full height; side 28%.
    expect(html).toContain("width:72%");
    expect(html).toContain("height:100%");
    expect(html).toContain("width:28%");
    expect(html).toContain("left:72%");
  });

  it("triple renders main, side and rail in order", () => {
    const html = render(TEMPLATE_FIXTURES.triple);
    const mainIndex = html.indexOf('class="panel-slot panel-slot--main"');
    const sideIndex = html.indexOf('class="panel-slot panel-slot--side"');
    const railIndex = html.indexOf('class="panel-slot panel-slot--rail"');
    expect(mainIndex).toBeGreaterThan(-1);
    expect(sideIndex).toBeGreaterThan(mainIndex);
    expect(railIndex).toBeGreaterThan(sideIndex);
  });

  it("focus renders exactly one slot", () => {
    const html = render(TEMPLATE_FIXTURES.focus);
    expect(html.match(/class="panel-slot/g)).toHaveLength(1);
  });

  it("placeholder surfaces carry identity + role data attributes", () => {
    const html = render(TEMPLATE_FIXTURES.sidecar);
    expect(html).toContain('data-surface-id="placeholder.primary"');
    expect(html).toContain('data-role="primary"');
    expect(html).toContain('data-slot="main"');
    expect(html).toContain('data-surface-id="placeholder.companion"');
    expect(html).toContain('data-role="companion"');
    expect(html).toContain('data-slot="side"');
  });

  it("surface moves between slots by identity — same surfaceId, new slot", () => {
    const before = geometryOf(TEMPLATE_FIXTURES.sidecar);
    const htmlBefore = renderToString(<AdaptiveStage geometry={before} />);
    expect(htmlBefore).toContain(
      'data-surface-id="placeholder.companion" data-role="companion" data-slot="side"',
    );

    const moved: LayoutSpec = {
      template: "sidecar",
      assignments: [
        { surfaceId: "placeholder.companion", role: "primary", slot: "main" },
        { surfaceId: "placeholder.primary", role: "companion", slot: "side" },
      ],
      proportion: "balanced",
    };
    const after = geometryOf(moved);
    const htmlAfter = renderToString(<AdaptiveStage geometry={after} />);
    expect(htmlAfter).toContain(
      'data-surface-id="placeholder.companion" data-role="primary" data-slot="main"',
    );
    // Identity is surfaceId: the companion placeholder is still the same
    // element key, now in main.
    expect(htmlAfter).toContain("placeholder.companion");
    expect(htmlAfter).not.toContain(
      'data-surface-id="placeholder.companion" data-role="companion"',
    );
  });

  it("adds no container chrome (no headers, cards, or borders)", () => {
    const html = render(TEMPLATE_FIXTURES.triple);
    expect(html).not.toContain("panel-header");
    expect(html).not.toContain('class="panel ');
    expect(html).not.toContain("border");
    expect(html).not.toContain("box-shadow");
  });
});
