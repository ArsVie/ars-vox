/**
 * UI-102 — Adaptive stage renderer (fixture placeholder surfaces).
 *
 * Renders the output of the geometry engine (src/layout/adaptiveEngine.ts)
 * into the DOM. This is the UI-102 fixture path: placeholder surfaces are
 * rendered into the computed slots so the engine is testable end-to-end
 * before any product surface (UI-201..205) exists. Individual surface
 * rendering is owned by UI-103/UI-201+; this component only hosts the
 * placeholder fixtures from src/adaptive/fixtures.ts.
 *
 * UI-206 — layout transition system (motion): the stage carries a motion
 * gate (data-motion="enabled"|"reduced") driven by prefers-reduced-motion;
 * slot geometry changes animate in place via CSS transitions (see the
 * UI-206 block in styles.css). Animation never remounts: slot elements are
 * keyed by surfaceId, so a surface moving between slots keeps its React
 * instance and simply transitions its geometry (acceptance: identity =
 * surfaceId). The gate is consulted synchronously at render time (SSR-safe)
 * and kept live via a matchMedia change listener; the CSS reduced-motion
 * block is the second gate.
 *
 * DOM contract: KEEPS the existing .panel-slot vocabulary — each slot
 * renders `<div class="panel-slot panel-slot--<slot>">` positioned in
 * fractional stage coordinates, exactly like the legacy PanelHost. New
 * data-* attributes (data-surface-id / data-role / data-slot / data-motion)
 * are ADDITIVE.
 *
 * The engine produces geometry only — this component adds no container
 * chrome (no borders, headers, cards). Look & feel is UI-101/UI-104.
 */
import { useEffect, useState } from "react";
import type { AdaptiveGeometry } from "./adaptiveEngine";
import type { SurfaceRole } from "../adaptive/contracts";
import { surfaceComponent } from "../adaptive/surfaces";
import { SurfaceRoleProvider } from "../roles/context";
import { surfaceRegistry } from "../roles/registry";

/** Fraction → CSS percentage string with FP noise trimmed (3 decimals:
 * sub-pixel precision for any stage up to ~100k px). Geometry fractions
 * themselves stay exact — only the DOM string is cleaned. */
function pct(value: number): string {
  const rounded = Math.round(value * 100 * 1000) / 1000;
  return `${rounded}%`;
}

/**
 * UI-206 — prefers-reduced-motion gate.
 *
 * Synchronous initial read (lazy state initializer) so SSR markup and
 * node tests see the matchMedia verdict without waiting for effects
 * (renderToString never runs effects); a change listener keeps the gate
 * live in the browser. `override` (explicit prop) wins over the media
 * query — used by tests and by hosts that already know the preference.
 */
export function usePrefersReducedMotion(override?: boolean): boolean {
  const [matches, setMatches] = useState<boolean>(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false,
  );
  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return undefined;
    }
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    }
    if (typeof query.addListener === "function") {
      query.addListener(onChange);
      return () => query.removeListener(onChange);
    }
    return undefined;
  }, []);
  return override ?? matches;
}

/** Placeholder surface (UI-102 fixture) — a bare, chrome-free region that
 * identifies itself via data attributes. Product surfaces replace it. */
export function PlaceholderSurface({
  surfaceId,
  role,
  slot,
}: {
  surfaceId: string;
  role: string;
  slot: string;
}) {
  return (
    <div
      className="adaptive-placeholder"
      data-surface-id={surfaceId}
      data-role={role}
      data-slot={slot}
    >
      <span className="adaptive-placeholder-label">{surfaceId}</span>
    </div>
  );
}

/**
 * UI-206 — slot elements keyed by SURFACE ID (the no-remount contract).
 * Pure and hook-free so tests can inspect the reconciliation keys directly:
 * a surface moving between slots keeps its key — React preserves the
 * instance and the CSS transition animates the same element's geometry.
 * Never key by slot name: that would remount on every move.
 */
export function stageSlotElements(geometry: AdaptiveGeometry) {
  return geometry.slots.map((g) => {
    const Component = surfaceComponent(g.surfaceId);
    const role = g.role as SurfaceRole;
    return (
      <div
        key={g.surfaceId}
        className={`panel-slot panel-slot--${g.slot}`}
        style={{
          left: pct(g.x),
          top: pct(g.y),
          width: pct(g.width),
          height: pct(g.height),
          zIndex: g.zIndex,
        }}
        data-slot={g.slot}
        data-role={g.role}
        data-surface-id={g.surfaceId}
      >
        {Component ? (
          // GATE-2 (Wave 2): registered product surfaces render through the
          // role host contract — SurfaceRoleProvider hands the surface its
          // semantic role (UI-103); key stays the surfaceId (no remount).
          <SurfaceRoleProvider
            value={{
              surfaceId: g.surfaceId,
              role,
              requestedRole: role,
              capabilities: surfaceRegistry.capabilitiesOf(g.surfaceId),
              degraded: !surfaceRegistry
                .capabilitiesOf(g.surfaceId)
                .includes(role),
            }}
          >
            <Component panelId={g.surfaceId} />
          </SurfaceRoleProvider>
        ) : (
          <PlaceholderSurface
            surfaceId={g.surfaceId}
            role={g.role}
            slot={g.slot}
          />
        )}
      </div>
    );
  });
}

/** Renders an AdaptiveGeometry: one .panel-slot per occupied slot. */
export function AdaptiveStage({
  geometry,
  reducedMotion,
}: {
  geometry: AdaptiveGeometry;
  /** Explicit motion preference (tests / hosts). Defaults to matchMedia. */
  reducedMotion?: boolean;
}) {
  const motion = !usePrefersReducedMotion(reducedMotion);
  return (
    <div
      className="panel-host"
      data-adaptive-stage=""
      data-motion={motion ? "enabled" : "reduced"}
      data-template={geometry.template}
      data-proportion={geometry.proportion}
    >
      {stageSlotElements(geometry)}
    </div>
  );
}
