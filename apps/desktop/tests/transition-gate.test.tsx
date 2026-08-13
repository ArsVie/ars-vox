/**
 * Cordis plan lane B2 (§4.3.3) — transition gate: pure unit tests.
 *
 * Covers the full IDLE -> TRANSITIONING -> IDLE lifecycle, last-wins
 * queuing of rapid proposals (the in-flight target is never touched and
 * intermediate proposals never commit), settle applying the queued
 * target as the next committed transition, the queue slot clearing on
 * settle, the frozen 260ms transition duration, and determinism
 * (identical state + event -> identical results).
 */
import { describe, expect, it } from "vitest";

import type { LayoutSpec } from "../src/adaptive/contracts";
import { TEMPLATE_FIXTURES } from "../src/adaptive/fixtures";
import type { GateState } from "../src/layout/transitionGate";
import {
  INITIAL_GATE_STATE,
  TRANSITION_MS,
  reduce,
} from "../src/layout/transitionGate";

const sidecar = TEMPLATE_FIXTURES.sidecar;
const focus = TEMPLATE_FIXTURES.focus;
const stack = TEMPLATE_FIXTURES.stack;
const split = TEMPLATE_FIXTURES.split;
const triple = TEMPLATE_FIXTURES.triple;

/** Distinct valid specs, used to tell proposals apart in a trace. */
const SPECS: LayoutSpec[] = [sidecar, focus, stack, split, triple];

describe("reduce — full lifecycle", () => {
  it("IDLE + propose commits the spec and enters TRANSITIONING with no queue", () => {
    const result = reduce(INITIAL_GATE_STATE, { type: "propose", spec: sidecar });
    expect(result.command).toBe("commit");
    expect(result.state).toEqual({
      phase: "TRANSITIONING",
      target: sidecar,
    });
    expect("queued" in result.state).toBe(false);
  });

  it("TRANSITIONING + settle with no queue returns to IDLE with 'none'", () => {
    const running = reduce(INITIAL_GATE_STATE, {
      type: "propose",
      spec: sidecar,
    }).state;
    const result = reduce(running, { type: "settle" });
    expect(result.command).toBe("none");
    expect(result.state).toEqual({ phase: "IDLE" });
  });

  it("a stray settle while IDLE is a no-op — never creates work", () => {
    const result = reduce(INITIAL_GATE_STATE, { type: "settle" });
    expect(result.command).toBe("none");
    expect(result.state).toEqual({ phase: "IDLE" });
    // No state change at all: the same object is returned untouched.
    expect(result.state).toBe(INITIAL_GATE_STATE);
  });
});

describe("reduce — queue last-wins", () => {
  it("a proposal during TRANSITIONING is queued with 'wait', target untouched", () => {
    const running = reduce(INITIAL_GATE_STATE, {
      type: "propose",
      spec: sidecar,
    }).state;
    const result = reduce(running, { type: "propose", spec: focus });
    expect(result.command).toBe("wait");
    expect(result.state).toEqual({
      phase: "TRANSITIONING",
      target: sidecar,
      queued: focus,
    });
  });

  it("rapid proposals replace the queue — last-wins, never stacked", () => {
    let state = reduce(INITIAL_GATE_STATE, {
      type: "propose",
      spec: sidecar,
    }).state;
    state = reduce(state, { type: "propose", spec: focus }).state;
    state = reduce(state, { type: "propose", spec: stack }).state;
    state = reduce(state, { type: "propose", spec: split }).state;
    expect(state).toEqual({
      phase: "TRANSITIONING",
      target: sidecar,
      queued: split,
    });
  });
});

describe("reduce — settle applies the queued target", () => {
  it("settle with a queued proposal commits it as the next target and clears the queue", () => {
    let state = reduce(INITIAL_GATE_STATE, {
      type: "propose",
      spec: sidecar,
    }).state;
    state = reduce(state, { type: "propose", spec: focus }).state;
    const result = reduce(state, { type: "settle" });
    expect(result.command).toBe("commit");
    expect(result.state).toEqual({
      phase: "TRANSITIONING",
      target: focus,
    });
    expect("queued" in result.state).toBe(false);
  });

  it("settle without a queue returns to IDLE instead of committing", () => {
    const running = reduce(INITIAL_GATE_STATE, {
      type: "propose",
      spec: sidecar,
    }).state;
    const result = reduce(running, { type: "settle" });
    expect(result.command).toBe("none");
    expect(result.state).toEqual({ phase: "IDLE" });
  });
});

describe("reduce — the in-flight transition always completes", () => {
  it("proposals never interrupt the in-flight target; only settle lands the last queued", () => {
    let state = reduce(INITIAL_GATE_STATE, {
      type: "propose",
      spec: sidecar,
    }).state;
    // Three proposals mid-flight: the target stays sidecar throughout.
    state = reduce(state, { type: "propose", spec: focus }).state;
    expect(state).toEqual({
      phase: "TRANSITIONING",
      target: sidecar,
      queued: focus,
    });
    state = reduce(state, { type: "propose", spec: stack }).state;
    state = reduce(state, { type: "propose", spec: split }).state;
    expect(state).toEqual({
      phase: "TRANSITIONING",
      target: sidecar,
      queued: split,
    });
    // Settle lands the last-wins proposal as a fresh committed target.
    const settled = reduce(state, { type: "settle" });
    expect(settled.command).toBe("commit");
    expect(settled.state).toEqual({ phase: "TRANSITIONING", target: split });
  });
});

describe("reduce — five rapid proposals commit exactly the first and the last", () => {
  it("the first commits, the middle four wait, and settle commits only the last", () => {
    const commands: string[] = [];
    let state: GateState = INITIAL_GATE_STATE;
    for (const spec of SPECS) {
      const result = reduce(state, { type: "propose", spec });
      commands.push(result.command);
      state = result.state;
    }
    // Exactly one commit (the first proposal); every other proposal
    // waited in the queue.
    expect(commands).toEqual(["commit", "wait", "wait", "wait", "wait"]);
    // The queue holds only the LAST proposal; the in-flight target is
    // still the first.
    expect(state).toEqual({
      phase: "TRANSITIONING",
      target: sidecar,
      queued: triple,
    });
    // Settle commits the last proposal exactly once...
    const settled = reduce(state, { type: "settle" });
    expect(settled.command).toBe("commit");
    expect(settled.state).toEqual({ phase: "TRANSITIONING", target: triple });
    // ...and the transition after it settles with no further commit.
    const done = reduce(settled.state, { type: "settle" });
    expect(done.command).toBe("none");
    expect(done.state).toEqual({ phase: "IDLE" });
  });
});

describe("reduce — determinism (pure)", () => {
  it("identical state + event produce identical results", () => {
    const a = reduce(INITIAL_GATE_STATE, { type: "propose", spec: sidecar });
    const b = reduce(INITIAL_GATE_STATE, { type: "propose", spec: sidecar });
    expect(a).toEqual(b);

    const queuedState = reduce(a.state, { type: "propose", spec: focus }).state;
    const s1 = reduce(queuedState, { type: "settle" });
    const s2 = reduce(queuedState, { type: "settle" });
    expect(s1).toEqual(s2);
  });

  it("the same event sequence replayed from the same start produces the same trace", () => {
    const run = (): string[] => {
      const trace: string[] = [];
      let state: GateState = INITIAL_GATE_STATE;
      for (const spec of SPECS) {
        const result = reduce(state, { type: "propose", spec });
        trace.push(result.command);
        state = result.state;
      }
      const settled = reduce(state, { type: "settle" });
      trace.push(settled.command);
      trace.push(reduce(settled.state, { type: "settle" }).command);
      return trace;
    };
    expect(run()).toEqual(run());
    expect(run()).toEqual([
      "commit",
      "wait",
      "wait",
      "wait",
      "wait",
      "commit",
      "none",
    ]);
  });
});

describe("TRANSITION_MS — frozen short low-motion duration", () => {
  it("is 260ms (host settles with it; no timers live in this module)", () => {
    expect(TRANSITION_MS).toBe(260);
  });
});
