/**
 * TurnTimer — elapsed readout for agent turns (UI Wave, Leaf C).
 *
 * Node env + renderToStaticMarkup for the DOM contract (repo convention —
 * no jsdom). The count-up itself runs on the framework-free tick engine
 * (createTurnTicker — the exact code path <TurnTimer /> mounts), driven
 * with REAL fake timers: 0:00 -> 0:01 -> 0:02 while running, frozen while
 * paused. Store integration is exercised through the singleton appStore
 * via the getServerState patch (same convention as notifications-region
 * and a11y tests).
 */
import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  createTurnTicker,
  formatElapsed,
  TURN_ACTIVE_VOICE_STATES,
  TurnTimer,
} from "../src/components/TurnTimer";
import { appStore } from "../src/store";
import type { VoiceState } from "../src/contracts";

const CSS = readFileSync(
  new URL("../src/components/turn-timer.css", import.meta.url),
  "utf8",
);

/** Patch the SSR snapshot source (zustand v4: getServerState || getInitialState). */
function setServerVoiceState(state: VoiceState): void {
  (appStore as unknown as { getServerState: () => unknown }).getServerState =
    () => appStore.getState();
  appStore.setState({ voiceState: state });
}

const EMOJI_RE = /\p{Extended_Pictographic}/u;

describe("formatElapsed", () => {
  it("renders '0:07'-style mm:ss with padded seconds", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(999)).toBe("0:00");
    expect(formatElapsed(1000)).toBe("0:01");
    expect(formatElapsed(7000)).toBe("0:07");
    expect(formatElapsed(61000)).toBe("1:01");
    expect(formatElapsed(600000)).toBe("10:00");
  });

  it("floors negative or sub-second input to 0:00", () => {
    expect(formatElapsed(-5000)).toBe("0:00");
    expect(formatElapsed(250)).toBe("0:00");
  });
});

describe("createTurnTicker (the component's real count-up path)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("ticks 0:00 -> 0:01 -> 0:02 while running", () => {
    vi.useFakeTimers();
    const seen: number[] = [];
    const ticker = createTurnTicker((ms) => seen.push(ms));

    expect(formatElapsed(ticker.elapsedMs)).toBe("0:00");

    ticker.start();
    vi.advanceTimersByTime(1000); // 4 ticks @ TURN_TICK_MS
    expect(formatElapsed(ticker.elapsedMs)).toBe("0:01");
    expect(seen[seen.length - 1]).toBe(1000);

    vi.advanceTimersByTime(1000);
    expect(formatElapsed(ticker.elapsedMs)).toBe("0:02");
    expect(seen[seen.length - 1]).toBe(2000);
  });

  it("pauses when stopped: elapsed freezes, no further ticks", () => {
    vi.useFakeTimers();
    const seen: number[] = [];
    const ticker = createTurnTicker((ms) => seen.push(ms));

    ticker.start();
    vi.advanceTimersByTime(2000);
    expect(formatElapsed(ticker.elapsedMs)).toBe("0:02");

    ticker.stop();
    const frozen = seen.length;
    vi.advanceTimersByTime(5000);
    expect(formatElapsed(ticker.elapsedMs)).toBe("0:02");
    expect(seen.length).toBe(frozen);
    expect(vi.getTimerCount()).toBe(0); // the interval was really cleared
  });

  it("resumes from the frozen value instead of restarting", () => {
    vi.useFakeTimers();
    const ticker = createTurnTicker(() => {});

    ticker.start();
    vi.advanceTimersByTime(1500);
    ticker.stop();
    vi.advanceTimersByTime(3000);
    ticker.start();
    vi.advanceTimersByTime(500);
    expect(formatElapsed(ticker.elapsedMs)).toBe("0:02");
  });

  it("start is idempotent (no double interval)", () => {
    vi.useFakeTimers();
    const ticker = createTurnTicker(() => {});
    ticker.start();
    ticker.start();
    ticker.start();
    vi.advanceTimersByTime(1000);
    expect(formatElapsed(ticker.elapsedMs)).toBe("0:01");
  });

  it("seeds the elapsed offset from startAtMs (mid-turn mount)", () => {
    vi.useFakeTimers();
    const ticker = createTurnTicker(() => {}, 65_000);
    expect(formatElapsed(ticker.elapsedMs)).toBe("1:05");
  });
});

describe("TurnTimer DOM contract", () => {
  beforeEach(() => {
    setServerVoiceState("sleeping");
  });

  it("renders role= timer, aria-live=off, Spanish title and 0:00", () => {
    const html = renderToStaticMarkup(<TurnTimer running={false} />);
    expect(html).toContain('role="timer"');
    expect(html).toContain('aria-live="off"');
    expect(html).toContain('title="Tiempo de la petición"');
    expect(html).toContain(">0:00<");
    expect(html).toContain('data-running="false"');
    expect(html).not.toMatch(EMOJI_RE);
  });

  it("marks the running state for the shimmer CSS", () => {
    const html = renderToStaticMarkup(<TurnTimer running />);
    expect(html).toContain('data-running="true"');
    expect(html).toContain("turn-timer running");
    expect(html).not.toMatch(EMOJI_RE);
  });

  it("auto-runs while the store voiceState is an active turn state", () => {
    for (const state of TURN_ACTIVE_VOICE_STATES) {
      setServerVoiceState(state as VoiceState);
      const html = renderToStaticMarkup(<TurnTimer />);
      expect(html, `voiceState=${state}`).toContain('data-running="true"');
    }
  });

  it("stays paused for idle voice states", () => {
    for (const state of [
      "sleeping",
      "waiting_for_confirmation",
      "stopping",
      "error",
    ] as const) {
      setServerVoiceState(state);
      const html = renderToStaticMarkup(<TurnTimer />);
      expect(html, `voiceState=${state}`).toContain('data-running="false"');
    }
  });

  it("explicit running prop overrides the store", () => {
    setServerVoiceState("thinking");
    const html = renderToStaticMarkup(<TurnTimer running={false} />);
    expect(html).toContain('data-running="false"');
  });
});

describe("turn-timer.css", () => {
  it("uses the shared tokens with dark-theme fallbacks", () => {
    expect(CSS).toContain("var(--av-ink-dim, #9aa7bd)");
    expect(CSS).toContain("var(--av-accent, #3d9aff)");
  });

  it("animates only the shimmer, and only while running", () => {
    expect(CSS).toContain("animation: turn-timer-shimmer 1.6s linear infinite");
    // The animation must be gated behind the running state.
    const runningRule = CSS.indexOf(".turn-timer.running .turn-timer__shimmer");
    expect(runningRule).toBeGreaterThan(-1);
    expect(CSS.indexOf("@keyframes turn-timer-shimmer")).toBeGreaterThan(
      runningRule,
    );
    // The base rule must not animate (paused = no motion).
    const baseRule = CSS.slice(
      CSS.indexOf(".turn-timer__shimmer {"),
      CSS.indexOf(".turn-timer.running"),
    );
    expect(baseRule).not.toContain("animation");
  });

  it("kills the shimmer under prefers-reduced-motion", () => {
    const block = CSS.indexOf("@media (prefers-reduced-motion: reduce)");
    expect(block).toBeGreaterThan(-1);
    const reduced = CSS.slice(block);
    expect(reduced).toContain(".turn-timer.running .turn-timer__shimmer");
    expect(reduced).toContain("animation: none");
  });
});
