/**
 * GATE-2 — product surface wiring tests (Wave 2).
 *
 * Verifies the adaptive stage hosts the REAL product surfaces (UI-201..205)
 * through LayoutSpec: registration + capabilities, real-component rendering
 * with the role host contract, and the placeholder fallback for unmapped
 * surface ids (existing fixture behavior preserved).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";

import type { LayoutSpec } from "../src/adaptive/contracts";
import {
  registerProductSurfaces,
  SURFACE_COMPONENTS,
} from "../src/adaptive/surfaces";
import {
  computeAdaptiveGeometry,
  type AdaptiveGeometry,
} from "../src/layout/adaptiveEngine";
import { AdaptiveStage } from "../src/layout/AdaptiveStage";
import { surfaceRegistry } from "../src/roles/registry";
import { appStore } from "../src/store";

const DESKTOP = { width: 1280, height: 800 };

function geometryOf(spec: LayoutSpec): AdaptiveGeometry {
  return computeAdaptiveGeometry(spec, DESKTOP, surfaceRegistry.registeredIds());
}

function renderStage(spec: LayoutSpec): string {
  return renderToString(<AdaptiveStage geometry={geometryOf(spec)} />);
}

beforeAll(() => {
  // Live store snapshot for SSR (zustand getServerState gotcha — see
  // content-panels.test.tsx): component SSR reads current state.
  (appStore as unknown as { getServerState: () => unknown }).getServerState =
    () => appStore.getState();
  registerProductSurfaces();
});

describe("product surface registration (GATE-2)", () => {
  it("registers the five product surfaces with role capabilities", () => {
    for (const id of [
      "browser",
      "conversation",
      "document_editor",
      "tasks",
      "media",
    ]) {
      expect(surfaceRegistry.has(id)).toBe(true);
    }
    expect(surfaceRegistry.capabilitiesOf("browser")).toEqual([
      "primary",
      "companion",
      "support",
    ]);
    expect(surfaceRegistry.capabilitiesOf("media")).toEqual([
      "primary",
      "companion",
      "persistent",
    ]);
    expect(surfaceRegistry.isPersistentCapable("media")).toBe(true);
    expect(surfaceRegistry.isPersistentCapable("browser")).toBe(false);
  });

  it("maps every registered product surface to a component", () => {
    for (const id of [
      "browser",
      "conversation",
      "document_editor",
      "tasks",
      "media",
    ]) {
      expect(SURFACE_COMPONENTS[id]).toBeTypeOf("function");
    }
  });

  it("is idempotent (repeat registration does not throw)", () => {
    expect(() => registerProductSurfaces()).not.toThrow();
  });
});

describe("adaptive stage hosting real surfaces", () => {
  it("renders real product surfaces via LayoutSpec with their role", () => {
    const spec: LayoutSpec = {
      template: "split",
      proportion: "balanced",
      assignments: [
        { surfaceId: "browser", role: "primary", slot: "main" },
        { surfaceId: "conversation", role: "primary", slot: "side" },
      ],
    };
    const html = renderStage(spec);
    expect(html).toContain('data-surface-id="browser"');
    expect(html).toContain('data-role="primary"');
    // UI-201: BrowserPanel renders its role variant attribute.
    expect(html).toContain('data-browser-role="primary"');
    // UI-202: ConversationPanel composer contract survives every variant.
    expect(html).toContain('aria-label="Escribe una petición"');
  });

  it("passes a persistent role to the media surface", () => {
    const spec: LayoutSpec = {
      template: "focus",
      assignments: [{ surfaceId: "media", role: "primary", slot: "main" }],
    };
    const html = renderStage(spec);
    expect(html).toContain('data-surface-id="media"');
    // UI-205: compact-bar markup is the persistent variant; primary renders
    // the full player chrome (media-dock root with player).
    expect(html).toContain("media-dock");
  });

  it("falls back to the placeholder fixture for unmapped surface ids", () => {
    if (!surfaceRegistry.has("surf.unmapped")) {
      surfaceRegistry.register({
        surfaceId: "surf.unmapped",
        roles: ["primary"],
      });
    }
    const spec: LayoutSpec = {
      template: "focus",
      assignments: [{ surfaceId: "surf.unmapped", role: "primary", slot: "main" }],
    };
    const html = renderStage(spec);
    expect(html).toContain("adaptive-placeholder");
    expect(html).toContain("surf.unmapped");
    expect(html).not.toContain("data-browser-role");
  });
});
