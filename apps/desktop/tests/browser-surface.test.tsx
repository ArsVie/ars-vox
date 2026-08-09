/**
 * UI-201 browser adaptive surface — SSR coverage of the three semantic
 * role variants (primary/companion/support) plus state survival across
 * role changes. Same zustand SSR trick as content-panels.test.tsx:
 * useStore snapshots via `api.getServerState || api.getInitialState`,
 * so we attach a live getServerState in beforeEach and seed the
 * singleton store through the real event path (applyEvent).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import type { SurfaceRole } from "../src/adaptive/contracts";
import { BrowserPanel } from "../src/components/BrowserPanel";
import { SurfaceRoleProvider, type SurfaceRoleInfo } from "../src/roles/context";
import { appStore } from "../src/store";

const DEMO_URL = "http://127.0.0.1:5173/demo-news.html";

function ts(): string {
  return new Date().toISOString();
}

/** Render the browser surface as it appears mounted at a given role. */
function renderAs(role: SurfaceRole): string {
  const info: SurfaceRoleInfo = {
    surfaceId: "surface.browser",
    role,
    requestedRole: role,
    capabilities: ["primary", "companion", "support"],
    degraded: false,
  };
  return renderToStaticMarkup(
    <SurfaceRoleProvider value={info}>
      <BrowserPanel />
    </SurfaceRoleProvider>,
  );
}

function seedBrowser(): void {
  appStore.getState().applyEvent({
    type: "browser.navigate",
    url: DEMO_URL,
    title: "Demo News",
    can_go_back: true,
    can_go_forward: false,
    loading: false,
    created_at: ts(),
  });
}

beforeEach(() => {
  (appStore as unknown as { getServerState: () => unknown }).getServerState = () =>
    appStore.getState();
  // Start every test with an empty content surface.
  appStore.setState({ content: {} });
});

describe("BrowserPanel adaptive roles (UI-201)", () => {
  it("primary: full browsing experience — toolbar, address entry, viewport iframe", () => {
    seedBrowser();
    const html = renderAs("primary");
    expect(html).toContain("browser-surface--primary");
    expect(html).toContain("browser-toolbar");
    expect(html).toContain("browser-address");
    expect(html).toContain("browser-viewport");
    expect(html).toContain(`src="${DEMO_URL}"`);
    expect(html).toContain("Demo News");
  });

  it("companion: full chrome preserved but rendered with the subdued variant", () => {
    seedBrowser();
    const html = renderAs("companion");
    expect(html).toContain("browser-surface--companion");
    expect(html).toContain("browser-toolbar");
    expect(html).toContain("browser-address");
    expect(html).toContain("browser-viewport");
    expect(html).toContain("Demo News");
  });

  it("support: compact contextual representation — viewport only, no toolbar", () => {
    seedBrowser();
    const html = renderAs("support");
    expect(html).toContain("browser-surface--support");
    expect(html).not.toContain("browser-toolbar");
    expect(html).not.toContain("browser-address");
    expect(html).toContain("browser-viewport");
    expect(html).toContain(`src="${DEMO_URL}"`);
  });

  it("kills the dead nav controls: no back/forward/refresh buttons in any variant", () => {
    // GATE-3.5 (W3-BROWSER): the toolbar buttons were permanently dead —
    // the service hardcodes can_go_back=false and the cross-origin
    // sandbox forbids driving the iframe's history from the parent.
    // Regression: they must not render, and must not come back.
    seedBrowser();
    for (const role of ["primary", "companion", "support"] as const) {
      const html = renderAs(role);
      expect(html).not.toContain("browser-nav-btn");
      expect(html).not.toContain('aria-label="Atrás"');
      expect(html).not.toContain('aria-label="Adelante"');
      expect(html).not.toContain('aria-label="Recargar"');
    }
    // Navigation lives in the address bar (browser.navigate) — it stays.
    expect(renderAs("primary")).toContain("browser-address");
    expect(renderAs("primary")).toContain('aria-label="Dirección web"');
  });

  it("no outer card and no permanent surface-name label", () => {
    seedBrowser();
    const html = renderAs("primary");
    // The header label is the PAGE title, never a bare surface name.
    expect(html).not.toContain("Navegador");
    expect(html).toContain("Demo News");
  });

  it("empty state keeps its message and viewport in every variant", () => {
    for (const role of ["primary", "companion", "support"] as const) {
      const html = renderAs(role);
      expect(html).toContain(
        "Pídeme que abra una página o escribe una dirección arriba.",
      );
      expect(html).toContain("browser-viewport");
      expect(html).not.toContain("<iframe");
    }
  });

  it("state survives role changes: content + key DOM persist across roles", () => {
    seedBrowser();
    // Role transitions (primary -> companion -> support) hit the same
    // store-backed content; rendering must never reset or drop it.
    for (const role of ["primary", "companion", "support"] as const) {
      const html = renderAs(role);
      expect(html).toContain("Demo News");
      expect(html).toContain(`src="${DEMO_URL}"`);
      expect(html).toContain("browser-viewport");
    }
    // The role still shapes the presentation.
    expect(renderAs("primary")).toContain("browser-address");
    expect(renderAs("support")).not.toContain("browser-address");
  });
});
