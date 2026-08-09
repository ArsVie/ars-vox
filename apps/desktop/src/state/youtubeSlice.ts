/**
 * GATE-5 (W1-YOUTUBE) — youtube surface slice.
 *
 * Owns the `content.youtube` bag: the agent's REAL search results as
 * selectable cards (vision line: *the LLM searches YouTube and OFFERS
 * the user options; the user picks one by click or voice*). The W1
 * tool emits the GATE-5 wire member `media.search_results` (unified
 * card shape with source/kind); the user picks by click
 * (`media.select_result`) or by voice (agent play tools).
 *
 * Compatibility path (expiring): the frozen actions.py still rebuilds
 * the legacy `youtube.search` event from the tool's JSON return, and
 * the frozen store's applyEvent routes only that event type to the
 * registry today. The slice reduces BOTH so real cards render until
 * the store routes `media.search_results` — see the TODO below.
 */

import type {
  ClientCommand,
  MediaSearchResult,
  ServerEvent,
  YoutubeVideoResult,
} from "../contracts";
import type { SurfaceSlice } from "./registry";
import type { YoutubeContent } from "./types";

/** Legacy youtube.search cards are youtube/video by definition. */
function toMediaCard(r: YoutubeVideoResult): MediaSearchResult {
  return {
    id: r.id,
    title: r.title,
    source: "youtube",
    kind: "video",
    channel: r.channel,
    duration_s: r.duration_s,
    published: r.published,
    thumbnail_url: r.thumbnail_url,
    local_path: null,
  };
}

export const youtubeSlice: SurfaceSlice<YoutubeContent> = {
  panelId: "youtube",
  eventTypes: ["media.search_results", "youtube.search"],
  commandActions: ["youtube.search"],
  applyEvent(bag, event) {
    switch (event.type) {
      case "media.search_results":
        // GATE-5 wire: the W1 tool's real cards land here.
        return { query: event.query, loading: false, results: event.results };
      case "youtube.search":
        // TODO(gate5-w1-youtube, delete-when: the frozen store routes
        // media.search_results to the content registry): legacy member
        // rebuilt by frozen actions.py — same real data, converted to
        // the unified card shape.
        return {
          query: event.query,
          loading: false,
          results: event.results.map(toMediaCard),
        };
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
