/**
 * UI-105 — Adaptive workflow test harness (public API).
 *
 * Test infrastructure ONLY. No product surface code, no layout engine, no
 * contract edits. The harness drives the frozen LayoutSpec contract
 * directly (no LLM) and asserts primary-role + state-survival invariants
 * across transitions.
 *
 * Modules:
 *  - driver.ts      applyLayoutForTest — validate + primary + stub geometry
 *  - host.ts        reference SurfaceHost, faulty hosts, remount detection
 *  - fixtures.ts    typed template fixtures, proportion variants, sequences
 *  - workflows.ts   canonical flow (frozen in plan) + runWorkflow runner
 *  - scenarios.ts   screenshot scenario catalog + render hook
 *  - geometry.ts    test-only stub geometry (UI-102 owns the real engine)
 */

export * from "./driver";
export * from "./host";
export * from "./fixtures";
export * from "./workflows";
export * from "./scenarios";
export * from "./geometry";
