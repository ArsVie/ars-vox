/**
 * UI-203 — DocumentPanel adaptive surface contract (SSR, node env).
 *
 * DocumentPanel is mounted by the role host ONLY: every instance renders
 * inside a SurfaceRoleProvider, so the adaptive path is the only path.
 * This suite pins that contract at the panel level:
 *   1. Every role renders the resolved role's variant chrome.
 *   2. A degraded requestedRole renders the ladder output — never a
 *      component-side default.
 *   3. Mounting WITHOUT a provider throws: there is no silent legacy
 *      fallback anymore.
 * Reader-engine specifics (epub measure, position survival) live in
 * reading-surface.test.tsx.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import type { SurfaceRole } from "../src/adaptive/contracts";
import { DocumentPanel } from "../src/components/DocumentPanel";
import { SurfaceRoleProvider } from "../src/roles/context";
import { appStore } from "../src/store";

function ts(): string {
  return new Date().toISOString();
}

function seedMarkdown(): void {
  appStore.getState().applyEvent({
    type: "document.load",
    title: "Reunión",
    kind: "md",
    path: "/docs/reunion.md",
    content: "Aprobado el calendario.",
    chapters: [],
    created_at: ts(),
  });
}

function renderWithRole(role: SurfaceRole, requestedRole?: SurfaceRole): string {
  return renderToStaticMarkup(
    <SurfaceRoleProvider
      value={{
        surfaceId: "document_editor",
        role,
        requestedRole: requestedRole ?? role,
        capabilities: ["primary", "companion", "support"],
        degraded: requestedRole !== undefined && requestedRole !== role,
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

describe("DocumentPanel adaptive contract (UI-203)", () => {
  it("renders the resolved role's variant chrome in every role", () => {
    seedMarkdown();
    for (const role of ["primary", "companion", "support"] as const) {
      const html = renderWithRole(role);
      expect(html).toContain(`data-surface-role="${role}"`);
      expect(html).toContain(`reading-surface--${role}`);
    }
  });

  it("renders the RESOLVED role when the requested role was degraded (ladder output is authoritative)", () => {
    seedMarkdown();
    // A degraded request (requestedRole != role) must render the role the
    // host RESOLVED — never a component-side default. Here the ladder
    // resolved a support request down to primary.
    const html = renderWithRole("primary", "support");
    expect(html).toContain('data-surface-role="primary"');
    expect(html).toContain("reading-surface--primary");
    expect(html).not.toContain("reading-surface--support");
  });

  it("requires the role provider — mounting without one throws (no silent legacy fallback)", () => {
    seedMarkdown();
    expect(() =>
      renderToStaticMarkup(<DocumentPanel panelId="document_editor" />),
    ).toThrow(/SurfaceRoleProvider/);
  });

  it("keeps the text/editor path working under a role", () => {
    seedMarkdown();
    const html = renderWithRole("companion");
    expect(html).toContain("doc-paragraph");
    expect(html).toContain("document-mode-btn");
    expect(html).toContain("Aprobado el calendario.");
  });

  // GATE-5 (W1-DOC-SHARED): agent edits reach the open editor LIVE.
  // document.changed routes through the store's content registry into
  // documentSlice, which replaces title/path/content while preserving
  // the reader fields — the panel re-renders the new content.
  it("applies document.changed live — agent edits replace the rendered content", () => {
    seedMarkdown();
    appStore.getState().applyEvent({
      type: "document.changed",
      document_id: 1,
      title: "Reunión",
      path: "/docs/reunion.md",
      content: "El agente reescribió el documento.",
      created_at: ts(),
    });

    const bag = appStore.getState().content.document_editor;
    // Reader fields survive the replace (one document, one authority).
    expect(bag?.kind).toBe("md");
    expect(bag?.chapters).toEqual([]);
    expect(bag?.content).toBe("El agente reescribió el documento.");

    const html = renderWithRole("primary");
    expect(html).toContain("El agente reescribió el documento.");
    expect(html).not.toContain("Aprobado el calendario.");
    // The preserved kind keeps the editor affordance available.
    expect(html).toContain("document-mode-btn");
  });
});
