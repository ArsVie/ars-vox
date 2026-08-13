/**
 * Cordis §4.3.3 / plan lane B2 — Transition gate (pure, deterministic,
 * no timers, no React, no side effects, no randomness; the host owns
 * timing).
 *
 * PURPOSE
 *   An in-flight layout transition ALWAYS completes — nothing can abort
 *   it mid-step. The UI-207 inertia policy (layout/inertia.ts) decides
 *   WHETHER a proposed layout change is worth applying; this gate
 *   decides WHEN it may be applied. It composes AFTER the cost policy:
 *   the store feeds the gate only specs the policy already approved
 *   (policy decides whether; gate decides when).
 *
 *   Rapid proposals arriving while a transition is in flight are QUEUED
 *   LAST-WINS — the newest proposal replaces the queued one, never
 *   stacks, and never touches the in-flight target. When the host
 *   settles the transition (after TRANSITION_MS), the queued proposal
 *   becomes the next committed target.
 *
 * FROZEN MOVEMENT RULES (user-owned) honored here
 *   - short low-motion transitions: TRANSITION_MS = 260ms;
 *   - keep active content visible during transitions: one target at a
 *     time, no mid-flight retargeting;
 *   - no layout change during reading: the gate grants "commit" only on
 *     a proposal in IDLE or on settling a queued target;
 *   - max one major change per command: at most one queued proposal
 *     survives a transition.
 *
 * STATE TABLE (all state x event combinations)
 *   state                             event           -> state                                     command
 *   IDLE                              propose(spec)   -> TRANSITIONING { target: spec }             "commit"
 *   IDLE                              settle          -> IDLE                                       "none"
 *   TRANSITIONING { target }          propose(spec)   -> TRANSITIONING { target, queued: spec }     "wait"
 *   TRANSITIONING { target }          settle          -> IDLE                                       "none"
 *   TRANSITIONING { target, queued }  propose(spec)   -> TRANSITIONING { target, queued: spec }     "wait"
 *   TRANSITIONING { target, queued }  settle          -> TRANSITIONING { target: queued }           "commit"
 *
 * TIMING OWNERSHIP
 *   This module holds no timers. After a "commit" the host applies the
 *   resulting state's target, starts the transition, and schedules a
 *   settle for TRANSITION_MS later; the host then calls
 *   reduce(state, { type: "settle" }). Deterministic: identical inputs
 *   always produce identical outputs.
 */

import type { LayoutSpec } from "../adaptive/contracts";

/** Short, low-motion transition duration (ms) — the host settles with this. */
export const TRANSITION_MS = 260;

/**
 * Gate state. TRANSITIONING always carries the in-flight target; it
 * additionally carries the last-wins queued proposal when one arrived
 * mid-flight. IDLE means no transition is running and no work is owed.
 */
export type GateState =
  | { phase: "IDLE" }
  | { phase: "TRANSITIONING"; target: LayoutSpec }
  | { phase: "TRANSITIONING"; target: LayoutSpec; queued: LayoutSpec };

/** Events the host may send. */
export type GateEvent =
  | { type: "propose"; spec: LayoutSpec }
  | { type: "settle" };

/**
 * What the host must do after the transition:
 *   "commit" — apply the resulting state's target and start a transition;
 *   "wait"   — do nothing now; the proposal is held until the transition
 *              settles;
 *   "none"   — nothing to do.
 */
export type GateCommand = "commit" | "wait" | "none";

/** Deterministic transition result. */
export interface GateResult {
  state: GateState;
  command: GateCommand;
}

/** Initial state — no transition running, no work owed. */
export const INITIAL_GATE_STATE: GateState = { phase: "IDLE" };

/**
 * Pure transition function: given the current gate state and one event,
 * return the next state and the command for the host. No side effects,
 * no timers, no randomness — identical inputs always produce identical
 * outputs.
 */
export function reduce(state: GateState, event: GateEvent): GateResult {
  switch (event.type) {
    case "propose": {
      if (state.phase === "IDLE") {
        // First proposal starts a transition: the caller commits the
        // spec and begins animating. Nothing is queued.
        return {
          state: { phase: "TRANSITIONING", target: event.spec },
          command: "commit",
        };
      }
      // A proposal during a transition is queued LAST-WINS: it replaces
      // any previously queued proposal. The in-flight target is never
      // touched — the transition always completes.
      return {
        state: {
          phase: "TRANSITIONING",
          target: state.target,
          queued: event.spec,
        },
        command: "wait",
      };
    }
    case "settle": {
      if (state.phase === "IDLE") {
        // Defensive no-op: a stray settle (e.g. a late timer) never
        // creates work out of nothing.
        return { state, command: "none" };
      }
      if (!("queued" in state)) {
        // The in-flight transition completed and nothing is queued:
        // the gate returns to IDLE.
        return { state: { phase: "IDLE" }, command: "none" };
      }
      // The queued proposal becomes the next in-flight target: the
      // caller commits it and starts the next transition. The queue
      // slot is cleared — at most one transition in flight at a time.
      return {
        state: { phase: "TRANSITIONING", target: state.queued },
        command: "commit",
      };
    }
  }
}
