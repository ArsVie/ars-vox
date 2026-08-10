/**
 * A8 (GATE-3.5 wave 1) / W2-VIEW (GATE-5) — tests for the Electron glue
 * (R40/R41/R42): hardened session/view creation, session webRequest
 * allowlist enforcement + CSP injection, navigation guards, local-doc
 * protocol handler, IPC sender validation, global WebContents guard.
 *
 * `electron` is fully mocked (vitest node env cannot load the real
 * module — it resolves to the binary path). The mock records handler
 * registrations so tests can fire the events like Electron would.
 * The real Electron types are cast away at the mock boundary — the
 * runtime objects are our fakes.
 */
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { WebContents, WebFrameMain } from "electron";

interface FakeWebContents {
  __listeners: Record<string, Array<(arg: unknown) => void>>;
  __webPreferences?: Record<string, unknown>;
  __fire: (evt: string, arg: unknown) => void;
  on: Mock;
  removeListener: Mock;
  setWindowOpenHandler: Mock;
  isDestroyed: () => boolean;
  mainFrame: { id: string };
  destroyed: boolean;
}

const asWC = (wc: FakeWebContents): WebContents => wc as unknown as WebContents;
const asFrame = (f: { id: string }): WebFrameMain => f as unknown as WebFrameMain;
const asIpcEvent = (sender: FakeWebContents, senderFrame: { id: string } | null) => ({
  sender: asWC(sender),
  senderFrame: senderFrame ? asFrame(senderFrame) : null,
});

/**
 * Self-contained electron mock: all state lives inside the factory and is
 * reachable through the `__test` handle, so vi.mock hoisting cannot break
 * TDZ (vitest hoists the factory above top-level consts).
 */
vi.mock("electron", () => {
  type ListenerMap = Record<string, Array<(arg: unknown) => void>>;
  type AppListenerMap = Record<string, Array<(event: unknown, wc: unknown) => void>>;
  type WebRequestMap = Record<string, Array<(details: unknown, callback: (r: unknown) => void) => void>>;

  const sessions: Array<Record<string, unknown>> = [];
  const appListeners: AppListenerMap = {};
  let lastView: FakeWebContents | undefined;

  function makeFakeWebContents(): FakeWebContents {
    const listeners: ListenerMap = {};
    const wc: FakeWebContents = {
      __listeners: listeners,
      on: vi.fn((evt: string, cb: (arg: unknown) => void) => {
        (listeners[evt] ??= []).push(cb);
      }),
      removeListener: vi.fn((evt: string, cb: unknown) => {
        listeners[evt] = (listeners[evt] ?? []).filter((l) => l !== cb);
      }),
      setWindowOpenHandler: vi.fn(),
      isDestroyed: () => wc.destroyed,
      mainFrame: { id: "main-frame" },
      destroyed: false,
      __fire: (evt: string, arg: unknown) => {
        for (const cb of listeners[evt] ?? []) cb(arg);
      },
    };
    return wc;
  }

  return {
    app: {
      whenReady: () => Promise.resolve(),
      on: (evt: string, cb: (event: unknown, wc: unknown) => void) => {
        (appListeners[evt] ??= []).push(cb);
      },
    },
    protocol: {
      registerSchemesAsPrivileged: vi.fn(),
      handle: vi.fn(),
    },
    session: {
      fromPartition: vi.fn((partition: string) => {
        const webRequestListeners: WebRequestMap = {};
        const ses: Record<string, unknown> = {
          partition,
          permissionRequestHandler: null,
          permissionCheckHandler: null,
          setPermissionRequestHandler: (fn: unknown) => {
            ses.permissionRequestHandler = fn;
          },
          setPermissionCheckHandler: (fn: unknown) => {
            ses.permissionCheckHandler = fn;
          },
          webRequest: {
            onBeforeRequest: vi.fn((evt: string, cb: (details: unknown, callback: (r: unknown) => void) => void) => {
              (webRequestListeners[evt] ??= []).push(cb);
            }),
            onHeadersReceived: vi.fn((evt: string, cb: (details: unknown, callback: (r: unknown) => void) => void) => {
              (webRequestListeners[evt] ??= []).push(cb);
            }),
            __fire: (evt: string, details: unknown, callback: (r: unknown) => void) => {
              for (const cb of webRequestListeners[evt] ?? []) cb(details, callback);
            },
          },
        };
        sessions.push(ses);
        return ses;
      }),
    },
    net: {
      fetch: vi.fn(async (url: string) => new Response(`served:${url}`, { status: 200 })),
    },
    WebContentsView: class {
      webContents: FakeWebContents;
      constructor(options: { webPreferences?: Record<string, unknown> }) {
        lastView = makeFakeWebContents();
        lastView.__webPreferences = options?.webPreferences ?? {};
        this.webContents = lastView;
      }
    },
    __test: {
      sessions,
      appListeners,
      get lastView(): FakeWebContents | undefined {
        return lastView;
      },
      makeFakeWebContents,
      reset: () => {
        sessions.length = 0;
        for (const k of Object.keys(appListeners)) delete appListeners[k];
        lastView = undefined;
      },
    },
  };
});

import * as electronModule from "electron";
import {
  __resetLocalDocProtocolRegistrationForTests,
  attachRemoteNavigationGuards,
  createHardenedRemoteView,
  createRemoteContentSession,
  installGlobalWebContentsGuard,
  isTrustedIpcSender,
  registerLocalDocProtocol,
} from "../electron/hardened-view";
import { LOCAL_DOC_SCHEME, REMOTE_CONTENT_PARTITION, REMOTE_CSP } from "../electron/security-policy";

type ElectronTestHandle = {
  sessions: Array<Record<string, unknown>>;
  appListeners: Record<string, Array<(event: unknown, wc: unknown) => void>>;
  lastView: FakeWebContents | undefined;
  makeFakeWebContents: () => FakeWebContents;
  reset: () => void;
};
const electronTest = (electronModule as unknown as { __test: ElectronTestHandle }).__test;

/** Delegates to the mock-internal factory (kept out of the hoisted vi.mock). */
function makeFakeWebContents(): FakeWebContents {
  return electronTest.makeFakeWebContents();
}

type FakeSession = {
  partition: string;
  permissionRequestHandler: unknown;
  permissionCheckHandler: unknown;
  webRequest: {
    onBeforeRequest: Mock;
    onHeadersReceived: Mock;
    __fire: (evt: string, details: unknown, callback: (r: unknown) => void) => void;
  };
};

const mockApp = electronModule.app;
const mockNet = electronModule.net;
const mockProtocol = electronModule.protocol;
const mockSession = electronModule.session;

function lastView(): FakeWebContents | undefined {
  return electronTest.lastView;
}

function lastSession(): FakeSession | undefined {
  const s = electronTest.sessions[electronTest.sessions.length - 1];
  return s as FakeSession | undefined;
}

beforeEach(() => {
  vi.clearAllMocks();
  electronTest.reset();
  __resetLocalDocProtocolRegistrationForTests();
});

describe("createRemoteContentSession (R40)", () => {
  it("uses the persistent remote-content partition", () => {
    const ses = createRemoteContentSession() as unknown as FakeSession;
    expect(mockSession.fromPartition).toHaveBeenCalledWith(REMOTE_CONTENT_PARTITION, { cache: false });
    expect(ses.partition).toBe(REMOTE_CONTENT_PARTITION);
    expect(REMOTE_CONTENT_PARTITION.startsWith("persist:")).toBe(true);
  });

  it("installs deny-by-default permission handlers", () => {
    const ses = createRemoteContentSession() as unknown as FakeSession;
    const requestHandler = ses.permissionRequestHandler as (
      wc: unknown,
      perm: string,
      cb: (v: boolean) => void,
    ) => void;
    const checkHandler = ses.permissionCheckHandler as (wc: unknown, perm: string) => boolean;
    requestHandler({}, "media", (granted) => expect(granted).toBe(false));
    requestHandler({}, "geolocation", (granted) => expect(granted).toBe(false));
    expect(checkHandler({}, "media")).toBe(false);
    expect(checkHandler({}, "notifications")).toBe(false);
  });

  it("enforces the allowlist at the session webRequest layer BEFORE any load (W2-VIEW)", () => {
    const ses = createRemoteContentSession() as unknown as FakeSession;
    expect(ses.webRequest.onBeforeRequest).toHaveBeenCalled();
    expect(ses.webRequest.onHeadersReceived).toHaveBeenCalled();
  });
});

describe("session webRequest allowlist enforcement (W2-VIEW)", () => {
  function beforeRequestHandler(): (details: Record<string, unknown>, cb: (r: unknown) => void) => void {
    createRemoteContentSession({ allowlist: ["youtube.com"] });
    const ses = lastSession()!;
    // Electron's webRequest.onBeforeRequest(listener) takes ONE argument
    // (the listener); the filter is optional. Index 0 is the listener.
    return ses.webRequest.onBeforeRequest.mock.calls[0][0] as (
      details: Record<string, unknown>,
      cb: (r: unknown) => void,
    ) => void;
  }

  it("cancels a main-frame load outside the allowlist", () => {
    const handler = beforeRequestHandler();
    const result: unknown[] = [];
    handler({ url: "https://example.com/", resourceType: "mainFrame" }, (r) => result.push(r));
    expect(result).toEqual([{ cancel: true }]);
  });

  it("cancels main-frame loads to dangerous schemes and local destinations", () => {
    const handler = beforeRequestHandler();
    for (const url of ["file:///etc/passwd", "http://127.0.0.1:8765/", "https://localhost/"]) {
      const result: unknown[] = [];
      handler({ url, resourceType: "mainFrame" }, (r) => result.push(r));
      expect(result).toEqual([{ cancel: true }], `expected ${url} to be cancelled`);
    }
  });

  it("passes allowlisted main-frame loads through", () => {
    const handler = beforeRequestHandler();
    const result: unknown[] = [];
    handler({ url: "https://www.youtube.com/watch?v=x", resourceType: "mainFrame" }, (r) => result.push(r));
    expect(result).toEqual([{}]);
  });

  it("never gates subframe/resource loads (CDNs, embeds)", () => {
    const handler = beforeRequestHandler();
    for (const resourceType of ["subFrame", "script", "image", "stylesheet", "xhr", "media"]) {
      const result: unknown[] = [];
      handler({ url: "https://cdn.example.com/asset.js", resourceType }, (r) => result.push(r));
      expect(result).toEqual([{}], `expected ${resourceType} to pass`);
    }
  });
});

describe("session webRequest CSP injection (migration note §3)", () => {
  it("injects the remote CSP into every response of the remote session", () => {
    createRemoteContentSession();
    const ses = lastSession()!;
    const handler = ses.webRequest.onHeadersReceived.mock.calls[0][0] as (
      details: Record<string, unknown>,
      cb: (r: unknown) => void,
    ) => void;
    const result: unknown[] = [];
    handler(
      { responseHeaders: { "content-type": ["text/html"] } },
      (r) => result.push(r),
    );
    const headers = (result[0] as { responseHeaders: Record<string, string[]> }).responseHeaders;
    expect(headers["Content-Security-Policy"]).toEqual([REMOTE_CSP]);
    // existing headers survive
    expect(headers["content-type"]).toEqual(["text/html"]);
  });
});

describe("createHardenedRemoteView (R40)", () => {
  it("binds the view to the isolated session with hard defaults and NO preload", () => {
    createHardenedRemoteView();
    const wp = lastView()?.__webPreferences ?? {};
    expect(wp.sandbox).toBe(true);
    expect(wp.contextIsolation).toBe(true);
    expect(wp.nodeIntegration).toBe(false);
    expect(wp.webSecurity).toBe(true);
    expect(wp.allowRunningInsecureContent).toBe(false);
    expect(wp.preload).toBeUndefined();
    expect(wp.session).toBeDefined();
  });

  it("attaches navigation + window-open guards", () => {
    createHardenedRemoteView();
    const wc = lastView();
    expect(wc).toBeDefined();
    expect(wc!.setWindowOpenHandler).toHaveBeenCalled();
    expect(wc!.__listeners["will-navigate"]?.length).toBeGreaterThan(0);
    expect(wc!.__listeners["will-frame-navigate"]?.length).toBeGreaterThan(0);
  });
});

describe("attachRemoteNavigationGuards (R40)", () => {
  function makeEvent(): { preventDefault: Mock; defaultPrevented: boolean } {
    return { preventDefault: vi.fn(), defaultPrevented: false };
  }

  it("blocks dangerous schemes and non-allowlisted hosts at the main frame", () => {
    const wc = makeFakeWebContents();
    attachRemoteNavigationGuards(asWC(wc), { allowlist: ["youtube.com"] });

    const fileEvt = makeEvent();
    wc.__fire("will-navigate", { url: "file:///etc/passwd", preventDefault: fileEvt.preventDefault });
    expect(fileEvt.preventDefault).toHaveBeenCalled();

    const localEvt = makeEvent();
    wc.__fire("will-navigate", { url: "http://127.0.0.1:8765/", preventDefault: localEvt.preventDefault });
    expect(localEvt.preventDefault).toHaveBeenCalled();

    const foreignEvt = makeEvent();
    wc.__fire("will-navigate", { url: "https://example.com/", preventDefault: foreignEvt.preventDefault });
    expect(foreignEvt.preventDefault).toHaveBeenCalled();
  });

  it("allows allowlisted public destinations", () => {
    const wc = makeFakeWebContents();
    attachRemoteNavigationGuards(asWC(wc), { allowlist: ["youtube.com"] });
    const evt = makeEvent();
    wc.__fire("will-navigate", { url: "https://www.youtube.com/watch?v=x", preventDefault: evt.preventDefault });
    expect(evt.preventDefault).not.toHaveBeenCalled();
  });

  it("does not block subframe navigations (cross-origin resources)", () => {
    const wc = makeFakeWebContents();
    attachRemoteNavigationGuards(asWC(wc), { allowlist: ["youtube.com"] });
    const evt = makeEvent();
    wc.__fire("will-frame-navigate", {
      url: "https://cdn.example.com/asset.js",
      isMainFrame: false,
      preventDefault: evt.preventDefault,
    });
    expect(evt.preventDefault).not.toHaveBeenCalled();
  });

  it("blocks main-frame frame navigations outside the policy", () => {
    const wc = makeFakeWebContents();
    attachRemoteNavigationGuards(asWC(wc), { allowlist: ["youtube.com"] });
    const evt = makeEvent();
    wc.__fire("will-frame-navigate", {
      url: "https://example.com/",
      isMainFrame: true,
      preventDefault: evt.preventDefault,
    });
    expect(evt.preventDefault).toHaveBeenCalled();
  });

  it("denies window.open unconditionally", () => {
    const wc = makeFakeWebContents();
    attachRemoteNavigationGuards(asWC(wc));
    const handler = (wc.setWindowOpenHandler as Mock).mock.calls[0][0] as () => { action: string };
    expect(handler().action).toBe("deny");
  });

  it("detach removes the listeners", () => {
    const wc = makeFakeWebContents();
    const handle = attachRemoteNavigationGuards(asWC(wc));
    handle.detach();
    expect(wc.__listeners["will-navigate"]?.length ?? 0).toBe(0);
    expect(wc.__listeners["will-frame-navigate"]?.length ?? 0).toBe(0);
  });
});

describe("registerLocalDocProtocol (R40)", () => {
  async function handlerFor(roots: Record<string, string>): Promise<(request: { url: string }) => Promise<Response>> {
    registerLocalDocProtocol({ roots });
    registerLocalDocProtocol({ roots }); // idempotent second registration
    expect(mockProtocol.registerSchemesAsPrivileged).toHaveBeenCalledTimes(1);
    await Promise.resolve(); // flush app.whenReady().then
    const handleMock = mockProtocol.handle as Mock;
    expect(handleMock).toHaveBeenCalledWith(LOCAL_DOC_SCHEME, expect.any(Function));
    return handleMock.mock.calls[0][1] as (request: { url: string }) => Promise<Response>;
  }

  it("registers the scheme as privileged exactly once", async () => {
    await handlerFor({});
    expect(mockProtocol.registerSchemesAsPrivileged).toHaveBeenCalledWith([
      expect.objectContaining({
        scheme: LOCAL_DOC_SCHEME,
        privileges: expect.objectContaining({ standard: true, secure: true }),
      }),
    ]);
  });

  it("serves files from registered roots", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arsvox-doc-"));
    fs.writeFileSync(path.join(dir, "hello.txt"), "hola");
    try {
      const handler = await handlerFor({ docs: dir });
      const res = await handler({ url: `${LOCAL_DOC_SCHEME}://docs/hello.txt` });
      expect(res.status).toBe(200);
      expect(mockNet.fetch).toHaveBeenCalledWith(expect.stringContaining("hello.txt"));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects traversal, unknown aliases and missing files", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arsvox-doc-"));
    fs.writeFileSync(path.join(dir, "ok.txt"), "x");
    try {
      const handler = await handlerFor({ docs: dir });
      // URL parsing normalizes dot segments before the handler runs, so a
      // traversal attempt lands outside the root or on a missing file —
      // either way it is denied and nothing is served.
      const traversal = await handler({ url: `${LOCAL_DOC_SCHEME}://docs/../secret` });
      expect(traversal.status).toBeGreaterThanOrEqual(400);
      expect(mockNet.fetch).not.toHaveBeenCalled();
      expect((await handler({ url: `${LOCAL_DOC_SCHEME}://other/x` })).status).toBe(403);
      expect((await handler({ url: `${LOCAL_DOC_SCHEME}://docs/missing.txt` })).status).toBe(404);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects symlink escapes outside the root (realpath containment)", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "arsvox-root-"));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "arsvox-outside-"));
    fs.writeFileSync(path.join(outside, "secret.txt"), "s3cret");
    try {
      fs.symlinkSync(path.join(outside, "secret.txt"), path.join(root, "link.txt"));
      const handler = await handlerFor({ docs: root });
      const res = await handler({ url: `${LOCAL_DOC_SCHEME}://docs/link.txt` });
      expect(res.status).toBe(403);
      expect(mockNet.fetch).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("isTrustedIpcSender (R41)", () => {
  it("accepts the main frame of a trusted WebContents", () => {
    const wc = makeFakeWebContents();
    expect(isTrustedIpcSender(asIpcEvent(wc, wc.mainFrame), (c) => c === asWC(wc))).toBe(true);
  });

  it("rejects untrusted WebContents", () => {
    const wc = makeFakeWebContents();
    const other = makeFakeWebContents();
    expect(isTrustedIpcSender(asIpcEvent(wc, wc.mainFrame), (c) => c === asWC(other))).toBe(false);
  });

  it("rejects subframe senders (iframe content is foreign)", () => {
    const wc = makeFakeWebContents();
    expect(isTrustedIpcSender(asIpcEvent(wc, { id: "sub-frame" }), () => true)).toBe(false);
  });

  it("rejects destroyed senders and null frames", () => {
    const wc = makeFakeWebContents();
    wc.destroyed = true;
    expect(isTrustedIpcSender(asIpcEvent(wc, wc.mainFrame), () => true)).toBe(false);
    const live = makeFakeWebContents();
    expect(isTrustedIpcSender(asIpcEvent(live, null), () => true)).toBe(false);
  });
});

describe("installGlobalWebContentsGuard (R40/R41)", () => {
  it("attaches remote guards to non-app WebContents only", () => {
    const appWc = makeFakeWebContents();
    const foreign = makeFakeWebContents();
    installGlobalWebContentsGuard({ isAppWebContents: (wc) => wc === asWC(appWc) });
    for (const cb of electronTest.appListeners["web-contents-created"] ?? []) {
      cb(null, foreign);
      cb(null, appWc);
    }
    expect(foreign.setWindowOpenHandler).toHaveBeenCalled();
    expect(foreign.__listeners["will-navigate"]?.length).toBeGreaterThan(0);
    expect(appWc.setWindowOpenHandler).not.toHaveBeenCalled();
  });
});
