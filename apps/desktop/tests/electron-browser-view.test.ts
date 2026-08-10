/**
 * W2-VIEW (GATE-5, ADR 0007) — the main-owned integrated browser:
 * BrowserView class tests covering the three new IPC contracts:
 *
 *  - NAV-STATE IPC: the view's REAL url/title/can_go_back/can_go_forward/
 *    loading published on every did-* event (main forwards the identical
 *    payload to the renderer over arsvox:browser-state and — snake_case
 *    via toServicePayload — PUTs it to /api/browser-state);
 *  - BOUNDS IPC: renderer-reported panel bounds → view.setBounds
 *    (clamped; zeroed on unmount);
 *  - ALLOWLIST ENFORCEMENT: every navigate() is pre-checked by
 *    decideRemoteNavigation BEFORE loadURL — a request outside the
 *    allowlist never reaches the view.
 *
 * `electron` is fully mocked (vitest node env cannot load the real
 * module). The mock records handler registrations so tests can fire the
 * events like Electron would; the real Electron types are cast away at
 * the mock boundary.
 */
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

interface FakeWebContents {
  __listeners: Record<string, Array<(arg: unknown) => void>>;
  __fire: (evt: string, arg?: unknown) => void;
  on: Mock;
  removeListener: Mock;
  setWindowOpenHandler: Mock;
  getURL: Mock;
  getTitle: Mock;
  isLoading: Mock;
  loadURL: Mock;
  reload: Mock;
  navigationHistory: {
    canGoBack: Mock;
    goBack: Mock;
    canGoForward: Mock;
    goForward: Mock;
  };
  destroyed: boolean;
}

vi.mock("electron", () => {
  type ListenerMap = Record<string, Array<(arg: unknown) => void>>;

  const sessions: Array<Record<string, unknown>> = [];
  const views: Array<{ setBounds: Mock }> = [];
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
      getURL: vi.fn(() => ""),
      getTitle: vi.fn(() => ""),
      isLoading: vi.fn(() => false),
      loadURL: vi.fn(async () => undefined),
      reload: vi.fn(),
      navigationHistory: {
        canGoBack: vi.fn(() => false),
        goBack: vi.fn(),
        canGoForward: vi.fn(() => false),
        goForward: vi.fn(),
      },
      destroyed: false,
      __fire: (evt: string, arg?: unknown) => {
        for (const cb of listeners[evt] ?? []) cb(arg);
      },
    };
    return wc;
  }

  return {
    app: {
      whenReady: () => Promise.resolve(),
      on: vi.fn(),
    },
    protocol: {
      registerSchemesAsPrivileged: vi.fn(),
      handle: vi.fn(),
    },
    net: {
      fetch: vi.fn(async (url: string) => new Response(`served:${url}`, { status: 200 })),
    },
    session: {
      fromPartition: vi.fn((partition: string) => {
        const ses: Record<string, unknown> = {
          partition,
          setPermissionRequestHandler: vi.fn(),
          setPermissionCheckHandler: vi.fn(),
          webRequest: {
            onBeforeRequest: vi.fn(),
            onHeadersReceived: vi.fn(),
          },
        };
        sessions.push(ses);
        return ses;
      }),
    },
    WebContentsView: class {
      webContents: FakeWebContents;
      setBounds: Mock;
      constructor() {
        lastView = makeFakeWebContents();
        this.webContents = lastView;
        this.setBounds = vi.fn();
        views.push(this);
      }
    },
    __test: {
      sessions,
      views,
      get lastView(): FakeWebContents | undefined {
        return lastView;
      },
      makeFakeWebContents,
      reset: () => {
        sessions.length = 0;
        views.length = 0;
        lastView = undefined;
      },
    },
  };
});

import * as electronModule from "electron";
import { BrowserView, toServicePayload } from "../electron/browser-view";
import { REMOTE_CONTENT_PARTITION } from "../electron/security-policy";

type ElectronTestHandle = {
  sessions: Array<Record<string, unknown>>;
  views: Array<{ setBounds: Mock }>;
  lastView: FakeWebContents | undefined;
  makeFakeWebContents: () => FakeWebContents;
  reset: () => void;
};
const electronTest = (electronModule as unknown as { __test: ElectronTestHandle }).__test;

const mockSession = electronModule.session;

function lastView(): FakeWebContents | undefined {
  return electronTest.lastView;
}

/** A live view with an onStateChange spy; returns the view + its wc. */
function makeView(allowlist?: readonly string[]) {
  const onStateChange = vi.fn();
  const view = BrowserView.create({ allowlist, onStateChange });
  const wc = lastView();
  if (!wc) throw new Error("no webContents created");
  return { view, wc, onStateChange };
}

beforeEach(() => {
  vi.clearAllMocks();
  electronTest.reset();
});

describe("nav-state IPC: view url/title/back/forward → renderer + service", () => {
  it("publishes the REAL state (frozen field set) on every did-* event", () => {
    const { wc, onStateChange } = makeView();
    wc.getURL.mockReturnValue("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    wc.getTitle.mockReturnValue("Pasta fresca en casa");
    wc.navigationHistory.canGoBack.mockReturnValue(true);
    wc.navigationHistory.canGoForward.mockReturnValue(false);
    wc.isLoading.mockReturnValue(true);

    wc.__fire("did-navigate");

    expect(onStateChange).toHaveBeenCalledTimes(1);
    const state = onStateChange.mock.calls[0][0];
    // frozen field set — exactly these keys, in this order
    expect(Object.keys(state)).toEqual([
      "url",
      "title",
      "canGoBack",
      "canGoForward",
      "loading",
    ]);
    expect(state).toEqual({
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      title: "Pasta fresca en casa",
      canGoBack: true,
      canGoForward: false,
      loading: true,
    });
  });

  it("pushes on did-navigate-in-page, page-title-updated, did-start/stop-loading, did-fail-load", () => {
    const { wc, onStateChange } = makeView();
    for (const evt of [
      "did-navigate-in-page",
      "page-title-updated",
      "did-start-loading",
      "did-stop-loading",
      "did-fail-load",
    ]) {
      wc.__fire(evt);
    }
    expect(onStateChange).toHaveBeenCalledTimes(5);
  });

  it("getState() reflects the webContents' live values", () => {
    const { view, wc } = makeView();
    wc.getURL.mockReturnValue("https://es.wikipedia.org/wiki/Pasta");
    wc.getTitle.mockReturnValue("Pasta — Wikipedia");
    wc.navigationHistory.canGoForward.mockReturnValue(true);
    expect(view.getState()).toEqual({
      url: "https://es.wikipedia.org/wiki/Pasta",
      title: "Pasta — Wikipedia",
      canGoBack: false,
      canGoForward: true,
      loading: false,
    });
  });

  it("toServicePayload maps onto the frozen snake_case BrowserNavigateEvent wire", () => {
    // This exact payload is what main PUTs to /api/browser-state —
    // the wire shape is FROZEN (do not rename fields).
    const payload = toServicePayload({
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      title: "Pasta fresca en casa",
      canGoBack: true,
      canGoForward: false,
      loading: false,
    });
    expect(Object.keys(payload)).toEqual([
      "url",
      "title",
      "can_go_back",
      "can_go_forward",
      "loading",
    ]);
    expect(payload).toEqual({
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      title: "Pasta fresca en casa",
      can_go_back: true,
      can_go_forward: false,
      loading: false,
    });
  });

  it("create() binds the view to the isolated remote partition", () => {
    makeView();
    expect(mockSession.fromPartition).toHaveBeenCalledWith(REMOTE_CONTENT_PARTITION, {
      cache: false,
    });
  });
});

describe("bounds IPC: renderer panel bounds → view setBounds", () => {
  function lastViewInstance(): { setBounds: Mock } {
    const views = (electronModule as unknown as { __test: ElectronTestHandle }).__test.views;
    const inst = views[views.length - 1];
    if (!inst) throw new Error("no WebContentsView created");
    return inst;
  }

  it("clamps negative and fractional values before delegating", () => {
    const { view } = makeView();
    view.setBounds({ x: -10.7, y: 12.9, width: 300.2, height: -5 });
    expect(lastViewInstance().setBounds).toHaveBeenCalledWith({
      x: 0,
      y: 12,
      width: 300,
      height: 0,
    });
  });

  it("zero bounds (panel unmount) hide the view", () => {
    const { view } = makeView();
    view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    expect(lastViewInstance().setBounds).toHaveBeenCalledWith({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    });
  });

  it("passes exact integer panel bounds through", () => {
    const { view } = makeView();
    view.setBounds({ x: 240, y: 120, width: 640, height: 480 });
    expect(lastViewInstance().setBounds).toHaveBeenCalledWith({
      x: 240,
      y: 120,
      width: 640,
      height: 480,
    });
  });
});

describe("allowlist enforcement on main-owned navigate", () => {
  it("blocks a URL outside the allowlist BEFORE any load", () => {
    const { view, wc } = makeView(["youtube.com"]);
    const result = view.navigate("https://example.com/");
    expect(result.ok).toBe(false);
    expect(result.reason.length).toBeGreaterThan(0);
    expect(wc.loadURL).not.toHaveBeenCalled();
  });

  it("allows allowlisted URLs and loads them", () => {
    const { view, wc } = makeView(["youtube.com"]);
    const result = view.navigate("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(result).toEqual({ ok: true, reason: "ok" });
    expect(wc.loadURL).toHaveBeenCalledWith("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });

  it("dedupes a navigate to the URL already displayed (service echo)", () => {
    const { view, wc } = makeView(["youtube.com"]);
    wc.getURL.mockReturnValue("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    const result = view.navigate("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(result).toEqual({ ok: true, reason: "already-loaded" });
    expect(wc.loadURL).not.toHaveBeenCalled();
  });

  it("back/forward honor the real navigationHistory capability", () => {
    const { view, wc } = makeView();
    wc.navigationHistory.canGoBack.mockReturnValue(false);
    view.back();
    expect(wc.navigationHistory.goBack).not.toHaveBeenCalled();

    wc.navigationHistory.canGoBack.mockReturnValue(true);
    view.back();
    expect(wc.navigationHistory.goBack).toHaveBeenCalledTimes(1);

    wc.navigationHistory.canGoForward.mockReturnValue(true);
    view.forward();
    expect(wc.navigationHistory.goForward).toHaveBeenCalledTimes(1);
  });

  it("refresh reloads the view", () => {
    const { view, wc } = makeView();
    view.refresh();
    expect(wc.reload).toHaveBeenCalledTimes(1);
  });

  it("attach adds the view to the window contentView", () => {
    const { view } = makeView();
    const addChildView = vi.fn();
    view.attach({ contentView: { addChildView } } as unknown as Electron.BrowserWindow);
    expect(addChildView).toHaveBeenCalledTimes(1);
  });
});
