import { useStore } from "zustand";

import type { PanelId } from "../layout/engine";
import type { PanelMeta } from "../store";
import { appStore, EMPTY_MEDIA } from "../store";
import { PanelHeader } from "./PanelHeader";
import { PauseIcon, PlayIcon, WaveformIcon, YoutubeIcon } from "./icons";

function fmtTime(total: number): string {
  const s = Math.max(0, Math.floor(total));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/**
 * Unified media player (dock or full) — ONE control surface for YouTube
 * videos and local music: play/pause, seek, elapsed/total, source badge.
 * The wire (media.state event) carries source youtube|local and kind
 * video|audio; the chrome never branches on it.
 */
export function MediaDock({ meta, panelId }: { meta?: PanelMeta; panelId: PanelId }) {
  const media = useStore(appStore, (s) => s.content.media);
  const dispatchCommand = useStore(appStore, (s) => s.dispatchCommand);

  const m = media ?? EMPTY_MEDIA;
  const hasTrack = m.title !== "" || m.videoId !== null || m.url !== null;
  const isVideo = m.kind === "video";
  const isPlaying = m.state === "playing";
  const progress = m.durationS > 0 ? Math.min(100, (m.positionS / m.durationS) * 100) : 0;

  const title = meta?.title ?? m.title ?? "Medios";

  return (
    <section className="panel media-dock" aria-label="Reproductor">
      <PanelHeader panelId={panelId} icon={<WaveformIcon size={15} />}>
        {title}
      </PanelHeader>
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
            <button
              type="button"
              className="media-play-btn"
              aria-label={isPlaying ? "Pausar" : "Reproducir"}
              disabled={m.state === "stopped"}
              onClick={() => dispatchCommand({ action: "media.play_pause" })}
            >
              {isPlaying ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
            </button>
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
              <span className="media-player-time">
                {fmtTime(m.positionS)} / {fmtTime(m.durationS)}
              </span>
            </div>
            <span className="media-player-source">
              {m.source === "youtube" ? "YouTube" : "Local"}
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
