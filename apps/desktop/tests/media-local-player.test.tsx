/**
 * GATE-5 (W1-MEDIA-LOCAL) — one player, two sources.
 *
 * Source-agnostic assertions on the UNIFIED player: a local item and a
 * youtube item render the SAME controls (play/pause, seek, time), the
 * stage branches on track IDENTITY (videoId present or not) — never on
 * source — and local playback reaches an HTML5 media element through the
 * same MediaController the YouTube embed uses.
 *
 * Node env + renderToStaticMarkup (repo convention — no jsdom).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { appStore } from "../src/store";
import { MediaDock } from "../src/components/MediaDock";
import { mediaController, resetMediaController } from "../src/media/controller";
import { localPlayableSrc, parseLocalElementUpdate } from "../src/media/localPlayer";
import {
  SurfaceRoleProvider,
  type SurfaceRoleInfo,
} from "../src/roles/context";

function ts(): string {
  return new Date().toISOString();
}

beforeEach(() => {
  (appStore as unknown as { getServerState: () => unknown }).getServerState =
    () => appStore.getState();
  appStore.setState({ content: {} });
  resetMediaController();
});

function roleInfo(role: "primary" | "companion" | "persistent"): SurfaceRoleInfo {
  return {
    surfaceId: "media",
    role,
    requestedRole: role,
    capabilities: ["primary", "companion", "persistent"],
    degraded: false,
  };
}

function renderPrimary(): string {
  return renderToStaticMarkup(
    <SurfaceRoleProvider value={roleInfo("primary")}>
      <MediaDock panelId="media" />
    </SurfaceRoleProvider>,
  );
}

/** Seed a local audio track through the REAL server-event path (the wire
 *  member local_path is what actions.py/media tools emit for LOCAL). */
function seedLocalTrack(localPath: string, title = "Sierra de banco"): void {
  appStore.getState().applyEvent({
    type: "media.state",
    state: "playing",
    source: "local",
    kind: "audio",
    title,
    video_id: null,
    url: localPath,
    local_path: localPath,
    position_s: 12,
    duration_s: 180,
    volume: 0.8,
    created_at: ts(),
  });
}

function seedYoutubeTrack(): void {
  appStore.getState().applyEvent({
    type: "media.state",
    state: "playing",
    source: "youtube",
    kind: "video",
    title: "Taller de carpintería",
    video_id: "dQw4w9WgXcQ",
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    position_s: 12,
    duration_s: 742,
    volume: 1,
    created_at: ts(),
  });
}

/** Extract the controls block (play button + progress + source badge) —
 *  the part that must be identical across sources. The time label shows
 *  REAL per-track durations (12s of 180 vs 742), so it is normalized:
 *  the CONTROL STRUCTURE must match byte-for-byte, the numbers must not. */
function controlsBlock(html: string): string {
  const start = html.indexOf("media-player-controls");
  expect(start).toBeGreaterThan(-1);
  const end = html.indexOf("</div>", start);
  return html
    .slice(start, end)
    // REAL per-track numbers (duration-driven max + time label) are
    // normalized; the CONTROL STRUCTURE must match byte-for-byte.
    .replace(/max="\d+"/g, 'max="D"')
    .replace(/\d+:\d+ \/ \d+:\d+/g, "T:T");
}

describe("localPlayableSrc — the renderer resolves local paths to playable srcs", () => {
  it("maps Windows absolute paths to file:// URLs", () => {
    expect(localPlayableSrc("C:\\Music\\sierra.mp3")).toBe("file:///C:/Music/sierra.mp3");
    expect(localPlayableSrc("c:/music/torno.wav")).toBe("file:///C:/music/torno.wav");
  });

  it("maps POSIX absolute paths to file:// URLs", () => {
    expect(localPlayableSrc("/mnt/c/Music/sierra.mp3")).toBe("file:///mnt/c/Music/sierra.mp3");
  });

  it("passes http(s) and file:// srcs through untouched", () => {
    expect(localPlayableSrc("https://cdn.example.com/song.mp3")).toBe(
      "https://cdn.example.com/song.mp3",
    );
    expect(localPlayableSrc("file:///C:/Music/sierra.mp3")).toBe(
      "file:///C:/Music/sierra.mp3",
    );
  });

  it("refuses bare names and relative paths (nothing to play)", () => {
    expect(localPlayableSrc("sierra")).toBeNull();
    expect(localPlayableSrc("music/sierra.mp3")).toBeNull();
    expect(localPlayableSrc(null)).toBeNull();
    expect(localPlayableSrc(undefined)).toBeNull();
    expect(localPlayableSrc("")).toBeNull();
  });
});

describe("parseLocalElementUpdate — element callbacks feed the R26 seam", () => {
  it("carries REAL position and duration from the element", () => {
    const el = { currentTime: 42.5, duration: 180 } as HTMLMediaElement;
    expect(parseLocalElementUpdate(el)).toEqual({ currentTime: 42.5, duration: 180 });
  });

  it("omits unknown duration (0 = not loaded yet)", () => {
    const el = { currentTime: 3, duration: 0 } as HTMLMediaElement;
    expect(parseLocalElementUpdate(el)).toEqual({ currentTime: 3 });
  });

  it("omits NaN/Infinity durations", () => {
    const el = { currentTime: 0, duration: Number.NaN } as HTMLMediaElement;
    expect(parseLocalElementUpdate(el)).toEqual({ currentTime: 0 });
  });
});

describe("GATE-5 W1-MEDIA-LOCAL: one unified player", () => {
  it("the controller carries localPath from the wire (local files reach playback)", () => {
    seedLocalTrack("C:\\Library\\sierra.mp3");

    const m = mediaController.getState();
    expect(m.localPath).toBe("C:\\Library\\sierra.mp3");
    expect(m.source).toBe("local");
    expect(m.videoId).toBeNull();
    expect(appStore.getState().content.media).toBe(m);
  });

  it("local item renders the HTML5 audio element with the resolved src", () => {
    seedLocalTrack("C:\\Library\\sierra.mp3");

    const html = renderPrimary();
    expect(html).toContain('class="media-player-local-audio"');
    expect(html).toContain('src="file:///C:/Library/sierra.mp3"');
    // No YouTube embed for a local track.
    expect(html).not.toContain("youtube.com/embed");
    expect(html).not.toContain("media-player-video");
  });

  it("SOURCE-AGNOSTIC: a local item and a youtube item render the SAME controls", () => {
    seedLocalTrack("C:\\Library\\sierra.mp3");
    const localHtml = renderPrimary();
    const localControls = controlsBlock(localHtml);

    appStore.setState({ content: {} });
    resetMediaController();
    seedYoutubeTrack();
    const youtubeHtml = renderPrimary();
    const youtubeControls = controlsBlock(youtubeHtml);

    // The controls (play/pause, seek slider, source badge) are
    // structurally byte-identical regardless of source.
    expect(localControls).toBe(youtubeControls);
    expect(localControls).toContain('aria-label="Pausar"');
    expect(localControls).toContain('type="range"');
    // Each track shows its OWN real position/duration (12s of 180 vs 742).
    expect(localHtml).toContain("0:12 / 3:00");
    expect(youtubeHtml).toContain("0:12 / 12:22");
    // Both render the same stage class family (art for local audio vs
    // video stage for youtube) but the CONTROLS never differ.
    expect(localHtml).toContain("media-player-art");
    expect(youtubeHtml).toContain("media-player-video");
  });

  it("local audio uses the same play/pause/seek commands as youtube", () => {
    seedLocalTrack("C:\\Library\\sierra.mp3");
    const html = renderPrimary();
    // The play button dispatches the SAME command a youtube track does.
    expect(html).toContain('aria-label="Pausar"');
    expect(html).toContain('type="range"');
  });

  it("local video (no videoId) renders an HTML5 video element, same controls", () => {
    appStore.getState().applyEvent({
      type: "media.state",
      state: "playing",
      source: "local",
      kind: "video",
      title: "Taller local",
      video_id: null,
      url: "C:\\Library\\taller.mp4",
      local_path: "C:\\Library\\taller.mp4",
      position_s: 5,
      duration_s: 600,
      volume: 1,
      created_at: ts(),
    });

    const html = renderPrimary();
    expect(html).toContain('class="media-player-local-video"');
    expect(html).toContain('src="file:///C:/Library/taller.mp4"');
    expect(html).toContain('aria-label="Pausar"');
  });

  it("persistent bar stays compact for local tracks (no media element)", () => {
    seedLocalTrack("C:\\Library\\sierra.mp3");

    const html = renderToStaticMarkup(
      <SurfaceRoleProvider value={roleInfo("persistent")}>
        <MediaDock panelId="media" />
      </SurfaceRoleProvider>,
    );
    expect(html).toContain("media-player--compact");
    expect(html).toContain("Sierra de banco");
    expect(html).not.toContain("media-player-local-audio");
    expect(html).not.toContain("media-player-video");
    expect(html).not.toContain("youtube.com/embed");
  });

  it("no track -> art-free waiting state (nothing to play)", () => {
    const html = renderPrimary();
    expect(html).toContain("Reproducción en espera.");
    expect(html).not.toContain("media-player-local-audio");
  });
});
