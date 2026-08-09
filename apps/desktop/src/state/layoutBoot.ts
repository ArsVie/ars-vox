/**
 * GATE-5 (W0-SLICE) — store boot/layout helpers.
 *
 * Pure adaptive-domain helpers the store's choke points use (the boot
 * default composition, the manual-open slot filler, the config template
 * mapping). Relocated out of the god store so store.ts keeps only the
 * choke bodies; they are NOT an authority — applyAdaptiveSpec in
 * store.ts remains the single layout choke.
 */

import { DEFAULT_PRIMARY, isPanelId } from "../contracts";
import {
  type AdaptiveTemplate,
  type LayoutSpec as AdaptiveLayoutSpec,
  type Proportion,
  TEMPLATE_SLOTS,
} from "../adaptive/contracts";
import { LEGACY_TEMPLATE_MAP } from "../adaptive/planner";
import { surfaceRegistry } from "../roles/registry";

/** Slot → semantic role for addSurfaceToSpec (mirrors WIRE_SLOT_ROLE in
 *  the planner: the adaptive contract's frozen role vocabulary). */
function slotRole(slot: string): "primary" | "companion" | "support" {
  if (slot === "main") return "primary";
  if (slot === "side") return "companion";
  return "support";
}

/**
 * R19 (GATE-3.5): place a surface into a composition deterministically —
 * the first FREE slot of the current template (main→primary, side→
 * companion, rail→support); when the template is full, step up to triple;
 * when nowhere to go, return the input unchanged (the degrade layer would
 * drop the newcomer anyway). Mirrors the legacy engine's "fill empty
 * slots" rule for the manual-open source.
 */
export function addSurfaceToSpec(
  spec: AdaptiveLayoutSpec,
  surfaceId: string,
): AdaptiveLayoutSpec {
  if (spec.assignments.some((a) => a.surfaceId === surfaceId)) return spec;
  const occupied = new Set(spec.assignments.map((a) => a.slot));
  const candidates = [spec.template, "triple"] as const;
  for (const template of candidates) {
    const free = TEMPLATE_SLOTS[template].find(
      (s: string) => !occupied.has(s),
    );
    if (free) {
      return {
        ...spec,
        template,
        assignments: [
          ...spec.assignments,
          { surfaceId, role: slotRole(free), slot: free },
        ],
      };
    }
  }
  return spec;
}

/**
 * GATE-3.5 (W2-STORE): the boot default composition — the adaptive
 * spec a layout command operates on when the config-driven default
 * has not landed yet. Registry-gated: an unregistered anchor returns
 * null (commands no-op; the registry gate never throws on boot data).
 */
export function bootDefaultSpec(): AdaptiveLayoutSpec | null {
  if (!surfaceRegistry.has(DEFAULT_PRIMARY)) return null;
  return {
    template: "focus",
    assignments: [
      { surfaceId: DEFAULT_PRIMARY, role: "primary", slot: "main" },
    ],
  };
}

/** R19 (GATE-3.5): config default_template → adaptive template id.
 *  Adaptive ids pass through; legacy wire ids (focus/split/reading/
 *  dashboard) map through the planner's frozen legacy map. Unknown ids
 *  → null (no default layout). */
export function adaptiveTemplateFromConfig(
  value: string,
): AdaptiveTemplate | null {
  if (value in TEMPLATE_SLOTS) return value as AdaptiveTemplate;
  return LEGACY_TEMPLATE_MAP[value] ?? null;
}

/** isPanelId re-export — kept local so layoutBoot needs no caller-side
 *  contracts imports (store.ts uses the canonical import). */
export { isPanelId };
export type { Proportion };
