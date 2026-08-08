/**
 * UI-105 — Canonical workflow definitions (frozen in the plan) as driveable
 * LayoutSpec transitions. No LLM: each step is a plain LayoutSpec applied
 * through the harness driver, with the expected primary activity and the
 * surfaces whose state must survive.
 *
 * Surface-agnostic by design: ids below are harness-owned SEMANTIC ids.
 * Product surfaces arrive in Wave 2; `remapWorkflow` lets real surfaceIds
 * slot in without touching the flow definition (see README).
 */

import type { LayoutSpec, SurfaceRegistration } from "../contracts";
import type { SurfaceHost } from "./host";
import { checkTransitionSurvival } from "./host";
import type { InstanceSnapshot } from "./host";
import { applyLayoutForTest } from "./driver";

/** Harness-owned semantic surface ids for the canonical flow. */
export const CANONICAL_SURFACES = {
  home: "surface.home",
  browser: "surface.browser",
  conversation: "surface.conversation",
  media: "surface.media",
  reader: "surface.reader",
  tasks: "surface.tasks",
} as const;

export type CanonicalSurfaceId = (typeof CANONICAL_SURFACES)[keyof typeof CANONICAL_SURFACES];

/** Registry for the canonical flow (every surface placeable in any role). */
export const CANONICAL_REGISTRY: SurfaceRegistration[] = Object.values(
  CANONICAL_SURFACES,
).map((surfaceId) => ({
  surfaceId,
  roles: ["primary", "companion", "support"],
  // Media is the shell-owned persistent-capable surface (media bar, UI-101/UI-205).
  persistentCapable: surfaceId === CANONICAL_SURFACES.media,
}));

export const CANONICAL_REGISTERED_IDS: ReadonlySet<string> = new Set(
  CANONICAL_REGISTRY.map((r) => r.surfaceId),
);

/** One step of a workflow: a transition plus what the harness must verify. */
export interface WorkflowStep {
  /** Stable step id (canonical flow step name). */
  id: string;
  /** Human-readable label. */
  label: string;
  /** The LayoutSpec to apply for this step. */
  spec: LayoutSpec;
  /** surfaceIds that must be `primary` after this step (exact match). */
  expectedPrimary: string[];
  /**
   * surfaceIds whose instance must survive INTO this step from the previous
   * one (same object identity + same mountCount). Detects remount/state loss.
   */
  stateSurvivors: string[];
  /**
   * Shell-owned persistent surfaces active during this step. NOT template
   * slots — but their instances must still survive (media keeps playing
   * while the user changes activity).
   */
  persistent?: string[];
}

/**
 * THE CANONICAL FLOW (frozen in docs/plans/adaptive-ui-redesign-execution-2026-08-07.md,
 * UI-105 canonical_flow): start/home -> open Facebook/browser -> open assistant
 * conversation alongside browser -> start video -> keep media playing while
 * changing activity -> open a book -> ask assistant about current activity ->
 * create a reminder -> return to browser.
 */
export const CANONICAL_FLOW: readonly WorkflowStep[] = [
  {
    id: "start-home",
    label: "Start/home",
    spec: {
      template: "focus",
      assignments: [
        { surfaceId: CANONICAL_SURFACES.home, role: "primary", slot: "main" },
      ],
    },
    expectedPrimary: [CANONICAL_SURFACES.home],
    stateSurvivors: [],
  },
  {
    id: "open-browser",
    label: "Open Facebook/browser",
    spec: {
      template: "focus",
      assignments: [
        { surfaceId: CANONICAL_SURFACES.browser, role: "primary", slot: "main" },
      ],
    },
    expectedPrimary: [CANONICAL_SURFACES.browser],
    stateSurvivors: [],
  },
  {
    id: "open-conversation",
    label: "Open assistant conversation alongside browser",
    spec: {
      template: "sidecar",
      assignments: [
        { surfaceId: CANONICAL_SURFACES.browser, role: "primary", slot: "main" },
        {
          surfaceId: CANONICAL_SURFACES.conversation,
          role: "companion",
          slot: "side",
        },
      ],
      proportion: "balanced",
    },
    expectedPrimary: [CANONICAL_SURFACES.browser],
    stateSurvivors: [CANONICAL_SURFACES.browser],
  },
  {
    id: "start-video",
    label: "Start video (media promoted to primary)",
    spec: {
      template: "triple",
      assignments: [
        { surfaceId: CANONICAL_SURFACES.media, role: "primary", slot: "main" },
        {
          surfaceId: CANONICAL_SURFACES.browser,
          role: "companion",
          slot: "side",
        },
        {
          surfaceId: CANONICAL_SURFACES.conversation,
          role: "support",
          slot: "rail",
        },
      ],
      proportion: "wide",
    },
    expectedPrimary: [CANONICAL_SURFACES.media],
    stateSurvivors: [CANONICAL_SURFACES.browser, CANONICAL_SURFACES.conversation],
  },
  {
    id: "media-in-background",
    label: "Keep media playing while changing activity",
    spec: {
      template: "sidecar",
      assignments: [
        { surfaceId: CANONICAL_SURFACES.browser, role: "primary", slot: "main" },
        {
          surfaceId: CANONICAL_SURFACES.conversation,
          role: "companion",
          slot: "side",
        },
      ],
      proportion: "balanced",
    },
    expectedPrimary: [CANONICAL_SURFACES.browser],
    stateSurvivors: [CANONICAL_SURFACES.browser, CANONICAL_SURFACES.conversation],
    // Media is NOT in the template — the shell keeps it in the persistent
    // media bar. Its instance must survive (playback continues).
    persistent: [CANONICAL_SURFACES.media],
  },
  {
    id: "open-book",
    label: "Open a book (reading primary)",
    spec: {
      template: "triple",
      assignments: [
        { surfaceId: CANONICAL_SURFACES.reader, role: "primary", slot: "main" },
        {
          surfaceId: CANONICAL_SURFACES.browser,
          role: "companion",
          slot: "side",
        },
        {
          surfaceId: CANONICAL_SURFACES.conversation,
          role: "support",
          slot: "rail",
        },
      ],
      proportion: "wide",
    },
    expectedPrimary: [CANONICAL_SURFACES.reader],
    stateSurvivors: [CANONICAL_SURFACES.browser, CANONICAL_SURFACES.conversation],
  },
  {
    id: "ask-about-current-activity",
    label: "Ask assistant about current activity (equal split)",
    spec: {
      template: "split",
      assignments: [
        { surfaceId: CANONICAL_SURFACES.reader, role: "primary", slot: "main" },
        {
          surfaceId: CANONICAL_SURFACES.conversation,
          role: "primary",
          slot: "side",
        },
      ],
      proportion: "balanced",
    },
    // Split explicitly supports two primaries (equal split).
    expectedPrimary: [
      CANONICAL_SURFACES.reader,
      CANONICAL_SURFACES.conversation,
    ],
    stateSurvivors: [CANONICAL_SURFACES.reader, CANONICAL_SURFACES.conversation],
    // Browser leaves the template here but the host must RETAIN it (state
    // survives unmount) — "return to browser" depends on it.
  },
  {
    id: "create-reminder",
    label: "Create a reminder (tasks surface appears)",
    spec: {
      template: "triple",
      assignments: [
        {
          surfaceId: CANONICAL_SURFACES.conversation,
          role: "primary",
          slot: "main",
        },
        {
          surfaceId: CANONICAL_SURFACES.reader,
          role: "companion",
          slot: "side",
        },
        { surfaceId: CANONICAL_SURFACES.tasks, role: "support", slot: "rail" },
      ],
      proportion: "wide",
    },
    expectedPrimary: [CANONICAL_SURFACES.conversation],
    stateSurvivors: [CANONICAL_SURFACES.conversation, CANONICAL_SURFACES.reader],
  },
  {
    id: "return-to-browser",
    label: "Return to browser",
    spec: {
      template: "focus",
      assignments: [
        { surfaceId: CANONICAL_SURFACES.browser, role: "primary", slot: "main" },
      ],
    },
    expectedPrimary: [CANONICAL_SURFACES.browser],
    // Browser was unmounted at "ask-about-current-activity" and must come
    // back as the SAME instance: visited state, scroll position, session.
    stateSurvivors: [CANONICAL_SURFACES.browser],
  },
];

/** One step's execution result. */
export interface StepResult {
  step: WorkflowStep;
  /** surfaceIds that were primary after this step. */
  primary: string[];
  /** Violations detected for this step (remount/state-loss/primary mismatch). */
  violations: string[];
  ok: boolean;
}

/** Full workflow run. */
export interface WorkflowReport {
  steps: StepResult[];
  /** All steps ok. */
  passed: boolean;
  /** Primary activity per step, in order. */
  primaryHistory: string[][];
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((id, i) => id === sortedB[i]);
}

/**
 * Drive a workflow through a host, asserting per step:
 *  (a) the spec validates (invalid specs throw — never reach layout state),
 *  (b) the primary activity equals exactly the step's expectation,
 *  (c) every listed survivor (incl. persistent) kept its instance.
 *
 * Survival checks use before/after snapshots of the host's instances —
 * never the host's self-report — so even a lying host is caught.
 */
export function runWorkflow(
  host: SurfaceHost,
  steps: readonly WorkflowStep[],
  registered: ReadonlySet<string>,
): WorkflowReport {
  const stepResults: StepResult[] = [];
  for (const step of steps) {
    const before: InstanceSnapshot = host.snapshot();
    applyLayoutForTest(step.spec, registered); // (a) validation, throws on violation
    host.applyTransition(step.spec, registered);
    const after: InstanceSnapshot = host.snapshot();

    const primary = step.spec.assignments
      .filter((a) => a.role === "primary")
      .map((a) => a.surfaceId);

    const violations = checkTransitionSurvival(
      before,
      after,
      [...step.stateSurvivors, ...(step.persistent ?? [])],
    ).map((v) => `[${v.kind}] ${v.detail}`);

    if (!sameIds(primary, step.expectedPrimary)) {
      violations.push(
        `[primary-mismatch] step "${step.id}" expected primary ` +
          `${step.expectedPrimary.join(", ") || "(none)"} but got ` +
          `${primary.join(", ") || "(none)"}`,
      );
    }

    stepResults.push({
      step,
      primary,
      violations,
      ok: violations.length === 0,
    });
  }
  return {
    steps: stepResults,
    passed: stepResults.every((s) => s.ok),
    primaryHistory: stepResults.map((s) => s.primary),
  };
}

/** Throw with a readable summary when a workflow run has any violation. */
export function assertWorkflowPasses(report: WorkflowReport): void {
  if (report.passed) {
    return;
  }
  const failures = report.steps
    .filter((s) => !s.ok)
    .map(
      (s) =>
        `  - step "${s.step.id}" (${s.step.label}):\n${s.violations
          .map((v) => `      ${v}`)
          .join("\n")}`,
    )
    .join("\n");
  throw new Error(`workflow violated harness assertions:\n${failures}`);
}

/**
 * Surface-agnostic slot-in mechanism (Wave 2): map this harness's semantic
 * ids to real product surfaceIds without editing the flow definition.
 * `idMap` keys are the CANONICAL_SURFACES values; values are the product
 * surfaceIds (e.g. { "surface.browser": "browser", ... }).
 */
export function remapWorkflow(
  steps: readonly WorkflowStep[],
  idMap: Readonly<Record<string, string>>,
): WorkflowStep[] {
  const mapId = (id: string): string => idMap[id] ?? id;
  return steps.map((step) => ({
    ...step,
    spec: {
      ...step.spec,
      assignments: step.spec.assignments.map((a) => ({
        ...a,
        surfaceId: mapId(a.surfaceId),
      })),
    },
    expectedPrimary: step.expectedPrimary.map(mapId),
    stateSurvivors: step.stateSurvivors.map(mapId),
    persistent: step.persistent?.map(mapId),
  }));
}

/** Registry for a remapped workflow (maps every canonical id). */
export function registryForRemap(
  idMap: Readonly<Record<string, string>>,
  persistentCapableIds: readonly string[] = [],
): { registrations: SurfaceRegistration[]; registeredIds: ReadonlySet<string> } {
  const registrations: SurfaceRegistration[] = Object.values(
    CANONICAL_SURFACES,
  ).map((id) => ({
    surfaceId: idMap[id] ?? id,
    roles: ["primary", "companion", "support"],
    persistentCapable: persistentCapableIds.includes(idMap[id] ?? id),
  }));
  return {
    registrations,
    registeredIds: new Set(registrations.map((r) => r.surfaceId)),
  };
}

/** LayoutSpec list view of the canonical flow (for scenario key frames). */
export function canonicalFlowSpecs(): readonly LayoutSpec[] {
  return CANONICAL_FLOW.map((step) => step.spec);
}
