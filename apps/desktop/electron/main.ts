/**
 * Electron main process: one window, loads the built renderer (or the
 * vite dev server when VITE_DEV_SERVER_URL is set). The Python agent
 * service is started externally (scripts/run_service.*); this shell only
 * talks to it over WebSocket.
 */

import { app, BrowserWindow, session } from "electron";
import * as path from "path";

// The assistant speaks without any user click (voice-first product):
// Chrome's autoplay policy must not block TTS playback.
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

// Voice-first product: the mic must be usable without fiddling with
// site permissions. Grant the media permission to this app's windows.
app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === "media");
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
    return permission === "media";
  });
});

const DEV_URL = process.env.VITE_DEV_SERVER_URL;

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 560,
    title: "Ars-Vox",
    backgroundColor: "#101418",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);

  if (DEV_URL) {
    void win.loadURL(DEV_URL);
  } else {
    void win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
