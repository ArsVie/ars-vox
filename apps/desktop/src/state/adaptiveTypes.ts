/**
 * GATE-5 (W0-SLICE) — adaptive state types.
 *
 * The store's layout choke (applyAdaptiveSpec in store.ts) keeps its
 * authority; these are its type definitions and the empty baseline,
 * relocated so the god store keeps only choke bodies. store.ts
 * re-exports them for existing import sites.
 */

import {
  EMPTY_OVERRIDES,
  type OverrideIntent,
  type OverrideSet,
} from "../adaptive/overrides";
import type { PlannerRejection } from "../adaptive/planner";
import type { LayoutSpec as AdaptiveLayoutSpec } from "../adaptive/contracts";
import type { ResolvedAssignment } from "../roles/fallback";

/**
 * UI-103 adaptive state: the last validated adaptive LayoutSpec plus its
 * role-resolved assignments. The config-driven default lands the first
 * composition at connect, so `spec` is null only before the server's
 * first config_update.
 *
 * UI-301: `lastRejection` records the planner's rejection reason for the
 * most recent agent layout intent that did NOT reach state (invalid model
 * output can never corrupt layout state — the rejection is the observable
 * trace). Null after a valid apply or a fresh store.
 *
 * UI-302: plus the persistent user constraint set (pin/stick/position/...)
 * that the override layer applies AFTER planner output.
 */
export interface AdaptiveState {
  spec: AdaptiveLayoutSpec | null;
  assignments: ResolvedAssignment[];
  lastRejection: PlannerRejection | null;
  /** UI-302: active user layout constraints, keyed by surfaceId. */
  overrides: OverrideSet;
  /** R19 (GATE-3.5): the composition captured when a fullscreen constraint
   *  ENGAGED — the fullscreen toggle's restore target. Null while no
   *  fullscreen constraint is active (or when it arrived via a snapshot
   *  restore, where it is not carried). Plain JSON — snapshot-safe. */
  preFullscreen: AdaptiveLayoutSpec | null;
  /** C5 (GATE-3.5, defect #2): the most recent UiCommand action that
   *  applyUiCommand did NOT handle (unknown wire action — JSON.parse casts
   *  bypass the exhaustive union). Latched diagnostic record: visible and
   *  testable, never throws. Null until an unknown action arrives. */
  lastUnhandledAction: string | null;
}

export const EMPTY_ADAPTIVE: AdaptiveState = {
  spec: null,
  assignments: [],
  lastRejection: null,
  overrides: EMPTY_OVERRIDES,
  preFullscreen: null,
  lastUnhandledAction: null,
};

/**
 * UI-302: options for applyAdaptiveSpec.
 */
export interface ApplyAdaptiveSpecOptions {
  /** UI-207: user-commanded change — the inertia scorer always applies it
   *  (bypasses the damping wall). Agent-initiated (planner) changes omit
   *  this and stay subject to inertia. An overrideIntent also counts as
   *  user-commanded. */
  userInitiated?: boolean;
  /** UI-302: a user override intent ("bigger", "right", "close", ...) to
   *  merge into the persistent constraint set. The constraint applies to
   *  this spec AFTER the planner's output and to every future planner
   *  spec until removed ("restore layout" / removeSurfaceOverrides). */
  overrideIntent?: OverrideIntent;
  /** R19 (GATE-3.5): full replacement constraint set, used WITHOUT
   *  overrideIntent when a caller needs to apply a modified set directly
   *  (e.g. removeSurfaceOverrides for the fullscreen toggle-off or a
   *  reconnect restoring the snapshot's constraints). When both are
   *  present, overrideIntent merges into this set. */
  overrides?: OverrideSet;
}
