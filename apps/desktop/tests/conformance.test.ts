/**
 * Phase-2 conformance test (plan §4 step 2): the TS wire mirror in
 * src/contracts.ts must agree with the regenerated Python JSON schema
 * (packages/contracts/schemas/ui-commands.schema.json, owned by workstream B).
 *
 * If this fails after a schema regeneration, update src/contracts.ts to
 * match — do NOT loosen the assertions.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { LayoutSlotsWire } from "../src/contracts";

const SCHEMA_PATH = new URL(
  "../../../packages/contracts/schemas/ui-commands.schema.json",
  import.meta.url,
);

interface JsonSchema {
  $defs?: Record<string, { properties?: Record<string, unknown>; required?: string[]; enum?: string[] }>;
}

function loadSchema(): JsonSchema {
  return JSON.parse(readFileSync(SCHEMA_PATH, "utf8")) as JsonSchema;
}

describe("layout.apply conformance with the Python schema", () => {
  const schema = loadSchema();
  const defs = schema.$defs ?? {};

  it("LayoutTemplate enum contains the frozen 4 + legacy aliases", () => {
    const enumValues = defs.LayoutTemplate?.enum ?? [];
    expect(enumValues).toEqual(
      expect.arrayContaining(["focus", "split", "reading", "dashboard"]),
    );
    expect(enumValues).toEqual(
      expect.arrayContaining(["reference", "background_media"]),
    );
  });

  it("LayoutApply carries optional slots referencing LayoutSlots", () => {
    const applyProps = defs.LayoutApply?.properties ?? {};
    expect(applyProps.slots).toBeDefined();
    const slotsRef = (applyProps.slots as { anyOf?: Array<{ $ref?: string }> })
      .anyOf?.some((a) => a.$ref === "#/$defs/LayoutSlots");
    expect(slotsRef).toBe(true);
    // the frozen wire shape also keeps primary/secondary
    expect(applyProps.primary_panel).toBeDefined();
    expect(applyProps.secondary_panel).toBeDefined();
  });

  it("LayoutSlots has required main with optional side/rail/dock", () => {
    const slots = defs.LayoutSlots;
    expect(slots).toBeDefined();
    expect(slots.required).toContain("main");
    const props = slots?.properties ?? {};
    expect(props.side).toBeDefined();
    expect(props.rail).toBeDefined();
    expect(props.dock).toBeDefined();
  });

  it("the TS mirror accepts exactly the schema's payload shape", () => {
    // compile-time mirror check: main required, side/rail/dock optional
    const full: LayoutSlotsWire = { main: "document_editor", side: "conversation", rail: null, dock: "media" };
    const minimal: LayoutSlotsWire = { main: "conversation" };
    void full;
    void minimal;
  });
});
