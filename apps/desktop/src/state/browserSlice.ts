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
 */

import type { ClientCommand, ServerEvent } from "../contracts";
import type { SurfaceSlice } from "./registry";
import type { BrowserContent } from "./types";

export const browserSlice: SurfaceSlice<BrowserContent> = {
  panelId: "browser",
  eventTypes: ["browser.navigate"],
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
