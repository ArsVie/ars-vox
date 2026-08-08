/**
 * GATE-2.5 H4: the renderer must authenticate every call to the agent
 * service. authHeaders() attaches the per-launch bearer token from the
 * preload bridge (window.arsvox) with a VITE_ARSVOX_TOKEN fallback for
 * plain-vite dev; wsUrl() rides the token on the WS handshake query.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authHeaders, wsUrl } from "../src/endpoints";

function setBridge(token: string | undefined): void {
  const w = globalThis as Record<string, unknown> & { window?: unknown };
  if (token === undefined) {
    delete (w.window as { arsvox?: unknown } | undefined)?.arsvox;
    return;
  }
  w.window = { arsvox: { getAuthToken: () => token } };
}

describe("endpoints auth wiring", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_ARSVOX_TOKEN", "");
    setBridge(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    setBridge(undefined);
  });

  it("attaches the Bearer header from the preload bridge", () => {
    setBridge("bridge-token");
    expect(authHeaders()).toEqual({ Authorization: "Bearer bridge-token" });
  });

  it("falls back to VITE_ARSVOX_TOKEN when the bridge is absent", () => {
    vi.stubEnv("VITE_ARSVOX_TOKEN", "env-token");
    expect(authHeaders()).toEqual({ Authorization: "Bearer env-token" });
  });

  it("prefers the bridge over the env fallback", () => {
    vi.stubEnv("VITE_ARSVOX_TOKEN", "env-token");
    setBridge("bridge-token");
    expect(authHeaders()).toEqual({ Authorization: "Bearer bridge-token" });
  });

  it("sends no Authorization header when no token is available", () => {
    expect(authHeaders()).toEqual({});
  });

  it("appends the token to the WS URL as a query param", () => {
    setBridge("ws-token");
    expect(wsUrl()).toContain("/ws?token=ws-token");
  });

  it("leaves the WS URL clean when no token is available", () => {
    expect(wsUrl()).not.toContain("token=");
  });
});
