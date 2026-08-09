/**
 * GATE-3.5 A2 — service lifecycle unit tests (electron/service.ts):
 * token generation, child spawn contract (command/env), authenticated
 * health handshake (R09), wrong-token rejection (R10), startup failure
 * surfacing (R12), terminate() killing the child (R13).
 *
 * The real Python spawn is covered by tests/launch-integration.test.ts.
 */

import { EventEmitter } from "node:events";
import * as http from "node:http";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildChildEnv,
  generateAuthToken,
  launchService,
  resolvePythonPath,
  type ServiceStatus,
} from "../electron/service";

class FakeChild extends EventEmitter {
  pid = 4242;
  exitCode: number | null = null;
  signalCode: string | null = null;
  killed = false;
  stderr = new EventEmitter() as EventEmitter;
  kill = vi.fn((_signal?: string) => {
    this.killed = true;
    // Real child.kill() leads to an exit event; simulate it so
    // terminate() resolves promptly in tests.
    process.nextTick(() => this.emitExit(null, "SIGTERM"));
    return true;
  });
  emitExit(code: number | null, signal: string | null = null): void {
    this.exitCode = code;
    this.signalCode = signal;
    this.emit("exit", code, signal);
  }
}

interface MockAgentServer {
  baseUrl: string;
  close: () => Promise<void>;
  start: () => Promise<string>;
  /** Listen on a caller-chosen port (pre-reserved with reservePort). */
  startOn: (port: number) => Promise<string>;
}

/** Mock agent service: /health public, /config token-gated (Bearer). */
function createMockAgent(
  token: string,
  opts: { up?: boolean; rejectAuth?: boolean } = {},
): MockAgentServer {
  const rejectAuth = opts.rejectAuth ?? false;
  const server = http.createServer((req, res) => {
    if (req.url === "/health") {
      if (opts.up === false) {
        res.writeHead(503).end();
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }
    if (req.url === "/config") {
      const auth = req.headers.authorization ?? "";
      if (auth === `Bearer ${token}` && !rejectAuth) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ app: { name: "Ars-Vox" } }));
        return;
      }
      res.writeHead(401, { "www-authenticate": "Bearer" });
      res.end(JSON.stringify({ detail: "unauthorized" }));
      return;
    }
    res.writeHead(404).end();
  });
  return {
    baseUrl: "",
    start: () =>
      new Promise((resolve) => {
        server.listen(0, "127.0.0.1", () => {
          const address = server.address() as { port: number };
          resolve(`http://127.0.0.1:${address.port}`);
        });
      }),
    /** Listen on a caller-chosen port (pre-reserved with reservePort). */
    startOn: (port: number) =>
      new Promise((resolve) => {
        server.listen(port, "127.0.0.1", () => {
          resolve(`http://127.0.0.1:${port}`);
        });
      }),
    close: () => new Promise((r) => server.close(() => r())),
  };
}

/** Grab a free loopback port (release it immediately for reuse). */
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

interface Collector {
  statuses: ServiceStatus[];
  push: (s: ServiceStatus) => void;
}

function makeCollector(): Collector {
  const statuses: ServiceStatus[] = [];
  return {
    statuses,
    push: (s: ServiceStatus) => {
      statuses.push(s);
    },
  };
}

function waitForState(
  statuses: ServiceStatus[],
  state: ServiceStatus["state"],
  timeoutMs = 8000,
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
    }, 10);
  });
}

const servers: MockAgentServer[] = [];
const childrenBySpawn: FakeChild[] = [];
let spawnFn: ReturnType<typeof vi.fn>;

function fakeSpawn() {
  childrenBySpawn.length = 0;
  spawnFn = vi.fn(() => {
    const child = new FakeChild();
    childrenBySpawn.push(child);
    return child as never;
  });
  return spawnFn;
}

/** Create + start a mock agent immediately (registered for cleanup). */
async function startAgent(
  token: string,
  opts?: { up?: boolean; rejectAuth?: boolean },
): Promise<MockAgentServer> {
  const agent = createMockAgent(token, opts);
  agent.baseUrl = await agent.start();
  servers.push(agent);
  return agent;
}

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  vi.restoreAllMocks();
});

describe("generateAuthToken", () => {
  it("produces 32 random bytes in base64url, unique per call", () => {
    const a = generateAuthToken();
    const b = generateAuthToken();
    expect(a).not.toBe(b);
    expect(Buffer.from(a, "base64url").length).toBe(32);
  });
});

describe("buildChildEnv / resolvePythonPath", () => {
  it("injects the token and prepends the service package roots to PYTHONPATH", () => {
    const repoRoot = "/repo";
    const env = buildChildEnv(repoRoot, "tok123");
    expect(env.ARSVOX_AUTH_TOKEN).toBe("tok123");
    expect(env.PYTHONUNBUFFERED).toBe("1");
    const roots = [
      path.join(repoRoot, "packages/contracts"),
      path.join(repoRoot, "services/agent"),
      path.join(repoRoot, "services/memory"),
      path.join(repoRoot, "services/tts"),
      path.join(repoRoot, "services/voice"),
    ];
    expect(env.PYTHONPATH.split(path.delimiter).slice(0, roots.length)).toEqual(roots);
  });

  it("honors ARSVOX_PYTHON, else the repo venv, else a bare python", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arsvox-py-"));
    const venv = path.join(tmp, ".venv", "bin", "python");
    fs.mkdirSync(path.dirname(venv), { recursive: true });
    fs.writeFileSync(venv, "");
    const prev = process.env.ARSVOX_PYTHON;
    delete process.env.ARSVOX_PYTHON;
    try {
      expect(resolvePythonPath(tmp)).toBe(venv);
      process.env.ARSVOX_PYTHON = "/custom/python";
      expect(resolvePythonPath(tmp)).toBe("/custom/python");
    } finally {
      if (prev === undefined) delete process.env.ARSVOX_PYTHON;
      else process.env.ARSVOX_PYTHON = prev;
    }
    expect(["python", "python3"]).toContain(
      resolvePythonPath(fs.mkdtempSync(path.join(os.tmpdir(), "arsvox-novenv-"))),
    );
  });
});

describe("launchService", () => {
  it("R09: spawns python -m arsvox_agent with the token env, then reports ready after the authenticated handshake", async () => {
    const token = generateAuthToken();
    // The mock agent is NOT listening at launch time: the pre-probe
    // fails, so launchService must spawn the child. The port is
    // pre-reserved so the poll loop's URL matches the later listener.
    const port = await reservePort();
    const agent = createMockAgent(token);
    const spawn = fakeSpawn();
    const collector = makeCollector();

    const handle = launchService({
      token,
      agentBaseUrl: `http://127.0.0.1:${port}`,
      repoRoot: "/repo",
      pythonPath: "/venv/python",
      spawnFn: spawn,
      healthIntervalMs: 30,
      healthTimeoutMs: 3000,
      onStatus: collector.push,
    });

    // Spawn happens right after the failed pre-probe; then the service
    // comes up and the authenticated handshake completes.
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1));
    agent.baseUrl = await agent.startOn(port);
    servers.push(agent);

    await waitForState(collector.statuses, "ready");

    expect(spawn).toHaveBeenCalledTimes(1);
    const call = spawn.mock.calls[0] as unknown as [
      string,
      string[],
      { env: Record<string, string>; cwd: string },
    ];
    const [command, args, options] = call;
    expect(command).toBe("/venv/python");
    expect(args[0]).toBe("-m");
    expect(args[1]).toBe("arsvox_agent");
    expect(args[2]).toBe("--config");
    expect(args[3]).toBe(path.join("/repo", "configs", "app.yaml"));
    expect(options.env.ARSVOX_AUTH_TOKEN).toBe(token);
    expect(options.cwd).toBe("/repo");

    expect(collector.statuses.map((s) => s.state)).toContain("ready");
    await handle.terminate();
  });

  it("R10: a foreign service that rejects the token fails the handshake with a clear status", async () => {
    const token = generateAuthToken();
    const agent = await startAgent("some-other-token");
    servers.push(agent);
    const spawn = fakeSpawn();
    const collector = makeCollector();

    const handle = launchService({
      token,
      agentBaseUrl: agent.baseUrl,
      repoRoot: "/repo",
      pythonPath: "/venv/python",
      spawnFn: spawn,
      healthIntervalMs: 30,
      healthTimeoutMs: 3000,
      onStatus: collector.push,
    });

    const failed = await waitForState(collector.statuses, "failed");
    expect(failed.detail).toMatch(/rechazó el token/);
    // No spawn: the port was already taken by a foreign service.
    expect(spawn).not.toHaveBeenCalled();
    await handle.terminate();
  });

  it("R12: child exit before ready surfaces as failed with the stderr tail", async () => {
    const token = generateAuthToken();
    const agent = await startAgent(token, { up: false });
    servers.push(agent);
    const spawn = fakeSpawn();
    const collector = makeCollector();

    const handle = launchService({
      token,
      agentBaseUrl: agent.baseUrl,
      repoRoot: "/repo",
      pythonPath: "/venv/python",
      spawnFn: spawn,
      healthIntervalMs: 30,
      healthTimeoutMs: 2000,
      onStatus: collector.push,
    });

    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1));
    const child = childrenBySpawn[0];
    child.stderr.emit("data", Buffer.from("Traceback: boom\n"));
    child.emitExit(1);

    const failed = await waitForState(collector.statuses, "failed");
    expect(failed.detail).toMatch(/antes de estar listo/);
    expect(failed.detail).toMatch(/boom/);
    await handle.terminate();
  });

  it("R09-adopt: an already-running service is adopted without a second spawn", async () => {
    const token = generateAuthToken();
    const agent = await startAgent(token);
    servers.push(agent);
    const spawn = fakeSpawn();
    const collector = makeCollector();

    const handle = launchService({
      token,
      agentBaseUrl: agent.baseUrl,
      repoRoot: "/repo",
      pythonPath: "/venv/python",
      spawnFn: spawn,
      healthIntervalMs: 30,
      healthTimeoutMs: 3000,
      onStatus: collector.push,
    });

    await waitForState(collector.statuses, "ready");
    expect(spawn).not.toHaveBeenCalled();
    await handle.terminate();
  });

  it("external mode never spawns and reports ready against a live service", async () => {
    const token = generateAuthToken();
    const agent = await startAgent(token);
    servers.push(agent);
    const spawn = fakeSpawn();
    const collector = makeCollector();

    const handle = launchService({
      token,
      agentBaseUrl: agent.baseUrl,
      repoRoot: "/repo",
      pythonPath: "/venv/python",
      spawnFn: spawn,
      serviceMode: "external",
      healthIntervalMs: 30,
      healthTimeoutMs: 3000,
      onStatus: collector.push,
    });

    await waitForState(collector.statuses, "ready");
    expect(spawn).not.toHaveBeenCalled();
    await handle.terminate();
  });

  it("R13: terminate() kills the child and suppresses the stopped status", async () => {
    const token = generateAuthToken();
    const agent = await startAgent(token, { up: false });
    servers.push(agent);
    const spawn = fakeSpawn();
    const collector = makeCollector();

    const handle = launchService({
      token,
      agentBaseUrl: agent.baseUrl,
      repoRoot: "/repo",
      pythonPath: "/venv/python",
      spawnFn: spawn,
      healthIntervalMs: 30,
      healthTimeoutMs: 3000,
      onStatus: collector.push,
    });
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1));
    const child = childrenBySpawn[0];

    await handle.terminate();
    expect(child.kill).toHaveBeenCalled();
    expect(child.killed).toBe(true);
    expect(handle.terminated).toBe(true);

    // Late child exit after terminate must not emit stopped/failed.
    child.emitExit(0);
    expect(collector.statuses.map((s) => s.state)).not.toContain("stopped");
    expect(collector.statuses.map((s) => s.state)).not.toContain("failed");
  });

  it("timeout without a service reports failed with the agent URL", async () => {
    // Port 1: nothing listens, connection refused is instant.
    const collector = makeCollector();
    const handle = launchService({
      token: generateAuthToken(),
      agentBaseUrl: "http://127.0.0.1:1",
      repoRoot: "/repo",
      pythonPath: "/venv/python",
      spawnFn: fakeSpawn(),
      healthIntervalMs: 30,
      healthTimeoutMs: 300,
      onStatus: collector.push,
    });
    const failed = await waitForState(collector.statuses, "failed");
    expect(failed.detail).toMatch(/no respondió/);
    await handle.terminate();
  });
});
