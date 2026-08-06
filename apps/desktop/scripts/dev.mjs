/**
 * Dev runner: starts the vite dev server, waits for it to accept
 * connections, then launches Electron pointed at it. Killing Electron
 * stops vite too. Node-only, no extra dependencies.
 */

import { spawn } from "node:child_process";

const PORT = 5173;
const url = `http://localhost:${PORT}`;

const isWin = process.platform === "win32";
const npx = isWin ? "npx.cmd" : "npx";

const vite = spawn(npx, ["vite"], { stdio: "inherit", shell: isWin });

async function waitForServer(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 404) return true; // 404 is fine; root exists
      if (res.status < 500) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

const ready = await waitForServer(30000);
if (!ready) {
  console.error("vite dev server did not start in time");
  vite.kill();
  process.exit(1);
}

console.log(`vite ready at ${url}; launching Electron...`);

const electron = spawn(npx, ["electron", "."], {
  stdio: "inherit",
  shell: isWin,
  env: { ...process.env, VITE_DEV_SERVER_URL: url },
});

electron.on("exit", () => {
  vite.kill();
  process.exit(0);
});

vite.on("exit", () => {
  electron.kill();
  process.exit(0);
});
