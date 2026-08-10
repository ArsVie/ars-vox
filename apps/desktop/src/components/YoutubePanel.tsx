import { useStore } from "zustand";
import { useState } from "react";

import type { MediaSearchResult } from "../contracts";
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

function watchUrl(result: MediaSearchResult): string {
  return `https://www.youtube.com/watch?v=${result.id}`;
}

function VideoCard({
  video,
  onSelect,
}: {
  video: MediaSearchResult;
  onSelect: (video: MediaSearchResult) => void;
}) {
  return (
    <button
      type="button"
      className="youtube-card"
      onClick={() => onSelect(video)}
      aria-label={`Seleccionar: ${video.title}`}
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
 * YouTube search panel — the agent searches for real, results render as
 * SELECTABLE OPTIONS (vision line), and the user picks one by click
 * (media.select_result -> the ONE media controller -> playback in the
 * media panel) or by voice (the agent's media.play tool). The user can
 * also search directly here. A performed search with zero results is an
 * honest "no encontré nada" — never a fixture.
 */
export function YoutubePanel({
  meta,
  embedded,
}: {
  meta?: { title?: string };
  /** Mounted inside an existing panel surface (the media dock's idle
   * state): skip the outer panel shell + header — the dock provides its
   * own header. Search box + selectable cards stay. */
  embedded?: boolean;
}) {
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
  // A search has actually been performed (vs. the untouched panel).
  const searched = content !== undefined && content.query.length > 0;

  const selectCard = (video: MediaSearchResult): void => {
    // GATE-5 wire: the CLICK path is media.select_result — the server's
    // ONE media controller plays the card and opens the media panel.
    dispatchCommand({
      action: "media.select_result",
      result_id: video.id,
      source: video.source,
      kind: video.kind,
      title: video.title,
      url: video.source === "youtube" ? watchUrl(video) : undefined,
      local_path: video.local_path ?? undefined,
    });
  };

  return (
    <section
      className={embedded ? "youtube-panel youtube-panel--embedded" : "panel youtube-panel"}
    >
      {!embedded ? (
        <PanelHeader panelId="youtube" icon={<YoutubeIcon size={15} />}>
          {meta?.title ?? "YouTube"}
        </PanelHeader>
      ) : null}
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
              {searched
                ? `No encontré nada para «${content.query}».`
                : "Pídeme que busque un vídeo o escribe aquí arriba."}
            </span>
          </div>
        ) : (
          results.map((video) => (
            <VideoCard key={video.id} video={video} onSelect={selectCard} />
          ))
        )}
      </div>
    </section>
  );
}
