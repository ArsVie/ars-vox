/**
 * GATE-5 (W0-SLICE) — snapshot restore helpers.
 *
 * The reconnect snapshot's adaptive workspace reconstruction. The
 * composition is applied through the SAME choke live agent compositions
 * use (registry-validated, inertia guarded) — the store supplies the
 * choke callbacks; this module owns the validation/mapping mechanics.
 * Returns whether a composition was applied (the caller latches its
 * config-default guard, ADV-F4).
 */

import { EMPTY_OVERRIDES, type OverrideSet } from "../adaptive/overrides";
import type {
  AdaptiveTemplate,
  LayoutSpec as AdaptiveLayoutSpec,
  Proportion,
  SurfaceRole,
} from "../adaptive/contracts";
import type { AdaptiveSnapshot } from "../contracts";
import type { ApplyAdaptiveSpecOptions } from "./adaptiveTypes";

/**
 * R33: reconstruct the adaptive workspace from the snapshot through the
 * ONE choke. Invalid compositions never crash the event path — the live
 * desk is kept and the rejection is observable (recorded by the caller's
 * callback).
 *
 * @returns true when a composition was applied (caller latches the
 *          config-default guard so a later config_update cannot land the
 *          default over the restored desk, ADV-F4).
 */
export function restoreAdaptiveFromSnapshot(
  ad: AdaptiveSnapshot,
  applySpec: (
    spec: AdaptiveLayoutSpec,
    options?: ApplyAdaptiveSpecOptions,
  ) => void,
  recordRejection: (error: unknown) => void,
): boolean {
  if (
    !ad ||
    typeof ad.template !== "string" ||
    !ad.template ||
    !Array.isArray(ad.assignments) ||
    ad.assignments.length === 0
  ) {
    return false;
  }
  const assignments = ad.assignments
    .filter(
      (a) =>
        a &&
        typeof a.surface_id === "string" &&
        typeof a.role === "string" &&
        typeof a.slot === "string",
    )
    .map((a) => ({
      surfaceId: a.surface_id,
      role: a.role as SurfaceRole,
      slot: a.slot,
    }));
  if (assignments.length === 0) return false;
  try {
    applySpec(
      {
        template: ad.template as AdaptiveTemplate,
        assignments,
        proportion: (ad.proportion as Proportion) ?? null,
      },
      {
        // Authoritative server truth (R33): restore WITH the
        // snapshot constraint set in one shot through the choke,
        // never damped by inertia on an authoritative restore.
        overrides:
          ad.overrides && typeof ad.overrides === "object"
            ? ({ bySurface: ad.overrides } as OverrideSet)
            : EMPTY_OVERRIDES,
        userInitiated: true,
      },
    );
    return true;
  } catch (error) {
    // The choke's geometry pre-check records its own rejection;
    // a throw from the constraint/resolve stages lands here.
    recordRejection(error);
    return false;
  }
}
