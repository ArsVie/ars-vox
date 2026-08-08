/**
 * UI-105 acceptance (c): the harness DETECTS accidental surface remount /
 * state loss. The reference host preserves state; faulty hosts lose it —
 * and the harness must catch exactly that, via instance identity AND the
 * monotonic mountCount marker on the mounted instance.
 */

import { describe, expect, it } from "vitest";

import { PLACEHOLDER_REGISTERED_IDS } from "../../src/adaptive/fixtures";
import { LAYOUT_FIXTURES, ROLE_SWAP_SEQUENCE, TRANSITION_SEQUENCES } from "../../src/adaptive/harness/fixtures";
import {
  SurfaceHost,
  checkTransitionSurvival,
  createFaultyHost,
} from "../../src/adaptive/harness/host";

describe("reference host preserves state across transitions", () => {
  it("keeps the same instance across a primary -> companion -> primary swap", () => {
    const host = new SurfaceHost();
    host.applyTransition(ROLE_SWAP_SEQUENCE[0], PLACEHOLDER_REGISTERED_IDS);
    const before = host.snapshot();
    host.applyTransition(ROLE_SWAP_SEQUENCE[1], PLACEHOLDER_REGISTERED_IDS);
    const after = host.snapshot();
    expect(
      checkTransitionSurvival(before, after, ["placeholder.primary", "placeholder.companion"]),
    ).toEqual([]);
    expect(host.instance("placeholder.primary")!.mountCount).toBe(1);
  });

  it("a state bag written on the mounted instance survives every transition", () => {
    const host = new SurfaceHost();
    host.applyTransition(LAYOUT_FIXTURES.focus, PLACEHOLDER_REGISTERED_IDS);
    host.instance("placeholder.primary")!.state = {
      drafts: ["draft 1", "draft 2"],
      cursor: 42,
    };
    // ride the whole template cycle
    for (const spec of TRANSITION_SEQUENCES.templateCycle.slice(1)) {
      host.applyTransition(spec, PLACEHOLDER_REGISTERED_IDS);
    }
    const instance = host.instance("placeholder.primary")!;
    expect(instance.state).toEqual({ drafts: ["draft 1", "draft 2"], cursor: 42 });
    expect(instance.mountCount).toBe(1); // never remounted
  });

  it("retains instances that leave the layout — returning restores the SAME instance", () => {
    const host = new SurfaceHost();
    host.applyTransition(LAYOUT_FIXTURES.sidecar, PLACEHOLDER_REGISTERED_IDS);
    host.instance("placeholder.companion")!.state = { url: "https://facebook.com" };
    host.applyTransition(LAYOUT_FIXTURES.focus, PLACEHOLDER_REGISTERED_IDS); // companion leaves
    expect(host.instance("placeholder.companion")).toBeDefined(); // retained, not dropped

    const before = host.snapshot();
    host.applyTransition(LAYOUT_FIXTURES.sidecar, PLACEHOLDER_REGISTERED_IDS); // companion returns
    const after = host.snapshot();
    expect(checkTransitionSurvival(before, after, ["placeholder.companion"])).toEqual([]);
    expect(host.instance("placeholder.companion")!.state).toEqual({
      url: "https://facebook.com",
    });
    expect(host.instance("placeholder.companion")!.mountCount).toBe(1);
  });

  it("mountCount markers are monotonic and stable for kept instances", () => {
    const host = new SurfaceHost();
    host.applyTransition(LAYOUT_FIXTURES.sidecar, PLACEHOLDER_REGISTERED_IDS);
    const first = host.snapshot();
    host.applyTransition(LAYOUT_FIXTURES.triple, PLACEHOLDER_REGISTERED_IDS);
    const second = host.snapshot();
    expect(first.get("placeholder.primary")!.mountCount).toBe(1);
    expect(second.get("placeholder.primary")!.mountCount).toBe(1);
  });
});

describe("harness detects accidental remount / state loss (acceptance c)", () => {
  it("flags a host that remounts every surface on every apply", () => {
    const host = createFaultyHost("remount-every-apply");
    host.applyTransition(LAYOUT_FIXTURES.sidecar, PLACEHOLDER_REGISTERED_IDS);
    host.instance("placeholder.primary")!.state = { drafts: ["draft 1"] };
    const before = host.snapshot();
    host.applyTransition(LAYOUT_FIXTURES.sidecar, PLACEHOLDER_REGISTERED_IDS);
    const after = host.snapshot();

    const violations = checkTransitionSurvival(before, after, ["placeholder.primary"]);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].kind).toBe("remount");
    // the user-visible bug: state bag wiped and the mount counter moved
    expect(host.instance("placeholder.primary")!.state).toEqual({});
    expect(host.instance("placeholder.primary")!.mountCount).toBeGreaterThan(1);
  });

  it("flags a host that drops unmounted surfaces — state lost on return", () => {
    const host = createFaultyHost("drop-on-unmount");
    host.applyTransition(LAYOUT_FIXTURES.sidecar, PLACEHOLDER_REGISTERED_IDS);
    host.instance("placeholder.companion")!.state = { url: "https://facebook.com" };
    host.applyTransition(LAYOUT_FIXTURES.focus, PLACEHOLDER_REGISTERED_IDS);
    expect(host.instance("placeholder.companion")).toBeUndefined(); // dropped!

    const before = host.snapshot();
    host.applyTransition(LAYOUT_FIXTURES.sidecar, PLACEHOLDER_REGISTERED_IDS);
    const after = host.snapshot();
    const violations = checkTransitionSurvival(before, after, ["placeholder.companion"]);
    expect(violations.length).toBeGreaterThan(0);
    expect(
      violations.some((v) => v.kind === "state-loss" || v.kind === "remount"),
    ).toBe(true);
  });

  it("catches instance replacement even when the mountCount marker is copied", () => {
    // A subtle bug: the host replaces the instance object (deep copy) but
    // copies the mountCount — object identity comparison must still catch it.
    class DeepCopyHost extends SurfaceHost {
      deepCopyAll(): void {
        for (const [id, inst] of this.instances) {
          this.instances.set(id, { ...inst, state: { ...inst.state } });
        }
      }
    }
    const host = new DeepCopyHost();
    host.applyTransition(LAYOUT_FIXTURES.sidecar, PLACEHOLDER_REGISTERED_IDS);
    host.instance("placeholder.primary")!.state = { drafts: ["draft 1"] };
    const before = host.snapshot(); // capture the ORIGINAL instance identity first
    host.deepCopyAll(); // instance object replaced, mountCount copied
    const after = host.snapshot();

    expect(before.get("placeholder.primary")!.mountCount).toBe(1);
    expect(after.get("placeholder.primary")!.mountCount).toBe(1);
    const violations = checkTransitionSurvival(before, after, ["placeholder.primary"]);
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe("remount");
    expect(violations[0].detail).toMatch(/identity changed/);
  });

  it("survivor checks also cover shell-owned persistent surfaces", () => {
    // Media leaves the template (becomes shell-owned persistent) — its
    // instance must still survive, or playback resets.
    const host = new SurfaceHost();
    host.applyTransition(LAYOUT_FIXTURES.triple, PLACEHOLDER_REGISTERED_IDS);
    host.instance("placeholder.primary")!.state = { playback: "playing", position: 142 };
    const before = host.snapshot();
    host.applyTransition(LAYOUT_FIXTURES.sidecar, PLACEHOLDER_REGISTERED_IDS);
    const after = host.snapshot();
    expect(
      checkTransitionSurvival(before, after, ["placeholder.primary"]),
    ).toEqual([]); // reference host: fine

    const buggy = createFaultyHost("remount-every-apply");
    buggy.applyTransition(LAYOUT_FIXTURES.triple, PLACEHOLDER_REGISTERED_IDS);
    buggy.instance("placeholder.primary")!.state = { playback: "playing" };
    const buggyBefore = buggy.snapshot();
    buggy.applyTransition(LAYOUT_FIXTURES.sidecar, PLACEHOLDER_REGISTERED_IDS);
    const buggyAfter = buggy.snapshot();
    expect(
      checkTransitionSurvival(buggyBefore, buggyAfter, ["placeholder.primary"]).length,
    ).toBeGreaterThan(0); // buggy host: flagged
  });

  it("purge() is explicit teardown — after it the instance is gone", () => {
    const host = new SurfaceHost();
    host.applyTransition(LAYOUT_FIXTURES.focus, PLACEHOLDER_REGISTERED_IDS);
    expect(host.instance("placeholder.primary")).toBeDefined();
    host.purge("placeholder.primary");
    expect(host.instance("placeholder.primary")).toBeUndefined();
  });
});
