/**
 * GATE-3.5 A5 — single renderer-side media authority (R24-R27).
 *
 * ONE MediaController owns the media state the UI renders. Every media
 * input routes through it:
 *
 *   Agent tool  ──> server MediaStateEvent ──┐
 *   User controls ──> dispatchCommand ───────┼──> MediaController -> store.content.media -> UI
 *   Player callbacks ──> applyPlayerMediaEvent ┘
 *
 * There is NO React-only simulated playback state: position/duration
 * come from the real player (YouTube iframe infoDelivery) or from the
 * backend controller (which emits the same full state shape). The store
 * mirrors `getState()` into `content.media` after every routed call, so
 * every consumer (MediaDock, persistent bar, snapshot restore) reads
 * the one authoritative state.
 */

import type {
  MediaKind,
  MediaSource,
  MediaState as WireMediaState,
} from "../contracts";
import type { MediaStateEvent, UiCommand } from "../contracts";

/** Authoritative media state shape (mirrors the wire MediaStateEvent). */
export interface MediaState {
  state: WireMediaState;
  source: MediaSource;
  kind: MediaKind;
  title: string;
  videoId: string | null;
  url: string | null;
  positionS: number;
  durationS: number;
  volume: number;
}

export const EMPTY_MEDIA: MediaState = {
  state: "stopped",
  source: "local",
  kind: "audio",
  title: "",
  videoId: null,
  url: null,
  positionS: 0,
  durationS: 0,
  volume: 1,
};

/**
 * Extract a YouTube video id from a watch/embed/short URL. Non-YouTube
 * or unparseable urls yield null.
 */
export function mediaVideoIdFromUrl(url: string | null): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null; // local path or bare name — not a YouTube URL
  }
  const host = parsed.hostname.replace(/^www\./, "");
  if (host === "youtu.be") {
    const id = parsed.pathname.slice(1);
    return id.length > 0 ? id : null;
  }
  if (host === "youtube.com" || host === "m.youtube.com") {
    const v = parsed.searchParams.get("v");
    if (v) return v;
    const embed = parsed.pathname.match(/^\/embed\/([\w-]+)/);
    if (embed) return embed[1];
  }
  return null;
}

function isUrlish(asset: string): boolean {
  return /^(https?:)?\/\//.test(asset) || asset.startsWith("/") || asset.startsWith(".");
}

/** Player callback payload (from the YouTube iframe message channel). */
export interface PlayerMediaUpdate {
  state?: WireMediaState;
  currentTime?: number;
  duration?: number;
}

/**
 * The single media controller. Pure vanilla (no React) so the full
 * event path is unit-testable in node.
 */
export class MediaController {
  private _state: MediaState = { ...EMPTY_MEDIA };

  getState(): MediaState {
    return this._state;
  }

  /** Test hook: clear to the empty track (in place semantics). */
  reset(): void {
    this._state = { ...EMPTY_MEDIA };
  }

  // ------------------------------------------------------------------ //
  // Agent/server path — authoritative full state from the backend
  // ------------------------------------------------------------------ //

  /** A server MediaStateEvent (agent tool / client action verdict). */
  applyServerEvent(ev: MediaStateEvent): void {
    this._state = {
      state: ev.state,
      source: ev.source,
      kind: ev.kind,
      title: ev.title,
      videoId: ev.video_id,
      url: ev.url,
      positionS: ev.position_s,
      durationS: ev.duration_s,
      volume: ev.volume,
    };
  }

  /**
   * Legacy/defensive server command path (ui_command media.state /
   * audio.play). The backend no longer emits these for media tools, but
   * a partial command must still merge without forking the authority.
   */
  applyServerCommand(command: UiCommand): void {
    const m = this._state;
    if (command.action === "media.state") {
      // When the command carries a NEW url, the track identity derives
      // from THAT url alone (a non-YouTube url clears any stale
      // videoId); only a url-less partial keeps the current identity.
      const url = command.url ?? m.url;
      const videoId = command.url != null ? mediaVideoIdFromUrl(command.url) : m.videoId;
      const isYoutube = videoId !== null;
      this._state = {
        ...m,
        state: command.state,
        title: command.title ?? m.title,
        url,
        videoId,
        source: command.url != null ? (isYoutube ? "youtube" : "local") : m.source,
        kind: command.url != null ? (isYoutube ? "video" : "audio") : m.kind,
        volume: command.volume ?? m.volume,
      };
      return;
    }
    if (command.action === "audio.play") {
      const asset = command.asset;
      if (isUrlish(asset)) {
        // A URL-ish asset is a FRESH local track (identity from itself).
        this._state = {
          state: "playing",
          source: "local",
          kind: "audio",
          title: asset.split(/[\\/]/).pop() || asset,
          url: asset,
          videoId: null,
          positionS: 0,
          durationS: m.durationS,
          volume: m.volume,
        };
        return;
      }
      // Bare name: keep the loaded track's identity, just start playing.
      this._state = {
        ...m,
        state: "playing",
        source: "local",
        kind: "audio",
        title: m.title || asset.split(/[\\/]/).pop() || asset,
        videoId: null,
        positionS: 0,
      };
    }
  }

  // ------------------------------------------------------------------ //
  // User path — optimistic local effect; the server reconciles with a
  // MediaStateEvent afterwards (H1 verdicts keep the UI honest).
  // ------------------------------------------------------------------ //

  /** User pressed play/pause (media.play_pause). */
  userPlayPause(): void {
    const m = this._state;
    if (!hasTrack(m)) return; // nothing loaded — nothing to toggle
    this._state = {
      ...m,
      state: m.state === "playing" ? "paused" : "playing",
    };
  }

  /** User dragged the slider / seek command (media.seek). */
  userSeek(positionS: number): void {
    const m = this._state;
    if (!hasTrack(m)) return;
    this._state = { ...m, positionS: Math.max(0, Math.floor(positionS)) };
  }

  /** User picked a YouTube result (youtube.play). */
  userPlayYoutube(videoId: string, title: string): void {
    this._state = {
      state: "playing",
      source: "youtube",
      kind: "video",
      title,
      videoId,
      url: `https://www.youtube.com/embed/${videoId}`,
      positionS: 0,
      durationS: 0,
      volume: this._state.volume,
    };
  }

  // ------------------------------------------------------------------ //
  // Player path — the real player's callbacks feed the controller (R26)
  // ------------------------------------------------------------------ //

  /**
   * Player playback-state change (infoDelivery playerState). The
   * player's own controls (YouTube's play/pause) are authoritative
   * about what the iframe is DOING.
   */
  playerStateChanged(state: WireMediaState): void {
    this._state = { ...this._state, state };
  }

  /**
   * Player time update (infoDelivery currentTime / videoData.duration).
   * Feeds REAL playback position/duration into the controller — the
   * progress bar reflects the iframe, never a simulated clock.
   * Redundant updates (<0.1s delta, same duration) are skipped.
   */
  playerTimeUpdate(currentTime: number, duration?: number): void {
    const m = this._state;
    const pos = Math.max(0, currentTime);
    const next: MediaState = { ...m };
    if (Math.abs(pos - m.positionS) >= 0.1) next.positionS = pos;
    if (duration !== undefined && duration > 0 && duration !== m.durationS) {
      next.durationS = duration;
    }
    if (next.positionS !== m.positionS || next.durationS !== m.durationS) {
      this._state = next;
    }
  }

  /** Combined player callback (one infoDelivery may carry all three). */
  applyPlayerUpdate(update: PlayerMediaUpdate): void {
    if (update.state !== undefined) this.playerStateChanged(update.state);
    if (update.currentTime !== undefined || update.duration !== undefined) {
      this.playerTimeUpdate(update.currentTime ?? this._state.positionS, update.duration);
    }
  }
}

function hasTrack(m: MediaState): boolean {
  return m.title !== "" || m.videoId !== null || m.url !== null;
}

/** The renderer's single media authority (bound by the app store). */
export const mediaController = new MediaController();

/** Test hook: clear the singleton in place. */
export function resetMediaController(): void {
  mediaController.reset();
}
