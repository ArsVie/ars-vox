/**
 * H7 (GATE-2.5) — media command/event wiring + real YouTube player control.
 *
 * Covers the two halves of the media hardening:
 *
 *   1. The backend media command path is no longer dropped: UiCommandEvent
 *      media.state / audio.play (emitted by services/agent media tools) now
 *      merge into the same store.content.media surface the MediaStateEvent
 *      path populates, and the surface renders that state.
 *   2. The YouTube embed is controlled as a real player: a STABLE iframe
 *      src with the IFrame Player API protocol (enablejsapi=1 + postMessage
 *      commands) — no URL swap on play/pause — plus the pure protocol
 *      helpers (command serialization / infoDelivery parsing) that the
 *      browser-side message channel runs on.
 *
 * Node env + renderToStaticMarkup (repo convention — no jsdom).
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { appStore } from "../src/store";
import { resetMediaController } from "../src/media/controller";
import {
  MediaDock,
  parseYoutubePlayerEvent,
  youtubeCommandMessage,
  youtubeEmbedSrc,
} from "../src/components/MediaDock";
import type { ServerEvent, UiCommand } from "../src/contracts";
import {
  SurfaceRoleProvider,
  type SurfaceRoleInfo,
} from "../src/roles/context";
import type { SurfaceRole } from "../src/adaptive/contracts";

function ts(): string {
  return new Date().toISOString();
}

/** Capabilities the media surface declares in the shared registry. */
const MEDIA_ROLES: readonly SurfaceRole[] = [
  "primary",
  "companion",
  "persistent",
];

function roleInfo(
  surfaceId: string,
  capabilities: readonly SurfaceRole[],
): SurfaceRoleInfo {
  return {
    surfaceId,
    role: "primary",
    requestedRole: "primary",
    capabilities,
    degraded: false,
  };
}

/** Mount a panel as the PRIMARY surface (full variant) — the W2-SURFACES
 *  contract: surfaces render inside a SurfaceRoleProvider (same pattern
 *  as tests/media-surface.test.tsx). */
function renderPrimary(
  node: ReactNode,
  surfaceId: string,
  capabilities: readonly SurfaceRole[],
): string {
  return renderToStaticMarkup(
    <SurfaceRoleProvider value={roleInfo(surfaceId, capabilities)}>
      {node}
    </SurfaceRoleProvider>,
  );
}

/** A backend ui_command event carrying the given command. */
function uiCommandEvent(command: UiCommand): ServerEvent {
  return { type: "ui_command", command, created_at: ts() };
}

beforeEach(() => {
  (appStore as unknown as { getServerState: () => unknown }).getServerState =
    () => appStore.getState();
  appStore.setState({ content: {} });
  // GATE-3.5: the media controller is the single authority — a test that
  // clears the store mirror must clear it too, or stale controller state
  // leaks into the next test.
  resetMediaController();
});

describe("H7: applyUiCommand media.state wires the media surface", () => {
  it("media.state playing with a YouTube url drives the video surface (videoId derived)", () => {
    appStore.getState().applyUiCommand({
      action: "media.state",
      state: "playing",
      title: "Pasta fresca en casa",
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    });

    const m = appStore.getState().content.media;
    expect(m?.state).toBe("playing");
    expect(m?.title).toBe("Pasta fresca en casa");
    expect(m?.videoId).toBe("dQw4w9WgXcQ");
    expect(m?.source).toBe("youtube");
    expect(m?.kind).toBe("video");
    expect(m?.url).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });

  it("media.state via the full backend event path (ui_command) reaches the surface", () => {
    appStore.getState().applyEvent(
      uiCommandEvent({
        action: "media.state",
        state: "paused",
        title: "Risotto cremoso",
        url: "https://www.youtube.com/embed/9bZkp7q19f0",
      }),
    );

    const m = appStore.getState().content.media;
    expect(m?.state).toBe("paused");
    expect(m?.title).toBe("Risotto cremoso");
    expect(m?.videoId).toBe("9bZkp7q19f0");
    expect(m?.source).toBe("youtube");
  });

  it("partial media.state merges (pause without url keeps the track identity)", () => {
    appStore.getState().applyUiCommand({
      action: "media.state",
      state: "playing",
      title: "Sinfonía",
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      volume: 0.8,
    });
    appStore.getState().applyUiCommand({ action: "media.state", state: "paused" });

    const m = appStore.getState().content.media;
    expect(m?.state).toBe("paused");
    expect(m?.title).toBe("Sinfonía");
    expect(m?.videoId).toBe("dQw4w9WgXcQ");
    expect(m?.source).toBe("youtube");
    expect(m?.kind).toBe("video");
    expect(m?.volume).toBe(0.8);
  });

  it("non-YouTube media.state url stays a local audio track", () => {
    appStore.getState().applyUiCommand({
      action: "media.state",
      state: "playing",
      title: "Big Buck Bunny",
      url: "https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    });

    const m = appStore.getState().content.media;
    expect(m?.state).toBe("playing");
    expect(m?.videoId).toBeNull();
    expect(m?.source).toBe("local");
    expect(m?.kind).toBe("audio");
  });

  it("audio.play surfaces the asset as a local audio track", () => {
    appStore.getState().applyUiCommand({
      action: "audio.play",
      asset: "https://cdn.example.com/sfx/woodshop/chime.mp3",
    });

    const m = appStore.getState().content.media;
    expect(m?.state).toBe("playing");
    expect(m?.source).toBe("local");
    expect(m?.kind).toBe("audio");
    expect(m?.title).toBe("chime.mp3");
    expect(m?.url).toBe("https://cdn.example.com/sfx/woodshop/chime.mp3");
    expect(m?.videoId).toBeNull();
    expect(m?.positionS).toBe(0);
  });

  it("audio.play with a bare asset name keeps an existing track url", () => {
    appStore.getState().applyUiCommand({
      action: "media.state",
      state: "paused",
      title: "Taller de carpintería",
      url: "https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    });
    appStore.getState().applyUiCommand({ action: "audio.play", asset: "ding" });

    const m = appStore.getState().content.media;
    expect(m?.state).toBe("playing");
    expect(m?.title).toBe("Taller de carpintería"); // existing title wins
    expect(m?.url).toBe(
      "https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    );
  });
});

describe("H7: the media surface renders backend-commanded state", () => {
  it("dock shows the title and playing state from a media.state command", () => {
    appStore.getState().applyEvent(
      uiCommandEvent({
        action: "media.state",
        state: "playing",
        title: "Taller de carpintería",
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      }),
    );

    const html = renderPrimary(<MediaDock panelId="media" />, "media", MEDIA_ROLES);
    expect(html).toContain("media-dock");
    expect(html).toContain("Taller de carpintería");
    expect(html).toContain('aria-label="Pausar"');
    expect(html).not.toContain("Reproducción en espera.");
  });

  it("empty surface still shows the waiting state", () => {
    const html = renderPrimary(<MediaDock panelId="media" />, "media", MEDIA_ROLES);
    expect(html).toContain("Reproducción en espera.");
  });
});

describe("H7: real YouTube player control (no URL swap)", () => {
  it("embed src is the stable player-API URL — paused mounts carry NO autoplay", () => {
    appStore.getState().applyUiCommand({
      action: "media.state",
      state: "paused",
      title: "Pasta",
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    });

    const html = renderPrimary(<MediaDock panelId="media" />, "media", MEDIA_ROLES);
    // enablejsapi=1: the postMessage channel is open; the legacy URL swap
    // (autoplay=0 marker on pause) is gone.
    expect(html).toContain("youtube.com/embed/dQw4w9WgXcQ?enablejsapi=1");
    expect(html).not.toContain("autoplay=0");
    expect(html).toContain('data-youtube-control="postmessage"');
  });

  it("playing mounts carry autoplay=1 ONLY as mount-time intent (keyed by videoId)", () => {
    appStore.getState().applyUiCommand({
      action: "media.state",
      state: "playing",
      title: "Pasta",
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    });

    const html = renderPrimary(<MediaDock panelId="media" />, "media", MEDIA_ROLES);
    expect(html).toContain("youtube.com/embed/dQw4w9WgXcQ?enablejsapi=1&amp;autoplay=1");
    // Same video id, same key — toggling state never remounts the embed.
    expect(html).toContain('data-youtube-control="postmessage"');
  });

  it("same video + same mount state renders byte-identical markup (deterministic)", () => {
    appStore.getState().applyUiCommand({
      action: "media.state",
      state: "paused",
      title: "Pasta",
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    });
    const a = renderPrimary(<MediaDock panelId="media" />, "media", MEDIA_ROLES);
    const b = renderPrimary(<MediaDock panelId="media" />, "media", MEDIA_ROLES);
    expect(a).toBe(b);
  });

  it("youtubeEmbedSrc builds the stable player-API url", () => {
    expect(youtubeEmbedSrc("dQw4w9WgXcQ", false)).toBe(
      "https://www.youtube.com/embed/dQw4w9WgXcQ?enablejsapi=1",
    );
    expect(youtubeEmbedSrc("dQw4w9WgXcQ", true)).toBe(
      "https://www.youtube.com/embed/dQw4w9WgXcQ?enablejsapi=1&autoplay=1",
    );
  });

  it("youtubeCommandMessage serializes IFrame Player API commands", () => {
    expect(youtubeCommandMessage("playVideo")).toBe(
      '{"event":"command","func":"playVideo","args":[]}',
    );
    expect(youtubeCommandMessage("seekTo", [42])).toBe(
      '{"event":"command","func":"seekTo","args":[42]}',
    );
  });

  it("parseYoutubePlayerEvent reads readiness and playerState deliveries", () => {
    expect(parseYoutubePlayerEvent({ event: "onReady" })).toEqual({ kind: "ready" });
    expect(parseYoutubePlayerEvent({ event: "initialDelivery" })).toEqual({
      kind: "ready",
    });
    expect(
      parseYoutubePlayerEvent({ event: "infoDelivery", info: { playerState: 1 } }),
    ).toEqual({ kind: "state", state: "playing" });
    expect(
      parseYoutubePlayerEvent({ event: "infoDelivery", info: { playerState: 2 } }),
    ).toEqual({ kind: "state", state: "paused" });
    expect(
      parseYoutubePlayerEvent({ event: "infoDelivery", info: { playerState: 0 } }),
    ).toEqual({ kind: "state", state: "stopped" });
    // Buffering / unstarted / garbage are not playback-state signals.
    expect(
      parseYoutubePlayerEvent({ event: "infoDelivery", info: { playerState: 3 } }),
    ).toEqual({ kind: "unknown" });
    expect(parseYoutubePlayerEvent("not json")).toEqual({ kind: "unknown" });
    expect(parseYoutubePlayerEvent(null)).toEqual({ kind: "unknown" });
    expect(parseYoutubePlayerEvent({ event: "onError" })).toEqual({ kind: "unknown" });
  });

  it("R26: infoDelivery carries REAL currentTime/duration for the controller", () => {
    expect(
      parseYoutubePlayerEvent({
        event: "infoDelivery",
        info: { playerState: 1, currentTime: 12.5, videoData: { duration: 742 } },
      }),
    ).toEqual({ kind: "state", state: "playing", currentTime: 12.5, duration: 742 });
    // Time-only deliveries (poll responses) become kind "time".
    expect(
      parseYoutubePlayerEvent({ event: "infoDelivery", info: { currentTime: 33.25 } }),
    ).toEqual({ kind: "time", currentTime: 33.25 });
    // getDuration responses carry info.duration.
    expect(
      parseYoutubePlayerEvent({ event: "infoDelivery", info: { duration: 495 } }),
    ).toEqual({ kind: "time", duration: 495 });
    // initialDelivery seeds position + duration on load.
    expect(
      parseYoutubePlayerEvent({
        event: "initialDelivery",
        info: { currentTime: 1.5, videoData: { duration: 300 } },
      }),
    ).toEqual({ kind: "ready", currentTime: 1.5, duration: 300 });
  });
});
