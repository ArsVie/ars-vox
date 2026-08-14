/**
 * UI-303 — usability + accessibility conformance (Wave 3).
 *
 * Node env, renderToStaticMarkup + CSS source reads (repo convention —
 * no jsdom). Guards the audit's targeted fixes so they cannot regress:
 *
 *   (a) STOP target size: >= 48px via the --control-height-lg token,
 *       always rendered in the shell bar, Spanish accessible name that
 *       matches the visible label.
 *   (b) Focus ring: token-colored :focus-visible ring on every control
 *       (no outline removal, no border-radius morph on pill controls).
 *   (c) Reduced motion: the prefers-reduced-motion block kills EVERY
 *       animation and interactive transition — mic pulse, STOP/mic
 *       presses, chips, status dot blink, smooth scroll, media controls.
 *   (d) Status semantics: listening/thinking/speaking/waiting render as
 *       text + icon (aria-hidden), never color alone, announced via the
 *       role="status" live region.
 *   (e) Tab order sanity: STOP is the first focusable in the shell bar
 *       (before the demo select); composer goes input -> mic -> send.
 *   (f) Small-target controls that were fixed (error dismiss, range
 *       thumb) keep their token-sized hit areas.
 *
 * If a fix regresses, fix the source — do NOT loosen these assertions.
 */
import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ConversationPanel } from "../src/components/ConversationPanel";
import { ComposerStatus, HomeAffordance } from "../src/components/StatusBar";
import type { VoiceState } from "../src/contracts";
import { appStore } from "../src/store";
import {
  SurfaceRoleProvider,
  type SurfaceRoleInfo,
} from "../src/roles/context";
import type { SurfaceRole } from "../src/adaptive/contracts";

const STYLES_CSS = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const CONTENT_CSS = readFileSync(new URL("../src/content.css", import.meta.url), "utf8");

/** Extract `--name: value;` custom properties from a CSS source. */
function cssTokens(raw: string): Map<string, string> {
  const stripped = raw.replace(/\/\*[\s\S]*?\*\//g, "");
  const tokens = new Map<string, string>();
  for (const m of stripped.matchAll(/--([a-z0-9][a-z0-9-]*)\s*:\s*([^;]+);/g)) {
    tokens.set(m[1], m[2].trim());
  }
  return tokens;
}

function px(token: string, raw = STYLES_CSS): number {
  const value = cssTokens(raw).get(token);
  expect(value, `--${token} must be defined`).toBeDefined();
  const m = value!.match(/^(-?\d+(?:\.\d+)?)px$/);
  expect(m, `--${token} must be a plain px value, got: ${value}`).not.toBeNull();
  return Number(m![1]);
}

/** The prefers-reduced-motion block of a CSS source. */
function mediaBlock(raw: string): string {
  const start = raw.indexOf("@media (prefers-reduced-motion: reduce)");
  expect(start, "prefers-reduced-motion block must exist").toBeGreaterThan(-1);
  return raw.slice(start);
}

function ruleBlock(raw: string, selector: string): string {
  // Match the selector as a RULE (followed by `{`) — never a comment or
  // a compound selector that merely contains it.
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = raw.match(new RegExp(`${escaped}\\s*\\{`));
  expect(m, `${selector} rule must exist`).toBeDefined();
  const open = raw.indexOf("{", m!.index!);
  const close = raw.indexOf("}", open);
  return raw.slice(open + 1, close);
}

function setVoiceState(state: VoiceState): void {
  appStore.getState().applyEvent({
    type: "state_update",
    voice_state: state,
    activity: null,
    created_at: new Date().toISOString(),
  });
}

function renderStatusBar(state: VoiceState): string {
  setVoiceState(state);
  return renderToStaticMarkup(
    <>
      <HomeAffordance />
      {/* R8 (2026-08-14): STOP lives in the composer row — render the
          conversation panel so the production bar is actually tested. */}
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
      </SurfaceRoleProvider>
    </>,
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
function renderConversation(): string {
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
  // Fresh shell state per test (shared singleton store).
  appStore.setState({
    voiceState: "sleeping",
    connected: true,
    activity: null,
    speakTexts: [],
  });
  // Repo convention: zustand's useStore uses getServerState (or the store's
  // INITIAL state) as the SSR snapshot — patch it live so renderToStaticMarkup
  // sees the state we just seeded (same as adaptive-resolved.test.tsx).
  (appStore as unknown as { getServerState: () => unknown }).getServerState =
    () => appStore.getState();
});

/* ------------------------------------------------------------- (a) STOP */

describe("UI-303 STOP: immediately recognizable and accessible", () => {
  it("meets the touch-target floor via the --control-height-lg token (>= 48px)", () => {
    expect(px("control-height-lg")).toBeGreaterThanOrEqual(48);
    expect(px("control-touch-target")).toBeGreaterThanOrEqual(48);
    // The control consumes the token — a literal height would drift.
    expect(ruleBlock(STYLES_CSS, ".stop-button")).toContain(
      "height: var(--control-height-lg)",
    );
  });

  it("renders in the shell chrome in every state as a real button with matching names", () => {
    const states: VoiceState[] = ["sleeping", "listening", "thinking", "speaking"];
    for (const state of states) {
      const html = renderStatusBar(state);
      expect(html).toContain('class="stop-button');
      expect(html).toContain("DETENER"); // visible Spanish label
      expect(html).toContain('aria-label="Detener"'); // accessible name matches
      // Always reachable: the home affordance precedes STOP, and no
      // selector exists anywhere in the shell chrome (W0-DIRECTIVE).
      const stopIdx = html.indexOf("stop-button");
      const homeIdx = html.indexOf('class="home-button"');
      expect(stopIdx).toBeGreaterThan(-1);
      expect(homeIdx).toBeGreaterThan(-1);
      expect(stopIdx).toBeGreaterThan(homeIdx);
      expect(html).not.toContain("<select");
    }
  });

  it("lights up (active) whenever there is something to stop — listening included", () => {
    const sleeping = renderStatusBar("sleeping");
    expect(sleeping).toContain('class="stop-button "');
    const activeStates: VoiceState[] = ["listening", "thinking", "speaking"];
    for (const state of activeStates) {
      const html = renderStatusBar(state);
      expect(html).toContain('class="stop-button active"');
    }
  });
});

/* ---------------------------------------------------------- (b) focus */

describe("UI-303 focus: visible token-based rings", () => {
  it(":focus-visible draws a token-colored ring and never removes outlines", () => {
    const fv = ruleBlock(STYLES_CSS, ":focus-visible");
    expect(fv).toContain("outline: 2px solid var(--accent)");
    expect(fv).not.toContain("outline: none");
    // No border-radius override: pill controls keep their pill outline
    // instead of morphing to a rounded square while focused.
    expect(fv).not.toContain("border-radius");
  });

  it("the focus-ring state token is real and non-empty", () => {
    const value = cssTokens(STYLES_CSS).get("state-focus-ring");
    expect(value, "--state-focus-ring must be defined").toBeDefined();
    expect(value!.trim()).not.toBe("");
  });

  it("controls that suppress the default outline substitute the token ring", () => {
    const composerFocus = ruleBlock(STYLES_CSS, ".composer input:focus");
    expect(composerFocus).toContain("outline: none");
    expect(composerFocus).toContain("var(--state-focus-ring)");
  });
});

/* ------------------------------------------------------- (c) motion gate */

describe("UI-303 reduced motion: the gate is honored everywhere", () => {
  it("kills every animation, including the mic recording pulse", () => {
    const block = mediaBlock(STYLES_CSS);
    // The animation group's last selector is .mic-button (the pulse that
    // previously kept animating under reduce).
    expect(block).toMatch(/\.mic-button\s*\{[^}]*animation:\s*none\s*!important/s);
    expect(block).toMatch(/\.status-dot[^}]*animation:\s*none\s*!important/s);
  });

  it("kills every interactive transition and tactile press transform", () => {
    const block = mediaBlock(STYLES_CSS);
    expect(block).toMatch(/\.stop-button,[\s\S]{0,600}transition:\s*none/s);
    expect(block).toContain("transform: none !important");
    // Smooth scrolling is instant under reduce.
    expect(block).toMatch(/\.message-list\s*\{[^}]*scroll-behavior:\s*auto/s);
  });

  it("gates content-surface controls (media play, task checks, toolbars)", () => {
    const block = mediaBlock(CONTENT_CSS);
    expect(block).toMatch(/\.media-play-btn,[\s\S]{0,600}transition:\s*none/s);
    expect(block).toContain("transform: none !important");
  });

  it("still ships the JS-level stage gate for stale data-motion states", () => {
    const block = mediaBlock(STYLES_CSS);
    expect(block).toMatch(
      /\[data-motion="enabled"\] \.panel-slot\s*\{[^}]*transition:\s*none/s,
    );
  });
});

/* ------------------------------------------------------- (d) status text */

describe("UI-303 status: text + icon, never color alone", () => {
  const STATES: Array<[VoiceState, string]> = [
    ["listening", "Escuchando"],
    ["thinking", "Pensando"],
    ["speaking", "Hablando"],
    ["waiting_for_confirmation", "Esperando confirmación"],
    ["stopping", "Deteniendo"],
    ["error", "Error"],
  ];

  it("announces state through a live region", () => {
    expect(renderStatusBar("sleeping")).toContain('role="status"');
  });

  for (const [state, label] of STATES) {
    it(`${state} renders the Spanish label AND a state icon inside the pill`, () => {
      const html = renderStatusBar(state);
      expect(html).toContain(`data-state="${state}"`);
      expect(html).toContain(`>${label}</span>`); // text, not color alone
      // Icon (aria-hidden) lives inside the pill, next to the label.
      expect(html).toMatch(
        new RegExp(
          `<span class="status-pill[^"]*" data-state="${state}"[^>]*>[\\s\\S]*?<svg`,
        ),
      );
      expect(html).toMatch(
        new RegExp(
          `<span class="status-state-icon" aria-hidden="true">[\\s\\S]*?<svg[\\s\\S]*?</svg></span>`,
        ),
      );
    });
  }
});

/* ------------------------------------------------------------ (e) tab */

describe("UI-303 tab order sanity", () => {
  it("shell chrome: home affordance first, then STOP — no demo select", () => {
    const html = renderStatusBar("sleeping");
    const stopIdx = html.indexOf("stop-button");
    const homeIdx = html.indexOf('class="home-button"');
    expect(stopIdx).toBeGreaterThan(-1);
    expect(homeIdx).toBeGreaterThan(-1);
    expect(stopIdx).toBeGreaterThan(homeIdx);
    expect(html).not.toContain("status-demo-select");
    expect(html).not.toContain("<select");
  });

  it("composer: input -> mic button -> send button", () => {
    appStore.setState({ messages: [] });
    const html = renderConversation();
    const inputIdx = html.indexOf('aria-label="Escribe una petición"');
    const micIdx = html.indexOf('class="mic-button');
    const sendIdx = html.indexOf('class="send-button"');
    expect(inputIdx).toBeGreaterThan(-1);
    expect(micIdx).toBeGreaterThan(inputIdx);
    expect(sendIdx).toBeGreaterThan(micIdx);
  });
});

/* ------------------------------------------------------- (f) hit areas */

describe("UI-303 small-target fixes keep token-sized hit areas", () => {
  it("error dismiss is a >= 32px (--control-height-sm) target", () => {
    const rule = ruleBlock(STYLES_CSS, ".error-dismiss");
    expect(rule).toContain("min-width: var(--control-height-sm)");
    expect(rule).toContain("height: var(--control-height-sm)");
    expect(px("control-height-sm")).toBeGreaterThanOrEqual(32);
  });

  it("the media seek thumb is a real grab target (>= 18px)", () => {
    const thumb = ruleBlock(
      CONTENT_CSS,
      ".media-player-progress input[type=\"range\"]::-webkit-slider-thumb",
    );
    expect(thumb).toMatch(/width:\s*18px/);
    expect(thumb).toMatch(/height:\s*18px/);
  });

  it("no text is smaller than the 12px token-scale floor", () => {
    for (const raw of [STYLES_CSS, CONTENT_CSS]) {
      expect(raw).not.toMatch(/font-size:\s*(9|10|11)(\.\d+)?px/);
    }
  });
});
