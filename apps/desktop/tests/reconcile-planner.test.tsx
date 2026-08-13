/**
 * B1 — layout reconciliation (per-surfaceId diff) + dependency specs
 * (2026-08-13).
 *
 * Covers the lane B1 acceptance criteria:
 *  - unchanged surfaces keep identity (surfaceId-keyed identity contract +
 *    no-change-during-reading rule); a template change with identical
 *    assignments is still a change but leaves every surface unchanged;
 *  - removedSurfaceIds is the disposal cue, addedSurfaceIds the mount cue;
 *  - dependency specs: media requires active media content, document_editor
 *    requires an open document context; a desired surface whose requirement
 *    is unsatisfied by the snapshot is DROPPED with code
 *    "requirement_unsatisfied" (never thrown mid-way);
 *  - absent snapshot (or registry) = requirements NOT consulted — all
 *    existing planner behavior preserved;
 *  - reconcileLayout is deterministic.
 */
import { describe, expect, it, vi } from "vitest";

import type { LayoutSpec } from "../src/adaptive/contracts";
import {
  reconcileLayout,
  type PlannerRegistry,
  type ReconcileResult,
} from "../src/adaptive/planner";
import {
  createSurfaceRegistry,
  surfaceRegistry,
  type SurfaceRequirement,
  type SurfaceRequirementSnapshot,
} from "../src/roles/registry";

/* ------------------------------------------------------------- fixtures */

const sidecarSpec: LayoutSpec = {
  template: "sidecar",
  assignments: [
    { surfaceId: "document_editor", role: "primary", slot: "main" },
    { surfaceId: "conversation", role: "companion", slot: "side" },
  ],
  proportion: "balanced",
};

/** Same surface ids/roles as sidecarSpec, different template (main+side
 *  slots exist in both) — template change with identical assignments. */
const stackSpec: LayoutSpec = {
  template: "stack",
  assignments: [
    { surfaceId: "document_editor", role: "primary", slot: "main" },
    { surfaceId: "conversation", role: "companion", slot: "side" },
  ],
  proportion: "wide",
};

const focusBrowserSpec: LayoutSpec = {
  template: "focus",
  assignments: [{ surfaceId: "browser", role: "primary", slot: "main" }],
};

const tripleMediaSpec: LayoutSpec = {
  template: "triple",
  assignments: [
    { surfaceId: "browser", role: "primary", slot: "main" },
    { surfaceId: "media", role: "companion", slot: "side" },
    { surfaceId: "tasks", role: "support", slot: "rail" },
  ],
  proportion: "wide",
};

const tripleDocumentSpec: LayoutSpec = {
  template: "triple",
  assignments: [
    { surfaceId: "browser", role: "primary", slot: "main" },
    { surfaceId: "document_editor", role: "companion", slot: "side" },
    { surfaceId: "tasks", role: "support", slot: "rail" },
  ],
  proportion: "wide",
};

const SATISFIED: SurfaceRequirementSnapshot = {
  mediaActive: true,
  documentOpen: true,
};

/** Product-like registry declaring the B1 dependency specs (mirrors the
 *  singleton's declarations in roles/registry.ts). */
function registryWithRequirements() {
  const reg = createSurfaceRegistry([
    { surfaceId: "browser", roles: ["primary", "companion", "support"] },
    { surfaceId: "conversation", roles: ["primary", "companion", "support"] },
    {
      surfaceId: "document_editor",
      roles: ["primary", "companion", "support"],
    },
    { surfaceId: "media", roles: ["primary", "companion", "persistent"] },
    { surfaceId: "tasks", roles: ["primary", "companion", "support"] },
  ]);
  reg.declareRequirement("media", (s) => s.mediaActive);
  reg.declareRequirement("document_editor", (s) => s.documentOpen);
  return reg;
}

function codesOf(result: ReconcileResult): string[] {
  return result.rejections.map((r) => r.code);
}

/* -------------------------------------------------- per-surfaceId diff */

describe("reconcileLayout — per-surfaceId diff", () => {
  it("identical desired/current → every surface unchanged, no cues, spec identity kept", () => {
    const result = reconcileLayout(sidecarSpec, sidecarSpec);
    expect(result.spec).toBe(sidecarSpec);
    expect(result.addedSurfaceIds).toEqual([]);
    expect(result.removedSurfaceIds).toEqual([]);
    expect(result.unchangedSurfaceIds).toEqual([
      "document_editor",
      "conversation",
    ]);
    expect(result.rejections).toEqual([]);
  });

  it("emits the disposal cue for a surface absent from the desired spec", () => {
    const desired: LayoutSpec = {
      template: "sidecar",
      assignments: [
        { surfaceId: "document_editor", role: "primary", slot: "main" },
        { surfaceId: "browser", role: "companion", slot: "side" },
      ],
      proportion: "balanced",
    };
    const result = reconcileLayout(desired, sidecarSpec);
    expect(result.removedSurfaceIds).toEqual(["conversation"]);
    expect(result.addedSurfaceIds).toEqual(["browser"]);
    expect(result.unchangedSurfaceIds).toEqual(["document_editor"]);
  });

  it("emits the mount cue for a surface added over the current spec", () => {
    const result = reconcileLayout(sidecarSpec, focusBrowserSpec);
    expect(result.addedSurfaceIds).toEqual(["document_editor", "conversation"]);
    expect(result.removedSurfaceIds).toEqual(["browser"]);
    expect(result.unchangedSurfaceIds).toEqual([]);
  });

  it("a null current spec mounts everything, removes nothing", () => {
    const result = reconcileLayout(sidecarSpec, null);
    expect(result.addedSurfaceIds).toEqual(["document_editor", "conversation"]);
    expect(result.removedSurfaceIds).toEqual([]);
    expect(result.unchangedSurfaceIds).toEqual([]);
    expect(result.spec).toBe(sidecarSpec);
  });

  it("template change with identical assignments → spec differs, surfaces unchanged", () => {
    const result = reconcileLayout(stackSpec, sidecarSpec);
    expect(result.spec).toBe(stackSpec);
    expect(result.spec.template).toBe("stack");
    expect(result.spec).not.toBe(sidecarSpec);
    expect(result.unchangedSurfaceIds).toEqual([
      "document_editor",
      "conversation",
    ]);
    expect(result.addedSurfaceIds).toEqual([]);
    expect(result.removedSurfaceIds).toEqual([]);
  });

  it("role swap reuses the same surfaceIds (identity survives)", () => {
    const swapped: LayoutSpec = {
      template: "sidecar",
      assignments: [
        { surfaceId: "conversation", role: "primary", slot: "main" },
        { surfaceId: "document_editor", role: "companion", slot: "side" },
      ],
      proportion: "balanced",
    };
    const result = reconcileLayout(swapped, sidecarSpec);
    expect(result.unchangedSurfaceIds).toEqual([
      "conversation",
      "document_editor",
    ]);
    expect(result.addedSurfaceIds).toEqual([]);
    expect(result.removedSurfaceIds).toEqual([]);
  });

  it("is deterministic — identical inputs produce deep-equal results", () => {
    expect(reconcileLayout(sidecarSpec, focusBrowserSpec)).toEqual(
      reconcileLayout(sidecarSpec, focusBrowserSpec),
    );
  });
});

/* --------------------------------------- dependency specs (requires) */

describe("reconcileLayout — requirement consultation", () => {
  const reg = registryWithRequirements();

  it("drops media when mediaActive is false and reports requirement_unsatisfied", () => {
    const result = reconcileLayout(
      tripleMediaSpec,
      tripleMediaSpec,
      { mediaActive: false, documentOpen: true },
      reg,
    );
    expect(result.spec.assignments.map((a) => a.surfaceId)).toEqual([
      "browser",
      "tasks",
    ]);
    expect(result.removedSurfaceIds).toEqual(["media"]);
    expect(result.unchangedSurfaceIds).toEqual(["browser", "tasks"]);
    expect(result.addedSurfaceIds).toEqual([]);
    expect(codesOf(result)).toEqual(["requirement_unsatisfied"]);
    expect(result.rejections[0].reason).toContain("media");
  });

  it("drops document_editor when documentOpen is false", () => {
    const result = reconcileLayout(
      tripleDocumentSpec,
      tripleDocumentSpec,
      { mediaActive: true, documentOpen: false },
      reg,
    );
    expect(result.removedSurfaceIds).toEqual(["document_editor"]);
    expect(result.unchangedSurfaceIds).toEqual(["browser", "tasks"]);
    expect(codesOf(result)).toEqual(["requirement_unsatisfied"]);
    expect(result.rejections[0].reason).toContain("document_editor");
  });

  it("keeps everything when every requirement is satisfied", () => {
    const result = reconcileLayout(tripleMediaSpec, tripleMediaSpec, SATISFIED, reg);
    expect(result.spec).toBe(tripleMediaSpec);
    expect(result.unchangedSurfaceIds).toEqual(["browser", "media", "tasks"]);
    expect(result.rejections).toEqual([]);
  });

  it("surfaces without a declared requirement are never consulted", () => {
    const result = reconcileLayout(
      tripleMediaSpec,
      tripleMediaSpec,
      { mediaActive: false, documentOpen: true },
      reg,
    );
    // browser/tasks declare no requirement and stay despite the snapshot.
    expect(result.unchangedSurfaceIds).toEqual(["browser", "tasks"]);
    expect(result.rejections.length).toBe(1);
  });

  it("a dropped surface that was never mounted is NOT reported as added", () => {
    const desired: LayoutSpec = {
      template: "sidecar",
      assignments: [
        { surfaceId: "browser", role: "primary", slot: "main" },
        { surfaceId: "media", role: "companion", slot: "side" },
      ],
      proportion: "balanced",
    };
    const result = reconcileLayout(
      desired,
      focusBrowserSpec,
      { mediaActive: false, documentOpen: true },
      reg,
    );
    expect(result.addedSurfaceIds).toEqual([]);
    expect(result.unchangedSurfaceIds).toEqual(["browser"]);
    expect(result.removedSurfaceIds).toEqual([]);
    expect(result.rejections[0].reason).toContain("media");
  });

  it("keeps the committed spec when dropping would invalidate the composition", () => {
    // document_editor is the only primary; dropping it leaves no primary →
    // the filtered composition is invalid → current is kept (no-op diff),
    // with the requirement rejection still reported.
    const result = reconcileLayout(
      sidecarSpec,
      sidecarSpec,
      { mediaActive: true, documentOpen: false },
      reg,
    );
    expect(result.spec).toBe(sidecarSpec);
    expect(result.addedSurfaceIds).toEqual([]);
    expect(result.removedSurfaceIds).toEqual([]);
    expect(result.unchangedSurfaceIds).toEqual([
      "document_editor",
      "conversation",
    ]);
    expect(codesOf(result)).toEqual(["requirement_unsatisfied"]);
  });

  it("never throws on requirement consultation — always a structured result", () => {
    const allDropped: LayoutSpec = {
      template: "sidecar",
      assignments: [
        { surfaceId: "document_editor", role: "primary", slot: "main" },
        { surfaceId: "media", role: "companion", slot: "side" },
      ],
      proportion: "balanced",
    };
    expect(() =>
      reconcileLayout(
        allDropped,
        null,
        { mediaActive: false, documentOpen: false },
        reg,
      ),
    ).not.toThrow();
    const result = reconcileLayout(
      allDropped,
      null,
      { mediaActive: false, documentOpen: false },
      reg,
    );
    expect(codesOf(result)).toEqual([
      "requirement_unsatisfied",
      "requirement_unsatisfied",
    ]);
    expect(result.spec.assignments).toEqual([]);
  });
});

/* ------------------------------- absent snapshot / registry: no consult */

describe("reconcileLayout — absent snapshot or registry skips consultation", () => {
  it("does not call requires() when the snapshot argument is absent", () => {
    const requires = vi.fn(() => true);
    const reg = createSurfaceRegistry([
      { surfaceId: "media", roles: ["primary", "companion", "persistent"] },
    ]);
    reg.declareRequirement("media", requires);
    const desired: LayoutSpec = {
      template: "focus",
      assignments: [{ surfaceId: "media", role: "primary", slot: "main" }],
    };
    const result = reconcileLayout(desired, null, undefined, reg);
    expect(requires).not.toHaveBeenCalled();
    expect(result.spec).toBe(desired);
    expect(result.rejections).toEqual([]);
  });

  it("does not call requires() when the snapshot is explicitly null", () => {
    const requires = vi.fn(() => true);
    const reg = createSurfaceRegistry([
      { surfaceId: "media", roles: ["primary"] },
    ]);
    reg.declareRequirement("media", requires);
    const desired: LayoutSpec = {
      template: "focus",
      assignments: [{ surfaceId: "media", role: "primary", slot: "main" }],
    };
    const result = reconcileLayout(desired, null, null, reg);
    expect(requires).not.toHaveBeenCalled();
    expect(result.spec).toBe(desired);
    expect(result.rejections).toEqual([]);
  });

  it("passes the desired spec through untouched when no registry is given", () => {
    const result = reconcileLayout(tripleMediaSpec, tripleMediaSpec, {
      mediaActive: false,
      documentOpen: true,
    });
    expect(result.spec).toBe(tripleMediaSpec);
    expect(result.unchangedSurfaceIds).toEqual(["browser", "media", "tasks"]);
    expect(result.rejections).toEqual([]);
  });

  it("does not consult when the registry lacks requiresOf (structural PlannerRegistry)", () => {
    const noRequirements: PlannerRegistry = {
      registeredIds: () => new Set<string>(),
      capabilitiesOf: () => [],
    };
    const result = reconcileLayout(
      tripleMediaSpec,
      tripleMediaSpec,
      { mediaActive: false, documentOpen: true },
      noRequirements,
    );
    expect(result.spec).toBe(tripleMediaSpec);
    expect(result.rejections).toEqual([]);
  });
});

/* --------------------------------------------------- registry (B1) API */

describe("registry dependency specs (B1)", () => {
  it("requiresOf returns undefined by default and for unknown ids", () => {
    const reg = createSurfaceRegistry([{ surfaceId: "a", roles: ["primary"] }]);
    expect(reg.requiresOf("a")).toBeUndefined();
    expect(reg.requiresOf("nope")).toBeUndefined();
  });

  it("declareRequirement round-trips through requiresOf", () => {
    const reg = createSurfaceRegistry([{ surfaceId: "a", roles: ["primary"] }]);
    const pred: SurfaceRequirement = (s) => s.mediaActive;
    reg.declareRequirement("a", pred);
    expect(reg.requiresOf("a")).toBe(pred);
    expect(pred({ mediaActive: true, documentOpen: false })).toBe(true);
    expect(pred({ mediaActive: false, documentOpen: true })).toBe(false);
  });

  it("the singleton declares the B1 specs for media and document_editor only", () => {
    expect(surfaceRegistry.requiresOf("media")).toBeDefined();
    expect(surfaceRegistry.requiresOf("document_editor")).toBeDefined();
    expect(surfaceRegistry.requiresOf("browser")).toBeUndefined();
    expect(surfaceRegistry.requiresOf("placeholder.primary")).toBeUndefined();

    // the declared predicates implement the documented semantics
    expect(
      surfaceRegistry.requiresOf("media")!({
        mediaActive: true,
        documentOpen: false,
      }),
    ).toBe(true);
    expect(
      surfaceRegistry.requiresOf("media")!({
        mediaActive: false,
        documentOpen: true,
      }),
    ).toBe(false);
    expect(
      surfaceRegistry.requiresOf("document_editor")!({
        mediaActive: true,
        documentOpen: true,
      }),
    ).toBe(true);
    expect(
      surfaceRegistry.requiresOf("document_editor")!({
        mediaActive: true,
        documentOpen: false,
      }),
    ).toBe(false);
  });
});
