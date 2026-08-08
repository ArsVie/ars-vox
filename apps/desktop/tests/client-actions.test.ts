/**
 * H1 fixture bridge (client side): every action string in the TS
 * UiCommand union must have exactly one frame in the shared fixture
 * packages/contracts/fixtures/client_actions.json, and no frame may
 * reference an action the union does not know.
 *
 * The fixture is the cross-language contract: tests/python/test_client_actions.py
 * parses every frame through parse_client_message on the Python side, so
 * if an action string drifts here, this test (missing fixture) and the
 * Python test (unknown action) both fail. Never regenerate the fixture on
 * one side only.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { UiCommand } from "../src/contracts";

const FIXTURE_PATH = new URL(
  "../../../packages/contracts/fixtures/client_actions.json",
  import.meta.url,
);

interface FixtureFrame {
  type: string;
  command: { action: string };
}

type FixtureFile = Record<string, FixtureFrame>;

/** One typed value per UiCommand union member — compile-time coverage. */
const ALL_ACTIONS: UiCommand[] = [
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
  {
    action: "notification.show",
    notification_id: "n-1",
    kind: "info",
    title: "Recordatorio",
    text: "Es hora de regar las plantas",
  },
  { action: "media.state", state: "playing", title: "Sinfonía Nº 5", volume: 0.8 },
  { action: "media.play_pause" },
  { action: "media.seek", position_s: 42 },
  { action: "youtube.search", query: "carpintería" },
  { action: "youtube.play", video_id: "yt-1", title: "Taller" },
  { action: "browser.navigate", url: "https://example.com/docs" },
  { action: "browser.back" },
  { action: "browser.forward" },
  { action: "browser.refresh" },
  { action: "document.save", panel_type: "document_editor", content: "## Notas" },
  { action: "tasks.toggle", task_id: "1" },
  { action: "tts.speak", text: "Hola" },
  { action: "audio.play", asset: "chime.wav" },
];

describe("H1 client action fixture conformance", () => {
  const fixtures = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as FixtureFile;

  it("every UiCommand action string has a fixture frame", () => {
    for (const cmd of ALL_ACTIONS) {
      const frame = fixtures[cmd.action];
      expect(frame, `missing fixture frame for ${cmd.action}`).toBeDefined();
      expect(frame.type).toBe("ui_command");
      expect(frame.command.action).toBe(cmd.action);
    }
  });

  it("fixture set is exactly the UiCommand set (no orphan frames)", () => {
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
