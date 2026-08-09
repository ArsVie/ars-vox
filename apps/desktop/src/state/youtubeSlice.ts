/**
 * GATE-5 (W0-SLICE) — youtube surface slice.
 *
 * Owns the `content.youtube` bag: the agent's search results as selectable
 * cards (vision line: the LLM searches YouTube and OFFERS options). Server
 * `youtube.search` events land the results; the optimistic
 * `youtube.search` command flips loading on while preserving the previous
 * results (behavior preserved from the pre-slice store).
 */

import type { ClientCommand, ServerEvent } from "../contracts";
import type { SurfaceSlice } from "./registry";
import type { YoutubeContent } from "./types";

export const youtubeSlice: SurfaceSlice<YoutubeContent> = {
  panelId: "youtube",
  eventTypes: ["youtube.search"],
  commandActions: ["youtube.search"],
  applyEvent(bag, event) {
    switch (event.type) {
      case "youtube.search":
        return { query: event.query, loading: false, results: event.results };
      default:
        return bag;
    }
  },
  applyCommand(bag, command) {
    switch (command.action) {
      case "youtube.search":
        return {
          query: command.query,
          loading: true,
          results: bag?.results ?? [],
        };
      default:
        return bag;
    }
  },
};
