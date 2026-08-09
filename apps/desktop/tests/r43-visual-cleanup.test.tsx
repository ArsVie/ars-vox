/**
 * GATE-3.5 R43 (Wave 1, A9) — production UI free of implementation
 * vocabulary. Node env, renderToStaticMarkup + CSS source reads (repo
 * convention — no jsdom, zustand getServerState shim in beforeEach).
 *
 * Guards the cleanup so it cannot regress:
 *   (a) PLANTILLA demo selector: dev tooling only — gated by a
 *       module-level import.meta.env.DEV constant in FOLDABLE form so
 *       production builds dead-code-eliminate it (source-level contract
 *       here; bundle verified post-build via dist grep). Vitest runs in
 *       dev mode, so the combobox IS present in these renders — the
 *       screenshot workflow is preserved.
 *   (b) ONE status indicator: the redundant "agente conectado" text is
 *       gone; the status pill is the single indicator.
 *   (c) No generic CONVERSACIÓN container header when conversation is
 *       primary (covered in conversation-surface.test.tsx) — here we pin
 *       the suggestion chips to real capabilities (no "Lee mis correos").
 *   (d) Confirmation UI shows human labels only — no raw `tool:` names.
 *   (e) Spanish accessibility labels everywhere in the touched chrome.
 *   (f) role="status" live region contains NO interactive controls.
 *   (g) One canonical status vocabulary (STATUS_VOCABULARY is the only
 *       voice-state text source).
 *   (h) STOP floor (>=48px token) stays guarded by a11y.test.tsx; here we
 *       pin the Spanish accessible name in the shell bar.
 */
import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ConfirmationPanel } from "../src/components/ConfirmationPanel";
import { ConversationPanel } from "../src/components/ConversationPanel";
import { STATUS_VOCABULARY, StatusBar } from "../src/components/StatusBar";
import { appStore } from "../src/store";
import {
  SurfaceRoleProvider,
  type SurfaceRoleInfo,
} from "../src/roles/context";
import type { SurfaceRole } from "../src/adaptive/contracts";

function renderStatusBar(): string {
  return renderToStaticMarkup(
    <StatusBar demoValue={null} onDemoChange={() => undefined} />,
  );
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

/* -------------------------------------------------- (a) PLANTILLA gate */

describe("R43 PLANTILLA selector is dev tooling, not a production control", () => {
  it("the gate is a foldable module-level DEV constant (DCE contract)", () => {
    const src = readFileSync(new URL("../src/components/StatusBar.tsx", import.meta.url), "utf8");
    // Vite's define() replaces import.meta.env.DEV with `false` in prod
    // builds; a module-level constant folds so the combobox is eliminated.
    // A prop/function indirection would NOT fold — this pins the form.
    expect(src).toMatch(
      /DEMO_TOGGLE_ENABLED\s*=\s*import\.meta\.env\.DEV\s*===\s*true/,
    );
    // The combobox is always gated by the constant.
    expect(src).toMatch(/DEMO_TOGGLE_ENABLED\s*\?/);
    expect(src).not.toContain("demoEnabled");
  });

  it("dev mode (vitest) keeps the demo combobox — screenshot workflow preserved", () => {
    const html = renderStatusBar();
    expect(html).toContain("status-demo-select");
    expect(html).toContain("Plantilla");
    expect(html).toContain("Automática");
    expect(html).toContain("aria-label=\"Plantilla de demostración\"");
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

describe("R43 confirmation UI: human labels only", () => {
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

  it("dev-mode demo select is outside the live region too", () => {
    const html = renderStatusBar();
    const statusIdx = html.indexOf('role="status"');
    const stopIdx = html.indexOf('<button type="button" class="stop-button');
    const selectIdx = html.indexOf("status-demo-select");
    expect(stopIdx).toBeGreaterThan(statusIdx);
    expect(selectIdx).toBeGreaterThan(stopIdx);
    const regionContent = html.slice(statusIdx, stopIdx);
    expect(regionContent).not.toContain("<select");
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
