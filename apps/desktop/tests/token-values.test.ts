/**
 * UI-104 conformance (2026-08-07): the frozen token catalog in
 * src/adaptive/tokens.ts must be FULLY implemented as CSS custom
 * properties in src/styles.css, with the frozen semantic rules:
 *
 *   - strong/normal/subordinate typography hierarchy is explicit;
 *   - minimum interaction sizing for the target UX (older user,
 *     Spanish-first): lg >= 48px touch target, md >= 40px;
 *   - region surfaces are NOT cards; card CONTENT has its own surface;
 *   - no invented group-prefixed tokens (one visual language);
 *   - legacy pre-catalog tokens keep working via the bridge.
 *
 * If this fails, update styles.css — do NOT loosen the assertions.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  ALL_TOKEN_NAMES,
  TOKEN_GROUPS,
  TOKEN_NAMES,
  isTokenName,
} from "../src/adaptive/tokens";

const CSS_PATH = new URL("../src/styles.css", import.meta.url);
const GROUP_PREFIX = new RegExp(`^(?:${TOKEN_GROUPS.join("|")})-`);

interface TypoValue {
  weight: number;
  size: number;
}

function readCss(): { raw: string; tokens: Map<string, string> } {
  const raw = readFileSync(CSS_PATH, "utf8");
  const stripped = raw.replace(/\/\*[\s\S]*?\*\//g, "");
  const tokens = new Map<string, string>();
  for (const m of stripped.matchAll(/--([a-z0-9][a-z0-9-]*)\s*:\s*([^;]+);/g)) {
    tokens.set(m[1], m[2].trim());
  }
  return { raw, tokens };
}

const { raw, tokens } = readCss();

function px(name: string): number {
  const v = tokens.get(name);
  expect(v, `--${name} must be defined in styles.css`).toBeDefined();
  const m = v!.match(/^(-?\d+(?:\.\d+)?)px$/);
  expect(m, `--${name} must be a plain px value, got: ${v}`).not.toBeNull();
  return Number(m![1]);
}

function typo(name: string): TypoValue {
  const v = tokens.get(name);
  expect(v, `--${name} must be defined in styles.css`).toBeDefined();
  const m = v!.match(/^(\d{3})\s+(\d+(?:\.\d+)?)px\//);
  expect(
    m,
    `--${name} must be font shorthand (weight size/line-height family), got: ${v}`,
  ).not.toBeNull();
  return { weight: Number(m![1]), size: Number(m![2]) };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function ruleUses(selector: string, fragment: string): boolean {
  return new RegExp(`${escapeRe(selector)}\\s*\\{[^}]*${escapeRe(fragment)}`).test(raw);
}

const TYPO_FAMILIES: Array<[string, string[]]> = [
  ["display", ["typography-display-strong", "typography-display-normal"]],
  ["title", ["typography-title-strong", "typography-title-normal"]],
  [
    "body",
    [
      "typography-body-strong",
      "typography-body-normal",
      "typography-body-subordinate",
    ],
  ],
  [
    "caption",
    [
      "typography-caption-strong",
      "typography-caption-normal",
      "typography-caption-subordinate",
    ],
  ],
];

describe("UI-104 token catalog <-> styles.css conformance", () => {
  it("every frozen token name exists as a CSS custom property", () => {
    for (const group of TOKEN_GROUPS) {
      for (const name of TOKEN_NAMES[group]) {
        expect(tokens.has(name), `--${name} (${group}) is missing from styles.css`).toBe(true);
      }
    }
    expect(tokens.size).toBeGreaterThan(60); // catalog (40) + legacy tokens
  });

  it("CSS group-prefixed tokens are exactly the catalog — no missing, no invented", () => {
    const cssCatalog = [...tokens.keys()].filter((k) => GROUP_PREFIX.test(k));
    expect(cssCatalog.sort()).toEqual([...ALL_TOKEN_NAMES].sort());
  });

  it("isTokenName() recognizes only catalog names", () => {
    // every group-prefixed token actually defined in CSS is a catalog name
    for (const k of tokens.keys()) {
      if (GROUP_PREFIX.test(k)) {
        expect(isTokenName(k), `--${k} is group-prefixed but not a catalog name`).toBe(true);
      }
    }
    // legacy and invented names must be rejected
    for (const name of [
      "radius", // legacy bare alias — not a catalog name
      "bg",
      "panel",
      "panel-2",
      "text",
      "accent",
      "shadow-panel",
      "typography-display", // missing suffix
      "spacing-xxl", // off-scale
      "surface-region-active-2",
      "control-height-xl",
      "state-hover-strong",
      "divider",
      "icon",
    ]) {
      expect(isTokenName(name), `${name} must NOT be a token name`).toBe(false);
    }
  });
});

describe("UI-104 typography hierarchy (strong/normal/subordinate)", () => {
  for (const [family, names] of TYPO_FAMILIES) {
    it(`${family}: strong >= normal >= subordinate in size AND weight`, () => {
      const vals = names.map(typo);
      for (let i = 1; i < vals.length; i++) {
        expect(vals[i - 1].size).toBeGreaterThanOrEqual(vals[i].size);
        expect(vals[i - 1].weight).toBeGreaterThanOrEqual(vals[i].weight);
      }
      // hierarchy must be real: -strong leads -subordinate in at least one axis
      expect(vals[0].weight).toBeGreaterThan(vals[vals.length - 1].weight);
    });
  }

  it("body-normal is the base voice (16px) and subordinate yields to it", () => {
    const body = TYPO_FAMILIES.find(([f]) => f === "body")![1];
    const normal = typo(body[1]);
    const subordinate = typo(body[2]);
    expect(normal.size).toBe(16);
    expect(subordinate.size).toBeLessThan(normal.size);
  });
});

describe("UI-104 scale rules", () => {
  it("spacing is a strict ascending scale (xs < sm < md < lg < xl)", () => {
    const sizes = ["spacing-xs", "spacing-sm", "spacing-md", "spacing-lg", "spacing-xl"].map(px);
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i]).toBeGreaterThan(sizes[i - 1]);
    }
  });

  it("radius is ascending and pill is the fully-round value", () => {
    const r = ["radius-xs", "radius-sm", "radius-md", "radius-lg"].map(px);
    for (let i = 1; i < r.length; i++) {
      expect(r[i]).toBeGreaterThan(r[i - 1]);
    }
    expect(px("radius-pill")).toBe(999);
  });

  it("control sizing meets the target UX floors (lg >= 48px, md >= 40px)", () => {
    expect(px("control-height-sm")).toBeLessThan(px("control-height-md"));
    expect(px("control-height-md")).toBeLessThan(px("control-height-lg"));
    expect(px("control-height-md")).toBeGreaterThanOrEqual(40);
    expect(px("control-height-lg")).toBeGreaterThanOrEqual(48);
    expect(px("control-touch-target")).toBeGreaterThanOrEqual(48);
    expect(px("control-height-lg")).toBeGreaterThanOrEqual(px("control-touch-target"));
  });

  it("icon sizes are ascending", () => {
    const s = ["icon-size-sm", "icon-size-md", "icon-size-lg"].map(px);
    expect(s[0]).toBeLessThan(s[1]);
    expect(s[1]).toBeLessThan(s[2]);
  });

  it("divider tokens are distinct and -subordinate is the subtle wash", () => {
    const strong = tokens.get("divider-strong");
    const normal = tokens.get("divider-normal");
    const subordinate = tokens.get("divider-subordinate");
    expect(strong).toBeDefined();
    expect(normal).toBeDefined();
    expect(subordinate).toBeDefined();
    expect(new Set([strong, normal, subordinate]).size).toBe(3);
    expect(subordinate).toMatch(/rgba\(/); // translucent, low-emphasis
  });
});

describe("UI-104 surface separation (regions are not cards)", () => {
  it("region, region-active, app and overlay surfaces exist", () => {
    for (const name of ["surface-app", "surface-region", "surface-region-active", "surface-overlay"]) {
      expect(tokens.has(name), `--${name} missing`).toBe(true);
    }
  });

  it("card CONTENT surface is distinct from region surfaces", () => {
    expect(tokens.get("surface-card")).not.toBe(tokens.get("surface-region"));
    expect(tokens.get("surface-card")).not.toBe(tokens.get("surface-region-active"));
    expect(tokens.get("surface-region-active")).not.toBe(tokens.get("surface-region"));
  });
});

describe("UI-104 state tokens", () => {
  it("focus/hover/active/disabled/reduced-motion all have values", () => {
    for (const name of ["state-focus-ring", "state-hover", "state-active", "state-disabled", "state-reduced-motion"]) {
      expect(tokens.has(name), `--${name} missing`).toBe(true);
    }
    expect(tokens.get("state-reduced-motion")).toBe("0s");
    expect(tokens.get("state-focus-ring")).not.toBe("");
  });
});

describe("UI-104 legacy bridge (reconciliation, no breakage)", () => {
  it("legacy tokens route shared values through the catalog", () => {
    expect(tokens.get("bg")).toBe("var(--surface-app)");
    expect(tokens.get("panel")).toBe("var(--surface-region)");
    expect(tokens.get("panel-2")).toBe("var(--surface-region-active)");
    expect(tokens.get("panel-3")).toBe("var(--surface-card)");
    expect(tokens.get("panel-border")).toBe("var(--divider-strong)");
    expect(tokens.get("panel-border-soft")).toBe("var(--divider-normal)");
    expect(tokens.get("radius")).toBe("var(--radius-md)");
  });

  it("radius-md is the 14px mid radius the legacy --radius alias resolves to", () => {
    expect(px("radius-md")).toBe(14);
  });

  it("canonical controls consume the catalog (not literals)", () => {
    expect(ruleUses(".stop-button", "height: var(--control-height-lg)")).toBe(true);
    expect(ruleUses(".overlay", "background: var(--surface-overlay)")).toBe(true);
    expect(ruleUses(".composer input:focus", "box-shadow: var(--state-focus-ring)")).toBe(true);
  });

  it("high-contrast mode overrides catalog surfaces so legacy + catalog consumers both adapt", () => {
    expect(ruleUses(".app[data-high-contrast]", "--surface-region:")).toBe(true);
    expect(ruleUses(".app[data-high-contrast]", "--divider-strong:")).toBe(true);
  });
});
