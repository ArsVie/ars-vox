/**
 * GATE-5 (W1-MEDIA-LOCAL) — the OTHER half of the unified player.
 *
 * One player, two sources: the YouTube iframe (videoId present) and an
 * HTML5 media element (everything else). This module owns the local
 * half of that player surface:
 *
 *   - `localPlayableSrc` — pure mapping from a local filesystem path /
 *     URL to something an <audio> element can actually load. The
 *     renderer origin is file:// in the packaged app; a raw Windows or
 *     POSIX path must become a file:// URL. http(s) URLs pass through.
 *
 *   - `useLocalPlayer` — the mirror image of useYoutubePlayer in
 *     MediaDock: it drives an <audio> element FROM the controller state
 *     (play/pause/seek commands) and feeds the element's REAL callbacks
 *     (timeupdate, durationchange, play, pause, ended) BACK into the
 *     same MediaController seam the YouTube iframe uses
 *     (applyPlayerMediaEvent). No simulated playback state anywhere:
 *     position/duration come from the real element, exactly like the
 *     iframe infoDelivery path (R26).
 *
 * The branch between the two players is by track IDENTITY (videoId
 * present or not), never by source: a local file and a YouTube video
 * render the same controls, the same UI.
 */

import { useEffect, useRef, type RefObject } from "react";

import { appStore } from "../store";
import type { MediaState as WireMediaState } from "../contracts";
import type { PlayerMediaUpdate } from "./controller";

/**
 * Convert a local-source member (local_path / url) into a src the
 * <audio> element can load.
 *
 *   - http(s):// and file:// URLs pass through untouched.
 *   - Absolute filesystem paths become file:// URLs:
 *       C:\Music\track.mp3  -> file:///C:/Music/track.mp3
 *       /mnt/c/Music/a.mp3  -> file:///mnt/c/Music/a.mp3
 *   - Anything else (bare names, relative paths) returns null — the
 *     renderer cannot resolve it to a playable file, so the player must
 *     not pretend it can.
 */
export function localPlayableSrc(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:\/\//i.test(path) || /^file:\/\//i.test(path)) return path;
  // Windows absolute path (C:\... or C:/...).
  const win = path.match(/^([A-Za-z]):[\\/](.*)$/);
  if (win) {
    const drive = win[1].toUpperCase();
    const rest = win[2].replace(/\\/g, "/");
    return `file:///${drive}:/${rest}`;
  }
  // POSIX absolute path.
  if (path.startsWith("/")) return `file://${path}`;
  return null;
}

/** Element lifecycle events → controller updates (the R26 seam). */
export function parseLocalElementUpdate(el: HTMLMediaElement): PlayerMediaUpdate {
  const update: PlayerMediaUpdate = {};
  if (el.currentTime >= 0) update.currentTime = el.currentTime;
  if (el.duration > 0 && Number.isFinite(el.duration)) update.duration = el.duration;
  return update;
}

/**
 * Drive ONE <audio> element from the single MediaController and feed its
 * real callbacks back into the controller — the exact contract
 * useYoutubePlayer has for the iframe. SSR-safe: without a window the
 * hook is inert (renderToStaticMarkup never mounts effects).
 *
 * Command direction (store → element): playing state calls el.play(),
 * paused/stopped calls el.pause(); a positionS change seeks the element.
 * Callback direction (element → store): timeupdate/durationchange carry
 * REAL position/duration; play/pause/ended carry the element's own state
 * — the same infoDelivery pattern the YouTube embed uses.
 */
export function useLocalPlayer<TElement extends HTMLMediaElement>(
  src: string | null,
  state: WireMediaState,
  positionS: number,
  volume: number,
): { mediaRef: RefObject<TElement> } {
  const mediaRef = useRef<HTMLMediaElement>(null);

  // Element -> controller: wire the real media element callbacks once
  // per src. All reads go to the LIVE store via applyPlayerMediaEvent.
  useEffect(() => {
    if (!src) return undefined;
    const el = mediaRef.current;
    if (!el || typeof window === "undefined") return undefined;

    const push = (update: PlayerMediaUpdate): void => {
      appStore.getState().applyPlayerMediaEvent(update);
    };

    const onTime = (): void => push(parseLocalElementUpdate(el));
    const onDuration = (): void => push(parseLocalElementUpdate(el));
    const onPlay = (): void => push({ state: "playing", ...parseLocalElementUpdate(el) });
    const onPause = (): void => push({ state: "paused", ...parseLocalElementUpdate(el) });
    const onEnded = (): void => push({ state: "stopped", currentTime: 0 });

    el.addEventListener("timeupdate", onTime);
    el.addEventListener("durationchange", onDuration);
    el.addEventListener("loadedmetadata", onDuration);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onEnded);

    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("durationchange", onDuration);
      el.removeEventListener("loadedmetadata", onDuration);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onEnded);
    };
  }, [src]);

  // Controller -> element: playback state commands (like the postMessage
  // playVideo/pauseVideo commands for the iframe).
  useEffect(() => {
    if (!src) return;
    const el = mediaRef.current;
    if (!el) return;
    if (state === "playing") {
      void el.play().catch(() => {
        /* autoplay/decoding failure — the element stays paused; the
         * controller state is reconciled by the next element event. */
      });
    } else {
      el.pause();
    }
  }, [src, state]);

  // Controller -> element: seek (like the iframe seekTo command).
  useEffect(() => {
    if (!src || positionS <= 0) return;
    const el = mediaRef.current;
    if (!el) return;
    if (Math.abs(el.currentTime - positionS) >= 0.5) {
      el.currentTime = positionS;
    }
  }, [src, positionS]);

  // Controller -> element: volume.
  useEffect(() => {
    if (!src) return;
    const el = mediaRef.current;
    if (!el) return;
    el.volume = Math.max(0, Math.min(1, volume));
  }, [src, volume]);

  return { mediaRef: mediaRef as RefObject<TElement> };
}
