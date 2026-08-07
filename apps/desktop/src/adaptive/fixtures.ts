/**
 * Placeholder fixtures for every template (UI-000 deliverable).
 *
 * These let shell / geometry / role / token / harness workers (UI-101..105)
 * compile and render against the contract BEFORE any product surface exists.
 * They use generic placeholder surface ids — product surfaces (UI-201..205)
 * replace them later. Identity is stable: moving a surface between roles
 * reuses the same surfaceId (state must survive).
 */

import type { LayoutSpec, SurfaceRegistration } from "./contracts";
import { TEMPLATE_SLOTS } from "./contracts";

/** Placeholder surface ids usable by any worker. */
export const PLACEHOLDER_SURFACES = [
  "placeholder.primary",
  "placeholder.companion",
  "placeholder.support",
  "placeholder.persistent",
] as const;

/** Registry fixture: every placeholder surface registered with full roles. */
export const PLACEHOLDER_REGISTRY: SurfaceRegistration[] =
  PLACEHOLDER_SURFACES.map((surfaceId) => ({
    surfaceId,
    roles: ["primary", "companion", "support"],
    persistentCapable: surfaceId === "placeholder.persistent",
  }));

export const PLACEHOLDER_REGISTERED_IDS: ReadonlySet<string> = new Set(
  PLACEHOLDER_REGISTRY.map((r) => r.surfaceId),
);

/** Valid LayoutSpec for every template, built from placeholder surfaces. */
export const TEMPLATE_FIXTURES: Record<string, LayoutSpec> = {
  focus: {
    template: "focus",
    assignments: [
      { surfaceId: "placeholder.primary", role: "primary", slot: "main" },
    ],
  },
  sidecar: {
    template: "sidecar",
    assignments: [
      { surfaceId: "placeholder.primary", role: "primary", slot: "main" },
      {
        surfaceId: "placeholder.companion",
        role: "companion",
        slot: "side",
      },
    ],
    proportion: "balanced",
  },
  stack: {
    template: "stack",
    assignments: [
      { surfaceId: "placeholder.primary", role: "primary", slot: "main" },
      {
        surfaceId: "placeholder.companion",
        role: "companion",
        slot: "side",
      },
    ],
    proportion: "wide",
  },
  split: {
    template: "split",
    assignments: [
      { surfaceId: "placeholder.primary", role: "primary", slot: "main" },
      {
        surfaceId: "placeholder.companion",
        role: "companion",
        slot: "side",
      },
    ],
    proportion: "balanced",
  },
  triple: {
    template: "triple",
    assignments: [
      { surfaceId: "placeholder.primary", role: "primary", slot: "main" },
      {
        surfaceId: "placeholder.companion",
        role: "companion",
        slot: "side",
      },
      { surfaceId: "placeholder.support", role: "support", slot: "rail" },
    ],
    proportion: "wide",
  },
};

/** All five templates, in wave order. */
export const ALL_TEMPLATES = [
  "focus",
  "sidecar",
  "stack",
  "split",
  "triple",
] as const;

/** Slot vocabulary per template (shared with the contract). */
export { TEMPLATE_SLOTS };
