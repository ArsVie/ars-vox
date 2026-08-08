/**
 * UI-105 — storyboard capture (screenshot-scenario output at Wave 1).
 *
 * Always asserts the storyboard is complete and serializable. When run with
 * WRITE_STORYBOARD=1 (via scripts/render-scenario-storyboard.mjs) it also
 * writes apps/desktop/storyboard/{scenarios.json,index.html} — a static
 * placeholder visual of every scenario (stub geometry). Real screenshots
 * land at GATE-2 with the shell; the scenario registry + render hook are
 * the Wave-1 fixture deliverable.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { ScenarioRender } from "../../src/adaptive/harness/scenarios";
import { renderStoryboard, storyboardPayload } from "../../src/adaptive/harness/scenarios";
import { STORYBOARD_REGISTERED_IDS } from "../../src/adaptive/harness/scenarios";

// type-safe env access (works without @types/node globals in this tsconfig)
const nodeProcess = (
  globalThis as { process?: { env?: Record<string, string | undefined> } }
).process;
const shouldWrite = nodeProcess?.env?.WRITE_STORYBOARD === "1";

const STORYBOARD_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "storyboard",
);

/** Static placeholder storyboard viewer (no deps, inline styles only). */
function storyboardHtml(renders: ScenarioRender[]): string {
  const scale = 0.5; // 1280x800 virtual canvas -> 640x400 frame
  const frameW = Math.round(1280 * scale);
  const frameH = Math.round(800 * scale);
  const slotStyle = (r: { x: number; y: number; width: number; height: number }) =>
    `position:absolute;left:${Math.round(r.x * scale)}px;top:${Math.round(r.y * scale)}px;` +
    `width:${Math.round(r.width * scale)}px;height:${Math.round(r.height * scale)}px;`;
  const frames = renders
    .map((render) => {
      const slotDivs = Object.entries(render.slots)
        .map(([slot, rect]) => {
          const assignment = render.scenario.spec.assignments.find(
            (a) => a.slot === slot,
          );
          return `<div style="${slotStyle(rect)}box-sizing:border-box;border:1px solid #888;` +
            `background:${slot === "main" ? "#e8eef7" : "#f4f4f4"};overflow:hidden;">` +
            `<div style="padding:6px;font:12px sans-serif;color:#333;">` +
            `<b>${slot}</b> — ${assignment ? `${assignment.surfaceId} (${assignment.role})` : "empty"}` +
            `</div></div>`;
        })
        .join("");
      const persistent = render.persistentBar
        ? `<div style="${slotStyle(render.persistentBar)}box-sizing:border-box;border:1px dashed #666;` +
          `background:#fdf6e3;overflow:hidden;">` +
          `<div style="padding:4px;font:11px sans-serif;color:#333;">persistent bar ` +
          `(${render.scenario.persistent?.join(", ") ?? ""})</div></div>`
        : "";
      const primary = render.applied.primary.join(", ");
      return `<div style="margin:12px;border:1px solid #ccc;padding:10px;background:#fff;">` +
        `<h3 style="margin:0 0 4px;font:bold 14px sans-serif;">${render.scenario.id} — ${render.scenario.title}</h3>` +
        `<div style="font:12px sans-serif;color:#555;margin-bottom:6px;">` +
        `template: <b>${render.template}</b> · proportion: <b>${render.proportion}</b> · ` +
        `primary: <b>${primary}</b>${render.scenario.persistent?.length ? ` · persistent: ${render.scenario.persistent.join(", ")}` : ""}` +
        `</div>` +
        `<div style="position:relative;width:${frameW}px;height:${frameH}px;background:#fafafa;border:1px solid #ddd;">` +
        `${slotDivs}${persistent}</div>` +
        `<div style="font:11px sans-serif;color:#999;margin-top:4px;">${render.scenario.description}</div>` +
        `</div>`;
    })
    .join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>UI-105 adaptive UI — placeholder storyboard</title>
</head>
<body style="margin:0;background:#eee;font-family:sans-serif;">
<h1 style="padding:16px 16px 0;font-size:18px;">Adaptive UI — Wave-1 placeholder storyboard (UI-105)</h1>
<p style="padding:0 16px;font-size:12px;color:#555;">Stub geometry only — real screenshots land at GATE-2 with the shell.</p>
<div style="display:flex;flex-wrap:wrap;align-items:flex-start;">${frames}</div>
</body>
</html>`;
}

describe("storyboard capture", () => {
  it("renders the full storyboard (24 scenarios) with no violations", () => {
    const renders = renderStoryboard(STORYBOARD_REGISTERED_IDS);
    expect(renders).toHaveLength(24);
    for (const render of renders) {
      expect(render.applied.primary.length).toBeGreaterThan(0);
    }
  });

  it("storyboard payload round-trips through JSON", () => {
    const payload = storyboardPayload(STORYBOARD_REGISTERED_IDS);
    const roundTripped = JSON.parse(JSON.stringify(payload)) as {
      scenarios: { id: string; geometry: Record<string, unknown> }[];
    };
    expect(roundTripped.scenarios).toHaveLength(24);
    for (const scenario of roundTripped.scenarios) {
      expect(Object.keys(scenario.geometry).length).toBeGreaterThan(0);
    }
  });

  it("writes storyboard artifacts when WRITE_STORYBOARD=1 (opt-in capture)", () => {
    if (!shouldWrite) {
      return; // run scripts/render-scenario-storyboard.mjs to capture
    }
    mkdirSync(STORYBOARD_DIR, { recursive: true });
    writeFileSync(
      join(STORYBOARD_DIR, "scenarios.json"),
      JSON.stringify(storyboardPayload(STORYBOARD_REGISTERED_IDS), null, 2),
    );
    writeFileSync(
      join(STORYBOARD_DIR, "index.html"),
      storyboardHtml(renderStoryboard(STORYBOARD_REGISTERED_IDS)),
    );
    expect(existsSync(join(STORYBOARD_DIR, "scenarios.json"))).toBe(true);
    expect(existsSync(join(STORYBOARD_DIR, "index.html"))).toBe(true);
  });
});
