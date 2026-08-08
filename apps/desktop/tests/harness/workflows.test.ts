/**
 * UI-105 — the CANONICAL FLOW (frozen in the plan) as driveable LayoutSpec
 * transitions, with per-step assertions for primary role and preserved state.
 *
 * Flow: start/home -> open browser -> open conversation alongside browser ->
 * start video -> media keeps playing while activity changes -> open a book ->
 * ask assistant about current activity -> create a reminder -> return to browser.
 */

import { describe, expect, it } from "vitest";

import { SurfaceHost, checkTransitionSurvival, createFaultyHost } from "../../src/adaptive/harness/host";
import type { WorkflowStep } from "../../src/adaptive/harness/workflows";
import {
  CANONICAL_FLOW,
  CANONICAL_REGISTERED_IDS,
  CANONICAL_SURFACES,
  assertWorkflowPasses,
  registryForRemap,
  remapWorkflow,
  runWorkflow,
} from "../../src/adaptive/harness/workflows";

const SURF = CANONICAL_SURFACES;

describe("canonical flow executes as driveable LayoutSpec transitions", () => {
  it("all 9 steps pass against the reference host (no LLM anywhere)", () => {
    const report = runWorkflow(new SurfaceHost(), CANONICAL_FLOW, CANONICAL_REGISTERED_IDS);
    expect(() => assertWorkflowPasses(report)).not.toThrow();
    expect(report.passed).toBe(true);
    expect(report.steps).toHaveLength(9);
  });

  it("the primary activity per step matches the frozen flow exactly", () => {
    const report = runWorkflow(new SurfaceHost(), CANONICAL_FLOW, CANONICAL_REGISTERED_IDS);
    expect(report.primaryHistory).toEqual([
      [SURF.home], // start/home
      [SURF.browser], // open Facebook/browser
      [SURF.browser], // conversation alongside browser
      [SURF.media], // start video
      [SURF.browser], // media playing in background, activity changed
      [SURF.reader], // open a book
      [SURF.reader, SURF.conversation], // ask assistant (split = two primaries)
      [SURF.conversation], // create a reminder
      [SURF.browser], // return to browser
    ]);
  });

  it("every step satisfies the exactly-one-primary invariant (split = documented exception)", () => {
    const report = runWorkflow(new SurfaceHost(), CANONICAL_FLOW, CANONICAL_REGISTERED_IDS);
    for (const stepResult of report.steps) {
      if (stepResult.step.spec.template === "split") {
        expect(stepResult.primary.length, stepResult.step.id).toBe(2);
      } else {
        expect(stepResult.primary.length, stepResult.step.id).toBe(1);
      }
    }
  });

  it("browser state written early survives the entire journey to the return step", () => {
    const host = new SurfaceHost();
    for (const step of CANONICAL_FLOW) {
      host.applyTransition(step.spec, CANONICAL_REGISTERED_IDS);
      if (step.id === "open-browser") {
        host.instance(SURF.browser)!.state = {
          url: "https://facebook.com",
          scroll: 1240,
          tabs: ["facebook", "news"],
        };
      }
    }
    // Step 9 returns to the SAME browser instance: state intact, never remounted.
    const browser = host.instance(SURF.browser)!;
    expect(browser.state).toEqual({
      url: "https://facebook.com",
      scroll: 1240,
      tabs: ["facebook", "news"],
    });
    expect(browser.mountCount).toBe(1);
  });

  it("media keeps playing across the persistent transition (not in template slots)", () => {
    const host = new SurfaceHost();
    const startVideo = CANONICAL_FLOW[3];
    const mediaInBackground = CANONICAL_FLOW[4];

    host.applyTransition(startVideo.spec, CANONICAL_REGISTERED_IDS);
    const mediaBefore = host.instance(SURF.media)!;
    mediaBefore.state = { playback: "playing", position: 142 };
    expect(mediaBefore.mountCount).toBe(1);

    // At the persistent step, media is NOT a template slot (shell-owned).
    expect(
      mediaInBackground.spec.assignments.some((a) => a.surfaceId === SURF.media),
    ).toBe(false);

    const before = host.snapshot();
    host.applyTransition(mediaInBackground.spec, CANONICAL_REGISTERED_IDS);
    const after = host.snapshot();
    expect(checkTransitionSurvival(before, after, [SURF.media])).toEqual([]);
    expect(host.instance(SURF.media)).toBe(mediaBefore); // same instance, still playing
  });

  it("detects state loss on faulty hosts across the whole flow", () => {
    for (const kind of ["remount-every-apply", "drop-on-unmount"] as const) {
      const host = createFaultyHost(kind);
      const report = runWorkflow(host, CANONICAL_FLOW, CANONICAL_REGISTERED_IDS);
      expect(report.passed, `${kind} must be caught`).toBe(false);
      const messages = report.steps.flatMap((s) => s.violations);
      expect(messages.length).toBeGreaterThan(0);
      expect(
        messages.some((m) => m.includes("[remount]") || m.includes("[state-loss]")),
        `${kind}: expected a remount/state-loss violation, got: ${messages.join(" | ")}`,
      ).toBe(true);
    }
  });

  it("a wrong primary expectation is caught by the runner", () => {
    const tampered: WorkflowStep[] = CANONICAL_FLOW.map((step, i) =>
      i === 1 ? { ...step, expectedPrimary: [SURF.home] } : step,
    );
    const report = runWorkflow(new SurfaceHost(), tampered, CANONICAL_REGISTERED_IDS);
    expect(report.passed).toBe(false);
    expect(report.steps[1].violations.some((v) => v.includes("[primary-mismatch]"))).toBe(
      true,
    );
  });

  it("invalid specs mid-flow throw instead of corrupting layout state", () => {
    const bad: WorkflowStep = {
      ...CANONICAL_FLOW[2],
      id: "invalid-step",
      spec: { template: "focus", assignments: [] },
    };
    const host = new SurfaceHost();
    expect(() =>
      runWorkflow(host, [...CANONICAL_FLOW.slice(0, 2), bad], CANONICAL_REGISTERED_IDS),
    ).toThrow(/at least one assignment/);
  });
});

describe("surface-agnosticism (Wave-2 slot-in)", () => {
  it("the identical flow passes with arbitrary surfaceIds", () => {
    const idMap: Record<string, string> = {
      [SURF.home]: "id-a",
      [SURF.browser]: "id-b",
      [SURF.conversation]: "id-c",
      [SURF.media]: "id-d",
      [SURF.reader]: "id-e",
      [SURF.tasks]: "id-f",
    };
    const remapped = remapWorkflow(CANONICAL_FLOW, idMap);
    const { registeredIds } = registryForRemap(idMap, [idMap[SURF.media]]);
    const report = runWorkflow(new SurfaceHost(), remapped, registeredIds);
    expect(() => assertWorkflowPasses(report)).not.toThrow();
    expect(report.primaryHistory[3]).toEqual(["id-d"]); // media primary
    expect(report.primaryHistory[8]).toEqual(["id-b"]); // browser back
    // media is persistent-capable in the remapped registry (shell media bar)
    expect(registeredIds.has("id-d")).toBe(true);
  });

  it("remapWorkflow leaves unmatched ids untouched", () => {
    const remapped = remapWorkflow(CANONICAL_FLOW, { [SURF.browser]: "real.browser" });
    expect(remapped[1].spec.assignments[0].surfaceId).toBe("real.browser");
    expect(remapped[0].spec.assignments[0].surfaceId).toBe(SURF.home);
  });
});
