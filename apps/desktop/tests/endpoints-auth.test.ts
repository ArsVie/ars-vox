/**
 * GATE-2.5 H4 + GATE-3.5 A2/R14: the renderer NEVER holds the per-launch
 * token. In Electron mode (window.arsvox bridge present) auth flows
 * through main-proxied calls — authenticatedFetch() routes to
 * window.arsvox.fetch and the token is attached in the MAIN process;
 * authHeaders()/wsUrl() must stay token-free (dev fallback only).
 *
 * In plain-vite dev (no bridge) VITE_ARSVOX_TOKEN is the fallback.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authHeaders, authenticatedFetch, hasBridge, wsUrl } from "../src/endpoints";

function setBridge(present: boolean): void {
  const w = globalThis as Record<string, unknown> & { window?: unknown };
  if (!present) {
    delete (w.window as { arsvox?: unknown } | undefined)?.arsvox;
    return;
  }
  w.window = { arsvox: { fetch: vi.fn() } };
}

describe("endpoints auth wiring", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_ARSVOX_TOKEN", "");
    setBridge(false);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    setBridge(false);
  });

  it("R14: with the bridge present, authHeaders() carries NO token (main attaches it)", () => {
    setBridge(true);
    expect(hasBridge()).toBe(true);
    expect(authHeaders()).toEqual({});
  });

  it("R14: with the bridge present, wsUrl() carries NO token (main-owned WS)", () => {
    setBridge(true);
    expect(wsUrl()).not.toContain("token=");
  });

  it("falls back to VITE_ARSVOX_TOKEN when the bridge is absent", () => {
    vi.stubEnv("VITE_ARSVOX_TOKEN", "env-token");
    expect(authHeaders()).toEqual({ Authorization: "Bearer env-token" });
  });

  it("sends no Authorization header when no token is available", () => {
    expect(authHeaders()).toEqual({});
  });

  it("appends the dev token to the WS URL as a query param (plain-vite dev)", () => {
    vi.stubEnv("VITE_ARSVOX_TOKEN", "ws-token");
    expect(wsUrl()).toContain("/ws?token=ws-token");
  });

  it("leaves the WS URL clean when no token is available", () => {
    expect(wsUrl()).not.toContain("token=");
  });

  it("R14: authenticatedFetch routes through the bridge (token-free request) when present", async () => {
    const bridgeFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      contentType: "application/json",
      body: new TextEncoder().encode("{}").buffer as ArrayBuffer,
    });
    const w = globalThis as Record<string, unknown> & { window?: unknown };
    w.window = { arsvox: { fetch: bridgeFetch } };

    const res = await authenticatedFetch("http://127.0.0.1:8765/config", {
      method: "GET",
    });

    expect(bridgeFetch).toHaveBeenCalledTimes(1);
    const request = bridgeFetch.mock.calls[0][0] as Record<string, unknown>;
    expect(request.url).toBe("http://127.0.0.1:8765/config");
    expect(request.method).toBe("GET");
    // The renderer never sends the token — not even in the request body.
    expect(JSON.stringify(request)).not.toContain("Authorization");
    expect(res.ok).toBe(true);
  });

  it("authenticatedFetch direct-fetches with the dev token when the bridge is absent", async () => {
    vi.stubEnv("VITE_ARSVOX_TOKEN", "env-token");
    const directFetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", directFetch);

    await authenticatedFetch("http://127.0.0.1:8765/config");

    expect(directFetch).toHaveBeenCalledTimes(1);
    const [url, init] = directFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:8765/config");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer env-token");
  });
});
