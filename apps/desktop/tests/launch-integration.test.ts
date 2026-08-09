/**
 * GATE-3.5 A2 — launch INTEGRATION test (R09/R10/R11/R13).
 *
 * Real end-to-end: spawns the actual Python agent service (repo venv)
 * with a per-launch token, completes the authenticated /health handshake
 * via launchService(), then talks to it over the main-process WsClient
 * with the token in the Authorization header.
 *
 * Skipped gracefully (describe.skipIf) when the environment cannot run
 * it: no usable Python interpreter / missing service imports. When it
 * CAN run it, failures are real failures.
 *
 * The spawned service uses a TEMP config derived from configs/app.yaml:
 * agent.mock=true (scripted model, no network), auth.enabled=true,
 * a caller-reserved port, and tmp memory/library/document dirs — the
 * repo's real config/data are never touched.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { launchService, type ServiceStatus } from "../electron/service";
import { WsClient } from "../electron/wsclient";

// ------------------------------------------------------------ discovery #

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const PYTHONPATH = [
  path.join(REPO_ROOT, "packages/contracts"),
  path.join(REPO_ROOT, "services/agent"),
  path.join(REPO_ROOT, "services/memory"),
  path.join(REPO_ROOT, "services/tts"),
].join(path.delimiter);

/** Candidate interpreters: env override, worktree venv, main-repo venv,
 *  bare python. The first that can import the service wins. */
function findPython(): string | null {
  const candidates = [
    process.env.ARSVOX_PYTHON,
    path.join(REPO_ROOT, ".venv", "bin", "python"),
    path.join(REPO_ROOT, ".venv", "Scripts", "python.exe"),
    // Worktrees live beside the main checkout (/dev/ars-vox-worktrees/<n>).
    path.resolve(REPO_ROOT, "..", "..", "ars-vox", ".venv", "bin", "python"),
    "python3",
  ].filter((c): c is string => !!c);

  for (const candidate of candidates) {
    if (candidate.includes(path.sep) && !fs.existsSync(candidate)) continue;
    // Cold imports on /mnt/c (WSL) take ~35s — give the probe room.
    const probe = spawnSync(
      candidate,
      ["-c", "import arsvox_agent, arsvox_contracts"],
      { env: { ...process.env, PYTHONPATH }, stdio: "ignore", timeout: 120_000 },
    );
    if (probe.status === 0) return candidate;
  }
  return null;
}

const PYTHON = findPython();
const canRunIntegration = PYTHON !== null;

// ------------------------------------------------------------- harness #

function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = http.createServer();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

interface TempConfig {
  path: string;
  root: string;
}

/**
 * Derive a temp config from configs/app.yaml via the SAME venv python
 * that will run the service: agent.mock=true, auth.enabled=true,
 * server.port=<reserved>, memory/library/documents under the tmp root.
 */
function writeTempConfig(port: number): TempConfig {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "arsvox-launch-int-"));
  const out = path.join(root, "app.yaml");
  const script = [
    "import json, sys",
    "from arsvox_contracts import AppConfig",
    "from arsvox_agent.config_loader import load_config",
    "cfg, _ = load_config(sys.argv[1])",
    "d = cfg.model_dump(mode='json')",
    "d['agent']['mock'] = True",
    "d['auth']['enabled'] = True",
    "d['server']['port'] = int(sys.argv[2])",
    "d['memory']['db_path'] = sys.argv[3] + '/arsvox-int.db'",
    "d['memory']['library_dir'] = sys.argv[3] + '/library'",
    "d['memory']['documents_dir'] = sys.argv[3] + '/documents'",
    "open(sys.argv[4], 'w').write(json.dumps(d))",
  ].join("\n");
  const res = spawnSync(
    PYTHON!,
    ["-c", script, path.join(REPO_ROOT, "configs", "app.yaml"), String(port), root, out],
    {
      env: { ...process.env, PYTHONPATH },
      stdio: "pipe",
      // Cold imports from the /mnt/c mount take 1-2 minutes on this
      // machine (measured 61-85s); 60s was a flake source under load.
      timeout: 180_000,
    },
  );
  if (res.status !== 0) {
    throw new Error(
      `failed to derive temp config: ${res.stderr?.toString() ?? res.error?.message ?? "unknown"}`,
    );
  }
  return { path: out, root };
}

// ------------------------------------------------------------- the suite #

describe.skipIf(!canRunIntegration)("launch integration (real Python service)", () => {
  let port = 0;
  let baseUrl = "";
  let token = "";
  let config: TempConfig | null = null;
  let statuses: ServiceStatus[] = [];
  let handle: ReturnType<typeof launchService> | null = null;

  beforeAll(async () => {
    port = await reservePort();
    baseUrl = `http://127.0.0.1:${port}`;
    token = `int-token-${port}-${Math.random().toString(36).slice(2)}`;
    config = writeTempConfig(port);
    statuses = [];
    handle = launchService({
      token,
      agentBaseUrl: baseUrl,
      repoRoot: REPO_ROOT,
      pythonPath: PYTHON!,
      configPath: config.path,
      serviceMode: "auto",
      healthIntervalMs: 150,
      healthTimeoutMs: 150_000, // cold import on /mnt/c takes ~35s+
      onStatus: (s) => statuses.push(s),
    });
    await waitForState(statuses, "ready", 120_000);
  }, 150_000);

  afterAll(async () => {
    await handle?.terminate();
    if (config) fs.rmSync(config.root, { recursive: true, force: true });
  });

  it("R09: spawned the real service and completed the authenticated handshake", () => {
    expect(handle?.child?.pid).toBeGreaterThan(0);
    expect(statuses.map((s) => s.state)).toContain("ready");
    expect(statuses.some((s) => s.state === "failed")).toBe(false);
  });

  it("R10: REST — right token succeeds, wrong token is rejected", async () => {
    const ok = await fetch(`${baseUrl}/config`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(ok.status).toBe(200);

    const bad = await fetch(`${baseUrl}/config`, {
      headers: { Authorization: "Bearer wrong-token" },
    });
    expect(bad.status).toBe(401);
  });

  it("R10/R11: WS — token header authenticates; early user_text arrives exactly once", async () => {
    const messages: string[] = [];
    let opened = 0;
    const client = new WsClient({
      url: `ws://127.0.0.1:${port}/ws`,
      headers: { Authorization: `Bearer ${token}` },
      onOpen: () => {
        opened += 1;
      },
      onMessage: (text) => messages.push(text),
      onClose: () => undefined,
    });
    // Send BEFORE connect: the main-process outbox must hold it and flush
    // it once the handshake completes (R11 no-loss window).
    client.send(JSON.stringify({ type: "user_text", text: "hola integración" }));
    client.connect();

    // 1) Handshake opens; 2) the service pushes its initial events; 3) the
    // buffered user_text arrives and the mock echoes user_message.
    await waitFor(() => opened === 1, "ws open", 15_000);
    await waitFor(
      () => messages.some((m) => m.includes('"user_message"')),
      "user_message echo",
      20_000,
    );
    expect(opened).toBe(1);

    const echoed = messages.filter((m) => m.includes('"user_message"'));
    expect(echoed).toHaveLength(1); // exactly once

    const echo = JSON.parse(echoed[0]) as { text?: string };
    expect(echo.text).toBe("hola integración");
    client.close();
  });

  it("R10: WS — a wrong token is rejected (close 4401, no open)", async () => {
    let opened = 0;
    let closedWith: number | undefined;
    const client = new WsClient({
      url: `ws://127.0.0.1:${port}/ws`,
      headers: { Authorization: "Bearer wrong-token" },
      onOpen: () => {
        opened += 1;
      },
      onMessage: () => undefined,
      onClose: (code) => {
        closedWith = code;
      },
    });
    client.connect();
    await waitFor(() => closedWith !== undefined, "close after rejected handshake", 10_000);
    expect(opened).toBe(0);
    // The service rejects BEFORE completing the WS handshake (Starlette
    // denies pre-accept closes with HTTP 403 / TCP drop), so the client
    // observes either the app-defined 4401 close or an abnormal 1006.
    // Either way the token gate held: no open, no events.
    expect([4401, 1006]).toContain(closedWith);
    client.close();
  });

  it("R13: terminate() kills the child process tree", async () => {
    const pid = handle?.child?.pid;
    expect(pid).toBeGreaterThan(0);
    await handle!.terminate();
    // The child's exit must be observed (exitCode set on the handle).
    await waitFor(
      () => handle === null || handle.child === null || handle.child.exitCode !== null,
      "child exit",
      10_000,
    );
    // And the port must stop answering.
    await waitFor(
      async () => {
        try {
          const res = await fetch(`${baseUrl}/health`);
          return !res.ok;
        } catch {
          return true;
        }
      },
      "port closed",
      10_000,
    );
    expect(handle!.terminated).toBe(true);
  });
});

// -------------------------------------------------------------- helpers #

function waitForState(
  statuses: ServiceStatus[],
  state: ServiceStatus["state"],
  timeoutMs: number,
): Promise<ServiceStatus> {
  const existing = statuses.find((s) => s.state === state);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(
            `timed out waiting for ${state}; saw [${statuses.map((s) => s.state).join(", ")}]`,
          ),
        ),
      timeoutMs,
    );
    const poll = setInterval(() => {
      const found = statuses.find((s) => s.state === state);
      if (found) {
        clearInterval(poll);
        clearTimeout(timer);
        resolve(found);
      }
    }, 25);
  });
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  description: string,
  timeoutMs: number,
): Promise<void> {
  const started = Date.now();
  for (;;) {
    if (await predicate()) return;
    if (Date.now() - started > timeoutMs) {
      throw new Error(`timed out waiting for ${description}`);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}
