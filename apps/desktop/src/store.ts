/**
 * App store — vanilla Zustand (no React dependency) so the full event path
 * (server event -> ui_command -> layout change) is unit-testable in node.
 *
 * GATE-3.5 (W2-STORE): the legacy layout authority is DELETED —
 * state.spec / state.layout / state.history / state.panelMeta /
 * state.fullscreenPanel / recompute() are gone, along with the six
 * "Legacy boot path" branches they served. The adaptive composition
 * (state.adaptive) is the single layout authority: the config-driven
 * default (ui.default_template / ui.default_primary) lands it at connect
 * (applyConfig), and the first layout command materializes it on demand
 * (bootDefaultSpec) when no composition exists yet — layout commands can
 * never touch a legacy mirror.
 */

import { createStore, type StoreApi } from "zustand/vanilla";

import {
  normalizeUiCommand,
  type ActionResultEvent,
  type AppConfigWire,
  type BrowserNavigateEvent,
  type ClientCommand,
  type DocumentKind,
  type MediaStateEvent,
  type NormalizedUiCommand,
  type ReminderItem,
  type ServerEvent,
  type StateSnapshotEvent,
  type TodoItem,
  type VoiceState,
  type YoutubeVideoResult,
} from "./contracts";
import { DEFAULT_PRIMARY, isPanelId, type PanelId } from "./contracts";
import { computeAdaptiveGeometry, type Viewport } from "./layout/adaptiveEngine";
import { surfaceRegistry } from "./roles/registry";
import { resolveLayout, type ResolvedAssignment } from "./roles/fallback";
import type {
  AdaptiveTemplate,
  LayoutSpec as AdaptiveLayoutSpec,
  Proportion,
  SurfaceRole,
} from "./adaptive/contracts";
import { TEMPLATE_SLOTS } from "./adaptive/contracts";
import {
  applyOverrides,
  EMPTY_OVERRIDES,
  mergeOverrideIntent,
  removeSurfaceOverrides,
  type OverrideIntent,
  type OverrideSet,
} from "./adaptive/overrides";
import {
  matchSpokenOverride,
  resolveSpokenOverrideTarget,
  spokenOverrideIntent,
} from "./adaptive/spokenOverrides";
import { scoreChange } from "./layout/inertia";
import {
  LEGACY_TEMPLATE_MAP,
  planLayout,
  type PlannerInput,
  type PlannerRejection,
} from "./adaptive/planner";
import {
  mediaController,
  type MediaState,
  type PlayerMediaUpdate,
} from "./media/controller";

/** Re-exported for components that mirror the controller state. */
export { EMPTY_MEDIA } from "./media/controller";

/** Default content viewport used until the renderer reports real size. */
export const DEFAULT_VIEWPORT: Viewport = { width: 1280, height: 800 };

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

/**
 * UI-103 adaptive state: the last validated adaptive LayoutSpec plus its
 * role-resolved assignments. The config-driven default lands the first
 * composition at connect, so `spec` is null only before the server's
 * first config_update.
 *
 * UI-301: `lastRejection` records the planner's rejection reason for the
 * most recent agent layout intent that did NOT reach state (invalid model
 * output can never corrupt layout state — the rejection is the observable
 * trace). Null after a valid apply or a fresh store.
 *
 * UI-302: plus the persistent user constraint set (pin/stick/position/...)
 * that the override layer applies AFTER planner output.
 */
export interface AdaptiveState {
  spec: AdaptiveLayoutSpec | null;
  assignments: ResolvedAssignment[];
  lastRejection: PlannerRejection | null;
  /** UI-302: active user layout constraints, keyed by surfaceId. */
  overrides: OverrideSet;
  /** R19 (GATE-3.5): the composition captured when a fullscreen constraint
   *  ENGAGED — the fullscreen toggle's restore target. Null while no
   *  fullscreen constraint is active (or when it arrived via a snapshot
   *  restore, where it is not carried). Plain JSON — snapshot-safe. */
  preFullscreen: AdaptiveLayoutSpec | null;
  /** C5 (GATE-3.5, defect #2): the most recent UiCommand action that
   *  applyUiCommand did NOT handle (unknown wire action — JSON.parse casts
   *  bypass the exhaustive union). Latched diagnostic record: visible and
   *  testable, never throws. Null until an unknown action arrives. */
  lastUnhandledAction: string | null;
}

export const EMPTY_ADAPTIVE: AdaptiveState = {
  spec: null,
  assignments: [],
  lastRejection: null,
  overrides: EMPTY_OVERRIDES,
  preFullscreen: null,
  lastUnhandledAction: null,
};

/**
 * UI-302: options for applyAdaptiveSpec.
 */
export interface ApplyAdaptiveSpecOptions {
  /** UI-207: user-commanded change — the inertia scorer always applies it
   *  (bypasses the damping wall). Agent-initiated (planner) changes omit
   *  this and stay subject to inertia. An overrideIntent also counts as
   *  user-commanded. */
  userInitiated?: boolean;
  /** UI-302: a user override intent ("bigger", "right", "close", ...) to
   *  merge into the persistent constraint set. The constraint applies to
   *  this spec AFTER the planner's output and to every future planner
   *  spec until removed ("restore layout" / removeSurfaceOverrides). */
  overrideIntent?: OverrideIntent;
  /** R19 (GATE-3.5): full replacement constraint set, used WITHOUT
   *  overrideIntent when a caller needs to apply a modified set directly
   *  (e.g. removeSurfaceOverrides for the fullscreen toggle-off or a
   *  reconnect restoring the snapshot's constraints). When both are
   *  present, overrideIntent merges into this set. */
  overrides?: OverrideSet;
}

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
  results: YoutubeVideoResult[];
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

export type SendFn = (message: unknown) => void;

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
  /** Panel content state, keyed by panel id (see PanelContent). */
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

let messageSeq = 0;
function nextMessageId(prefix: string): string {
  messageSeq += 1;
  return `${prefix}${messageSeq.toString(36)}`;
}

/**
 * GATE-3.5 (R24-R27 + W3-MEDIA): the H7 media-command merge helpers moved
 * into src/media/controller.ts — ALL media mutations (server events,
 * server commands, user commands, player callbacks, snapshot restore)
 * route through the one MediaController, and this file derives
 * content.media from it through ONE subscription (see createAppStore).
 * The store is never a write-target for media events; the wire paths
 * below only APPLY controller output.
 */

/** Slot → semantic role for addSurfaceToSpec (mirrors WIRE_SLOT_ROLE in
 *  the planner: the adaptive contract's frozen role vocabulary). */
function slotRole(slot: string): "primary" | "companion" | "support" {
  if (slot === "main") return "primary";
  if (slot === "side") return "companion";
  return "support";
}

/**
 * R19 (GATE-3.5): place a surface into a composition deterministically —
 * the first FREE slot of the current template (main→primary, side→
 * companion, rail→support); when the template is full, step up to triple;
 * when nowhere to go, return the input unchanged (the degrade layer would
 * drop the newcomer anyway). Mirrors the legacy engine's "fill empty
 * slots" rule for the manual-open source.
 */
function addSurfaceToSpec(
  spec: AdaptiveLayoutSpec,
  surfaceId: string,
): AdaptiveLayoutSpec {
  if (spec.assignments.some((a) => a.surfaceId === surfaceId)) return spec;
  const occupied = new Set(spec.assignments.map((a) => a.slot));
  const candidates = [spec.template, "triple"] as const;
  for (const template of candidates) {
    const free = TEMPLATE_SLOTS[template].find(
      (s: string) => !occupied.has(s),
    );
    if (free) {
      return {
        ...spec,
        template,
        assignments: [
          ...spec.assignments,
          { surfaceId, role: slotRole(free), slot: free },
        ],
      };
    }
  }
  return spec;
}

/** H5: raw transport send slot for the outbound buffer. Rebound by
 *  bindTransport (singleton) or left as the createAppStore argument for
 *  per-store instances; the store's `send` stays the buffering wrapper
 *  so reconnect sends are queued, never silently dropped. Declared
 *  before createAppStore so the singleton's module-load instantiation
 *  can register its rebind hook. */
let rebindRawSend: (send: SendFn) => void = () => {};

/**
 * GATE-3.5 (A6/R29): resync trigger. When the client detects a sequence
 * gap (a skipped bus number — the server dropped events for a slow
 * subscriber), it forces a reconnect; the fresh state_snapshot is the
 * resync. Bound from main.tsx to WsClient.forceReconnect; tests bind
 * their own observer. No-op until bound.
 */
let resyncHook: (() => void) | null = null;
export function bindResync(fn: () => void): void {
  resyncHook = fn;
}

/** GATE-3.5 (A6/R34): cap for the in-memory notification list. */
const NOTIFICATIONS_CAP = 20;

export function createAppStore(send: SendFn): StoreApi<AppState> {
  const store = createStore<AppState>((set, get) => {
    /** True once any server layout command has been applied; guards the
     *  config-driven default from clobbering later user state on reconnect. */
    let layoutApplied = false;
    // GATE-3.5 (A6/R29): bus-sequence authority. lastSeq is the highest
    // sequence seen (reset by every state_snapshot — the snapshot is the
    // sync point and the only thing that can reset a lower sequence after
    // a service restart). resyncRequested throttles the reconnect trigger
    // to once per gap episode (cleared by the next snapshot).
    let lastSeq: number | null = null;
    let resyncRequested = false;
    // H5 reconnect + GATE-3.5 R11 (A2): outbound buffering. The raw
    // transport send is rebound by bindTransport (the singleton); per-store
    // instances keep the send passed to createAppStore. While the store
    // is disconnected — including BEFORE the first connection (R11: early
    // user_text spoken/clicked during service startup must not be lost) —
    // outgoing messages are queued and flushed in order on the next
    // connect. The WebSocket client's send() silently drops frames when
    // the socket is not OPEN, which is exactly the loss this buffer
    // prevents; in Electron mode the main-process WS queue backs it up
    // (exactly-once delivery).
    let rawSend: SendFn = send;
    let hasConnected = false;
    const outbox: unknown[] = [];
    const OUTBOX_CAP = 200;
    rebindRawSend = (next: SendFn): void => {
      rawSend = next;
    };
    const transportSend = (message: unknown): void => {
      if (!get().connected) {
        outbox.push(message);
        if (outbox.length > OUTBOX_CAP) outbox.shift();
        return;
      }
      rawSend(message);
    };

    /** Append a TTS phrase, honoring the config-driven queue cap. */
    const pushSpeak = (text: string): void => {
      const state = get();
      const speakTexts = [...state.speakTexts, text];
      const cap = state.ttsQueueMax > 0 ? state.ttsQueueMax : 10;
      if (speakTexts.length > cap) speakTexts.shift();
      set({ speakTexts });
    };

    /** GATE-3.5 (A6/R34): append a rendered notification (dedupe by id,
     *  capped). Live events and snapshot restores share this path. */
    const pushNotification = (item: NotificationItem): void => {
      const state = get();
      const notifications = [
        ...state.notifications.filter((n) => n.notificationId !== item.notificationId),
        item,
      ];
      while (notifications.length > NOTIFICATIONS_CAP) notifications.shift();
      set({ notifications });
    };

    /**
     * GATE-3.5 (W2-STORE): the boot default composition — the adaptive
     * spec a layout command operates on when the config-driven default
     * has not landed yet. Registry-gated: an unregistered anchor returns
     * null (commands no-op; the registry gate never throws on boot data).
     */
    const bootDefaultSpec = (): AdaptiveLayoutSpec | null => {
      if (!surfaceRegistry.has(DEFAULT_PRIMARY)) return null;
      return {
        template: "focus",
        assignments: [
          { surfaceId: DEFAULT_PRIMARY, role: "primary", slot: "main" },
        ],
      };
    };

    /**
     * Apply the server config snapshot to the UI: accessibility modes,
     * TTS knobs, and (only before any layout command) the default layout.
     */
    const applyConfig = (config: AppConfigWire): void => {
      const state = get();
      const ui = config.ui ?? {};
      const tts = config.tts ?? {};
      const patch: Partial<AppState> = {};
      if (ui.reduced_motion !== undefined) patch.reducedMotion = ui.reduced_motion;
      if (ui.large_text !== undefined) patch.largeText = ui.large_text;
      if (ui.high_contrast !== undefined) patch.highContrast = ui.high_contrast;
      if (typeof tts.speed === "number" && tts.speed > 0) patch.ttsSpeed = tts.speed;
      if (typeof tts.queue_max === "number" && tts.queue_max > 0) {
        patch.ttsQueueMax = tts.queue_max;
      }
      if (!layoutApplied) {
        // R19 (GATE-3.5): the config-driven default layout is a layout
        // source ("migration") and enters the ONE choke as the initial
        // adaptive composition — the default lands at connect, before
        // any user interaction. Legacy template ids map through the
        // planner's frozen wire map; an unregistered default_primary
        // falls back to the conversation anchor (the choke's registry
        // gate must never throw on config data).
        const template =
          typeof ui.default_template === "string" && ui.default_template
            ? adaptiveTemplateFromConfig(ui.default_template)
            : null;
        if (template) {
          // Config data must NEVER throw through the choke's registry
          // gate: an unregistered default_primary falls back to the
          // conversation anchor; when even the anchor is unregistered
          // (e.g. product surfaces not yet registered), skip the default.
          const configuredPrimary =
            typeof ui.default_primary === "string" &&
            isPanelId(ui.default_primary) &&
            surfaceRegistry.has(ui.default_primary)
              ? ui.default_primary
              : null;
          const primary =
            configuredPrimary ??
            (surfaceRegistry.has(DEFAULT_PRIMARY) ? DEFAULT_PRIMARY : null);
          if (primary) {
            try {
              applyAdaptiveSpec(
                {
                  template,
                  assignments: [
                    { surfaceId: primary, role: "primary", slot: "main" },
                  ],
                },
                { userInitiated: false },
              );
              layoutApplied = true;
            } catch (error) {
              // never crash the event path on config data
              console.warn(
                "[store] config default layout rejected:",
                (error as Error).message,
              );
            }
          }
        }
      }
      set(patch);
    };

    /** R19 (GATE-3.5): config default_template → adaptive template id.
     *  Adaptive ids pass through; legacy wire ids (focus/split/reading/
     *  dashboard) map through the planner's frozen legacy map. Unknown ids
     *  → null (no default layout). */
    const adaptiveTemplateFromConfig = (value: string): AdaptiveTemplate | null => {
      if (value in TEMPLATE_SLOTS) return value as AdaptiveTemplate;
      return LEGACY_TEMPLATE_MAP[value] ?? null;
    };

    /**
     * UI-103: validate the adaptive LayoutSpec against the surface registry,
     * resolve every role through the deterministic fallback ladder, and
     * store the result. Invalid specs throw and never reach state.
     *
     * UI-207: spatial inertia guard. After validation, the pure scorer
     * (layout/inertia.ts) decides whether applying the requested spec is
     * worth its movement cost. Agent chatter (equivalent layouts,
     * sub-bar movement, unjustified template changes) is damped: the
     * current composition is kept untouched (zero churn). User-initiated
     * changes and primary re-focusing always apply — the policy never
     * blocks a real signal. Every layout source flows through this choke
     * (R22: the legacy engine path is retired).
     *
     * UI-301: agent layout intents (wire ui_command/layout.apply) flow
     * through the planner (adaptive/planner.ts) into this choke via
     * applyLayoutIntent — the inertia guard stays active for agent-initiated
     * changes. User-initiated overrides are UI-302's hook.
     *
     * UI-302 (Wave 3): this function is the single choke point where the
     * planner's output (UI-301's layer) meets the user's explicit layout
     * constraints. Pipeline per call:
     *   1. merge options.overrideIntent into the persistent constraint set
     *      (constraints survive across planner rounds — pin/stick semantics);
     *   2. apply the constraint set ON TOP of the incoming planner spec
     *      (applyOverrides — explicit user constraints beat planner
     *      preferences; invalid arrangements degrade deterministically to
     *      the nearest valid template);
     *   3. score the CONSTRAINED spec (never the raw planner spec) against
     *      the current layout with the UI-207 scorer — a user-commanded
     *      change (overrideIntent present or options.userInitiated) bypasses
     *      the damping wall; agent-initiated planner changes stay damped;
     *   4. the constrained spec becomes layout state, so the UI always
     *      renders the user's composition.
     */
    const applyAdaptiveSpec = (
      spec: AdaptiveLayoutSpec,
      options: ApplyAdaptiveSpecOptions = {},
    ): void => {
      const state = get();
      // UI-102 geometry guard (GATE-1, 2026-08-09): an unrenderable spec
      // (duplicate slot assignment, template that cannot fit the stage)
      // must NEVER reach layout state — the engine throws at render
      // otherwise and the whole app white-screens (found in the packaged
      // build: a split compose with both primaries in "main" passed the
      // frozen validator and crashed boot via the snapshot restore). The
      // frozen validateLayoutSpec deliberately does not cover slot
      // uniqueness — geometry-level validation is the choke's job.
      try {
        computeAdaptiveGeometry(
          spec,
          state.viewport,
          surfaceRegistry.registeredIds(),
        );
      } catch (error) {
        console.warn(
          "[adaptive] rejecting unrenderable spec:",
          (error as Error).message,
        );
        return;
      }
      const baseOverrides = options.overrides ?? state.adaptive.overrides;
      const overrides = options.overrideIntent
        ? mergeOverrideIntent(baseOverrides, options.overrideIntent, spec)
        : baseOverrides;
      const constrained = applyOverrides(
        spec,
        overrides,
        surfaceRegistry.registeredIds(),
      );
      const assignments = resolveLayout(constrained, surfaceRegistry);
      const userInitiated =
        options.userInitiated === true || options.overrideIntent !== undefined;
      // R19: capture the pre-fullscreen composition when a fullscreen
      // constraint ENGAGES (once), and clear it when it disengages — the
      // toggle-off restore target. Spec is the incoming (unconstrained)
      // composition, so the restore returns to exactly what the user had.
      const wasFullscreen = Object.values(state.adaptive.overrides.bySurface).some(
        (c) => c.fullscreen === true,
      );
      const nowFullscreen = Object.values(overrides.bySurface).some(
        (c) => c.fullscreen === true,
      );
      const preFullscreen =
        !wasFullscreen && nowFullscreen
          ? spec
          : wasFullscreen && !nowFullscreen
            ? null
            : state.adaptive.preFullscreen;
      const verdict = scoreChange(state.adaptive.spec, constrained, {
        userInitiated,
      });
      if (verdict.decision === "keep") {
        // No layout churn — but a fresh constraint set must still persist
        // (a no-op user command still pins for future planner rounds).
        if (overrides !== state.adaptive.overrides || preFullscreen !== state.adaptive.preFullscreen) {
          set({ adaptive: { ...state.adaptive, overrides, preFullscreen } });
        }
        return;
      }
      set({
        adaptive: {
          ...state.adaptive,
          spec: constrained,
          assignments,
          overrides,
          lastRejection: null,
          preFullscreen,
        },
      });
    };

    /**
     * UI-301: route an agent layout intent through the planner (semantic
     * composition authority — the agent says WHAT, never HOW). The planner
     * maps the intent (adaptive-native LayoutIntent or the legacy wire
     * layout.apply payload) to a LayoutSpec and validates it deterministically
     * (frozen validateLayoutSpec + computeAdaptiveGeometry); invalid model
     * output is REJECTED with a structured reason and can never corrupt
     * layout state. Valid intents flow through the same choke as
     * applyAdaptiveSpec — the UI-207 inertia guard remains active for
     * agent-initiated changes.
     *
     * @returns The rejection reason when the intent was rejected (recorded
     *          in adaptive.lastRejection), else null.
     */
    const applyLayoutIntent = (intent: PlannerInput): PlannerRejection | null => {
      const state = get();
      const result = planLayout(intent, surfaceRegistry, {
        viewport: state.viewport,
      });
      if (!result.ok) {
        // Invalid model output: record the rejection, never touch layout.
        set({ adaptive: { ...state.adaptive, lastRejection: result.rejection } });
        return result.rejection;
      }
      // GATE-3.5 (review P1-2): agent-planner output goes through the SAME
      // choke as every other layout mutation (applyAdaptiveSpec), so the
      // persistent user constraint set applies ON TOP of the planned spec —
      // an explicit user constraint ("close conversation") beats a later
      // agent composition that would bring the surface back.
      applyAdaptiveSpec(result.spec, { userInitiated: false });
      set({ adaptive: { ...get().adaptive, lastRejection: null } });
      return null;
    };

    /** UI-103: write one value into a surface's per-surfaceId state bag. */
    const setSurfaceState = (
      surfaceId: string,
      key: string,
      value: unknown,
    ): void => {
      const bags = get().surfaceState;
      const bag = bags[surfaceId] ?? {};
      set({
        surfaceState: { ...bags, [surfaceId]: { ...bag, [key]: value } },
      });
    };

    const applyUiCommand = (command: NormalizedUiCommand): void => {
      const state = get();
      switch (command.action) {
        case "layout.apply": {
          // UI-301: the agent's layout intent (H1 wire path) flows through
          // the planner into the ONE adaptive choke (applyAdaptiveSpec via
          // applyLayoutIntent). The planner maps the legacy wire vocabulary
          // to a LayoutSpec and validates it deterministically — invalid
          // intents are rejected and recorded (adaptive.lastRejection),
          // never thrown and never corrupting layout state.
          applyLayoutIntent(command);
          layoutApplied = true;
          return;
        }
        case "layout.compose": {
          // C5/A3 (GATE-3.5): the adaptive-native composition command — the
          // frozen LayoutSpec shape (template + surface-role assignments +
          // optional proportion, NO geometry) routed STRAIGHT into the ONE
          // choke (applyAdaptiveSpec). It does NOT touch the planner: the
          // planner is the legacy layout.apply adapter (planner.ts — do
          // NOT extend). Assignments arrive already normalized to
          // surfaceId by normalizeUiCommand at the wire boundary.
          // Agent-initiated (userInitiated: false): the UI-207 inertia
          // guard stays active for agent compositions.
          layoutApplied = true;
          applyAdaptiveSpec(
            {
              template: command.template,
              assignments: command.assignments,
              proportion: command.proportion ?? null,
            },
            { userInitiated: false },
          );
          return;
        }
        case "panel.open": {
          // Overlay panels (confirmation/notification) use their own
          // channels; only layout panels enter the composition.
          if (!isPanelId(command.panel_type)) return;
          // The manual-open source enters the ONE choke: opening a surface
          // cancels any prior close constraint for it and places it into
          // the composition deterministically (first free template slot;
          // the degrade layer rehomes/drops when the template cannot host
          // it). Unregistered ids are ignored (the frozen registry check
          // applies at the choke, never silently). Before the config
          // default has landed, the boot default composition is the base.
          const base = state.adaptive.spec ?? bootDefaultSpec();
          if (!base) return;
          layoutApplied = true;
          const opened =
            surfaceRegistry.has(command.panel_type)
              ? addSurfaceToSpec(base, command.panel_type)
              : base;
          applyAdaptiveSpec(opened, {
            userInitiated: true,
            overrides: removeSurfaceOverrides(
              state.adaptive.overrides,
              command.panel_type,
            ),
          });
          return;
        }
        case "panel.close": {
          const target = isPanelId(command.panel_type ?? "")
            ? (command.panel_type as PanelId)
            : (command.panel_id as PanelId | null);
          if (!target) return;
          // R19/R20 (GATE-3.5): closing a surface is a USER close intent —
          // a persistent constraint through the ONE choke. A later agent
          // composition that proposes the surface cannot bring it back.
          const base = state.adaptive.spec ?? bootDefaultSpec();
          if (!base) return;
          layoutApplied = true;
          applyAdaptiveSpec(base, {
            userInitiated: true,
            overrideIntent: { kind: "close", surfaceId: target },
          });
          return;
        }
        case "panel.set_primary": {
          if (!isPanelId(command.panel_type)) return;
          // R19 (GATE-3.5): "make this the primary" == the frozen "left"
          // intent (the target becomes the main primary; the previous main
          // occupant moves to the side companion) — through the ONE choke.
          const base = state.adaptive.spec ?? bootDefaultSpec();
          if (!base) return;
          layoutApplied = true;
          applyAdaptiveSpec(base, {
            userInitiated: true,
            overrideIntent: { kind: "left", surfaceId: command.panel_type },
          });
          return;
        }
        case "panel.fullscreen": {
          if (!isPanelId(command.panel_type)) return;
          // R19 (GATE-3.5): fullscreen through the ONE choke — the
          // fullscreen constraint replaces the composition with
          // focus{target} and adaptive.preFullscreen captures the restore
          // target. The components derive their fullscreen icon state from
          // adaptive.overrides (no mirror field).
          const base = state.adaptive.spec ?? bootDefaultSpec();
          if (!base) return;
          layoutApplied = true;
          applyAdaptiveSpec(base, {
            userInitiated: true,
            overrideIntent: { kind: "fullscreen", surfaceId: command.panel_type },
          });
          return;
        }
        case "layout.restore": {
          // R19 (GATE-3.5): "restore layout" == the frozen restore intent —
          // clears the persistent constraint set through the ONE choke (the
          // explicit user reset; the unconstrained composition applies).
          // GATE-2 fix (2026-08-09, packaged-verified): the restore base must
          // be the pre-fullscreen composition when one exists — the fullscreen
          // constraint REPLACES adaptive.spec with focus{target}, so restoring
          // from adaptive.spec returns to fullscreen geometry and the
          // pre-fullscreen desk is lost. preFullscreen was captured but never
          // consumed (R19 incomplete).
          const base =
            state.adaptive.preFullscreen ??
            state.adaptive.spec ??
            bootDefaultSpec();
          if (!base) return;
          layoutApplied = true;
          applyAdaptiveSpec(base, {
            userInitiated: true,
            overrideIntent: { kind: "restore" },
          });
          return;
        }
        case "notification.show": {
          // GATE-3.5 (A6/R34): the command path (scheduler emits both the
          // `notification` event and this command) feeds the same rendered
          // list as the event path.
          pushNotification({
            notificationId: command.notification_id,
            kind: command.kind,
            title: command.title,
            text: command.text,
            dueAt: null,
          });
          set({
            messages: [
              ...state.messages,
              {
                id: nextMessageId("n"),
                role: "system",
                text: `${command.title}: ${command.text}`,
              },
            ],
          });
          return;
        }
        case "tts.speak": {
          pushSpeak(command.text);
          return;
        }
        case "media.state": {
          // GATE-3.5 (R24-R27 + W3-MEDIA): defensive server-command path —
          // routed through the single MediaController like every other
          // media input; the controller merges the partial command and
          // the store's ONE subscription mirrors the authoritative result.
          mediaController.applyServerCommand(command);
          return;
        }
        case "audio.play": {
          mediaController.applyServerCommand(command);
          return;
        }
        default: {
          // C5 (GATE-3.5, defect #2): an unknown action must NEVER be
          // silently swallowed — the old exhaustive switch did exactly
          // that, hiding unsupported commands through the whole gate. The
          // union is exhaustive at compile time; this catches runtime
          // frames that bypass the type (ws JSON.parse as ServerEvent).
          // Records visibly (console + store) and NEVER throws.
          const action = (command as { action?: unknown }).action;
          console.warn(
            `[store] unhandled UiCommand action: ${typeof action === "string" ? action : String(action)}`,
          );
          set({
            adaptive: {
              ...get().adaptive,
              lastUnhandledAction:
                typeof action === "string" ? action : String(action),
            },
          });
          return;
        }
      }
    };

    const applyEvent = (event: ServerEvent): void => {
      // GATE-3.5 (A6/R29): sequence authority. The snapshot is the sync
      // point: events older than it (pre-snapshot bus leftovers) are stale
      // and DROPPED — the snapshot already reflects that state. A skipped
      // number means the server dropped events (slow-subscriber QueueFull)
      // and the client forces a reconnect, whose fresh snapshot is the
      // resync. Events without a sequence (direct sends, tests) pass
      // through untouched.
      if (event.type === "state_snapshot") {
        lastSeq = event.sequence;
        resyncRequested = false;
      } else if (typeof (event as unknown as { sequence?: unknown }).sequence === "number") {
        const seq = (event as unknown as { sequence: number }).sequence;
        if (lastSeq !== null) {
          if (seq <= lastSeq) return; // stale pre-snapshot event
          if (seq > lastSeq + 1 && !resyncRequested) {
            resyncRequested = true;
            resyncHook?.();
          }
        }
        lastSeq = seq;
      }
      const state = get();
      switch (event.type) {
        case "state_update":
          set({
            voiceState: event.voice_state,
            activity: event.activity ?? null,
            // GATE-3.5 (R01/R07): STOP — button or spoken — surfaces
            // here as STOPPING. Clearing the TTS queue makes TtsPlayer
            // interrupt physical playback (and ack tts.cancelled).
            // Without this a spoken "detente" would cancel the turn
            // server-side while the speaker keeps talking.
            ...(event.voice_state === "stopping" ? { speakTexts: [] } : {}),
          });
          return;
        case "user_message":
          set({
            messages: [
              ...state.messages,
              { id: event.id, role: "user", text: event.text },
            ],
          });
          return;
        case "agent_message": {
          const messages = [...state.messages];
          const last = messages[messages.length - 1];
          if (event.delta && last && last.role === "assistant") {
            messages[messages.length - 1] = { ...last, text: last.text + event.text };
          } else {
            messages.push({ id: nextMessageId("a"), role: "assistant", text: event.text });
          }
          set({ messages });
          return;
        }
        case "ui_command":
          // C5/A3 (GATE-3.5): the SINGLE wire-boundary normalization site —
          // every incoming ui_command frame passes through normalizeUiCommand
          // exactly once here (surface_id → surfaceId for layout.compose)
          // before applyUiCommand sees it. ws/client.ts hands the raw
          // JSON.parse frame to applyEvent untouched.
          applyUiCommand(normalizeUiCommand(event.command));
          return;
        case "confirmation_requested":
          set({
            pending: {
              pendingId: event.pending_id,
              tool: event.tool,
              title: event.title,
              detail: event.detail,
              expiresInS: event.expires_in_s,
            },
          });
          return;
        case "confirmation_resolved":
          set({
            pending: null,
            messages: [
              ...state.messages,
              {
                id: nextMessageId("c"),
                role: "system",
                text: event.message
                  ? `Confirmación ${event.status}: ${event.message}`
                  : `Confirmación ${event.status}`,
              },
            ],
          });
          return;
        case "error":
          set({ error: { message: event.message, recoverable: event.recoverable } });
          return;
        case "notification":
          // GATE-3.5 (A6/R34): notifications are real UI state now — the
          // persistent region renders them, and the chat keeps its system
          // line for the conversation log.
          pushNotification({
            notificationId: event.notification_id,
            kind: event.kind,
            title: event.title,
            text: event.text,
            dueAt: event.due_at,
          });
          set({
            messages: [
              ...state.messages,
              {
                id: nextMessageId("n"),
                role: "system",
                text: `${event.title}: ${event.text}`,
              },
            ],
          });
          return;
        case "config_update":
          applyConfig(event.config);
          return;
        case "state_snapshot": {
          // H5 reconnect + GATE-3.5 A6: apply the canonical snapshot sent
          // once per WS connect. Authoritative server state — voice,
          // pending, media, history, notifications and the adaptive
          // composition are REPLACED (null/empty = absence, R30/R31).
          // Panels are NOT restored: a fresh page load must start at the
          // central-mic hero (user directive, 2026-08-08), and a same-tab
          // reconnect keeps its in-memory desk.
          const snap = event as StateSnapshotEvent;
          // R30 (A6): media=null is authoritative absence — the stale
          // player is CLEARED, never preserved. Snapshot restore is
          // another server-state input routed through the SAME
          // MediaController (A5/W3-MEDIA — single authority); the store's
          // ONE subscription mirrors the result into content.media.
          if (snap.media) {
            mediaController.applyServerEvent(snap.media);
          } else {
            mediaController.reset();
          }
          const patch: Partial<AppState> = {
            voiceState: snap.voice_state,
            pending: snap.pending_confirmation
              ? {
                  pendingId: snap.pending_confirmation.pending_id,
                  tool: snap.pending_confirmation.tool,
                  title: snap.pending_confirmation.title,
                  detail: snap.pending_confirmation.detail,
                  expiresInS: snap.pending_confirmation.expires_in_s,
                }
              : null,
            // R31/R34: history and notifications are authoritative —
            // empty lists CLEAR stale chat/notification state.
            messages: snap.history.map((h) => ({
              id: `h${h.id}`,
              role: h.role,
              text: h.text,
            })),
            notifications: snap.notifications.map((n) => ({
              notificationId: n.notification_id,
              kind: n.kind,
              title: n.title,
              text: n.text,
              dueAt: n.due_at ?? null,
            })),
          };
          // R33: reconstruct the adaptive workspace through the SAME choke
          // live agent compositions use (registry-validated, inertia
          // guarded). Invalid compositions never crash the event path —
          // the live desk is kept and the rejection is observable.
          const ad = snap.adaptive;
          if (
            ad &&
            typeof ad.template === "string" &&
            ad.template &&
            Array.isArray(ad.assignments) &&
            ad.assignments.length > 0
          ) {
            const assignments = ad.assignments
              .filter(
                (a) =>
                  a &&
                  typeof a.surface_id === "string" &&
                  typeof a.role === "string" &&
                  typeof a.slot === "string",
              )
              .map((a) => ({
                surfaceId: a.surface_id,
                role: a.role as SurfaceRole,
                slot: a.slot,
              }));
            if (assignments.length > 0) {
              try {
                applyAdaptiveSpec(
                  {
                    template: ad.template as AdaptiveTemplate,
                    assignments,
                    proportion: (ad.proportion as Proportion) ?? null,
                  },
                  {
                    // Authoritative server truth (R33): restore WITH the
                    // snapshot constraint set in one shot through the choke,
                    // never damped by inertia on an authoritative restore.
                    overrides:
                      ad.overrides && typeof ad.overrides === "object"
                        ? ({ bySurface: ad.overrides } as OverrideSet)
                        : EMPTY_OVERRIDES,
                    userInitiated: true,
                  },
                );
              } catch {
                // never crash the event path on an invalid composition
              }
            }
          }
          set(patch);
          return;
        }
        case "youtube.search": {
          set({
            content: {
              ...state.content,
              youtube: {
                query: event.query,
                loading: false,
                results: event.results,
              },
            },
          });
          return;
        }
        case "browser.navigate": {
          const ev = event as BrowserNavigateEvent;
          set({
            content: {
              ...state.content,
              browser: {
                url: ev.url,
                title: ev.title,
                canGoBack: ev.can_go_back,
                canGoForward: ev.can_go_forward,
                loading: ev.loading,
              },
            },
          });
          return;
        }
        case "document.load": {
          set({
            content: {
              ...state.content,
              document_editor: {
                title: event.title,
                kind: event.kind,
                path: event.path,
                url: event.url ?? null,
                content: event.content,
                chapters: event.chapters,
              },
            },
          });
          return;
        }
        case "tasks.update": {
          set({
            content: {
              ...state.content,
              tasks: { todos: event.todos, reminders: event.reminders },
            },
          });
          return;
        }
        case "media.state": {
          const ev = event as MediaStateEvent;
          // GATE-3.5 (R24-R27 + W3-MEDIA): the authoritative server state
          // (agent tool / client action verdict) feeds the single
          // controller; the store's ONE subscription mirrors it.
          mediaController.applyServerEvent(ev);
          return;
        }
        case "action_result": {
          // H1: server verdict on a client-initiated action. The UI may
          // have applied the action optimistically; failed/unsupported
          // means that state is a lie — surface it so the user knows the
          // action did not take effect.
          const ev = event as ActionResultEvent;
          if (ev.status === "failed" || ev.status === "unsupported") {
            set({
              error: {
                message: `Acción ${ev.action} ${ev.status}${
                  ev.detail ? `: ${ev.detail}` : ""
                }`,
                recoverable: true,
              },
            });
          }
          return;
        }
        case "tool_call":
        case "pong":
          return;
      }
    };

    return {
      connected: false,
      voiceState: "sleeping",
      activity: null,
      messages: [],
      pending: null,
      error: null,
      reducedMotion: false,
      largeText: false,
      highContrast: false,
      ttsSpeed: 1.0,
      ttsQueueMax: 10,
      viewport: DEFAULT_VIEWPORT,
      speakTexts: [],
      content: {},
      notifications: [],
      adaptive: EMPTY_ADAPTIVE,
      surfaceState: {},

      send: transportSend,
      setConnected: (connected) => {
        if (connected) {
          // Flush the reconnect outbox in FIFO order; the socket is OPEN
          // by the time the transport reports status (ws.onopen), so the
          // raw sends pass through. Never re-buffer: flush via rawSend.
          hasConnected = true;
          const pending = outbox.splice(0);
          set({ connected: true });
          for (const message of pending) rawSend(message);
        } else {
          set({ connected: false });
        }
      },
      setReducedMotion: (value) => {
        set({ reducedMotion: value });
      },
      setViewport: (viewport) => {
        set({ viewport });
      },

      applyEvent,
      sendText: (text) => {
        const trimmed = text.trim();
        if (!trimmed) return;
        // No optimistic append: the server echoes user_message, which is
        // the single source of truth for the conversation history.
        get().send({ type: "user_text", text: trimmed });
      },
      toggleFullscreen: (panel) => {
        const state = get();
        // R19 (GATE-3.5): the manual fullscreen source enters the ONE
        // choke. The constraint set decides the toggle direction: a
        // fullscreen constraint on this surface → OFF (drop the surface's
        // constraints and restore the pre-fullscreen composition captured
        // when the constraint engaged); otherwise → ON (fullscreen intent).
        const base = state.adaptive.spec ?? bootDefaultSpec();
        if (!base) return;
        layoutApplied = true;
        const c = state.adaptive.overrides.bySurface[panel];
        if (c?.fullscreen === true) {
          const restoreTo = state.adaptive.preFullscreen ?? base;
          applyAdaptiveSpec(restoreTo, {
            userInitiated: true,
            overrides: removeSurfaceOverrides(state.adaptive.overrides, panel),
          });
        } else {
          applyAdaptiveSpec(base, {
            userInitiated: true,
            overrideIntent: { kind: "fullscreen", surfaceId: panel },
          });
        }
      },
      stop: () => {
        // STOP is locally authoritative: run the LOCAL cancellation
        // boundary first — abort mic capture (which also aborts any
        // in-flight STT fetch and bumps the capture generation so late
        // transcripts are dropped), clear the TTS queue so TtsPlayer
        // interrupts playback — THEN notify the service. All of this
        // works with the socket down or the service slow to ack.
        captureAbort?.();
        set({ speakTexts: [] });
        get().send({ type: "stop" });
      },
      dispatchCommand: (command) => {
        const state = get();
        switch (command.action) {
          case "youtube.search": {
            set({
              content: {
                ...state.content,
                youtube: {
                  query: command.query,
                  loading: true,
                  results: state.content.youtube?.results ?? [],
                },
              },
            });
            break;
          }
          case "youtube.play": {
            // GATE-3.5 (W3-MEDIA): user pick -> the controller (optimistic;
            // the server ack/verdict reconciles afterwards); the store's
            // ONE subscription mirrors the result.
            mediaController.userPlayYoutube(command.video_id, command.title);
            break;
          }
          case "browser.navigate": {
            const b = state.content.browser;
            set({
              content: {
                ...state.content,
                browser: {
                  url: command.url,
                  title: b?.title ?? "",
                  canGoBack: b?.canGoBack ?? false,
                  canGoForward: b?.canGoForward ?? false,
                  loading: true,
                },
              },
            });
            break;
          }
          case "browser.back":
          case "browser.forward":
          case "browser.refresh": {
            const b = state.content.browser;
            if (b) {
              set({ content: { ...state.content, browser: { ...b, loading: true } } });
            }
            break;
          }
          case "tasks.toggle": {
            const tasks = state.content.tasks;
            if (tasks) {
              set({
                content: {
                  ...state.content,
                  tasks: {
                    ...tasks,
                    todos: tasks.todos.map((t) =>
                      t.id === command.task_id ? { ...t, done: !t.done } : t,
                    ),
                  },
                },
              });
            }
            break;
          }
          case "media.play_pause": {
            // W3-MEDIA: optimistic toggle through the controller — the
            // subscription mirrors only real changes (no track = no-op =
            // no fake media surface created).
            mediaController.userPlayPause();
            break;
          }
          case "media.seek": {
            // W3-MEDIA: optimistic seek through the controller — the
            // subscription mirrors only real changes.
            mediaController.userSeek(command.position_s);
            break;
          }
          case "document.save":
            // The editor already holds the local content; nothing to
            // optimistically change here. The command carries the text.
            break;
        }
        get().send({
          type: "ui_command",
          command,
          created_at: new Date().toISOString(),
        });
      },
      confirm: (approve) => {
        const state = get();
        if (!state.pending) return;
        const pendingId = state.pending.pendingId;
        set({ pending: null });
        get().send(
          approve
            ? { type: "confirm", pending_id: pendingId }
            : { type: "cancel", pending_id: pendingId },
        );
      },
      dismissError: () => set({ error: null }),
      setError: (error) => set({ error }),

      applyUiCommand,
      /**
       * GATE-3.5 (R26 + W3-MEDIA): player callbacks -> the one controller
       * -> store (single subscription). No React-only simulated playback
       * state: what the iframe reports IS what the progress bar shows.
       */
      applyPlayerMediaEvent: (update) => {
        mediaController.applyPlayerUpdate(update);
      },
      applyAdaptiveSpec,
      applyLayoutIntent,
      handleSpokenText: (text) => {
        const state = get();
        // R21: deterministic spoken-override route. Whole-utterance phrase
        // matching (accent-stripped, punctuation-free) — a matched layout
        // phrase becomes an OverrideIntent applied through the ONE choke
        // and is CONSUMED (no user_text reaches the model, so no vague
        // model suggestion can be produced). Non-matches and utterances
        // before any composition exists fall through to the normal path.
        const kind = matchSpokenOverride(text);
        if (!kind || state.adaptive.spec == null) return false;
        const intent = spokenOverrideIntent(
          kind,
          resolveSpokenOverrideTarget(state.adaptive.spec),
        );
        if (!intent) return false;
        layoutApplied = true;
        applyAdaptiveSpec(state.adaptive.spec, {
          userInitiated: true,
          overrideIntent: intent,
        });
        return true;
      },
      setSurfaceState,
      enqueueTts: pushSpeak,
      ttsDone: () => {
        set({ speakTexts: get().speakTexts.slice(1) });
      },
      // W2-REMINDERS seam (GATE-3.5): client-side dismissal of one
      // rendered notification — additive local action, never sent.
      dismissNotification: (notificationId) => {
        set({
          notifications: get().notifications.filter(
            (n) => n.notificationId !== notificationId,
          ),
        });
      },
    };
  });

  // GATE-3.5 (W3-MEDIA): ONE media authority — content.media is DERIVED
  // from the MediaController through this single subscription. The store
  // is never a write-target for media events: every wire path above
  // (server events, ui_commands, user commands, player callbacks,
  // snapshot restore) only APPLIES controller output, and this
  // subscription mirrors the authoritative result. Emits that produce no
  // real change (no-op toggles/seeks, redundant player time updates)
  // leave the state object untouched — no re-render churn.
  mediaController.subscribe(() => {
    const media = mediaController.getState();
    store.setState((s: AppState) =>
      s.content.media === media ? s : { ...s, content: { ...s.content, media } },
    );
  });

  return store;
}

/**
 * The renderer's singleton store. The transport is bound once from
 * main.tsx (the WebSocket client); until then sends are no-ops.
 */
export const appStore = createAppStore(() => {});

/**
 * Local cancellation hook for stop(): the mic module registers its abort
 * here (one-way dependency, no store->mic import cycle) so stop() can
 * cancel capture + in-flight STT before the stop message is sent.
 */
let captureAbort: (() => void) | null = null;
export function registerCaptureAbort(fn: () => void): void {
  captureAbort = fn;
}

export function bindTransport(send: SendFn): void {
  rebindRawSend(send);
}
