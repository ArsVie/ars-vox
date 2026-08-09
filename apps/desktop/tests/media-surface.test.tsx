/**
 * UI-205 — adaptive media surface (SSR render coverage).
 *
 * Renders MediaDock per semantic role (via SurfaceRoleProvider, the same
 * context SurfaceHost provides) and proves the contract acceptance:
 *   1. primary   -> large player (header, video stage/art, full controls).
 *   2. companion -> secondary visible media (player + controls, no header).
 *   3. persistent-> compact shell-level playback bar (title + play/pause +
 *      progress; no video stage, no art, no header, no source badge).
 *   4. THE key test: playback state (store.content.media via the real
 *      media.state event path) SURVIVES a primary -> persistent role
 *      transition — playing state, position and controls are all preserved.
 *   5. Role source of truth: the provider's RESOLVED role is authoritative —
 *      a degraded requestedRole renders the ladder output, never a
 *      component-side default.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { appStore } from "../src/store";
import { MediaDock } from "../src/components/MediaDock";
import { mediaController } from "../src/media/controller";
import {
  SurfaceRoleProvider,
  type SurfaceRoleInfo,
} from "../src/roles/context";

function ts(): string {
  return new Date().toISOString();
}

beforeEach(() => {
  (appStore as unknown as { getServerState: () => unknown }).getServerState = () =>
    appStore.getState();
  // Start every test with an empty content surface.
  appStore.setState({ content: {} });
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

function renderWithRole(role: "primary" | "companion" | "persistent"): string {
  return renderToStaticMarkup(
    <SurfaceRoleProvider value={roleInfo(role)}>
      <MediaDock panelId="media" />
    </SurfaceRoleProvider>,
  );
}

function seedPlayingMedia(): void {
  appStore.getState().applyEvent({
    type: "media.state",
    state: "playing",
    source: "local",
    kind: "audio",
    title: "Sinfonía",
    video_id: null,
    url: null,
    position_s: 60,
    duration_s: 300,
    volume: 0.8,
    created_at: ts(),
  });
}

describe("UI-205 MediaDock adaptive variants", () => {
  it("ONE media authority: tool path -> controller -> store subscription -> dock", () => {
    // The agent TOOL path: a server MediaStateEvent.
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

    // The store value IS the controller's state object — ONE authority,
    // no parallel mirror that could drift.
    expect(appStore.getState().content.media).toBe(mediaController.getState());
    expect(mediaController.getState().videoId).toBe("dQw4w9WgXcQ");

    // The dock renders the authoritative state.
    const html = renderWithRole("primary");
    expect(html).toContain("Taller de carpintería");
    expect(html).toContain('aria-label="Pausar"');
    expect(html).toContain(
      "youtube.com/embed/dQw4w9WgXcQ?enablejsapi=1&amp;autoplay=1",
    );

    // A second tool-path change (pause) lands in the CONTROLLER first…
    appStore.getState().applyEvent({
      type: "media.state",
      state: "paused",
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
    expect(mediaController.getState().state).toBe("paused");
    expect(appStore.getState().content.media).toBe(mediaController.getState());

    // …and the dock (re-rendered from the store subscription) reflects it.
    const pausedHtml = renderWithRole("primary");
    expect(pausedHtml).toContain('aria-label="Reproducir"');
    expect(pausedHtml).not.toContain('aria-label="Pausar"');
  });

  it("primary renders the large player with header and full controls", () => {
    seedPlayingMedia();
    const html = renderWithRole("primary");
    expect(html).toContain("media-dock");
    expect(html).toContain("data-media-variant=\"primary\"");
    expect(html).toContain("media-player");
    expect(html).toContain("media-player-art");
    expect(html).toContain('aria-label="Pausar"');
    expect(html).toContain("1:00 / 5:00");
    expect(html).toContain("media-player-source");
    expect(html).not.toContain("media-player--compact");
  });

  it("companion renders the player with controls but no header chrome", () => {
    seedPlayingMedia();
    const html = renderWithRole("companion");
    expect(html).toContain("media-dock--companion");
    expect(html).toContain("data-media-variant=\"companion\"");
    expect(html).toContain("media-player");
    expect(html).toContain('aria-label="Pausar"');
    expect(html).toContain("1:00 / 5:00");
    expect(html).not.toContain("media-player--compact");
  });

  it("persistent renders a compact playback bar — no stage, art or header", () => {
    seedPlayingMedia();
    const html = renderWithRole("persistent");
    expect(html).toContain("media-dock--persistent");
    expect(html).toContain("data-media-variant=\"persistent\"");
    expect(html).toContain("media-player--compact");
    expect(html).toContain("media-player-bar-title");
    expect(html).toContain("Sinfonía");
    expect(html).toContain('aria-label="Pausar"');
    expect(html).toContain('type="range"');
    // Minimal footprint: nothing that competes with the primary activity.
    expect(html).not.toContain("media-player-video");
    expect(html).not.toContain("media-player-art");
    expect(html).not.toContain("media-player-source");
    expect(html).not.toContain("youtube.com/embed");
    expect(html).not.toContain("media-player-time");
  });

  it("KEY: media state survives the primary -> persistent role transition", () => {
    seedPlayingMedia();

    // Watch the media surface as the PRIMARY activity (full player).
    const primaryHtml = renderWithRole("primary");
    expect(primaryHtml).toContain("media-player");
    expect(primaryHtml).toContain('aria-label="Pausar"');

    // Role change (same store, same surfaceId — no re-seed, no remount):
    // the same playback must continue in the compact persistent bar.
    const persistentHtml = renderWithRole("persistent");
    expect(persistentHtml).toContain("media-player--compact");
    // Playing state preserved (still Pausar, not Reproducir).
    expect(persistentHtml).toContain('aria-label="Pausar"');
    expect(persistentHtml).not.toContain('aria-label="Reproducir"');
    // Position/progress preserved (60s of 300s).
    expect(persistentHtml).toContain('value="60"');
    expect(persistentHtml).toContain('max="300"');
    // Controls remain accessible.
    expect(persistentHtml).toContain('type="range"');
    expect(persistentHtml).toContain("media-player-bar-title");
    // Store still holds the authoritative playback state.
    expect(appStore.getState().content.media?.state).toBe("playing");
    expect(appStore.getState().content.media?.positionS).toBe(60);
    expect(appStore.getState().content.media?.title).toBe("Sinfonía");
  });

  it("persistent bar shows the waiting state when nothing is playing", () => {
    const html = renderWithRole("persistent");
    expect(html).toContain("media-dock-empty");
    expect(html).toContain("Reproducción en espera.");
    expect(html).not.toContain("media-player--compact");
  });

  it("renders the RESOLVED role when the requested role was degraded (ladder output is authoritative)", () => {
    seedPlayingMedia();
    // A degraded request (requestedRole != role) must render the role the
    // host RESOLVED — never a component-side default. Here the ladder
    // resolved a persistent request down to primary.
    const html = renderToStaticMarkup(
      <SurfaceRoleProvider
        value={{
          surfaceId: "media",
          role: "primary",
          requestedRole: "persistent",
          capabilities: ["primary", "companion", "persistent"],
          degraded: true,
        }}
      >
        <MediaDock panelId="media" />
      </SurfaceRoleProvider>,
    );
    expect(html).toContain("media-dock");
    expect(html).toContain("media-player");
    expect(html).toContain('aria-label="Pausar"');
    expect(html).toContain("1:00 / 5:00");
    // Resolved role is primary: full dock, NOT the compact persistent bar.
    expect(html).toContain('data-media-variant="primary"');
    expect(html).not.toContain("media-player--compact");
  });
});
