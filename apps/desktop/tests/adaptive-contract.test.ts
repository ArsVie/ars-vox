/**
 * UI-000 conformance: the TS mirror (src/adaptive/contracts.ts) must agree
 * with the Python schema (packages/contracts/schemas/adaptive-layout.schema.json),
 * fixtures must be valid, and validation must enforce the frozen rules.
 *
 * If this fails after a schema regeneration, update src/adaptive/contracts.ts
 * to match — do NOT loosen the assertions.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  ASSIGNABLE_ROLES,
  EQUAL_SPLIT_TEMPLATES,
  TEMPLATE_SLOTS,
  validateLayoutSpec,
  type AdaptiveTemplate,
} from "../src/adaptive/contracts";
import {
  ALL_TEMPLATES,
  PLACEHOLDER_REGISTERED_IDS,
  TEMPLATE_FIXTURES,
} from "../src/adaptive/fixtures";
import { ALL_TOKEN_NAMES, TOKEN_GROUPS, TOKEN_NAMES, isTokenName } from "../src/adaptive/tokens";

const SCHEMA_PATH = new URL(
  "../../../packages/contracts/schemas/adaptive-layout.schema.json",
  import.meta.url,
);

interface JsonSchema {
  $defs?: Record<
    string,
    { properties?: Record<string, unknown>; required?: string[]; enum?: string[] }
  >;
  properties?: Record<string, unknown>;
}

function loadSchema(path: URL): JsonSchema {
  return JSON.parse(readFileSync(path, "utf8")) as JsonSchema;
}

const schema = loadSchema(SCHEMA_PATH);
const defs = schema.$defs ?? {};

describe("adaptive contract schema conformance", () => {
  it("SurfaceRole enum matches the Python schema", () => {
    const roles = (defs.SurfaceRole?.enum ?? []) as string[];
    expect(roles).toEqual(["primary", "companion", "support", "persistent"]);
    expect([...ASSIGNABLE_ROLES]).toEqual(["primary", "companion", "support"]);
  });

  it("AdaptiveTemplate enum matches the five frozen templates", () => {
    const templates = (defs.AdaptiveTemplate?.enum ?? []) as string[];
    expect(templates).toEqual([...ALL_TEMPLATES]);
    expect(templates).toEqual(["focus", "sidecar", "stack", "split", "triple"]);
  });

  it("Proportion enum matches the Python schema", () => {
    expect(defs.Proportion?.enum).toEqual(["narrow", "balanced", "wide"]);
  });

  it("LayoutSpec carries only semantic fields — no geometry", () => {
    // The schema root IS LayoutSpec; $defs holds only enums/assignments.
    const props = schema.properties ?? {};
    expect(Object.keys(props).sort()).toEqual([
      "assignments",
      "proportion",
      "template",
    ]);
  });

  it("every template has a fixture and its slots match the contract", () => {
    for (const t of ALL_TEMPLATES) {
      const fixture = TEMPLATE_FIXTURES[t];
      expect(fixture.template).toBe(t);
      const offered = TEMPLATE_SLOTS[t as AdaptiveTemplate];
      for (const a of fixture.assignments) {
        expect(offered).toContain(a.slot);
      }
    }
  });

  it("all fixtures validate against the placeholder registry", () => {
    for (const t of ALL_TEMPLATES) {
      expect(() =>
        validateLayoutSpec(TEMPLATE_FIXTURES[t], PLACEHOLDER_REGISTERED_IDS),
      ).not.toThrow();
    }
  });

  it("role transition reuses the same surfaceId (identity survives)", () => {
    const sidecar = TEMPLATE_FIXTURES.sidecar;
    const swapped = {
      template: "sidecar" as const,
      assignments: [
        { surfaceId: "placeholder.companion", role: "primary" as const, slot: "main" },
        { surfaceId: "placeholder.primary", role: "companion" as const, slot: "side" },
      ],
    };
    expect(new Set(sidecar.assignments.map((a) => a.surfaceId))).toEqual(
      new Set(swapped.assignments.map((a) => a.surfaceId)),
    );
    expect(() =>
      validateLayoutSpec(swapped, PLACEHOLDER_REGISTERED_IDS),
    ).not.toThrow();
  });

  it("persistent role is rejected inside template assignments", () => {
    expect(() =>
      validateLayoutSpec(
        {
          template: "sidecar",
          assignments: [
            { surfaceId: "placeholder.primary", role: "primary", slot: "main" },
            { surfaceId: "placeholder.persistent", role: "persistent", slot: "side" },
          ],
        },
        PLACEHOLDER_REGISTERED_IDS,
      ),
    ).toThrow(/shell-controlled/);
  });

  it("unknown slot fails deterministically", () => {
    expect(() =>
      validateLayoutSpec(
        {
          template: "focus",
          assignments: [
            { surfaceId: "placeholder.primary", role: "primary", slot: "side" },
          ],
        },
        PLACEHOLDER_REGISTERED_IDS,
      ),
    ).toThrow(/not offered/);
  });

  it("unregistered surface fails deterministically", () => {
    expect(() =>
      validateLayoutSpec(
        {
          template: "focus",
          assignments: [
            { surfaceId: "nope", role: "primary", slot: "main" },
          ],
        },
        PLACEHOLDER_REGISTERED_IDS,
      ),
    ).toThrow(/unregistered/);
  });

  it("split allows two primaries; others require exactly one", () => {
    expect(EQUAL_SPLIT_TEMPLATES.has("split")).toBe(true);
    expect(() =>
      validateLayoutSpec(
        {
          template: "split",
          assignments: [
            { surfaceId: "placeholder.primary", role: "primary", slot: "main" },
            { surfaceId: "placeholder.companion", role: "primary", slot: "side" },
          ],
        },
        PLACEHOLDER_REGISTERED_IDS,
      ),
    ).not.toThrow();
    expect(() =>
      validateLayoutSpec(
        {
          template: "sidecar",
          assignments: [
            { surfaceId: "placeholder.primary", role: "primary", slot: "main" },
            { surfaceId: "placeholder.companion", role: "primary", slot: "side" },
          ],
        },
        PLACEHOLDER_REGISTERED_IDS,
      ),
    ).toThrow(/exactly one primary/);
  });
});

describe("token naming contract", () => {
  it("groups are frozen and exhaustive", () => {
    expect(TOKEN_GROUPS).toEqual([
      "typography",
      "spacing",
      "divider",
      "surface",
      "radius",
      "control",
      "icon",
      "state",
    ]);
  });

  it("every group has a non-empty catalog", () => {
    for (const g of TOKEN_GROUPS) {
      expect(TOKEN_NAMES[g].length).toBeGreaterThan(0);
    }
  });

  it("every catalog name is recognized by isTokenName", () => {
    for (const g of TOKEN_GROUPS) {
      for (const name of TOKEN_NAMES[g]) {
        expect(isTokenName(name)).toBe(true);
      }
    }
    expect(ALL_TOKEN_NAMES.size).toBeGreaterThan(20);
  });

  it("tokens are kebab-case and group-prefixed", () => {
    for (const g of TOKEN_GROUPS) {
      for (const name of TOKEN_NAMES[g]) {
        expect(name.startsWith(`${g}-`)).toBe(true);
        expect(name).toMatch(/^[a-z]+(-[a-z0-9]+)*$/);
      }
    }
  });
});
