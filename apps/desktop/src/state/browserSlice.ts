/**
 * GATE-5 (W0-SLICE) — browser surface slice.
 *
 * Owns the `content.browser` bag: the integrated browser's navigation
 * surface. Server `browser.navigate` events land the authoritative
 * page state (url/title/nav capability/loading); optimistic client
 * commands (navigate/back/forward/refresh) flip loading while preserving
 * the last known nav capability (behavior preserved from the pre-slice
 * store — `can_go_back`/`can_go_forward` stay wired, W2 will replace the
 * hardcoded backend values).
 *
 * GATE-5 (routing-parity, defect #1): `browser.dom_action` frames (the
 * agent driving the SAME view the user manipulates) are routed here too —
 * the last action/result is recorded on the bag (never faked), so
 * W2-DRIVE producers land visible frames instead of being dropped.
 */

import type { ClientCommand, ServerEvent } from "../contracts";
import type { SurfaceSlice } from "./registry";
import type { BrowserContent } from "./types";

export const browserSlice: SurfaceSlice<BrowserContent> = {
  panelId: "browser",
  eventTypes: ["browser.navigate", "browser.dom_action"],
  commandActions: [
    "browser.navigate",
    "browser.back",
    "browser.forward",
    "browser.refresh",
  ],
  applyEvent(bag, event) {
    switch (event.type) {
      case "browser.navigate":
        return {
          url: event.url,
          title: event.title,
          canGoBack: event.can_go_back,
          canGoForward: event.can_go_forward,
          loading: event.loading,
        };
      case "browser.dom_action":
        // GATE-5 (routing-parity, defect #1): the agent's DOM action lands
        // on the SAME bag the user sees — record the last action/result,
        // never fake. Without a prior navigate the nav fields stay the
        // honest "unknown page" truth (empty url renders the same empty
        // state, and the frame is still recorded).
        return {
          url: bag?.url ?? "",
          title: bag?.title ?? "",
          canGoBack: bag?.canGoBack ?? false,
          canGoForward: bag?.canGoForward ?? false,
          loading: bag?.loading ?? false,
          lastDomAction: {
            operation: event.operation,
            target: event.target,
            value: event.value,
            result: event.result,
            createdAt: event.created_at,
          },
        };
      default:
        return bag;
    }
  },
  applyCommand(bag, command) {
    switch (command.action) {
      case "browser.navigate":
        return {
          url: command.url,
          title: bag?.title ?? "",
          canGoBack: bag?.canGoBack ?? false,
          canGoForward: bag?.canGoForward ?? false,
          loading: true,
        };
      case "browser.back":
      case "browser.forward":
      case "browser.refresh":
        // No nav bag yet: nothing to mark loading (the server event
        // materializes the bag). Preserved from the pre-slice store.
        return bag ? { ...bag, loading: true } : bag;
      default:
        return bag;
    }
  },
};

/**
 * W2-VIEW (ADR 0007) — the VIEW is the navigation authority: main
 * publishes the real WebContentsView state (url/title/can_go_back/
 * can_go_forward/loading) over arsvox:browser-state, and the store
 * reduces it onto the same bag the browser.navigate events feed. Both
 * pipes carry the same frozen field set, so they converge instead of
 * fighting; the IPC push is simply the freshest truth (in-view link
 * clicks and title updates never round-trip through the service).
 */
export function applyBrowserViewState(
  bag: BrowserContent | undefined,
  view: { url: string; title: string; canGoBack: boolean; canGoForward: boolean; loading: boolean },
): BrowserContent {
  return {
    url: view.url,
    title: view.title,
    canGoBack: view.canGoBack,
    canGoForward: view.canGoForward,
    loading: view.loading,
    ...(bag?.lastDomAction ? { lastDomAction: bag.lastDomAction } : {}),
  };
}
