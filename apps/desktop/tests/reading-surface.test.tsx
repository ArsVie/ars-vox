/**
 * UI-203 — Reading adaptive surface tests (SSR, node env).
 *
 * The reading surface (DocumentPanel + ReaderView) adapts to its semantic
 * role: primary = maximal reading experience, companion = reduced
 * dominance, support = compact title + position. Verification is
 * DOM/state-level (reader engines are broken on main — out of scope):
 * variant classes, data-surface-role, the epub ≈72ch measure, position
 * state surviving role transitions via the store surfaceState bag, and
 * the reader staying MOUNTED in support so the engine instance survives.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import type { SurfaceRole } from "../src/adaptive/contracts";
import type { ReaderLocation } from "../src/readers/reader";
import { DocumentPanel } from "../src/components/DocumentPanel";
import { SurfaceRoleProvider } from "../src/roles/context";
import { appStore } from "../src/store";

function ts(): string {
  return new Date().toISOString();
}

const LOCATION: ReaderLocation = {
  locator: "epubcfi(/6/4!/4/2)",
  label: "Página 2 de 4",
  progress: 0.5,
};

function seedEpub(): void {
  appStore.getState().applyEvent({
    type: "document.load",
    title: "El Quijote",
    kind: "epub",
    path: "/books/quijote.epub",
    url: "demo-book.epub",
    content: "",
    chapters: [],
    created_at: ts(),
  });
}

function renderWithRole(role: SurfaceRole): string {
  return renderToStaticMarkup(
    <SurfaceRoleProvider
      value={{
        surfaceId: "document_editor",
        role,
        requestedRole: role,
        capabilities: ["primary", "companion", "support"],
        degraded: false,
      }}
    >
      <DocumentPanel panelId="document_editor" />
    </SurfaceRoleProvider>,
  );
}

beforeEach(() => {
  (appStore as unknown as { getServerState: () => unknown }).getServerState = () =>
    appStore.getState();
  appStore.setState({ content: {}, surfaceState: {} });
});

describe("DocumentPanel role variants (UI-203)", () => {
  it("primary renders the maximal reading surface with the epub measure class", () => {
    seedEpub();
    const html = renderWithRole("primary");
    expect(html).toContain('data-surface-role="primary"');
    expect(html).toContain("reading-surface--primary");
    expect(html).toContain("reader-view--primary");
    // epub book-column class drives the ≈72ch measure (asserted below)
    expect(html).toContain("reader-view--epub");
    expect(html).toContain("reader-stage");
    // no compact position strip in primary
    expect(html).not.toContain("reading-position-strip");
  });

  it("companion renders the reduced-dominance variant of the reader", () => {
    seedEpub();
    const html = renderWithRole("companion");
    expect(html).toContain('data-surface-role="companion"');
    expect(html).toContain("reading-surface--companion");
    expect(html).toContain("reader-view--companion");
    // the reader itself is still fully present and measured
    expect(html).toContain("reader-view--epub");
    expect(html).toContain("reader-stage");
  });

  it("support renders compact title + position while keeping the reader mounted", () => {
    seedEpub();
    appStore.getState().setSurfaceState("document_editor", "readingLocation", LOCATION);
    const html = renderWithRole("support");
    expect(html).toContain('data-surface-role="support"');
    expect(html).toContain("reading-surface--support");
    expect(html).toContain('data-reading-position');
    expect(html).toContain("El Quijote");
    expect(html).toContain("Página 2 de 4");
    // The reader stays in the DOM (hidden by .reading-surface--support
    // CSS) so the engine instance + position survive role changes.
    expect(html).toContain("reader-view--support");
    expect(html).toContain("reader-stage");
  });

  it("reading position survives a role change (store surfaceState bag)", () => {
    seedEpub();
    // position recorded while the surface was primary (page turn)
    appStore.getState().setSurfaceState("document_editor", "readingLocation", LOCATION);
    const primaryHtml = renderWithRole("primary");
    expect(primaryHtml).toContain("reader-view--primary");
    // role changes: same surfaceId, same store bag -> position is still
    // there, now rendered as the compact support representation
    const supportHtml = renderWithRole("support");
    expect(supportHtml).toContain("Página 2 de 4");
    expect(supportHtml).toContain('data-reading-position');
    expect(supportHtml).toContain("reader-view");
  });

  it("adds no redundant surface-naming label (no READING/Lectura chrome)", () => {
    seedEpub();
    for (const role of ["primary", "companion", "support"] as const) {
      const html = renderWithRole(role);
      expect(html).not.toMatch(/>(Lectura|Reading|Lector|Leyendo)</);
    }
  });

  it("renders the RESOLVED role when the requested role was degraded (ladder output is authoritative)", () => {
    seedEpub();
    // A degraded request (requestedRole != role) must render the role the
    // host RESOLVED — never a component-side default. Here the ladder
    // resolved a support request down to primary.
    const html = renderToStaticMarkup(
      <SurfaceRoleProvider
        value={{
          surfaceId: "document_editor",
          role: "primary",
          requestedRole: "support",
          capabilities: ["primary", "companion", "support"],
          degraded: true,
        }}
      >
        <DocumentPanel panelId="document_editor" />
      </SurfaceRoleProvider>,
    );
    expect(html).toContain('data-surface-role="primary"');
    expect(html).toContain("reading-surface--primary");
    expect(html).toContain("reader-view--primary");
    expect(html).toContain("reader-stage");
    // The degraded request must NOT leak into the presentation.
    expect(html).not.toContain("reading-surface--support");
    expect(html).not.toContain("reading-position-strip");
  });

  it("keeps the text/editor path working under every role", () => {
    appStore.getState().applyEvent({
      type: "document.load",
      title: "Reunión",
      kind: "md",
      path: "/docs/reunion.md",
      content: "Aprobado el calendario.",
      chapters: [],
      created_at: ts(),
    });
    const html = renderWithRole("companion");
    expect(html).toContain("doc-paragraph");
    expect(html).toContain("document-mode-btn");
    expect(html).toContain("Aprobado el calendario.");
  });
});

describe("UI-203 epub measure (72ch book column)", () => {
  it("constrains the epub stage to the same ≈72ch measure as .document-reader", () => {
    const css = readFileSync(
      new URL("../src/content.css", import.meta.url),
      "utf8",
    );
    // text docs already had the 72ch measure — reused, not duplicated
    expect(css).toMatch(/\.document-reader\s*\{[^}]*max-width:\s*72ch/);
    // epub reader gets the same measure via the variant class
    expect(css).toMatch(
      /\.reader-view--epub \.reader-stage iframe\s*\{[^}]*min\(100%,\s*72ch\)/,
    );
  });

  it("uses catalog tokens only for the variant chrome", () => {
    const css = readFileSync(
      new URL("../src/content.css", import.meta.url),
      "utf8",
    );
    // no new group-prefixed custom properties introduced by UI-203
    const ui203Block = css.slice(css.indexOf("reader variants (UI-203)"));
    expect(ui203Block).not.toMatch(/--(surface|spacing|divider|typography|radius|control|icon|state)-[a-z-]+:\s*[^v]/);
    expect(ui203Block).toMatch(/var\(--surface-card\)/);
    expect(ui203Block).toMatch(/var\(--divider-subordinate\)/);
    expect(ui203Block).toMatch(/var\(--typography-caption-normal\)/);
  });
});
