/**
 * TurnTimer — tiny elapsed-time readout for agent turns (UI Wave, Leaf C).
 *
 * '0:07'-style monospace count-up (mm:ss) with a subtle shimmer underline,
 * ticking while the turn is running. Two run sources, explicit prop first:
 *
 *   <TurnTimer />                    -> auto-runs from the store's voiceState
 *   <TurnTimer running={false} />    -> explicit control wins, store ignored
 *   <TurnTimer startAtMs={...} />    -> seed the elapsed offset (defaults to
 *                                        mount time, i.e. elapsed starts at 0)
 *
 * Store integration (READ-ONLY, src/store.ts): when no `running` prop is
 * passed the timer auto-runs while `appStore`'s voiceState is one of
 * TURN_ACTIVE_VOICE_STATES (listening / thinking / speaking — the states
 * StopButton also treats as an in-flight turn).
 *
 * Accessibility: role="timer", aria-live="off" (the readout must never
 * announce itself — the status pill owns the live region), Spanish title.
 * The shimmer is purely decorative (aria-hidden) and is killed entirely
 * under prefers-reduced-motion (see turn-timer.css).
 */
import { useEffect, useRef, useState } from "react";

import { useStore } from "zustand";

import { appStore } from "../store";

import "./turn-timer.css";

/** Tick cadence for the count-up (4 Hz — smooth enough, cheap enough). */
export const TURN_TICK_MS = 250;

/** Voice states that count as an agent turn in progress (store auto-run). */
export const TURN_ACTIVE_VOICE_STATES: readonly string[] = [
  "listening",
  "thinking",
  "speaking",
];

/** Format an elapsed duration as mm:ss — '0:07', '1:05', '12:34'.
 *  Seconds are always two digits; minutes grow unpadded. Negative or
 *  sub-second input floors to '0:00'. */
export function formatElapsed(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export interface TurnTicker {
  /** Start counting (idempotent — a second start is a no-op). */
  start(): void;
  /** Stop counting; elapsed freezes at its last value (idempotent). */
  stop(): void;
  /** Milliseconds accumulated while running. */
  readonly elapsedMs: number;
}

/** Framework-free tick engine — the count-up core <TurnTimer /> mounts.
 *  Kept outside React so the node-env test suite (repo convention: no
 *  jsdom) can drive the real ticking path with fake timers. Elapsed
 *  ACCUMULATES only while running: pause freezes it, resume continues. */
export function createTurnTicker(
  onTick: (elapsedMs: number) => void,
  initialMs = 0,
): TurnTicker {
  let elapsedMs = Math.max(0, initialMs);
  let timer: ReturnType<typeof setInterval> | null = null;
  return {
    get elapsedMs(): number {
      return elapsedMs;
    },
    start(): void {
      if (timer !== null) return;
      timer = setInterval(() => {
        elapsedMs += TURN_TICK_MS;
        onTick(elapsedMs);
      }, TURN_TICK_MS);
    },
    stop(): void {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    },
  };
}

export interface TurnTimerProps {
  /** Explicit run control. When omitted, the timer auto-runs while the
   *  store's voiceState is an active turn state (TURN_ACTIVE_VOICE_STATES). */
  running?: boolean;
  /** Epoch ms the turn started; defaults to mount time (elapsed 0:00). */
  startAtMs?: number;
}

export function TurnTimer({ running, startAtMs }: TurnTimerProps) {
  const voiceState = useStore(appStore, (s) => s.voiceState);
  const storeRunning = TURN_ACTIVE_VOICE_STATES.includes(voiceState);
  const effectiveRunning = running ?? storeRunning;

  // startAtMs is read once at mount (lazy initializer): the elapsed offset
  // for a mid-turn mount, or 0 when the turn starts with this component.
  const [elapsedMs, setElapsedMs] = useState(() =>
    startAtMs === undefined ? 0 : Math.max(0, Date.now() - startAtMs),
  );
  // The engine is created once per instance; the interval lifecycle is
  // owned by the effect below (start while running, stop otherwise).
  const tickerRef = useRef<TurnTicker | null>(null);
  if (tickerRef.current === null) {
    tickerRef.current = createTurnTicker(setElapsedMs, elapsedMs);
  }

  useEffect(() => {
    const ticker = tickerRef.current as TurnTicker;
    if (effectiveRunning) ticker.start();
    else ticker.stop();
    return () => ticker.stop();
  }, [effectiveRunning]);

  return (
    <span
      className={effectiveRunning ? "turn-timer running" : "turn-timer"}
      data-running={effectiveRunning ? "true" : "false"}
      role="timer"
      aria-live="off"
      title="Tiempo de la petición"
    >
      <span className="turn-timer__value">{formatElapsed(elapsedMs)}</span>
      <span className="turn-timer__shimmer" aria-hidden="true" />
    </span>
  );
}
