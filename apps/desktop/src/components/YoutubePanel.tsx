import { useStore } from "zustand";
import { useState } from "react";

import type { YoutubeVideoResult } from "../contracts";
import { appStore, type YoutubeContent } from "../store";
import { PanelHeader } from "./PanelHeader";
import { PlayIcon, SearchIcon, YoutubeIcon } from "./icons";

function fmtDuration(total: number): string {
  const s = Math.max(0, Math.floor(total));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function VideoCard({
  video,
  onPlay,
}: {
  video: YoutubeVideoResult;
  onPlay: (video: YoutubeVideoResult) => void;
}) {
  return (
    <button
      type="button"
      className="youtube-card"
      onClick={() => onPlay(video)}
      aria-label={`Reproducir: ${video.title}`}
    >
      <span className="youtube-thumb">
        {video.thumbnail_url ? <img src={video.thumbnail_url} alt="" loading="lazy" /> : null}
        <span className="youtube-duration">{fmtDuration(video.duration_s)}</span>
      </span>
      <span className="youtube-card-body">
        <span className="youtube-card-title">{video.title}</span>
        <span className="youtube-card-meta">
          {video.channel} · {video.published}
        </span>
      </span>
      <span className="youtube-card-play" aria-hidden>
        <PlayIcon size={15} />
      </span>
    </button>
  );
}

/**
 * YouTube search panel — the agent searches, results render as selectable
 * options, and the user picks one (click now, voice later). Playback goes
 * to the media panel. The user can also search directly here.
 */
export function YoutubePanel({ meta }: { meta?: { title?: string } }) {
  const youtube = useStore(appStore, (s) => s.content.youtube);
  const dispatchCommand = useStore(appStore, (s) => s.dispatchCommand);
  const [query, setQuery] = useState("");

  const runSearch = (text: string): void => {
    const q = text.trim();
    if (!q) return;
    dispatchCommand({ action: "youtube.search", query: q });
  };

  const content: YoutubeContent | undefined = youtube;
  const results = content?.results ?? [];
  const loading = content?.loading ?? false;

  return (
    <section className="panel youtube-panel">
      <PanelHeader panelId="youtube" icon={<YoutubeIcon size={15} />}>
        {meta?.title ?? "YouTube"}
      </PanelHeader>
      <div className="youtube-search">
        <SearchIcon size={15} className="youtube-search-icon" />
        <input
          type="text"
          value={query}
          placeholder="Busca un vídeo…"
          aria-label="Buscar en YouTube"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") runSearch(query);
          }}
        />
        <button type="button" className="youtube-search-btn" onClick={() => runSearch(query)}>
          Buscar
        </button>
      </div>
      <div className="youtube-results">
        {loading ? (
          <div className="content-loading">
            <span className="content-loading-pulse" />
            <span>Buscando…</span>
          </div>
        ) : results.length === 0 ? (
          <div className="content-panel-empty">
            <span className="content-panel-empty-icon">
              <YoutubeIcon size={30} />
            </span>
            <span className="content-panel-empty-text">
              Pídeme que busque un vídeo o escribe aquí arriba.
            </span>
          </div>
        ) : (
          results.map((video) => (
            <VideoCard
              key={video.id}
              video={video}
              onPlay={(v) =>
                dispatchCommand({ action: "youtube.play", video_id: v.id, title: v.title })
              }
            />
          ))
        )}
      </div>
    </section>
  );
}
