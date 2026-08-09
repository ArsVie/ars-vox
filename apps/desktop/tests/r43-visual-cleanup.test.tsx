/**
 * GATE-3.5 R43 (Wave 1, A9) + GATE-5 W0-DIRECTIVE — production UI free of
 * implementation vocabulary. Node env, renderToStaticMarkup + CSS source
 * reads (repo convention — no jsdom, zustand getServerState shim in
 * beforeEach).
 *
 * Guards the cleanup so it cannot regress:
 *   (a) NO template selector anywhere, dev included: the R43 demo
 *       combobox is DELETED (W0-DIRECTIVE) — no DEMO_TOGGLE_ENABLED in
 *       source, no <select> in the shell chrome, no "Plantilla".
 *   (b) ONE status indicator: the redundant "agente conectado" text is
 *       gone; the status pill is the single indicator.
 *   (c) No generic CONVERSACIÓN container header when conversation is
 *       primary (covered in conversation-surface.test.tsx) — here we pin
 *       the suggestion chips to real capabilities (no "Lee mis correos").
 *   (d) Confirmation UI shows human labels only — no raw `tool:` names —
 *       and renders as a popup inside the chat, not a full-screen overlay.
 *   (e) Spanish accessibility labels everywhere in the touched chrome.
 *   (f) role="status" live region contains NO interactive controls.
 *   (g) One canonical status vocabulary (STATUS_VOCABULARY is the only
 *       voice-state text source).
 *   (h) STOP floor (>=48px token) stays guarded by a11y.test.tsx; here we
 *       pin the Spanish accessible name in the shell chrome.
 *   (i) W0-DIRECTIVE: persistent home affordance (ARS·VOX → mic hero) and
 *       a close X on every panel header.
 */
import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ConfirmationPanel } from "../src/components/ConfirmationPanel";
import { ConversationPanel } from "../src/components/ConversationPanel";
import { PanelHeader } from "../src/components/PanelHeader";
import { STATUS_VOCABULARY, StatusBar } from "../src/components/StatusBar";
import { appStore } from "../src/store";
import {
  SurfaceRoleProvider,
  type SurfaceRoleInfo,
} from "../src/roles/context";
import type { SurfaceRole } from "../src/adaptive/contracts";

function renderStatusBar(): string {
  return renderToStaticMarkup(<StatusBar />);
}

/** Capabilities the conversation surface declares in the shared registry. */
const CONVERSATION_ROLES: readonly SurfaceRole[] = [
  "primary",
  "companion",
  "support",
];

/** W2-SURFACES: surfaces render inside a SurfaceRoleProvider — mount the
 *  conversation as PRIMARY (full variant), same pattern as
 *  tests/media-surface.test.tsx. */
function renderPrimaryConversation(): string {
  return renderToStaticMarkup(
    <SurfaceRoleProvider
      value={
        {
          surfaceId: "conversation",
          role: "primary",
          requestedRole: "primary",
          capabilities: CONVERSATION_ROLES,
          degraded: false,
        } satisfies SurfaceRoleInfo
      }
    >
      <ConversationPanel panelId="conversation" />
    </SurfaceRoleProvider>,
  );
}

beforeEach(() => {
  appStore.setState({
    voiceState: "sleeping",
    connected: true,
    activity: null,
    speakTexts: [],
    messages: [],
    pending: null,
  });
  (appStore as unknown as { getServerState: () => unknown }).getServerState = () =>
    appStore.getState();
});

/* ----------------------------------------- (a) NO template selector gate */

describe("W0-DIRECTIVE: no template selector anywhere, dev included", () => {
  it("the demo toggle is deleted from source — no DEMO_TOGGLE_ENABLED, no select", () => {
    const src = readFileSync(new URL("../src/components/StatusBar.tsx", import.meta.url), "utf8");
    expect(src).not.toContain("DEMO_TOGGLE_ENABLED");
    expect(src).not.toContain("status-demo");
    expect(src).not.toContain("<select");
    expect(src).not.toContain("TEMPLATE_DEMO_LABELS");
  });

  it("the shell chrome renders no selector and no demo vocabulary", () => {
    const html = renderStatusBar();
    expect(html).not.toContain("<select");
    expect(html).not.toContain("status-demo-select");
    expect(html).not.toContain("Plantilla");
    expect(html).not.toContain("Automática");
  });
});

/* ----------------------------------------- (b) one status indicator */

describe("R43 one status indicator", () => {
  it("no redundant connection text — the pill is the single indicator", () => {
    const html = renderStatusBar();
    expect(html).not.toContain("agente conectado");
    expect(html).not.toContain("agente sin conexión");
    expect(html).not.toContain("status-conn");
  });
});

/* ------------------------------------------------- (c) suggestion chips */

describe("R43 suggestion chips name real capabilities only", () => {
  it("primary empty state offers only implemented capabilities", () => {
    const html = renderPrimaryConversation();
    expect(html).toContain("Abre un documento"); // document.open exists
    expect(html).toContain("Dime la hora"); // time injection exists
    expect(html).not.toContain("Lee mis correos"); // email NOT implemented
    expect(html.match(/suggestion-chip/g)).toHaveLength(2);
  });
});

/* ---------------------------------------- (d) confirmation human labels */

describe("W0-DIRECTIVE confirmation: human labels, popup inside the chat", () => {
  it("never renders the raw tool name", () => {
    appStore.setState({
      pending: {
        pendingId: "p1",
        tool: "telegram.send_pending",
        title: "Enviar mensaje por Telegram",
        detail: "Se enviará a la persona aprobada:\nhola",
        expiresInS: 60,
      },
    });
    const html = renderToStaticMarkup(<ConfirmationPanel />);
    expect(html).toContain("Enviar mensaje por Telegram"); // human title
    expect(html).toContain("Se enviará a la persona aprobada"); // human detail
    expect(html).not.toContain("tool:");
    expect(html).not.toContain("telegram.send_pending");
    expect(html).toContain('aria-label="Confirmación"');
  });

  it("renders as a chat popup, not a full-screen overlay panel", () => {
    appStore.setState({
      pending: {
        pendingId: "p1",
        tool: "telegram.send_pending",
        title: "Enviar mensaje por Telegram",
        detail: "Se enviará a la persona aprobada:\nhola",
        expiresInS: 60,
      },
    });
    const html = renderToStaticMarkup(<ConfirmationPanel />);
    expect(html).toContain("confirmation-popup");
    expect(html).toContain("confirmation-card");
    expect(html).not.toContain('class="overlay"');
  });
});

/* ---------------------------------------------------- (e) Spanish labels */

describe("R43 Spanish accessibility labels in a Spanish UI", () => {
  it("conversation chrome has no English accessible names", () => {
    const html = renderPrimaryConversation();
    expect(html).toContain('aria-label="Conversación"'); // section
    expect(html).toContain('aria-label="Escribe una petición"'); // composer
    expect(html).toContain('aria-label="Grabar un mensaje"'); // mic (hero + composer)
    expect(html).not.toContain('aria-label="Request"');
    expect(html).not.toContain('aria-label="Conversation"');
  });

  it("STOP keeps its Spanish accessible name in the production bar", () => {
    const html = renderStatusBar();
    expect(html).toContain('aria-label="Detener"');
    expect(html).toContain("DETENER");
  });
});

/* --------------------------------- (f) live region has no interactive */

describe("R43 role=status live region contains no interactive controls", () => {
  it("the pill is the only live region and holds no controls", () => {
    const html = renderStatusBar();
    const matches = html.match(/role="status"/g);
    expect(matches).toHaveLength(1);
    const statusIdx = html.indexOf('role="status"');
    // Window ends at the STOP <button> tag itself (the pill region ends
    // right before it), so any interactive element inside the window would
    // be INSIDE the live region.
    const stopIdx = html.indexOf('<button type="button" class="stop-button');
    expect(stopIdx).toBeGreaterThan(-1);
    const regionContent = html.slice(statusIdx, stopIdx);
    expect(regionContent).not.toContain("<button");
    expect(regionContent).not.toContain("<select");
    expect(regionContent).not.toContain("<input");
  });

  it("no select exists anywhere in the shell chrome (dev included)", () => {
    const html = renderStatusBar();
    expect(html).not.toContain("<select");
  });
});

/* ------------------------------------------------- (i) W0-DIRECTIVE chrome */

describe("W0-DIRECTIVE: persistent home affordance + close X on panel headers", () => {
  it("the ARS·VOX home affordance is persistent and labeled Inicio", () => {
    const html = renderStatusBar();
    expect(html).toContain("ARS");
    expect(html).toContain("VOX");
    expect(html).toContain('aria-label="Inicio"');
    expect(html).toContain('class="home-button"');
    expect(html).toContain('class="shell-chrome"');
  });

  it("the state presentation is minimal — no activity line, no header bar", () => {
    const html = renderStatusBar();
    expect(html).not.toContain("status-activity");
    expect(html).not.toContain("status-bar");
    expect(html).not.toContain("app-topbar");
  });

  it("every panel header exposes a close X through the shared seam", () => {
    const html = renderToStaticMarkup(
      <PanelHeader panelId="browser" icon={<span>i</span>}>
        Navegador
      </PanelHeader>,
    );
    expect(html).toContain('aria-label="Cerrar panel"');
    expect(html).toContain("panel-action--close");
    // The maximize/restore action is preserved alongside the close X.
    expect(html).toContain('aria-label="Maximizar panel"');
  });
});

/* -------------------------------------------------- (g) status vocabulary */

describe("R43 one canonical status vocabulary", () => {
  it("STATUS_VOCABULARY is the single frozen set of Spanish status texts", () => {
    expect(STATUS_VOCABULARY).toEqual({
      sleeping: "En espera",
      listening: "Escuchando",
      thinking: "Pensando",
      speaking: "Hablando",
      waiting_for_confirmation: "Esperando confirmación",
      stopping: "Deteniendo",
      error: "Error",
    });
  });

  it("the production pill renders a canonical label (never a raw state key)", () => {
    const html = renderStatusBar();
    expect(html).toContain(">En espera</span>");
  });
});
