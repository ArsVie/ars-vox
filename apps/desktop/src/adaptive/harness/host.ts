/**
 * UI-105 — Surface host reference + remount/state-loss detection.
 *
 * The frozen contract says: "Moving a surface between roles or slots MUST
 * reuse the same surfaceId — surface state must never be reset merely
 * because its role or slot changed." The harness turns that into a testable
 * mechanism:
 *
 *  - Every mounted surface instance carries a monotonic `mountCount` marker
 *    and a state bag. A remount (new instance for an existing surfaceId) is
 *    the failure mode the harness exists to catch — it increments the
 *    counter and wipes the state bag, exactly like a React remount losing
 *    component state.
 *  - `SurfaceHost` is the REFERENCE behavior (what UI-103's surface host
 *    must do): instances are keyed by surfaceId and survive role changes,
 *    template changes, AND leaving/re-entering the layout. Tests run
 *    workflows against it to prove the harness catches nothing.
 *  - `createFaultyHost()` injects realistic bugs (remount-every-apply,
 *    drop-on-unmount). Tests run the SAME workflow against faulty hosts to
 *    prove the harness DETECTS the remount/state loss — the core acceptance
 *    (c). The harness never trusts a host's self-report: survival checks
 *    snapshot instances before/after a transition and compare identity AND
 *    mountCount, so even a host that "lies" is caught.
 */

import type { LayoutSpec } from "../contracts";
import type { AppliedLayout } from "./driver";
import { applyLayoutForTest } from "./driver";

/** One mounted surface instance: identity marker + state bag. */
export interface SurfaceInstanceState {
  surfaceId: string;
  /**
   * Monotonic mount counter. Starts at 1 on first mount; a remount
   * increments it and resets `state`. Stable across role/slot/template
   * changes when the host behaves.
   */
  mountCount: number;
  /** Surface-owned state bag. Keyed by surfaceId via the instance. */
  state: Record<string, unknown>;
}

/** A transition violation the harness detected. */
export type TransitionViolation =
  | {
      kind: "remount";
      surfaceId: string;
      detail: string;
    }
  | {
      kind: "state-loss";
      surfaceId: string;
      detail: string;
    }
  | {
      kind: "primary-mismatch";
      surfaceId: string;
      detail: string;
    };

/** Snapshot of the host's instances (for before/after comparison). */
export type InstanceSnapshot = ReadonlyMap<string, SurfaceInstanceState>;

/** What happened during one transition (host self-report — never trusted). */
export interface TransitionReport {
  applied: AppliedLayout;
  /** surfaceIds currently occupying template slots. */
  mounted: string[];
  /** surfaceIds mounted for the first time in this transition. */
  freshMounts: string[];
  /** surfaceIds kept from the previous layout (instance preserved). */
  retained: string[];
  /** surfaceIds that left the template slots (instances retained by the host). */
  unmounted: string[];
}

function freshInstance(surfaceId: string): SurfaceInstanceState {
  return { surfaceId, mountCount: 1, state: {} };
}

/**
 * Reference surface-host behavior for tests. UI-103 owns the real surface
 * host; this is the contract-ideal the workflow harness drives against.
 */
export class SurfaceHost {
  protected instances = new Map<string, SurfaceInstanceState>();
  protected mounted = new Set<string>();

  /** Apply a validated-compatible LayoutSpec: mount/keep/unmount by surfaceId. */
  applyTransition(
    spec: LayoutSpec,
    registered: ReadonlySet<string>,
  ): TransitionReport {
    const applied = applyLayoutForTest(spec, registered);
    const freshMounts: string[] = [];
    const retained: string[] = [];
    const nextMounted = new Set<string>();
    for (const a of spec.assignments) {
      // Classification is by instance KNOWLEDGE, not mountCount: a retained
      // instance that left the layout and returns is NOT a fresh mount.
      // (Self-report only — survival detection uses snapshots, never this.)
      const wasKnown = this.instances.has(a.surfaceId);
      this.ensureInstance(a.surfaceId);
      if (wasKnown) {
        retained.push(a.surfaceId);
      } else {
        freshMounts.push(a.surfaceId);
      }
      nextMounted.add(a.surfaceId);
    }
    const unmounted = [...this.mounted].filter((id) => !nextMounted.has(id));
    this.mounted = nextMounted;
    return { applied, mounted: [...nextMounted], freshMounts, retained, unmounted };
  }

  /**
   * Hook: produce the instance for a surfaceId on mount. The reference
   * behavior reuses the retained instance whenever one exists (even after
   * the surface left the layout) — that is what makes state survive.
   */
  protected ensureInstance(surfaceId: string): SurfaceInstanceState {
    const existing = this.instances.get(surfaceId);
    if (existing) {
      return existing;
    }
    const fresh = freshInstance(surfaceId);
    this.instances.set(surfaceId, fresh);
    return fresh;
  }

  /** Access an instance (mounted or retained). Undefined if never mounted. */
  instance(surfaceId: string): SurfaceInstanceState | undefined {
    return this.instances.get(surfaceId);
  }

  /** Explicitly forget a surface (host teardown). */
  purge(surfaceId: string): void {
    this.instances.delete(surfaceId);
    this.mounted.delete(surfaceId);
  }

  /** Live snapshot for before/after survival comparison. */
  snapshot(): InstanceSnapshot {
    return new Map(this.instances);
  }
}

/** Host that remounts EVERY surface on every apply — state always wiped. */
class RemountEveryApplyHost extends SurfaceHost {
  protected ensureInstance(surfaceId: string): SurfaceInstanceState {
    const existing = this.instances.get(surfaceId);
    const fresh = {
      surfaceId,
      mountCount: (existing?.mountCount ?? 0) + 1,
      state: {},
    };
    this.instances.set(surfaceId, fresh);
    return fresh;
  }
}

/** Host that drops instances when a surface leaves the layout — state lost on return. */
class DropOnUnmountHost extends SurfaceHost {
  applyTransition(spec: LayoutSpec, registered: ReadonlySet<string>): TransitionReport {
    const report = super.applyTransition(spec, registered);
    for (const id of report.unmounted) {
      this.instances.delete(id);
    }
    return report;
  }
}

export type FaultKind = "remount-every-apply" | "drop-on-unmount";

/**
 * Intentionally broken hosts for proving the harness detects state loss.
 * Tests run the same workflow against these and assert the harness flags
 * exactly the surfaces whose state was lost.
 */
export function createFaultyHost(kind: FaultKind): SurfaceHost {
  if (kind === "remount-every-apply") {
    return new RemountEveryApplyHost();
  }
  return new DropOnUnmountHost();
}

/**
 * THE core assertion: for every surfaceId in `survivors`, the instance
 * must exist after the transition AND be the same object with the same
 * mountCount as before. Any divergence is an accidental remount / state
 * loss — the exact failure this harness exists to detect.
 *
 * `survivors` may include shell-owned persistent surfaces (media bar):
 * they are not template slots, but their instances must still survive.
 */
export function checkTransitionSurvival(
  before: InstanceSnapshot,
  after: InstanceSnapshot,
  survivors: readonly string[],
): TransitionViolation[] {
  const violations: TransitionViolation[] = [];
  for (const surfaceId of survivors) {
    const prior = before.get(surfaceId);
    const current = after.get(surfaceId);
    if (!current) {
      violations.push({
        kind: "state-loss",
        surfaceId,
        detail: `instance for "${surfaceId}" vanished during the transition`,
      });
      continue;
    }
    if (!prior) {
      violations.push({
        kind: "remount",
        surfaceId,
        detail: `"${surfaceId}" is listed as a survivor but had no prior instance`,
      });
      continue;
    }
    if (current !== prior) {
      violations.push({
        kind: "remount",
        surfaceId,
        detail:
          `instance object for "${surfaceId}" was replaced during the transition ` +
          `(identity changed) — state bag lost`,
      });
      continue;
    }
    if (current.mountCount !== prior.mountCount) {
      violations.push({
        kind: "remount",
        surfaceId,
        detail:
          `mountCount for "${surfaceId}" changed ${prior.mountCount} -> ` +
          `${current.mountCount} during the transition — surface was remounted`,
      });
    }
  }
  return violations;
}
