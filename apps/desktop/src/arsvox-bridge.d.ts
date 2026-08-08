/**
 * Electron preload bridge surface (see electron/preload.ts). Exposed via
 * contextBridge only — the renderer never sees the token source.
 */
interface Window {
  arsvox?: {
    getAuthToken(): string;
  };
}
