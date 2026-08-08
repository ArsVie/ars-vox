#!/usr/bin/env node
/**
 * UI-105 — storyboard capture script.
 *
 * Renders every screenshot scenario (template × proportion matrix +
 * canonical-flow key frames) to apps/desktop/storyboard/:
 *   - scenarios.json  (data: spec, primary, stub geometry per frame)
 *   - index.html      (static placeholder visual, zero deps)
 *
 * Wave-1 output uses the harness's stub geometry; real screenshots land at
 * GATE-2 with the shell. Run from apps/desktop:
 *
 *   node scripts/render-scenario-storyboard.mjs
 *
 * (It drives the storyboard capture test with WRITE_STORYBOARD=1 — the
 * capture assertions always run; the file emission is opt-in.)
 */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const result = spawnSync(
  "npx",
  ["vitest", "run", "tests/harness/storyboard-capture.test.ts"],
  {
    cwd: appDir,
    stdio: "inherit",
    env: { ...process.env, WRITE_STORYBOARD: "1" },
  },
);
if (result.error) {
  console.error("failed to run vitest:", result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);
