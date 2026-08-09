import { useEffect, useRef, useState, type RefObject } from "react";
import { useStore } from "zustand";

import type { MediaState } from "../contracts";
import type { PanelId } from "../layout/engine";
import type { PanelMeta } from "../store";
import { appStore, EMPTY_MEDIA } from "../store";
import { useSurfaceRole } from "../roles/context";
import { PanelHeader } from "./PanelHeader";
import { PauseIcon, PlayIcon, WaveformIcon, YoutubeIcon } from "./icons";

function fmtTime(total: number): string {
  const s = Math.max(0, Math.floor(total));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ */
/* H7 (GATE-2.5) — real YouTube player control via the IFrame Player   */
/* API postMessage protocol.                                           */
/*                                                                     */
/* The embed iframe is created ONCE per video (keyed by videoId) with  */
/* a STABLE src (enablejsapi=1, autoplay fixed at mount time from the  */
/* current state). After mount the src NEVER changes — play/pause/seek */
/* are sent to the SAME iframe instance as postMessage commands, and   */
/* player-originated state changes come back as infoDelivery messages  */
/* and are merged into store.content.media (the same surface state the */
/* backend media.state path feeds). No URL swap on play/pause.         */
/*                                                                     */
/* NETWORK-FALLBACK (stop condition, marked): the postMessage channel  */
/* is only trusted after the player signals readiness (onReady). If no */
/* readiness signal arrives within YT_PLAYER_READY_GRACE_MS (offline / */
/* embed blocked), the control mode falls back to the legacy URL-swap  */
/* behavior: the src reflects autoplay from the live state, so toggling */
/* play/pause reloads the embed (old behavior, still functional). The  */
/* active mode is visible on the iframe as data-youtube-control.       */
/* ------------------------------------------------------------------ */

const YOUTUBE_EMBED_BASE = "https://www.youtube.com/embed";
/** Grace period before falling back to the legacy URL-swap behavior. */
export const YT_PLAYER_READY_GRACE_MS = 5000;

/** Stable embed URL for the player-API protocol (no URL swap on toggle). */
export function youtubeEmbedSrc(videoId: string, autoplay: boolean): string {
  const params = new URLSearchParams({ enablejsapi: "1" });
  if (autoplay) params.set("autoplay", "1");
  return `${YOUTUBE_EMBED_BASE}/${videoId}?${params.toString()}`;
}

/** Serialized IFrame Player API command for postMessage. */
export function youtubeCommandMessage(func: string, args: unknown[] = []): string {
  return JSON.stringify({ event: "command", func, args });
}

export type YoutubePlayerEvent =
  | { kind: "ready"; currentTime?: number; duration?: number }
  | { kind: "state"; state: MediaState; currentTime?: number; duration?: number }
  | { kind: "time"; currentTime?: number; duration?: number }
  | { kind: "unknown" };

/**
 * Parse an IFrame Player API postMessage payload (pure, unit-testable).
 *
 * GATE-3.5 (R26): infoDelivery carries REAL player data — currentTime and
 * duration (videoData) — which the controller consumes so the progress
 * bar reflects the actual iframe. Keys are only present when the payload
 * carries them (undefined keys are never emitted).
 */
export function parseYoutubePlayerEvent(data: unknown): YoutubePlayerEvent {
  if (!data || typeof data !== "object") return { kind: "unknown" };
  const ev = data as Record<string, unknown>;
  const info = ev.info && typeof ev.info === "object" ? (ev.info as Record<string, unknown>) : null;

  const timeInfo = (): { currentTime?: number; duration?: number } => {
    if (!info) return {};
    const out: { currentTime?: number; duration?: number } = {};
    if (typeof info.currentTime === "number") out.currentTime = info.currentTime;
    const rawDuration =
      typeof info.duration === "number" ? info.duration : undefined;
    const videoData =
      info.videoData && typeof info.videoData === "object"
        ? (info.videoData as Record<string, unknown>)
        : null;
    const videoDuration =
      videoData && typeof videoData.duration === "number" ? videoData.duration : undefined;
    const duration = rawDuration ?? videoDuration;
    if (typeof duration === "number" && duration > 0) out.duration = duration;
    return out;
  };

  if (ev.event === "onReady") return { kind: "ready" };
  if (ev.event === "initialDelivery") {
    return { kind: "ready", ...timeInfo() };
  }
  if (ev.event === "infoDelivery" && info) {
    if (info.playerState === 1) return { kind: "state", state: "playing", ...timeInfo() };
    if (info.playerState === 2) return { kind: "state", state: "paused", ...timeInfo() };
    if (info.playerState === 0) return { kind: "state", state: "stopped", ...timeInfo() };
    const t = timeInfo();
    if (t.currentTime !== undefined || t.duration !== undefined) {
      return { kind: "time", ...t };
    }
  }
  return { kind: "unknown" };
}

export type YoutubeControlMode = "postmessage" | "urlswap";

function postCommand(iframe: HTMLIFrameElement, func: string, args: unknown[] = []): void {
  iframe.contentWindow?.postMessage(youtubeCommandMessage(func, args), "*");
}

/**
 * H7 — control the EXISTING YouTube embed (never remount, never swap src).
 * Returns the iframe ref (attach to the <iframe>) and the active control
 * mode. SSR-safe: without window / before mount the hook is inert.
 */
function useYoutubePlayer(
  videoId: string | null,
  state: MediaState,
  positionS: number,
): { iframeRef: RefObject<HTMLIFrameElement>; controlMode: YoutubeControlMode } {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [controlMode, setControlMode] = useState<YoutubeControlMode>("postmessage");
  const readyRef = useRef(false);
  const stateRef = useRef(state);
  const positionRef = useRef(positionS);
  const pendingRef = useRef<{ func: string; args: unknown[] } | null>(null);

  useEffect(() => {
    stateRef.current = state;
  });
  useEffect(() => {
    positionRef.current = positionS;
  });

  // Wire the message channel once per video: onReady -> flush pending
  // commands + sync the player to the store; infoDelivery playerState ->
  // merge into the store (player's own controls stay authoritative).
  useEffect(() => {
    if (!videoId) return undefined;
    readyRef.current = false;
    setControlMode("postmessage");
    const iframe = iframeRef.current;
    if (!iframe || typeof window === "undefined") return undefined;

    const markReady = (): void => {
      if (readyRef.current) return;
      readyRef.current = true;
      setControlMode("postmessage");
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (pending) postCommand(iframe, pending.func, pending.args);
      if (stateRef.current === "playing") postCommand(iframe, "playVideo");
      else if (stateRef.current === "paused") postCommand(iframe, "pauseVideo");
      if (positionRef.current > 0) postCommand(iframe, "seekTo", [positionRef.current]);
    };

    const onMessage = (event: MessageEvent): void => {
      if (event.source !== iframe.contentWindow) return;
      if (!event.origin.endsWith("youtube.com")) return;
      let data: unknown;
      try {
        data = JSON.parse(String(event.data));
      } catch {
        return;
      }
      const parsed = parseYoutubePlayerEvent(data);
      if (parsed.kind === "ready") {
        markReady();
        if (parsed.currentTime !== undefined || parsed.duration !== undefined) {
          appStore.getState().applyPlayerMediaEvent({
            currentTime: parsed.currentTime,
            duration: parsed.duration,
          });
        }
        return;
      }
      if (parsed.kind === "state" || parsed.kind === "time") {
        // GATE-3.5 (R26): the player's REAL callbacks feed the single
        // MediaController — playback state (the player's own controls)
        // and currentTime/duration (progress bar) both come from the
        // iframe. No React-only simulated playback state anywhere.
        appStore.getState().applyPlayerMediaEvent({
          state:
            parsed.kind === "state" && parsed.state !== stateRef.current
              ? parsed.state
              : undefined,
          currentTime: parsed.currentTime,
          duration: parsed.duration,
        });
      }
    };

    window.addEventListener("message", onMessage);
    const timer = window.setTimeout(() => {
      // NETWORK-FALLBACK: no readiness signal -> legacy URL-swap mode.
      if (!readyRef.current) setControlMode("urlswap");
    }, YT_PLAYER_READY_GRACE_MS);

    // GATE-3.5 (R26): while the player is ready and playing, poll the
    // real currentTime/duration so the progress bar tracks the iframe
    // even without user interaction. Responses arrive as infoDelivery
    // messages parsed above.
    const poller = window.setInterval(() => {
      if (!readyRef.current || stateRef.current !== "playing") return;
      postCommand(iframe, "getCurrentTime");
      postCommand(iframe, "getDuration");
    }, 1000);

    return () => {
      window.removeEventListener("message", onMessage);
      window.clearTimeout(timer);
      window.clearInterval(poller);
    };
  }, [videoId]);

  // Store state -> player command (postmessage mode only).
  useEffect(() => {
    if (state === "stopped" || !videoId) return;
    const iframe = iframeRef.current;
    if (!iframe) return;
    if (readyRef.current) {
      postCommand(iframe, state === "playing" ? "playVideo" : "pauseVideo");
      return;
    }
    // Not ready yet: keep the most recent intent; flushed on onReady.
    pendingRef.current = {
      func: state === "playing" ? "playVideo" : "pauseVideo",
      args: [],
    };
  }, [state, videoId]);

  // Store position -> player command (seek follows the slider/backend).
  useEffect(() => {
    if (positionS <= 0 || !videoId) return;
    const iframe = iframeRef.current;
    if (!iframe) return;
    if (readyRef.current) {
      postCommand(iframe, "seekTo", [Math.floor(positionS)]);
      return;
    }
    pendingRef.current = { func: "seekTo", args: [Math.floor(positionS)] };
  }, [positionS, videoId]);

  return { iframeRef, controlMode };
}

/**
 * UI-205 — adaptive media surface.
 *
 * One unified player (YouTube + local media) that renders per its semantic
 * role (read via useSurfaceRole):
 *   - primary   -> large player: header + video stage/art + full controls.
 *   - companion -> secondary visible media: same player, header dropped so
 *                  it clearly reduces visual dominance next to the primary.
 *   - persistent-> compact shell-level playback bar (hosted by
 *                  PersistentRegions): title + play/pause + progress only —
 *                  no video stage, no art, no header, no source badge — so
 *                  it never competes with the current primary activity.
 *
 * Playback state ALWAYS lives in store.content.media (the media.state event
 * path); role changes never touch it, so primary -> persistent keeps
 * playing without a reset. The component is mounted by the role host keyed
 * by surfaceId (never remounted on role change) — see roles/host.tsx.
 * The adaptive mount is the ONLY mount: every MediaDock instance renders
 * inside a SurfaceRoleProvider.
 */
export function MediaDock({ meta, panelId }: { meta?: PanelMeta; panelId: PanelId }) {
  const media = useStore(appStore, (s) => s.content.media);
  const dispatchCommand = useStore(appStore, (s) => s.dispatchCommand);

  const { role } = useSurfaceRole();

  const m = media ?? EMPTY_MEDIA;
  const hasTrack = m.title !== "" || m.videoId !== null || m.url !== null;
  const isVideo = m.kind === "video";
  const isPlaying = m.state === "playing";
  const progress = m.durationS > 0 ? Math.min(100, (m.positionS / m.durationS) * 100) : 0;

  // H7 (GATE-2.5): real YouTube control. The hook drives the EXISTING
  // iframe via the player-API postMessage protocol; autoplay is fixed at
  // mount time only (keyed by videoId, so a NEW video remounts fresh).
  const { iframeRef, controlMode } = useYoutubePlayer(m.videoId, m.state, m.positionS);
  const [initialAutoplay] = useState(() => m.state === "playing");

  const title = meta?.title ?? m.title ?? "Medios";

  const playPauseButton = (
    <button
      type="button"
      className="media-play-btn"
      aria-label={isPlaying ? "Pausar" : "Reproducir"}
      disabled={m.state === "stopped"}
      onClick={() => dispatchCommand({ action: "media.play_pause" })}
    >
      {isPlaying ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
    </button>
  );

  const progressControl = (
    <div className="media-player-progress">
      <input
        type="range"
        min={0}
        max={Math.max(1, m.durationS)}
        value={Math.min(m.positionS, m.durationS)}
        aria-label="Posición"
        onChange={(e) =>
          dispatchCommand({ action: "media.seek", position_s: Number(e.target.value) })
        }
      />
      {role !== "persistent" ? (
        <span className="media-player-time">
          {fmtTime(m.positionS)} / {fmtTime(m.durationS)}
        </span>
      ) : null}
    </div>
  );

  // Persistent: compact shell-level playback bar (persistent media host).
  // Title + play/pause + progress, nothing that competes with the primary
  // activity — no video stage, no art, no header, no source badge.
  if (role === "persistent") {
    return (
      <section
        className="media-dock media-dock--persistent"
        data-media-variant="persistent"
        aria-label="Reproductor"
      >
        {!hasTrack ? (
          <div className="media-dock-body">
            <span className="media-dock-empty">Reproducción en espera.</span>
          </div>
        ) : (
          <div className="media-player media-player--compact">
            <span className="media-player-bar-title" title={m.title}>
              {m.title || (m.source === "youtube" ? "YouTube" : "Local")}
            </span>
            {playPauseButton}
            {progressControl}
          </div>
        )}
      </section>
    );
  }

  // companion: secondary visible media — same player, header removed to
  // reduce visual dominance next to the primary activity.
  const isCompanion = role === "companion";

  return (
    <section
      className={`panel media-dock${isCompanion ? " media-dock--companion" : ""}`}
      data-media-variant={isCompanion ? "companion" : "primary"}
      aria-label="Reproductor"
    >
      {!isCompanion ? (
        <PanelHeader panelId={panelId} icon={<WaveformIcon size={15} />}>
          {title}
        </PanelHeader>
      ) : null}
      {!hasTrack ? (
        <div className="media-dock-body">
          <span className="media-dock-empty">Reproducción en espera.</span>
        </div>
      ) : (
        <div className="media-player">
          {isVideo && m.videoId ? (
            <div className="media-player-video">
              <iframe
                key={m.videoId}
                ref={iframeRef}
                src={
                  controlMode === "urlswap"
                    ? youtubeEmbedSrc(m.videoId, isPlaying) // NETWORK-FALLBACK (legacy URL swap)
                    : youtubeEmbedSrc(m.videoId, initialAutoplay) // stable — no swap on toggle
                }
                title={m.title}
                allow="autoplay; encrypted-media; picture-in-picture"
                allowFullScreen
                data-youtube-control={controlMode}
              />
            </div>
          ) : (
            <div className="media-player-art">
              {m.source === "youtube" ? (
                <YoutubeIcon size={26} />
              ) : (
                <WaveformIcon size={26} />
              )}
            </div>
          )}
          <div className="media-player-controls">
            {playPauseButton}
            {progressControl}
            <span className="media-player-source">
              {m.source === "youtube" ? "YouTube" : "Local"}
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
