/**
 * GATE-5 (W0-SLICE) — shared state types.
 *
 * The per-surface content bags and the small UI-state records that used to
 * live inside the 1,420-line store. The store re-exports every type from
 * here (see store.ts) so existing components keep their import sites; new
 * surface slices import from "./types" directly.
 */

import type {
  ClientCommand,
  DocumentKind,
  MediaSearchResult,
  NormalizedUiCommand,
  PanelId,
  ReminderItem,
  ServerEvent,
  TodoItem,
  VoiceState,
  YoutubeVideoResult,
} from "../contracts";
import type { PlayerMediaUpdate, MediaState } from "../media/controller";
import type { Viewport } from "../layout/adaptiveEngine";
import type { LayoutSpec as AdaptiveLayoutSpec } from "../adaptive/contracts";
import type { ResolvedAssignment } from "../roles/fallback";
import type { PlannerInput, PlannerRejection } from "../adaptive/planner";
import type { OverrideSet } from "../adaptive/overrides";
import type {
  AdaptiveState,
  ApplyAdaptiveSpecOptions,
} from "./adaptiveTypes";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
}

/** Panel metadata carried by the surface components' `meta` prop
 *  (title / content_reference). Not store state — the legacy
 *  state.panelMeta field was deleted with PanelHost (GATE-3.5 W2-STORE). */
export interface PanelMeta {
  title?: string;
  contentReference?: string;
}

export type SendFn = (message: unknown) => void;

export interface ConfirmationInfo {
  pendingId: string;
  tool: string;
  title: string;
  detail: string;
  expiresInS: number;
}

export interface ErrorInfo {
  message: string;
  recoverable: boolean;
}

/* ------------------------------------------------------------ content */
/* Panel content state — reduced from the panel content events. Keys are
   the panel ids that own content surfaces (youtube, browser,
   document_editor, tasks, media). Absent key = panel has no content yet. */

export interface YoutubeContent {
  query: string;
  loading: boolean;
  /** The cards the agent OFFERED — the unified wire shape
   *  (media.search_results) so source/kind travel with each card. */
  results: MediaSearchResult[];
}

export interface BrowserContent {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
}

export interface DocumentContent {
  title: string;
  kind: DocumentKind;
  path: string;
  /** Fetchable URL for pdf/epub real rendering. */
  url?: string | null;
  content: string;
  chapters: { title: string; content: string }[];
}

export interface TasksContent {
  todos: TodoItem[];
  reminders: ReminderItem[];
}

export interface PanelContent {
  youtube?: YoutubeContent;
  browser?: BrowserContent;
  document_editor?: DocumentContent;
  tasks?: TasksContent;
  media?: MediaState;
}

/**
 * GATE-3.5 (A6/R34): a rendered notification. Populated by live
 * `notification` events AND restored from the reconnect snapshot
 * (authoritative — an empty snapshot list clears it, R31).
 */
export interface NotificationItem {
  notificationId: string;
  kind: string;
  title: string;
  text: string;
  dueAt: string | null;
}

export interface AppState {
  connected: boolean;
  voiceState: VoiceState;
  activity: string | null;
  messages: ChatMessage[];
  pending: ConfirmationInfo | null;
  error: ErrorInfo | null;
  reducedMotion: boolean;
  /** Accessibility modes driven by config ui.large_text / ui.high_contrast. */
  largeText: boolean;
  highContrast: boolean;
  /** TTS knobs driven by config tts.speed / tts.queue_max. */
  ttsSpeed: number;
  ttsQueueMax: number;
  /** Real content-viewport size in px (engine px floors + density). */
  viewport: Viewport;
  /** Pending TTS phrases (text), played in order by TtsPlayer. */
  speakTexts: string[];
  /** Panel content state, keyed by panel id (see PanelContent). The bags
   *  are owned by the content slices (state/*), reduced through the ONE
   *  registration seam — the store never writes them directly. */
  content: PanelContent;
  /** GATE-3.5 (A6/R34): notifications to render (live events + snapshot
   *  restore; the snapshot list is authoritative). */
  notifications: NotificationItem[];
  /** UI-103: validated adaptive LayoutSpec + role-resolved assignments. */
  adaptive: AdaptiveState;
  /** Per-surface state bag keyed by surfaceId (UI-103). The role framework
   *  never touches this on role/slot changes — surface state survives. */
  surfaceState: Record<string, Record<string, unknown>>;

  send: SendFn;
  setConnected: (connected: boolean) => void;
  /** GATE-3.5 A2/R12: surface service-lifecycle failures (main-proxied
   *  service events) through the same error banner as wire errors. */
  setError: (error: ErrorInfo | null) => void;
  setReducedMotion: (value: boolean) => void;
  setViewport: (viewport: Viewport) => void;

  applyEvent: (event: ServerEvent) => void;
  sendText: (text: string) => void;
  stop: () => void;
  confirm: (approve: boolean) => void;
  dismissError: () => void;

  /** Local UI action: toggle a panel's fullscreen state (never sent to the
   *  server). The fullscreen constraint lives in adaptive.overrides — the
   *  components derive their fullscreen icon state from it (no mirror). */
  toggleFullscreen: (panel: PanelId) => void;

  /** User-initiated command: optimistic local effect + send to the server. */
  dispatchCommand: (command: ClientCommand) => void;

  /** Server command application. C5/A3 (GATE-3.5): accepts the NORMALIZED
   *  command — callers coming from the wire MUST pass through
   *  normalizeUiCommand first (applyEvent's ui_command case is the single
   *  boundary site; surface_id → surfaceId happens exactly there). */
  applyUiCommand: (command: NormalizedUiCommand) => void;

  /**
   * GATE-3.5 (R26): the REAL player's callbacks (YouTube iframe
   * infoDelivery — playerState / currentTime / duration) feed the single
   * MediaController; there is no React-only simulated playback state.
   */
  applyPlayerMediaEvent: (update: PlayerMediaUpdate) => void;
  /** UI-103: validate + apply an adaptive LayoutSpec (registry + fallback
   *  ladder). Throws on invalid specs; state is never partially updated.
   *  UI-302: options carry the user-initiated signal (bypasses UI-207's
   *  damping wall) and user override intents (applied AFTER the planner
   *  output — explicit user constraints beat planner preferences). */
  applyAdaptiveSpec: (
    spec: AdaptiveLayoutSpec,
    options?: ApplyAdaptiveSpecOptions,
  ) => void;
  /** UI-301: route an agent layout intent (adaptive-native or legacy wire
   *  layout.apply) through the planner. Invalid intents are rejected with
   *  a structured reason and NEVER reach state; valid intents apply through
   *  the same choke as applyAdaptiveSpec (registry + inertia guard).
   *  Returns the rejection reason when the intent was rejected, else null. */
  applyLayoutIntent: (intent: PlannerInput) => PlannerRejection | null;
  /** R21 (GATE-3.5): the spoken-override route. Deterministic phrase
   *  matching on an STT transcript BEFORE any user_text reaches the model:
   *  a matched layout phrase becomes an OverrideIntent through the ONE
   *  choke and the utterance is consumed (never a vague model suggestion).
   *  Returns true when the utterance was consumed as a layout override. */
  handleSpokenText: (text: string) => boolean;
  /** UI-103: write a per-surface state value (keyed by surfaceId). */
  setSurfaceState: (surfaceId: string, key: string, value: unknown) => void;
  enqueueTts: (text: string) => void;
  ttsDone: () => void;
  /** GATE-3.5 (W2-REMINDERS seam): client-side removal of one rendered
   *  notification (dismiss affordance). Never sent to the server. */
  dismissNotification: (notificationId: string) => void;
}
