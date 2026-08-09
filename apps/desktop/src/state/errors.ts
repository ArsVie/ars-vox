/**
 * GATE-5 (W0-SLICE) — error surface helpers.
 *
 * H1: server verdicts on client-initiated actions. The UI may have
 * applied the action optimistically; failed/unsupported means that state
 * is a lie — surface it so the user knows the action did not take effect.
 */

import type { ActionResultEvent } from "../contracts";
import type { ErrorInfo } from "./types";

/** action_result -> error banner record (null when the verdict is not a
 *  failure — done/accepted verdicts surface nothing). */
export function actionResultError(
  event: ActionResultEvent,
): ErrorInfo | null {
  if (event.status !== "failed" && event.status !== "unsupported") return null;
  return {
    message: `Acción ${event.action} ${event.status}${
      event.detail ? `: ${event.detail}` : ""
    }`,
    recoverable: true,
  };
}
