/**
 * GATE-5 (W0-SLICE) — media surface wiring.
 *
 * The media panel's content bag (`content.media`) never lived in the
 * store: GATE-3.5 (R24-R27 + W3-MEDIA) made MediaController the single
 * media authority and the store derives content.media through ONE
 * subscription. This module is the media surface slice's wiring: every
 * wire path (server events, server commands, player callbacks, user
 * commands, snapshot restore) routes through the controller, and
 * subscribeMediaToStore installs the store's single mirror.
 */

import type { StoreApi } from "zustand/vanilla";

import type {
  ClientCommand,
  MediaStateEvent,
  NormalizedUiCommand,
} from "../contracts";
import {
  mediaController,
  type MediaState,
  type PlayerMediaUpdate,
} from "../media/controller";
import type { PanelContent } from "./types";

/** Re-exported for components that mirror the controller state. */
export { EMPTY_MEDIA } from "../media/controller";

/** Server MediaStateEvent — authoritative server state (agent tool /
 *  client action verdict) feeds the single controller. */
export function applyMediaServerEvent(event: MediaStateEvent): void {
  mediaController.applyServerEvent(event);
}

/** Defensive server-command path (media.state / audio.play ui_command) —
 *  the controller merges the partial command. */
export function applyMediaServerCommand(
  command: Extract<NormalizedUiCommand, { action: "media.state" | "audio.play" }>,
): void {
  mediaController.applyServerCommand(command);
}

/** The REAL player's callbacks (YouTube iframe infoDelivery) — no
 *  React-only simulated playback state. */
export function applyMediaPlayerUpdate(update: PlayerMediaUpdate): void {
  mediaController.applyPlayerUpdate(update);
}

/** Optimistic user command route (youtube.play / media.play_pause /
 *  media.seek) — the server ack/verdict reconciles afterwards. */
export function applyMediaUserCommand(
  command: Extract<ClientCommand, { action: "youtube.play" | "media.play_pause" | "media.seek" }>,
): void {
  switch (command.action) {
    case "youtube.play":
      mediaController.userPlayYoutube(command.video_id, command.title);
      break;
    case "media.play_pause":
      mediaController.userPlayPause();
      break;
    case "media.seek":
      mediaController.userSeek(command.position_s);
      break;
  }
}

/** Snapshot restore: media=null is authoritative absence — the stale
 *  player is CLEARED, never preserved. */
export function resetMedia(): void {
  mediaController.reset();
}

/** GATE-3.5 (W3-MEDIA): ONE media authority — content.media is DERIVED
 *  from the MediaController through this single subscription. The store
 *  is never a write-target for media events. Emits that produce no real
 *  change leave the state object untouched — no re-render churn. */
export function subscribeMediaToStore(
  store: StoreApi<{ content: PanelContent }>,
): void {
  mediaController.subscribe(() => {
    const media = mediaController.getState();
    store.setState((s) =>
      s.content.media === media ? s : { ...s, content: { ...s.content, media } },
    );
  });
}

export type { MediaState };
