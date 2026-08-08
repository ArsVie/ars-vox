import { useStore } from "zustand";

import type { PanelId } from "../layout/engine";
import type { PanelMeta } from "../store";
import { appStore, EMPTY_MEDIA } from "../store";
import { useSurfaceRole, type SurfaceRoleInfo } from "../roles/context";
import { PanelHeader } from "./PanelHeader";
import { PauseIcon, PlayIcon, WaveformIcon, YoutubeIcon } from "./icons";

function fmtTime(total: number): string {
  const s = Math.max(0, Math.floor(total));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
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
 *
 * Legacy path: PanelHost and direct renders mount MediaDock without a
 * SurfaceRoleProvider; the safe read falls back to the classic full dock
 * rendering (existing DOM contracts .media-dock / .media-player kept).
 */
export function MediaDock({ meta, panelId }: { meta?: PanelMeta; panelId: PanelId }) {
  const media = useStore(appStore, (s) => s.content.media);
  const dispatchCommand = useStore(appStore, (s) => s.dispatchCommand);

  const roleInfo = useOptionalSurfaceRole();
  const role = roleInfo?.role ?? "primary";

  const m = media ?? EMPTY_MEDIA;
  const hasTrack = m.title !== "" || m.videoId !== null || m.url !== null;
  const isVideo = m.kind === "video";
  const isPlaying = m.state === "playing";
  const progress = m.durationS > 0 ? Math.min(100, (m.positionS / m.durationS) * 100) : 0;

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
                src={`https://www.youtube.com/embed/${m.videoId}?autoplay=${isPlaying ? 1 : 0}`}
                title={m.title}
                allow="autoplay; encrypted-media; picture-in-picture"
                allowFullScreen
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

/**
 * Safe role read: surfaces mounted through the role host (roles/host.tsx)
 * receive SurfaceRoleInfo via context. Legacy mounts (PanelHost, direct
 * renders, SSR tests) have no provider — useSurfaceRole() throws there, so
 * this returns null and the surface falls back to its classic rendering.
 * The hook is still called unconditionally (hook-order stable); the throw is
 * caught locally.
 */
function useOptionalSurfaceRole(): SurfaceRoleInfo | null {
  try {
    return useSurfaceRole();
  } catch {
    return null;
  }
}
