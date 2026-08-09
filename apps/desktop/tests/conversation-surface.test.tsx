/**
 * UI-202 — conversation adaptive surface.
 *
 * SSR coverage (renderToStaticMarkup, no jsdom) for the three role
 * variants (primary/companion/support) driven by useSurfaceRole() from the
 * UI-103 role framework, plus the history-survival and shell-state
 * non-duplication guarantees. Same zustand SSR trick as
 * content-panels.test.tsx: attach a live getServerState in beforeEach and
 * seed the singleton store through the real event path (applyEvent).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import type { SurfaceRole } from "../src/adaptive/contracts";
import { appStore } from "../src/store";
import { SurfaceRoleProvider } from "../src/roles/context";
import { ConversationPanel } from "../src/components/ConversationPanel";

function ts(): string {
  return new Date().toISOString();
}

const PANEL_ID = "conversation" as const;

function roleInfo(role: SurfaceRole) {
  return {
    surfaceId: "conversation",
    role,
    requestedRole: role,
    capabilities: ["primary", "companion", "support"] as readonly SurfaceRole[],
    degraded: false,
  };
}

function render(role: SurfaceRole): string {
  return renderToStaticMarkup(
    <SurfaceRoleProvider value={roleInfo(role)}>
      <ConversationPanel panelId={PANEL_ID} />
    </SurfaceRoleProvider>,
  );
}

function seedMessages(texts: { role: "user" | "assistant"; text: string }[]): void {
  for (const m of texts) {
    if (m.role === "user") {
      appStore.getState().applyEvent({
        type: "user_message",
        id: `u-${m.text}`,
        text: m.text,
        created_at: ts(),
      });
    } else {
      appStore.getState().applyEvent({
        type: "agent_message",
        text: m.text,
        delta: false,
        created_at: ts(),
      });
    }
  }
}

beforeEach(() => {
  (appStore as unknown as { getServerState: () => unknown }).getServerState = () =>
    appStore.getState();
  appStore.setState({ messages: [] });
});

describe("ConversationPanel variants", () => {
  it("primary renders the full conversation (empty state, suggestions, composer — no redundant container header)", () => {
    const html = render("primary");
    expect(html).toContain('data-variant="primary"');
    expect(html).toContain("conversation-panel");
    // R43: the generic CONVERSACIÓN container label is dropped when the
    // conversation IS the primary surface; the surface keeps its Spanish
    // accessible name (and its identity is the hero / message list).
    expect(html).not.toContain("panel-header");
    expect(html).toContain('aria-label="Conversación"');
    // Full empty-state chrome.
    expect(html).toContain("Di o escribe una petición");
    expect(html).toContain("suggestion-chip");
    expect(html).toContain("Abre un documento");
    // Composer contract preserved.
    expect(html).toContain('aria-label="Escribe una petición"');
    expect(html).toContain("send-button");
    expect(html).toContain("Enviar");
  });

  it("companion renders a compact conversation: subdued header, no hero/suggestions, composer intact", () => {
    seedMessages([
      { role: "user", text: "Abre un documento" },
      { role: "assistant", text: "Claro, abriendo el informe…" },
    ]);
    const html = render("companion");
    expect(html).toContain('data-variant="companion"');
    // Subdued header instead of the full panel header.
    expect(html).toContain("conversation-subheader");
    expect(html).not.toContain("panel-header");
    // Messages stay readable.
    expect(html).toContain("message user");
    expect(html).toContain("message assistant");
    expect(html).toContain("Abre un documento");
    expect(html).toContain("Claro, abriendo el informe…");
    // No hero/suggestion chrome.
    expect(html).not.toContain("suggestion-chip");
    expect(html).not.toContain("empty-hint");
    // Composer contract preserved (density classes still apply from the slot).
    expect(html).toContain('aria-label="Escribe una petición"');
    expect(html).toContain("send-button");
  });

  it("support renders only the latest exchange, no header, composer intact", () => {
    seedMessages([
      { role: "user", text: "primero" },
      { role: "assistant", text: "respuesta uno" },
      { role: "user", text: "segundo" },
      { role: "assistant", text: "respuesta dos" },
    ]);
    const html = render("support");
    expect(html).toContain('data-variant="support"');
    // Only the latest exchange is visible (render-only slice).
    expect(html).toContain("segundo");
    expect(html).toContain("respuesta dos");
    expect(html).not.toContain("primero");
    expect(html).not.toContain("respuesta uno");
    // No header chrome, composer still present.
    expect(html).not.toContain("panel-header");
    expect(html).not.toContain("conversation-subheader");
    expect(html).toContain('aria-label="Escribe una petición"');
    expect(html).toContain("send-button");
  });

  it("keeps the composer DOM in every variant so engine density collapse still applies", () => {
    for (const role of ["primary", "companion", "support"] as SurfaceRole[]) {
      const html = render(role);
      expect(html).toContain("composer");
      expect(html).toContain('aria-label="Escribe una petición"');
      expect(html).toContain("send-button");
    }
  });
});

describe("ConversationPanel history survival", () => {
  it("messages survive role changes: seeded via applyEvent, intact in every variant", () => {
    seedMessages([
      { role: "user", text: "Lee mis correos" },
      { role: "assistant", text: "Tienes 3 correos nuevos" },
    ]);

    const companionHtml = render("companion");
    expect(companionHtml).toContain("Lee mis correos");
    expect(companionHtml).toContain("Tienes 3 correos nuevos");

    // Promoted back to primary: same history, same surface.
    const primaryHtml = render("primary");
    expect(primaryHtml).toContain("Lee mis correos");
    expect(primaryHtml).toContain("Tienes 3 correos nuevos");
    expect(primaryHtml).toContain('data-variant="primary"');
  });

  it("does not clear history when demoted to support (store is authoritative)", () => {
    seedMessages([
      { role: "user", text: "Dime la hora" },
      { role: "assistant", text: "Son las 10:00" },
    ]);
    const html = render("support");
    expect(html).toContain("Dime la hora");
    expect(html).toContain("Son las 10:00");
    // The store still holds both messages — nothing was cleared.
    expect(appStore.getState().messages).toHaveLength(2);
  });
});

describe("ConversationPanel shell-state non-duplication", () => {
  it("never repeats shell-level assistant state (StatusBar owns it)", () => {
    appStore.getState().applyEvent({
      type: "state_update",
      voice_state: "listening",
      activity: "Procesando correos",
      created_at: ts(),
    });
    const html = render("primary");
    expect(html).not.toContain("Escuchando");
    expect(html).not.toContain("Pensando");
    expect(html).not.toContain("Deteniendo");
    expect(html).not.toContain("Procesando correos");
    expect(html).not.toContain("status-pill");
  });
});

describe("ConversationPanel legacy path", () => {
  it("renders the default primary variant without a SurfaceRoleProvider", () => {
    const html = renderToStaticMarkup(<ConversationPanel panelId={PANEL_ID} />);
    expect(html).toContain('data-variant="primary"');
    // R43: primary never renders the container header, legacy path included.
    expect(html).not.toContain("panel-header");
    expect(html).toContain('aria-label="Conversación"');
    expect(html).toContain('aria-label="Escribe una petición"');
  });
});
