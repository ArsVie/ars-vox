/**
 * UI-201 browser adaptive surface — SSR coverage of the three semantic
 * role variants (primary/companion/support) plus state survival across
 * role changes. Same zustand SSR trick as content-panels.test.tsx:
 * useStore snapshots via `api.getServerState || api.getInitialState`,
 * so we attach a live getServerState in beforeEach and seed the
 * singleton store through the real event path (applyEvent).
 *
 * W2-VIEW (GATE-5, ADR 0007): the browser surface is a MAIN-owned
 * WebContentsView — BrowserPanel is its chrome + transparent viewport
 * placeholder. The renderer IFRAME PATH IS REMOVED: no <iframe>, no
 * src= anywhere; back/forward/refresh are LIVE nav controls driven by
 * the real can_go_back/can_go_forward the view publishes (they exist
 * again — the GATE-3.5 dead-button regression is reversed).
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

function seedBrowser(overrides: Partial<{ can_go_back: boolean; can_go_forward: boolean }> = {}): void {
  appStore.getState().applyEvent({
    type: "browser.navigate",
    url: DEMO_URL,
    title: "Demo News",
    can_go_back: overrides.can_go_back ?? true,
    can_go_forward: overrides.can_go_forward ?? false,
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
  it("primary: full browsing experience — toolbar, address entry, live nav buttons, viewport", () => {
    seedBrowser();
    const html = renderAs("primary");
    expect(html).toContain("browser-surface--primary");
    expect(html).toContain("browser-toolbar");
    expect(html).toContain("browser-address");
    expect(html).toContain("browser-viewport");
    expect(html).toContain("browser-nav-btn");
    expect(html).toContain("Demo News");
    // R6 (2026-08-14, reviewer round 6 finding 3): without an Electron
    // bridge (web harness / tests) the panel renders a REAL iframe so the
    // page is actually visible — the Electron story layers the main-owned
    // WebContentsView over the placeholder INSTEAD of the iframe.
    expect(html).toContain("browser-iframe-fallback");
    expect(html).toContain(`src="${DEMO_URL}"`);
  });

  it("companion: full chrome preserved but rendered with the subdued variant", () => {
    seedBrowser();
    const html = renderAs("companion");
    expect(html).toContain("browser-surface--companion");
    expect(html).toContain("browser-toolbar");
    expect(html).toContain("browser-address");
    expect(html).toContain("browser-viewport");
    expect(html).toContain("browser-nav-btn");
    expect(html).toContain("Demo News");
    expect(html).toContain("browser-iframe-fallback");
  });

  it("support: compact contextual representation — viewport only, no toolbar", () => {
    seedBrowser();
    const html = renderAs("support");
    expect(html).toContain("browser-surface--support");
    expect(html).not.toContain("browser-toolbar");
    expect(html).not.toContain("browser-address");
    expect(html).not.toContain("browser-nav-btn");
    expect(html).toContain("browser-viewport");
    expect(html).toContain("browser-iframe-fallback");
  });

  it("live nav controls: back/forward enabled exactly per the view's real state", () => {
    // Real can_go_back/can_go_forward from the WebContentsView drive the
    // buttons — W2-VIEW (ADR 0007) reverses the GATE-3.5 dead controls.
    seedBrowser({ can_go_back: true, can_go_forward: true });
    const html = renderAs("primary");
    expect(html).toContain('aria-label="Atrás"');
    expect(html).toContain('aria-label="Adelante"');
    expect(html).toContain('aria-label="Recargar"');
    // enabled: no disabled attribute on back/forward; refresh never disabled
    const back = html.match(/<button[^>]*aria-label="Atrás"[^>]*>/)?.[0] ?? "";
    const fwd = html.match(/<button[^>]*aria-label="Adelante"[^>]*>/)?.[0] ?? "";
    const reload = html.match(/<button[^>]*aria-label="Recargar"[^>]*>/)?.[0] ?? "";
    expect(back).not.toContain("disabled");
    expect(fwd).not.toContain("disabled");
    expect(reload).not.toContain("disabled");
  });

  it("nav controls disable when the view reports no history", () => {
    seedBrowser({ can_go_back: false, can_go_forward: false });
    const html = renderAs("primary");
    const back = html.match(/<button[^>]*aria-label="Atrás"[^>]*>/)?.[0] ?? "";
    const fwd = html.match(/<button[^>]*aria-label="Adelante"[^>]*>/)?.[0] ?? "";
    expect(back).toContain("disabled");
    expect(fwd).toContain("disabled");
    // refresh is always available (reload of the current page)
    const reload = html.match(/<button[^>]*aria-label="Recargar"[^>]*>/)?.[0] ?? "";
    expect(reload).not.toContain("disabled");
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
      expect(html).not.toContain("src=");
    }
  });

  it("state survives role changes: content + key DOM persist across roles", () => {
    seedBrowser();
    // Role transitions (primary -> companion -> support) hit the same
    // store-backed content; rendering must never reset or drop it.
    for (const role of ["primary", "companion", "support"] as const) {
      const html = renderAs(role);
      expect(html).toContain("Demo News");
      expect(html).toContain("browser-viewport");
      expect(html).toContain("browser-iframe-fallback");
    }
    // The role still shapes the presentation.
    expect(renderAs("primary")).toContain("browser-address");
    expect(renderAs("support")).not.toContain("browser-address");
  });

  it("view state reduced from the bridge (applyBrowserViewState) drives the same panel", () => {
    // The main process publishes REAL WebContentsView state over
    // arsvox:browser-state; the store reduces the same frozen field set
    // the browser.navigate events carry — the panel must render it.
    appStore.getState().browserViewState({
      url: DEMO_URL,
      title: "Demo News",
      canGoBack: true,
      canGoForward: true,
      loading: true,
    });
    const html = renderAs("primary");
    expect(html).toContain("Demo News");
    expect(html).toContain("browser-viewport");
    const back = html.match(/<button[^>]*aria-label="Atrás"[^>]*>/)?.[0] ?? "";
    expect(back).not.toContain("disabled");
    // loading=true renders the spinner affordance
    expect(html).toContain("browser-spinner");
  });
});
