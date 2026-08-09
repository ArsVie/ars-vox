/**
 * Wire contracts — TypeScript mirror of the Python contracts
 * (packages/contracts/arsvox_contracts). Field names match the JSON
 * payloads exactly (snake_case).
 */

import type { AnyTemplate, PanelId, SlotName } from "./layout/engine";

/** Wire shape of layout.apply `slots` (mirror of LayoutSlots in Python). */
export interface LayoutSlotsWire {
  main: PanelId;
  side?: PanelId | null;
  rail?: PanelId | null;
  dock?: PanelId | null;
}

/**
 * Enum unions — mirror of packages/contracts/arsvox_contracts/enums.py.
 * Typed (not `string`) so enum drift between Python and TS is a compile
 * error, and cross-checked by tests/conformance.test.ts.
 */
export type NotificationKind = "reminder" | "alarm" | "info" | "error";
export type MediaState = "playing" | "paused" | "stopped";
export type ConfirmationStatus =
  | "pending"
  | "approved"
  | "executing"
  | "executed"
  | "failed"
  | "cancelled"
  | "expired"
  | "superseded";

/**
 * All panel values the Python side can emit (PanelType enum). The layout
 * engine only hosts KNOWN_PANELS; confirmation/notification are overlay
 * panels handled through their own channels (ConfirmationPanel /
 * notification events), so they exist on the wire but never in slots.
 */
export type WirePanelId = PanelId | "confirmation" | "notification";

/**
 * Minimal typed view of the agent config the UI consumes (mirror of
 * packages/contracts/arsvox_contracts/config.py). The server sends the
 * full config on connect (config_update) and on GET /config.
 */
export interface UiConfigWire {
  templates?: string[];
  reduced_motion?: boolean;
  large_text?: boolean;
  high_contrast?: boolean;
  default_template?: string;
  default_primary?: string;
}

export interface TtsConfigWire {
  provider?: string;
  auto_speak?: boolean;
  es_voice?: string | null;
  speed?: number;
  queue_max?: number;
}

export interface AppConfigWire {
  app?: { name?: string; locale?: string };
  server?: { host?: string; port?: number };
  agent?: { mock?: boolean; model?: { name?: string; max_steps?: number } };
  tts?: TtsConfigWire;
  ui?: UiConfigWire;
  [key: string]: unknown;
}

export type VoiceState =
  | "sleeping"
  | "listening"
  | "thinking"
  | "speaking"
  | "waiting_for_confirmation"
  | "stopping"
  | "error";

/** Media source for the unified player (same UI for both). */
export type MediaSource = "youtube" | "local";
export type MediaKind = "video" | "audio";

/* ------------------------------------------------------------------ */
/* Panel content events — the wire for populating panels.             */
/* The agent (or mock) emits these; the store reduces them into       */
/* `content` state consumed by the panel components.                  */
/* ------------------------------------------------------------------ */

export interface YoutubeVideoResult {
  id: string;
  title: string;
  channel: string;
  duration_s: number;
  published: string;
  thumbnail_url: string | null;
}

export interface YoutubeSearchEvent {
  type: "youtube.search";
  query: string;
  results: YoutubeVideoResult[];
  created_at: string;
}

export interface BrowserNavigateEvent {
  type: "browser.navigate";
  url: string;
  title: string;
  can_go_back: boolean;
  can_go_forward: boolean;
  loading: boolean;
  created_at: string;
}

export type DocumentKind = "txt" | "md" | "pdf" | "epub";

export interface DocumentChapter {
  title: string;
  content: string;
}

export interface DocumentLoadEvent {
  type: "document.load";
  title: string;
  kind: DocumentKind;
  path: string;
  /** Fetchable URL for pdf/epub real rendering (web demo / Electron
   *  custom protocol). When absent, the text path renders instead. */
  url?: string | null;
  /** Full text for txt/md; for pdf/epub, the extracted readable text
   *  (rendered chapters) so panels never stay empty shells. */
  content: string;
  chapters: DocumentChapter[];
  created_at: string;
}

export interface TodoItem {
  id: string;
  title: string;
  done: boolean;
  priority: "low" | "normal" | "high";
  due: string | null;
}

export interface ReminderItem {
  id: string;
  title: string;
  /** Human cadence label, e.g. "Cada día 9:00". */
  cadence: string;
  next_fire: string;
}

export interface TasksUpdateEvent {
  type: "tasks.update";
  todos: TodoItem[];
  reminders: ReminderItem[];
  created_at: string;
}

export interface MediaStateEvent {
  type: "media.state";
  state: MediaState;
  source: MediaSource;
  kind: MediaKind;
  title: string;
  video_id: string | null;
  url: string | null;
  position_s: number;
  duration_s: number;
  volume: number;
  created_at: string;
}

export interface UserMessageEvent {
  type: "user_message";
  id: string;
  text: string;
  created_at: string;
}

export interface AgentMessageEvent {
  type: "agent_message";
  text: string;
  /** true = continuation of the previous assistant message. */
  delta: boolean;
  created_at: string;
}

export interface ToolCallEvent {
  type: "tool_call";
  run_id: string;
  tool: string;
  args: Record<string, unknown>;
  status: "running" | "done" | "error" | "rejected";
  result: string | null;
  created_at: string;
}

export type UiCommand =
  | {
      action: "layout.apply";
      template: AnyTemplate;
      primary_panel: PanelId | null;
      secondary_panel: PanelId | null;
      slots?: LayoutSlotsWire;
      preserve?: boolean;
    }
  | {
      action: "panel.open";
      panel_type: WirePanelId;
      title?: string | null;
      content_reference?: string | null;
    }
  | {
      action: "panel.close";
      panel_type?: WirePanelId | null;
      panel_id?: string | null;
    }
  | { action: "panel.set_primary"; panel_type: WirePanelId }
  | { action: "panel.fullscreen"; panel_type: WirePanelId }
  | { action: "layout.restore" }
  | {
      action: "notification.show";
      notification_id: string;
      kind: NotificationKind;
      title: string;
      text: string;
      sound?: boolean;
      snoozable?: boolean;
    }
  | {
      action: "media.state";
      state: MediaState;
      title?: string | null;
      url?: string | null;
      volume?: number | null;
    }
  | { action: "media.play_pause" }
  | { action: "media.seek"; position_s: number }
  | { action: "youtube.search"; query: string }
  | { action: "youtube.play"; video_id: string; title: string }
  | { action: "browser.navigate"; url: string }
  | { action: "browser.back" }
  | { action: "browser.forward" }
  | { action: "browser.refresh" }
  | { action: "document.save"; panel_type: string; content: string }
  | { action: "tasks.toggle"; task_id: string }
  | { action: "tts.speak"; text: string; priority?: boolean }
  | { action: "audio.play"; asset: string };

export interface UiCommandEvent {
  type: "ui_command";
  command: UiCommand;
  created_at: string;
}

export interface ConfirmationRequestedEvent {
  type: "confirmation_requested";
  pending_id: string;
  tool: string;
  title: string;
  detail: string;
  expires_in_s: number;
  created_at: string;
}

export interface ConfirmationResolvedEvent {
  type: "confirmation_resolved";
  pending_id: string;
  status: ConfirmationStatus;
  message: string | null;
  created_at: string;
}

export interface StateUpdateEvent {
  type: "state_update";
  voice_state: VoiceState;
  activity: string | null;
  created_at: string;
}

export interface NotificationEvent {
  type: "notification";
  notification_id: string;
  kind: NotificationKind;
  title: string;
  text: string;
  due_at: string | null;
  created_at: string;
}

export interface ErrorEvent {
  type: "error";
  message: string;
  recoverable: boolean;
  created_at: string;
}

export interface ConfigUpdateEvent {
  type: "config_update";
  config: AppConfigWire;
  created_at: string;
}

export interface PongEvent {
  type: "pong";
  ts: string;
}

/** Server verdict on a client-initiated ui_command action (H1).
 *  done = effect applied; unsupported = no backend capability (stop
 *  pretending the action is live); failed = understood but not applied;
 *  accepted = received, effect is asynchronous. */
export interface ActionResultEvent {
  type: "action_result";
  action: string;
  status: "accepted" | "done" | "failed" | "unsupported";
  detail: string | null;
}

/* ------------------------------------------------------------------ */
/* H5: reconnect recovery — canonical state snapshot.                  */
/* Emitted once per WS connect (after state_update + config_update).   */
/* The client treats it as authoritative: pending confirmation card,   */
/* open panels, media, notifications and content keys are replayed so  */
/* a reconnect never leaves the UI desynced from the service.          */
/* ------------------------------------------------------------------ */

export interface PendingConfirmationSnapshot {
  pending_id: string;
  tool: string;
  title: string;
  detail: string;
  expires_in_s: number;
  expires_at: string;
}

export interface SnapshotPanel {
  panel_type: string;
  title?: string | null;
  content_reference?: string | null;
}

export interface SnapshotNotification {
  notification_id: string;
  kind: string;
  title: string;
  text: string;
  due_at: string | null;
}

/** GATE-3.5 (A6/R33): adaptive composition carried by the snapshot — a
 *  renderer reload reconstructs the workspace from this (template, role/
 *  slot assignments, proportion) plus the user constraint set (overrides,
 *  keyed by surfaceId — A4's OverrideSet is plain JSON). */
export interface AdaptiveSnapshot {
  template: string | null;
  assignments: { surface_id: string; role: string; slot: string }[];
  proportion: string | null;
  overrides: Record<string, unknown>;
}

export interface StateSnapshotEvent {
  type: "state_snapshot";
  /** Current bus session sequence; every bus event carries one, so gaps
   *  (QueueFull drops) are detectable. The client resets its baseline to
   *  this value and forces a reconnect when a later event skips a number. */
  sequence: number;
  voice_state: VoiceState;
  config: AppConfigWire;
  /** Service-side layout truth: open panels. */
  layout: {
    panels: SnapshotPanel[];
  };
  pending_confirmation: PendingConfirmationSnapshot | null;
  media: MediaStateEvent | null;
  notifications: SnapshotNotification[];
  content_keys: string[];
  /** Recent turns of the most recent session — restored on connect so a
   *  reload/reconnect does not blank the conversation (events are
   *  per-connection, turns are persisted). Empty = authoritative clear. */
  history: { id: number; role: "user" | "assistant"; text: string; created_at: string }[];
  /** Adaptive composition — reload/reconnect reconstructs the workspace. */
  adaptive: AdaptiveSnapshot;
  created_at: string;
}

export type ServerEvent =
  | UserMessageEvent
  | AgentMessageEvent
  | ToolCallEvent
  | UiCommandEvent
  | ConfirmationRequestedEvent
  | ConfirmationResolvedEvent
  | StateUpdateEvent
  | NotificationEvent
  | ErrorEvent
  | ConfigUpdateEvent
  | YoutubeSearchEvent
  | BrowserNavigateEvent
  | DocumentLoadEvent
  | TasksUpdateEvent
  | MediaStateEvent
  | PongEvent
  | ActionResultEvent
  | StateSnapshotEvent;
