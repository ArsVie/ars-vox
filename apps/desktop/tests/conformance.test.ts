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

import type {
  ConfirmationStatus,
  LayoutSlotsWire,
  MediaState,
  NotificationKind,
  VoiceState,
  WirePanelId,
} from "../src/contracts";
import { KNOWN_PANELS } from "../src/layout/engine";

const SCHEMA_PATH = new URL(
  "../../../packages/contracts/schemas/ui-commands.schema.json",
  import.meta.url,
);
const EVENTS_SCHEMA_PATH = new URL(
  "../../../packages/contracts/schemas/agent-events.schema.json",
  import.meta.url,
);

interface JsonSchema {
  $defs?: Record<string, { properties?: Record<string, unknown>; required?: string[]; enum?: string[] }>;
}

function loadSchema(path: URL): JsonSchema {
  return JSON.parse(readFileSync(path, "utf8")) as JsonSchema;
}

const uiSchema = loadSchema(SCHEMA_PATH);
const eventsSchema = loadSchema(EVENTS_SCHEMA_PATH);
const uiDefs = uiSchema.$defs ?? {};
const eventsDefs = eventsSchema.$defs ?? {};

/** Values the layout engine hosts in slots. */
const LAYOUT_PANELS = [...KNOWN_PANELS] as string[];
/** Overlay panels that exist on the wire but live outside the registry. */
const OVERLAY_PANELS = ["confirmation", "notification"];

describe("layout.apply conformance with the Python schema", () => {
  it("LayoutTemplate enum contains the frozen 4 + legacy aliases", () => {
    const enumValues = uiDefs.LayoutTemplate?.enum ?? [];
    expect(enumValues).toEqual(
      expect.arrayContaining(["focus", "split", "reading", "dashboard"]),
    );
    expect(enumValues).toEqual(
      expect.arrayContaining(["reference", "background_media"]),
    );
  });

  it("LayoutApply carries optional slots referencing LayoutSlots", () => {
    const applyProps = uiDefs.LayoutApply?.properties ?? {};
    expect(applyProps.slots).toBeDefined();
    const slotsRef = (applyProps.slots as { anyOf?: Array<{ $ref?: string }> })
      .anyOf?.some((a) => a.$ref === "#/$defs/LayoutSlots");
    expect(slotsRef).toBe(true);
    // the frozen wire shape also keeps primary/secondary
    expect(applyProps.primary_panel).toBeDefined();
    expect(applyProps.secondary_panel).toBeDefined();
  });

  it("LayoutSlots has required main with optional side/rail/dock", () => {
    const slots = uiDefs.LayoutSlots;
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

describe("wire enum parity with the Python schemas", () => {
  it("NotificationKind matches the schema enum", () => {
    const schemaValues = (uiDefs.NotificationKind?.enum ?? []) as NotificationKind[];
    const tsValues: NotificationKind[] = ["reminder", "alarm", "info", "error"];
    expect(schemaValues).toEqual(tsValues);
  });

  it("MediaState matches the schema enum", () => {
    const schemaValues = (uiDefs.MediaState?.enum ?? []) as MediaState[];
    const tsValues: MediaState[] = ["playing", "paused", "stopped"];
    expect(schemaValues).toEqual(tsValues);
  });

  it("ConfirmationStatus matches the agent-events schema enum", () => {
    const schemaValues = (eventsDefs.ConfirmationStatus?.enum ?? []) as ConfirmationStatus[];
    const tsValues: ConfirmationStatus[] = [
      "pending",
      "approved",
      "executing",
      "executed",
      "failed",
      "cancelled",
      "expired",
      "superseded",
    ];
    expect(schemaValues).toEqual(tsValues);
  });

  it("VoiceState matches the agent-events schema enum", () => {
    const schemaValues = (eventsDefs.VoiceState?.enum ?? []) as VoiceState[];
    const tsValues: VoiceState[] = [
      "sleeping",
      "listening",
      "thinking",
      "speaking",
      "waiting_for_confirmation",
      "stopping",
      "error",
    ];
    expect(schemaValues).toEqual(tsValues);
  });

  it("every schema PanelType is accepted by the TS wire (layout + overlays)", () => {
    const schemaPanels = (uiDefs.PanelType?.enum ?? []) as WirePanelId[];
    expect(schemaPanels.length).toBeGreaterThanOrEqual(14);
    for (const panel of schemaPanels) {
      expect(
        LAYOUT_PANELS.includes(panel) || OVERLAY_PANELS.includes(panel),
        `PanelType ${panel} must be a KNOWN_PANEL or an overlay panel`,
      ).toBe(true);
    }
  });

  it("KNOWN_PANELS contains no values outside the schema PanelType", () => {
    const schemaPanels = uiDefs.PanelType?.enum ?? [];
    for (const panel of LAYOUT_PANELS) {
      expect(schemaPanels).toContain(panel);
    }
  });
});
