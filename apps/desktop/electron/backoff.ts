/**
 * GATE-3.5 W3-TRANSPORT — the ONE reconnect backoff policy.
 *
 * Both WS transports import this module: the renderer WsClient
 * (src/ws/client.ts) and the main-process WsClient (electron/wsclient.ts).
 * No copy-paste constants and no per-layer retry logic — the policy
 * (delay schedule + single-flight scheduling + attempt tracking) lives
 * here and here only.
 *
 * Policy: exponential backoff with jitter and a cap, reset on a
 * successful connection. attempt 0 -> base, attempt n ->
 * min(cap, base * 2^n) with +/-20% jitter. The exponential growth gives
 * a flapping service room to recover while the cap keeps reconnect spam
 * bounded.
 *
 * Environment-agnostic: the timer functions are injected so the renderer
 * can use window.setTimeout (its tests stub `window`) and the main
 * process uses the node global.
 */

export const RECONNECT_BASE_MS = 2000;
export const RECONNECT_CAP_MS = 30_000;

/** Jitter band: [0.8, 1.2) x the exponential delay. */
const JITTER_MIN = 0.8;
const JITTER_SPAN = 0.4;

export interface BackoffScheduler {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

/** Pure delay computation (unit-testable with an injected random). */
export function reconnectDelayMs(
  attempt: number,
  random: () => number = Math.random,
  baseMs: number = RECONNECT_BASE_MS,
): number {
  const exponent = Math.min(attempt, 31); // keep 2**n within safe integers
  const exponential = baseMs * 2 ** exponent;
  const capped = Math.min(exponential, RECONNECT_CAP_MS);
  const jitter = JITTER_MIN + random() * JITTER_SPAN;
  return Math.round(capped * jitter);
}

/**
 * Single-flight reconnect scheduling shared by both transports:
 *  - schedule() is a no-op while a reconnect is already pending;
 *  - cancel() clears a pending reconnect (user close, forceReconnect);
 *  - reset() restarts the exponential curve after a successful connect.
 */
export class ReconnectBackoff {
  private readonly baseMs: number;
  private attempt = 0;
  private timer: unknown = null;

  constructor(
    private readonly scheduler: BackoffScheduler,
    baseMs: number = RECONNECT_BASE_MS,
  ) {
    this.baseMs = baseMs;
  }

  /** Schedule one reconnect attempt; single-flight while one is pending. */
  schedule(fn: () => void): void {
    if (this.timer !== null) return;
    const delay = this.nextDelayMs();
    this.timer = this.scheduler.setTimeout(() => {
      this.timer = null;
      fn();
    }, delay);
  }

  cancel(): void {
    if (this.timer !== null) {
      this.scheduler.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** Restart the curve after a successful connection. */
  reset(): void {
    this.attempt = 0;
  }

  private nextDelayMs(): number {
    const delay = reconnectDelayMs(this.attempt, Math.random, this.baseMs);
    this.attempt += 1;
    return delay;
  }
}
