/**
 * H1/C1 fixture bridge (client side): every action string in the TS
 * ClientCommand union (the NARROWED client-sendable subset of UiCommand)
 * must have exactly one frame in the shared fixture
 * packages/contracts/fixtures/client_actions.json, and no frame may
 * reference an action the union does not know.
 *
 * Server-originated commands (notification.show, media.state,
 * tts.speak, audio.play) are deliberately NOT client frames — the
 * full UiCommand union keeps them for the server->client channel only.
 *
 * The fixture is the cross-language contract: tests/python/test_client_actions.py
 * parses every frame through parse_client_message on the Python side
 * and fails if any declared ClientAction lacks an authoritative handler
 * (R39), so if an action string drifts here, this test (missing
 * fixture) and the Python test (unknown action) both fail. Never
 * regenerate the fixture on one side only.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { ClientCommand } from "../src/contracts";

const FIXTURE_PATH = new URL(
  "../../../packages/contracts/fixtures/client_actions.json",
  import.meta.url,
);

interface FixtureFrame {
  type: string;
  command: { action: string };
}

type FixtureFile = Record<string, FixtureFrame>;

/** One typed value per ClientCommand union member — compile-time coverage. */
const ALL_ACTIONS: ClientCommand[] = [
  {
    action: "layout.apply",
    template: "split",
    primary_panel: "document_editor",
    secondary_panel: "conversation",
  },
  { action: "panel.open", panel_type: "document_editor", title: "Notas" },
  { action: "panel.close", panel_type: "document_editor" },
  { action: "panel.set_primary", panel_type: "browser" },
  { action: "panel.fullscreen", panel_type: "media" },
  { action: "layout.restore" },
  { action: "media.play_pause" },
  { action: "media.seek", position_s: 42 },
  {
    action: "media.select_result",
    result_id: "dQw4w9WgXcQ",
    source: "youtube",
    kind: "video",
    title: "Taller",
  },
  { action: "youtube.search", query: "carpintería" },
  { action: "youtube.play", video_id: "yt-1", title: "Taller" },
  { action: "browser.navigate", url: "https://example.com/docs" },
  { action: "browser.back" },
  { action: "browser.forward" },
  { action: "browser.refresh" },
  { action: "document.save", panel_type: "document_editor", content: "## Notas" },
  { action: "tasks.toggle", task_id: "1" },
];

describe("H1/C1 client action fixture conformance", () => {
  const fixtures = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as FixtureFile;

  it("every ClientCommand action string has a fixture frame", () => {
    for (const cmd of ALL_ACTIONS) {
      const frame = fixtures[cmd.action];
      expect(frame, `missing fixture frame for ${cmd.action}`).toBeDefined();
      expect(frame.type).toBe("ui_command");
      expect(frame.command.action).toBe(cmd.action);
    }
  });

  it("fixture set is exactly the ClientCommand set (no orphan frames)", () => {
    const unionActions = ALL_ACTIONS.map((c) => c.action).sort();
    const fixtureActions = Object.keys(fixtures)
      .filter((k) => !k.startsWith("_"))
      .sort();
    expect(fixtureActions).toEqual(unionActions);
  });

  it("fixture count matches the union size", () => {
    const fixtureActions = Object.keys(fixtures).filter((k) => !k.startsWith("_"));
    expect(fixtureActions).toHaveLength(ALL_ACTIONS.length);
  });
});
