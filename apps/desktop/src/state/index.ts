/**
 * GATE-5 (W0-SLICE) — state slice facade.
 *
 * The ONE registration seam: `contentRegistry` (a singleton, like
 * surfaceRegistry) is seeded with the four product content slices.
 * Product lanes that need content state register a slice here:
 *
 *   import { contentRegistry } from "./state";
 *   contentRegistry.register(mySlice);
 *
 * and never edit store.ts. After GATE-0 the store is frozen; the
 * registry is the only content-state entry point.
 */

import { browserSlice } from "./browserSlice";
import { documentSlice } from "./documentSlice";
import { createContentRegistry } from "./registry";
import { tasksSlice } from "./tasksSlice";
import { youtubeSlice } from "./youtubeSlice";

/** The renderer's content registry — the ONE registration seam. */
export const contentRegistry = createContentRegistry();
contentRegistry.register(youtubeSlice);
contentRegistry.register(browserSlice);
contentRegistry.register(documentSlice);
contentRegistry.register(tasksSlice);

/** The product slices themselves — exported for tests and for lanes that
 *  want to reuse a reducer directly. */
export { browserSlice, documentSlice, tasksSlice, youtubeSlice };

export { createContentRegistry };
export type { ContentRegistry, SurfaceSlice } from "./registry";

export {
  appendAgentMessage,
  appendUserMessage,
  nextMessageId,
  systemMessage,
} from "./conversation";
export {
  applyMediaPlayerUpdate,
  applyMediaServerCommand,
  applyMediaServerEvent,
  applyMediaUserCommand,
  resetMedia,
  subscribeMediaToStore,
} from "./media";
export { EMPTY_MEDIA } from "./media";
export type { MediaState } from "./media";
export {
  dismissNotification,
  NOTIFICATIONS_CAP,
  pushNotification,
  restoreNotifications,
} from "./notifications";
export {
  adaptiveTemplateFromConfig,
  addSurfaceToSpec,
  bootDefaultSpec,
} from "./layoutBoot";
export { applyConfigToState } from "./config";
export type { ConfigDefaultLayoutContext } from "./config";
export {
  confirmationFromEvent,
  confirmationResolvedMessage,
  pendingConfirmationFromSnapshot,
} from "./confirmation";
export { actionResultError } from "./errors";
export { restoreAdaptiveFromSnapshot } from "./snapshotRestore";
export { EMPTY_ADAPTIVE } from "./adaptiveTypes";
export type { AdaptiveState, ApplyAdaptiveSpecOptions } from "./adaptiveTypes";
export type * from "./types";
