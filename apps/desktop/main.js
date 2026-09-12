/* Electron shell. It starts the agent service if it is not already up, then
   points a window at it. All the behaviour lives in the page and the service. */

const { app, BrowserWindow } = require("electron");
const { spawn } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");

const HOST = "127.0.0.1";
const PORT = Number(process.env.ARSVOX_PORT || 8790);
const URL = `http://${HOST}:${PORT}/`;
const REPO = path.resolve(__dirname, "..", "..");
const PYTHON = path.join(REPO, ".venv-win", "Scripts", "python.exe");

let service = null;
let window = null;

function healthy() {
  return new Promise((resolve) => {
    const request = http.get({ host: HOST, port: PORT, path: "/health", timeout: 900 }, (response) => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.on("error", () => resolve(false));
    request.on("timeout", () => {
      request.destroy();
      resolve(false);
    });
  });
}

async function ensureService() {
  if (await healthy()) return;
  service = spawn(PYTHON, [path.join("apps", "cli", "arsvox_cli.py"), "serve", "--port", String(PORT)], {
    cwd: REPO,
    stdio: "ignore",
    windowsHide: true,
  });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (await healthy()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  console.error("el servicio no arrancó");
}

function openWindow() {
  window = new BrowserWindow({
    width: 1180,
    height: 860,
    minWidth: 720,
    backgroundColor: "#f7f5f1",
    title: "Ars Vox",
    autoHideMenuBar: true,
  });
  window.loadURL(URL);
}

app.whenReady().then(async () => {
  await ensureService();
  openWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) openWindow();
  });
});

app.on("window-all-closed", () => {
  if (service) service.kill();
  app.quit();
});
