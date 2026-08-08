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
 * DOM contract: KEEPS the existing .panel-slot vocabulary — each slot
 * renders `<div class="panel-slot panel-slot--<slot>">` positioned in
 * fractional stage coordinates, exactly like the legacy PanelHost. New
 * data-* attributes (data-surface-id / data-role / data-slot) are
 * ADDITIVE. Slot keys are surfaceIds, so a surface moving between slots
 * keeps its React instance (acceptance: identity = surfaceId).
 *
 * The engine produces geometry only — this component adds no container
 * chrome (no borders, headers, cards). Look & feel is UI-101/UI-104.
 */
import type { AdaptiveGeometry } from "./adaptiveEngine";

/** Fraction → CSS percentage string with FP noise trimmed (3 decimals:
 * sub-pixel precision for any stage up to ~100k px). Geometry fractions
 * themselves stay exact — only the DOM string is cleaned. */
function pct(value: number): string {
  const rounded = Math.round(value * 100 * 1000) / 1000;
  return `${rounded}%`;
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

/** Renders an AdaptiveGeometry: one .panel-slot per occupied slot. */
export function AdaptiveStage({ geometry }: { geometry: AdaptiveGeometry }) {
  return (
    <div
      className="panel-host"
      data-adaptive-stage=""
      data-template={geometry.template}
      data-proportion={geometry.proportion}
    >
      {geometry.slots.map((g) => (
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
          <PlaceholderSurface surfaceId={g.surfaceId} role={g.role} slot={g.slot} />
        </div>
      ))}
    </div>
  );
}
