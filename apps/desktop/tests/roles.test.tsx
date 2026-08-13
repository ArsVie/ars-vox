/**
 * UI-103 role framework tests — registry, deterministic fallback ladder,
 * store integration (role transitions + state survival), and the
 * geometry-blind SurfaceHost.
 *
 * Host tests use react-dom/server (renderToString, node env — repo
 * convention, see panelhost.test.tsx): zustand's SSR snapshot is wired to
 * the live singleton store so renders reflect applied state.
 *
 * NOTE on instance retention: React preserves component state when keyed
 * elements keep their key (the host keys every surface by surfaceId), so
 * "state survives role swaps" is asserted through (1) the store-level
 * per-surfaceId state bag surviving primary -> companion -> primary, (2) the
 * rendered stamp from that bag staying stable across the transition, and
 * (3) the demo role-history showing one uninterrupted per-surfaceId entry
 * with the full role sequence.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import type { StoreApi } from "zustand/vanilla";

import {
  validateLayoutSpec,
  type LayoutSpec as AdaptiveLayoutSpec,
  type SurfaceRole,
} from "../src/adaptive/contracts";
import { TEMPLATE_FIXTURES } from "../src/adaptive/fixtures";
import {
  createSurfaceRegistry,
  surfaceRegistry,
  type SurfaceRegistry,
} from "../src/roles/registry";
import {
  resolveLayout,
  resolveRole,
  ROLE_FALLBACK_LADDER,
} from "../src/roles/fallback";
import { SurfaceHost } from "../src/roles/host";
import {
  DEMO_SURFACE_COMPONENTS,
  demoRoleHistory,
} from "../src/roles/demo";
import {
  appStore,
  createAppStore,
  EMPTY_ADAPTIVE,
  type AppState,
} from "../src/store";
import { TRANSITION_MS } from "../src/layout/transitionGate";

/** sidecar spec with explicit main/side role assignments. */
function sidecar(
  mainId: string,
  mainRole: SurfaceRole,
  sideId: string,
  sideRole: SurfaceRole,
): AdaptiveLayoutSpec {
  return {
    template: "sidecar",
    assignments: [
      { surfaceId: mainId, role: mainRole, slot: "main" },
      { surfaceId: sideId, role: sideRole, slot: "side" },
    ],
    proportion: "balanced",
  };
}

/** The same surface transitions primary -> companion -> primary. */
const specPrimary = sidecar(
  "placeholder.primary",
  "primary",
  "placeholder.companion",
  "companion",
);
const specSwapped = sidecar(
  "placeholder.companion",
  "primary",
  "placeholder.primary",
  "companion",
);

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** Current resolved role of a surface in a store's adaptive state. */
function roleOf(store: StoreApi<AppState>, surfaceId: string): string {
  const assignment = store
    .getState()
    .adaptive.assignments.find((a) => a.surfaceId === surfaceId);
  if (!assignment) {
    throw new Error(`surface "${surfaceId}" is not in the current assignments`);
  }
  return assignment.role;
}

/* ------------------------------------------------------------- registry */

describe("surface registry", () => {
  it("register / list / lookup / has / size round trip", () => {
    const reg: SurfaceRegistry = createSurfaceRegistry([
      { surfaceId: "a", roles: ["primary", "companion"] },
    ]);
    reg.register({ surfaceId: "b", roles: ["support"], persistentCapable: true });
    expect(reg.size()).toBe(2);
    expect(reg.has("a")).toBe(true);
    expect(reg.lookup("b")).toEqual({
      surfaceId: "b",
      roles: ["support"],
      persistentCapable: true,
    });
    expect(reg.list().map((r) => r.surfaceId)).toEqual(["a", "b"]);
    expect(reg.capabilitiesOf("a")).toEqual(["primary", "companion"]);
    expect(reg.isPersistentCapable("b")).toBe(true);
    expect(reg.isPersistentCapable("a")).toBe(false);
    expect(reg.capabilitiesOf("nope")).toEqual([]);
  });

  it("rejects duplicate registrations deterministically", () => {
    const reg = createSurfaceRegistry([{ surfaceId: "a", roles: ["primary"] }]);
    expect(() => reg.register({ surfaceId: "a", roles: ["support"] })).toThrow(
      /already registered/,
    );
    expect(reg.size()).toBe(1);
  });

  it("rejects empty capability sets deterministically", () => {
    const reg = createSurfaceRegistry();
    expect(() => reg.register({ surfaceId: "a", roles: [] })).toThrow(
      /at least one role/,
    );
    expect(reg.has("a")).toBe(false);
  });

  it("rejects unknown role strings deterministically", () => {
    const reg = createSurfaceRegistry();
    expect(() =>
      reg.register({ surfaceId: "a", roles: ["primary", "hero"] as SurfaceRole[] }),
    ).toThrow(/unknown role/);
  });

  it("unregister removes and allows re-registration", () => {
    const reg = createSurfaceRegistry([{ surfaceId: "a", roles: ["primary"] }]);
    expect(reg.unregister("a")).toBe(true);
    expect(reg.unregister("a")).toBe(false);
    expect(reg.has("a")).toBe(false);
    reg.register({ surfaceId: "a", roles: ["support"] });
    expect(reg.capabilitiesOf("a")).toEqual(["support"]);
  });

  it("registeredIds returns a fresh snapshot (no aliasing)", () => {
    const reg = createSurfaceRegistry([{ surfaceId: "a", roles: ["primary"] }]);
    const snapshot = reg.registeredIds();
    (snapshot as Set<string>).add("hax");
    expect(reg.registeredIds().has("hax")).toBe(false);
    expect(reg.registeredIds().has("a")).toBe(true);
  });

  it("registered set feeds validateLayoutSpec (frozen rule 3)", () => {
    const reg = createSurfaceRegistry([
      { surfaceId: "placeholder.primary", roles: ["primary"] },
      { surfaceId: "placeholder.companion", roles: ["companion"] },
      { surfaceId: "placeholder.support", roles: ["support"] },
      { surfaceId: "placeholder.persistent", roles: ["primary"], persistentCapable: true },
    ]);
    expect(() =>
      validateLayoutSpec(TEMPLATE_FIXTURES.sidecar, reg.registeredIds()),
    ).not.toThrow();
    reg.unregister("placeholder.companion");
    expect(() =>
      validateLayoutSpec(TEMPLATE_FIXTURES.sidecar, reg.registeredIds()),
    ).toThrow(/unregistered/);
  });

  it("singleton is seeded with the frozen placeholder registry", () => {
    expect(surfaceRegistry.has("placeholder.primary")).toBe(true);
    expect(surfaceRegistry.has("placeholder.persistent")).toBe(true);
    expect(surfaceRegistry.isPersistentCapable("placeholder.persistent")).toBe(true);
    expect(surfaceRegistry.isPersistentCapable("placeholder.primary")).toBe(false);
    expect(surfaceRegistry.size()).toBe(4);
  });
});

/* -------------------------------------------------------------- fallback */

describe("role fallback ladder", () => {
  it("documents the frozen ladder exactly", () => {
    expect(ROLE_FALLBACK_LADDER).toEqual({
      primary: ["companion", "support"],
      companion: ["support"],
      support: [],
      persistent: [],
    });
  });

  it("resolves exactly when the requested role is supported", () => {
    for (const role of ["primary", "companion", "support"] as const) {
      expect(resolveRole(role, ["primary", "companion", "support"])).toEqual({
        kind: "exact",
        requested: role,
        role,
      });
    }
  });

  it("degrades primary -> companion -> support, never promotes", () => {
    expect(resolveRole("primary", ["companion"])).toEqual({
      kind: "fallback",
      requested: "primary",
      role: "companion",
    });
    expect(resolveRole("primary", ["support"])).toEqual({
      kind: "fallback",
      requested: "primary",
      role: "support",
    });
    // A companion-requested surface never becomes primary.
    expect(resolveRole("companion", ["primary"])).toBeNull();
    expect(resolveRole("companion", ["support"])).toEqual({
      kind: "fallback",
      requested: "companion",
      role: "support",
    });
  });

  it("support is the floor — no fallback below it", () => {
    expect(resolveRole("support", ["primary", "companion"])).toBeNull();
    expect(resolveRole("support", ["support"])).toEqual({
      kind: "exact",
      requested: "support",
      role: "support",
    });
  });

  it("persistent never resolves through template roles", () => {
    expect(resolveRole("persistent", ["persistent"])).toBeNull();
  });

  it("resolveLayout resolves every assignment, exact when possible", () => {
    const resolved = resolveLayout(TEMPLATE_FIXTURES.triple, surfaceRegistry);
    expect(resolved).toEqual([
      {
        surfaceId: "placeholder.primary",
        slot: "main",
        requestedRole: "primary",
        role: "primary",
        degraded: false,
      },
      {
        surfaceId: "placeholder.companion",
        slot: "side",
        requestedRole: "companion",
        role: "companion",
        degraded: false,
      },
      {
        surfaceId: "placeholder.support",
        slot: "rail",
        requestedRole: "support",
        role: "support",
        degraded: false,
      },
    ]);
  });

  it("resolveLayout applies the ladder end-to-end", () => {
    const reg = createSurfaceRegistry([
      { surfaceId: "compact.only", roles: ["companion", "support"] },
    ]);
    const resolved = resolveLayout(
      {
        template: "focus",
        assignments: [
          { surfaceId: "compact.only", role: "primary", slot: "main" },
        ],
      },
      reg,
    );
    expect(resolved[0]).toEqual({
      surfaceId: "compact.only",
      slot: "main",
      requestedRole: "primary",
      role: "companion",
      degraded: true,
    });
  });

  it("fails deterministically when no acceptable role exists", () => {
    const reg = createSurfaceRegistry([
      { surfaceId: "full.roles", roles: ["primary"] },
      { surfaceId: "primary.only", roles: ["primary"] },
    ]);
    expect(() =>
      resolveLayout(
        {
          template: "sidecar",
          assignments: [
            { surfaceId: "full.roles", role: "primary", slot: "main" },
            { surfaceId: "primary.only", role: "support", slot: "side" },
          ],
        },
        reg,
      ),
    ).toThrow(/cannot render role "support".*no fallback available/);
  });

  it("validates the frozen rules before resolving (unregistered / persistent)", () => {
    const reg = createSurfaceRegistry([
      { surfaceId: "a", roles: ["primary"] },
      { surfaceId: "b", roles: ["primary"], persistentCapable: true },
    ]);
    expect(() =>
      resolveLayout(
        {
          template: "focus",
          assignments: [{ surfaceId: "ghost", role: "primary", slot: "main" }],
        },
        reg,
      ),
    ).toThrow(/unregistered/);
    expect(() =>
      resolveLayout(
        {
          template: "sidecar",
          assignments: [
            { surfaceId: "a", role: "primary", slot: "main" },
            { surfaceId: "b", role: "persistent", slot: "side" },
          ],
        },
        reg,
      ),
    ).toThrow(/shell-controlled/);
  });
});

/* ---------------------------------------------------------------- store */

describe("store adaptive state (UI-103)", () => {
  it("starts empty and stores a validated spec + resolved assignments", () => {
    const store = createAppStore(() => {});
    expect(store.getState().adaptive).toEqual(EMPTY_ADAPTIVE);
    store.getState().applyAdaptiveSpec(TEMPLATE_FIXTURES.sidecar);
    const { adaptive } = store.getState();
    expect(adaptive.spec).toEqual(TEMPLATE_FIXTURES.sidecar);
    expect(adaptive.assignments.map((a) => a.surfaceId)).toEqual([
      "placeholder.primary",
      "placeholder.companion",
    ]);
    expect(adaptive.assignments.map((a) => a.role)).toEqual([
      "primary",
      "companion",
    ]);
  });

  it("the same surface instance transitions primary -> companion -> primary", () => {
    // B2 transition gate: settle the window after each agent proposal so
    // the next one commits instead of queueing.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const store = createAppStore(() => {});
      const seen: string[] = [];
      store.getState().applyAdaptiveSpec(specPrimary);
      vi.advanceTimersByTime(TRANSITION_MS + 50);
      seen.push(roleOf(store, "placeholder.primary"));
      store.getState().applyAdaptiveSpec(specSwapped);
      vi.advanceTimersByTime(TRANSITION_MS + 50);
      seen.push(roleOf(store, "placeholder.primary"));
      store.getState().applyAdaptiveSpec(specPrimary);
      seen.push(roleOf(store, "placeholder.primary"));
      // The surfaceId never changes identity — only its role transitions.
      expect(seen).toEqual(["primary", "companion", "primary"]);
      // Both surfaces were present at every step (no surface lost).
      expect(store.getState().adaptive.assignments.length).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("per-surfaceId state bag survives role swaps untouched", () => {
    const store = createAppStore(() => {});
    store.getState().setSurfaceState("placeholder.primary", "stamp", "S1");
    store.getState().setSurfaceState("placeholder.primary", "scroll", 42);
    store.getState().applyAdaptiveSpec(specPrimary);
    store.getState().applyAdaptiveSpec(specSwapped);
    store.getState().applyAdaptiveSpec(specPrimary);
    expect(store.getState().surfaceState["placeholder.primary"]).toEqual({
      stamp: "S1",
      scroll: 42,
    });
    // Bags are independent per surfaceId.
    store.getState().setSurfaceState("placeholder.companion", "stamp", "C1");
    expect(store.getState().surfaceState["placeholder.companion"]).toEqual({
      stamp: "C1",
    });
    expect(store.getState().surfaceState["placeholder.primary"]).toEqual({
      stamp: "S1",
      scroll: 42,
    });
  });

  it("invalid specs are REJECTED, never thrown — state untouched (GATE-1 addendum)", () => {
    // GATE-1 changed applyAdaptiveSpec to warn-and-return on an
    // unrenderable spec: the geometry guard (computeAdaptiveGeometry)
    // catches validator/geometry failures, console.warns, and leaves
    // state untouched — the app must never white-screen.
    const store = createAppStore(() => {});
    store.getState().applyAdaptiveSpec(specPrimary);
    const before = store.getState().adaptive;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      // two primaries in a sidecar — frozen validator violation
      expect(() =>
        store.getState().applyAdaptiveSpec({
          template: "sidecar",
          assignments: [
            { surfaceId: "placeholder.primary", role: "primary", slot: "main" },
            { surfaceId: "placeholder.companion", role: "primary", slot: "side" },
          ],
        }),
      ).not.toThrow();
      // unregistered surface — registry violation
      expect(() =>
        store.getState().applyAdaptiveSpec({
          template: "focus",
          assignments: [
            { surfaceId: "ghost", role: "primary", slot: "main" },
          ],
        }),
      ).not.toThrow();
      // the rejection is observable: warn-and-return
      expect(warn).toHaveBeenCalled();
      } finally {
      warn.mockRestore();
      }
      // layout composition state is exactly what it was before — no partial
      // updates; only the rejection record changed (ADV-F3, GATE-4: the
      // rejection is observable — the last invalid spec recorded a structured
      // "geometry" code instead of vanishing silently).
      const after = store.getState().adaptive;
      expect(after.spec).toEqual(before.spec);
      expect(after.assignments).toEqual(before.assignments);
      expect(after.overrides).toEqual(before.overrides);
      expect(after.preFullscreen).toEqual(before.preFullscreen);
      expect(after.lastUnhandledAction).toEqual(before.lastUnhandledAction);
      expect(after.lastRejection).not.toBeNull();
      expect(after.lastRejection?.code).toBe("geometry");
      });

  it("the registry module is usable by the store end-to-end", () => {
    const store = createAppStore(() => {});
    surfaceRegistry.register({ surfaceId: "demo.registerme", roles: ["primary"] });
    try {
      store.getState().applyAdaptiveSpec({
        template: "focus",
        assignments: [
          { surfaceId: "demo.registerme", role: "primary", slot: "main" },
        ],
      });
      expect(store.getState().adaptive.assignments[0].role).toBe("primary");
    } finally {
      surfaceRegistry.unregister("demo.registerme");
    }
    expect(surfaceRegistry.has("demo.registerme")).toBe(false);
  });
});

/* ----------------------------------------------------------------- host */

describe("SurfaceHost (geometry-blind, keyed by surfaceId)", () => {
  // B2 transition gate host state lives in the store closure and survives
  // setState. Fake timers are armed ONCE for the whole describe (each
  // useFakeTimers call resets the clock, losing the store's pending settle
  // timer); the beforeEach advance then settles any leftover transition so
  // each test starts IDLE. No restore in afterEach — restoring would clear
  // the pending timer and re-break gate isolation.
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });

  beforeEach(() => {
    (appStore as unknown as { getServerState: () => unknown }).getServerState =
      () => appStore.getState();
    // Settle any leftover transition FIRST (the advance may commit a queued
    // target), then reset the state below.
    vi.advanceTimersByTime(1000);
    appStore.setState({ adaptive: EMPTY_ADAPTIVE, surfaceState: {} });
    demoRoleHistory.clear();
  });

  afterEach(() => {
    // No timer restore here — see the beforeAll note.
  });

  afterAll(() => {
    // Worker hygiene: restore real timers when this describe finishes so a
    // reused worker thread never leaks the fake clock into another file.
    vi.useRealTimers();
  });

  function renderHost(): string {
    return renderToString(
      <SurfaceHost
        assignments={appStore.getState().adaptive.assignments}
        persistent={["placeholder.persistent"]}
        registry={surfaceRegistry}
        components={DEMO_SURFACE_COMPONENTS}
      />,
    );
  }

  it("renders all four roles — every surface knows its role", () => {
    appStore.getState().applyAdaptiveSpec(TEMPLATE_FIXTURES.triple);
    const html = renderHost();
    expect(html).toContain('data-surface-role="primary"');
    expect(html).toContain('data-surface-role="companion"');
    expect(html).toContain('data-surface-role="support"');
    expect(html).toContain('data-surface-role="persistent"');
    expect(html).toContain('data-surface-slot="rail"');
    // The role context reached the mounted surface (demo renders it back).
    expect(html).toContain('data-demo-role="support"');
    expect(html).toContain('data-demo-capabilities="primary,companion,support"');
    // The persistent surface knows it is persistent.
    expect(html).toContain('data-demo-role="persistent"');
  });

  it("same surface transitions primary -> companion -> primary with state intact", () => {
    // The describe-level fake clock (beforeAll) is already active — the
    // advance calls settle each agent proposal's window so the next one
    // commits instead of queueing. No local useFakeTimers/useRealTimers:
    // restoring would clear the shared clock and leave later tests racy.
    {
      appStore.getState().setSurfaceState("placeholder.primary", "stamp", "S1");
      appStore.getState().applyAdaptiveSpec(specPrimary);
      vi.advanceTimersByTime(TRANSITION_MS + 50);
      let html = renderHost();
      expect(countOccurrences(html, 'data-surface-id="placeholder.primary"')).toBe(1);
      expect(html).toContain('data-demo-role="primary"');
      expect(html).toContain('data-demo-stamp="S1"');

      appStore.getState().applyAdaptiveSpec(specSwapped);
      vi.advanceTimersByTime(TRANSITION_MS + 50);
      html = renderHost();
      expect(countOccurrences(html, 'data-surface-id="placeholder.primary"')).toBe(1);
      expect(html).toContain('data-demo-role="companion"');
      expect(html).toContain('data-demo-stamp="S1"'); // state survived the swap

      appStore.getState().applyAdaptiveSpec(specPrimary);
      html = renderHost();
      expect(html).toContain('data-demo-role="primary"');
      expect(html).toContain('data-demo-stamp="S1"');
      // One uninterrupted per-surfaceId history entry with the full sequence.
      expect(demoRoleHistory.get("placeholder.primary")?.roles).toEqual([
        "primary",
        "companion",
        "primary",
      ]);
    }
  });

  it("renders the resolved (degraded) role for unsupported requests", () => {
    const reg = createSurfaceRegistry([
      { surfaceId: "compact.only", roles: ["companion", "support"] },
    ]);
    const resolved = resolveLayout(
      {
        template: "focus",
        assignments: [
          { surfaceId: "compact.only", role: "primary", slot: "main" },
        ],
      },
      reg,
    );
    const html = renderToString(
      <SurfaceHost
        assignments={resolved}
        registry={reg}
        components={{ "compact.only": DEMO_SURFACE_COMPONENTS["placeholder.primary"] }}
      />,
    );
    expect(html).toContain('data-surface-role="companion"');
    expect(html).toContain('data-surface-requested-role="primary"');
    expect(html).toContain('data-surface-degraded');
    // The surface itself knows it was degraded and what was requested.
    expect(html).toContain('data-demo-role="companion"');
    expect(html).toContain('data-demo-requested-role="primary"');
    expect(html).toContain('data-demo-degraded');
  });

  it("persistent region hosts only persistent-capable surfaces", () => {
    const html = renderToString(
      <SurfaceHost
        assignments={[]}
        persistent={["placeholder.persistent", "placeholder.primary"]}
        registry={surfaceRegistry}
        components={DEMO_SURFACE_COMPONENTS}
      />,
    );
    expect(html).toContain('data-surface-region="persistent"');
    expect(html).toContain('data-surface-id="placeholder.persistent"');
    expect(html).toContain('data-demo-role="persistent"');
    // placeholder.primary is NOT persistentCapable — skipped deterministically.
    expect(html).not.toContain('data-surface-id="placeholder.primary"');
  });

  it("unmapped surfaceIds render a neutral marker without crashing", () => {
    const html = renderToString(
      <SurfaceHost
        assignments={[
          {
            surfaceId: "no.component",
            slot: "main",
            requestedRole: "primary",
            role: "primary",
            degraded: false,
          },
        ]}
        registry={createSurfaceRegistry([
          { surfaceId: "no.component", roles: ["primary"] },
        ])}
        components={{}}
      />,
    );
    expect(html).toContain('data-surface-unmapped="no.component"');
  });

  it("the surface API is geometry-blind — no rects, px, or inline geometry", () => {
    const reg = createSurfaceRegistry([
      { surfaceId: "geom.a", roles: ["primary", "companion", "support"] },
      { surfaceId: "geom.b", roles: ["primary", "companion", "support"] },
      { surfaceId: "geom.c", roles: ["primary", "companion", "support"] },
      { surfaceId: "geom.p", roles: ["primary"], persistentCapable: true },
    ]);
    const resolved = resolveLayout(
      {
        template: "triple",
        assignments: [
          { surfaceId: "geom.a", role: "primary", slot: "main" },
          { surfaceId: "geom.b", role: "companion", slot: "side" },
          { surfaceId: "geom.c", role: "support", slot: "rail" },
        ],
      },
      reg,
    );
    const html = renderToString(
      <SurfaceHost
        assignments={resolved}
        persistent={["geom.p"]}
        registry={reg}
        components={{}}
      />,
    );
    expect(html).not.toMatch(/style=/);
    expect(html).not.toMatch(/px/i);
    expect(html).not.toMatch(/rect/i);
    expect(html).not.toMatch(/\b(width|height|x|y|z)="/);
    // ResolvedAssignment carries ONLY semantic fields.
    expect(Object.keys(resolved[0]).sort()).toEqual([
      "degraded",
      "requestedRole",
      "role",
      "slot",
      "surfaceId",
    ]);
  });
});
