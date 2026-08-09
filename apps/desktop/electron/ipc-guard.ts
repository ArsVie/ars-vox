/**
 * R41 — IPC sender validation for the Electron main process.
 *
 * A sender is trusted ONLY when it is (a) a live WebContents the app
 * itself created and vouches for via `trusted`, and (b) the MAIN frame
 * of that WebContents (subframes/iframes can be foreign content).
 *
 * Use in EVERY ipcMain handler. The privileged channels today
 * (all patched in main.ts):
 *   - arsvox:service-status  (invoke)
 *   - arsvox:fetch           (invoke)
 *   - arsvox:ws-connect      (send)
 *   - arsvox:ws-close        (send)
 *   - arsvox:ws-send         (send)
 *
 * The retired get-token channel (P2/A2) is gone and must not come back:
 * the per-launch token lives only in the main process (R14).
 */

import type { IpcMainEvent, WebContents } from "electron";

export function isTrustedIpcSender(
  event: Pick<IpcMainEvent, "sender" | "senderFrame">,
  trusted: (wc: WebContents) => boolean,
): boolean {
  if (!event.sender || event.sender.isDestroyed()) return false;
  if (!trusted(event.sender)) return false;
  const frame = event.senderFrame;
  if (!frame) return false;
  return frame === event.sender.mainFrame;
}
