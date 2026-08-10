/**
 * GATE-5 (routing-parity, defect #1) — memory surface slice.
 *
 * Owns the `content.memory` bag: semantic/FTS recall results from the
 * memory.search_results wire event (the W1-MEMORY producer). No memory
 * surface/panel is registered in the UI yet (adaptive/surfaces.ts lists
 * none) — this slice still gives the wire an honest consumer so frames
 * are never dropped, and W3 can surface content.memory.
 */

import type { ServerEvent } from "../contracts";
import type { SurfaceSlice } from "./registry";
import type { MemoryContent } from "./types";

export const memorySlice: SurfaceSlice<MemoryContent> = {
  panelId: "memory",
  eventTypes: ["memory.search_results"],
  commandActions: [],
  applyEvent(bag, event) {
    switch (event.type) {
      case "memory.search_results":
        return {
          query: event.query,
          results: event.results,
          createdAt: event.created_at,
        };
      default:
        return bag;
    }
  },
  applyCommand(bag) {
    return bag;
  },
};
