/**
 * R41 — tests for the IPC sender validation (electron/ipc-guard.ts).
 *
 * The module imports only TYPES from electron, so no electron mock is
 * needed (type-only imports are erased at compile time).
 */
import { describe, expect, it } from "vitest";
import type { WebContents, WebFrameMain } from "electron";

import { isTrustedIpcSender } from "../electron/ipc-guard";

interface FakeWebContents {
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

function makeFakeWebContents(): FakeWebContents {
  const wc: FakeWebContents = {
    isDestroyed: () => wc.destroyed,
    mainFrame: { id: "main-frame" },
    destroyed: false,
  };
  return wc;
}

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
