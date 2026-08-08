/**
 * Preload: the ONLY channel through which the renderer learns the
 * per-launch auth token. contextIsolation keeps this surface minimal —
 * the renderer sees exactly { getAuthToken } and nothing else.
 */

import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("arsvox", {
  getAuthToken: (): string => ipcRenderer.sendSync("arsvox:get-token") as string,
});
