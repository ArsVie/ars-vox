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
 *
 * GATE-5 (W0-SLICE): the per-surface content bags moved out of this file
 * into state/*Slice.ts modules, registered through the ONE content
 * registration seam (state/contentRegistry). The store keeps the choke
 * points — applyAdaptiveSpec (layout authority), applyEvent,
 * dispatchCommand, applyUiCommand — but no longer holds the five panels'
 * payloads: youtube/browser/document/tasks reduce through the registry,
 * media stays derived from the single MediaController (state/media.ts),
 * conversation and notification list mechanics live in
 * state/conversation.ts / state/notifications.ts. Snapshot history is
 * NEVER auto-restored (fresh start = central-mic hero, directive
 * 2026-08-08); it is stashed for an explicit resume.
 */

import { createStore, type StoreApi } from "zustand/vanilla";

import {
  DEFAULT_PRIMARY,
  isPanelId,
  normalizeUiCommand,
  type AppConfigWire,
  type ClientCommand,
  type NormalizedUiCommand,
  type PanelId,
  type ServerEvent,
  type StateSnapshotEvent,
} from "./contracts";
import { computeAdaptiveGeometry, type Viewport } from "./layout/adaptiveEngine";
import { surfaceRegistry } from "./roles/registry";
import { resolveLayout } from "./roles/fallback";
import type { LayoutSpec as AdaptiveLayoutSpec } from "./adaptive/contracts";
import {
  applyOverrides,
  mergeOverrideIntent,
  removeSurfaceOverrides,
  type OverrideIntent,
} from "./adaptive/overrides";
import {
  matchSpokenOverride,
  resolveSpokenOverrideTarget,
  spokenOverrideIntent,
} from "./adaptive/spokenOverrides";
import { scoreChange } from "./layout/inertia";
import {
  planLayout,
  type PlannerInput,
  type PlannerRejection,
  type PlannerRejectionCode,
} from "./adaptive/planner";
import { contentRegistry } from "./state";
import { EMPTY_ADAPTIVE } from "./state/adaptiveTypes";
import type {
  AdaptiveState,
  ApplyAdaptiveSpecOptions,
} from "./state/adaptiveTypes";
import { applyConfigToState } from "./state/config";
import {
  confirmationFromEvent,
  confirmationResolvedMessage,
  pendingConfirmationFromSnapshot,
} from "./state/confirmation";
import {
  appendAgentMessage,
  appendUserMessage,
  systemMessage,
} from "./state/conversation";
import { actionResultError } from "./state/errors";
import {
  addSurfaceToSpec,
  adaptiveTemplateFromConfig,
  bootDefaultSpec,
} from "./state/layoutBoot";
import {
  applyMediaPlayerUpdate,
  applyMediaServerCommand,
  applyMediaServerEvent,
  applyMediaUserCommand,
  resetMedia,
  subscribeMediaToStore,
} from "./state/media";
import {
  dismissNotification,
  pushNotification,
  restoreNotifications,
} from "./state/notifications";
import { restoreAdaptiveFromSnapshot } from "./state/snapshotRestore";
import type { AppState, SendFn } from "./state/types";

/** Re-exported for components that mirror the controller state. */
export { EMPTY_MEDIA } from "./state/media";

// TODO(w0-slice, delete-when: GATE-1 lanes import state types from
// "./state" instead of "./store"): after GATE-0 the store is frozen and
// these re-exports exist only for pre-slice import sites (components and
// tests that named the store as their type home).
/** GATE-5 (W0-SLICE): the state shapes moved to state/* — re-exported so
 *  existing component/test import sites keep working. */
export { EMPTY_ADAPTIVE } from "./state/adaptiveTypes";
export type {
  AdaptiveState,
  ApplyAdaptiveSpecOptions,
} from "./state/adaptiveTypes";
export type {
  AppState,
  BrowserContent,
  ChatMessage,
  ConfirmationInfo,
  DocumentContent,
  ErrorInfo,
  NotificationItem,
  PanelContent,
  PanelMeta,
  SendFn,
  TasksContent,
  YoutubeContent,
} from "./state/types";

/** Default content viewport used until the renderer reports real size. */
export const DEFAULT_VIEWPORT: Viewport = { width: 1280, height: 800 };

/**
 * GATE-5 (routing-parity, finding #2) — the ONE list of server event
 * types applyEvent routes to contentRegistry. The switch derives from
 * this constant and the registry<->store parity test
 * (tests/registry-store-parity.test.ts) cross-checks it against the
 * slices' claims in BOTH directions — a slice-claimed event type the
 * store never routes is dead on the wire, and a routed event nobody
 * claims is a silent no-op. This is the guard that makes the
 * "never edit store.ts" promise enforceable.
 */
export const CONTENT_ROUTED_EVENTS: readonly ServerEvent["type"][] = [
  "youtube.search",
  "media.search_results",
  "browser.navigate",
  "browser.dom_action",
  "memory.search_results",
  "document.load",
  "document.changed",
  "tasks.update",
];

/**
 * GATE-3.5 (R24-R27 + W3-MEDIA): the H7 media-command merge helpers live
 * in src/state/media.ts — ALL media mutations (server events, server
 * commands, user commands, player callbacks, snapshot restore) route
 * through the one MediaController, and this file derives content.media
 * from it through ONE subscription (see subscribeMediaToStore below).
 * The store is never a write-target for media events; the wire paths
 * below only APPLY controller output.
 */

/** W3-TRANSPORT: raw transport send slot for the outbound buffer. Rebound by
 *  bindTransport (singleton) or left as the createAppStore argument for
 *  per-store instances. Outbound buffering is owned by the TRANSPORT (the
 *  renderer client.ts outbox in direct mode, the main-process wsclient.ts
 *  queue in bridge mode) — the store's send is a pure pass-through (R11
 *  exactly-once pre-connect delivery is guaranteed there; the old store-level
 *  double buffer is gone). Declared before createAppStore so the singleton's
 *  module-load instantiation can register its rebind hook. */
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
    // W3-TRANSPORT (GATE-3.5): outbound buffering is owned by the
    // TRANSPORT — ONE outbox (renderer client.ts in direct mode, the
    // main-process wsclient.ts queue in bridge mode). R11 exactly-once
    // pre-connect delivery is guaranteed there, so the store's send is a
    // pure pass-through; the old store-level outbox (double buffering,
    // no shared backoff) is gone.
    let rawSend: SendFn = send;
    rebindRawSend = (next: SendFn): void => {
      rawSend = next;
    };
    const transportSend = (message: unknown): void => {
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

    /**
     * Apply the server config snapshot to the UI: accessibility modes,
     * TTS knobs, and (only before any layout command) the default layout
     * through the ONE choke (see state/config.ts).
     */
    const applyConfig = (config: AppConfigWire): void => {
      const patch = applyConfigToState(config, {
        canApplyDefault: !layoutApplied,
        applyDefault: (template, primary) => {
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
        },
      });
      set(patch);
    };

    /**
     * The ONE writer of adaptive.lastRejection for layout failures that
     * arrive as thrown errors rather than as planner verdicts. A rejected
     * composition must never crash the event path and must never vanish
     * silently — every caller records through here so the two conditions
     * cannot drift apart.
     */
    const recordLayoutRejection = (
      code: PlannerRejectionCode,
      where: string,
      error: unknown,
    ): void => {
      const reason = (error as Error).message;
      console.warn(`[adaptive] ${where}:`, reason);
      set({ adaptive: { ...get().adaptive, lastRejection: { code, reason } } });
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
        // ADV-F3 (2026-08-09): record the rejection instead of silently
        // dropping — the agent's layout_compose validates only the frozen
        // semantic gates (no viewport), so a small window can make a valid
        // triple fail the px floors here and the agent was told "aplicada".
        // Same structured code as the planner path (PlannerRejectionCode
        // includes "geometry").
        recordLayoutRejection("geometry", "rejecting unrenderable spec", error);
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
          set({
            notifications: pushNotification(state.notifications, {
              notificationId: command.notification_id,
              kind: command.kind,
              title: command.title,
              text: command.text,
              dueAt: null,
            }),
          });
          set({
            messages: [
              ...state.messages,
              systemMessage("n", `${command.title}: ${command.text}`),
            ],
          });
          return;
        }
        case "tts.speak": {
          pushSpeak(command.text);
          return;
        }
        case "media.state":
        case "audio.play": {
          // GATE-3.5 (R24-R27 + W3-MEDIA): defensive server-command path —
          // routed through the single MediaController like every other
          // media input; the controller merges the partial command and
          // the store's ONE subscription mirrors the authoritative result.
          applyMediaServerCommand(command);
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
      // GATE-5 (W0-SLICE + routing-parity): panel content events reduce
      // through the ONE content registry — the store routes, the owning
      // slice reduces. CONTENT_ROUTED_EVENTS is the single source of truth
      // shared with the parity test: every slice-claimed event type must
      // be routed here, every routed event must be claimed by exactly one
      // slice (tests/registry-store-parity.test.ts).
      if (CONTENT_ROUTED_EVENTS.includes(event.type)) {
        const content = contentRegistry.applyEvent(state.content, event);
        if (content !== state.content) set({ content });
        return;
      }
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
          // Server echo — the single source of truth for the conversation
          // history (no optimistic append).
          set({ messages: appendUserMessage(state.messages, event) });
          return;
        case "agent_message":
          set({ messages: appendAgentMessage(state.messages, event) });
          return;
        case "ui_command":
          // C5/A3 (GATE-3.5): the SINGLE wire-boundary normalization site —
          // every incoming ui_command frame passes through normalizeUiCommand
          // exactly once here (surface_id → surfaceId for layout.compose)
          // before applyUiCommand sees it. ws/client.ts hands the raw
          // JSON.parse frame to applyEvent untouched.
          applyUiCommand(normalizeUiCommand(event.command));
          return;
        case "confirmation_requested":
          set({ pending: confirmationFromEvent(event) });
          return;
        case "confirmation_resolved":
          set({
            pending: null,
            messages: [
              ...state.messages,
              systemMessage(
                "c",
                confirmationResolvedMessage(event.status, event.message),
              ),
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
          set({
            notifications: pushNotification(state.notifications, {
              notificationId: event.notification_id,
              kind: event.kind,
              title: event.title,
              text: event.text,
              dueAt: event.due_at,
            }),
          });
          set({
            messages: [
              ...state.messages,
              systemMessage("n", `${event.title}: ${event.text}`),
            ],
          });
          return;
        case "config_update":
          applyConfig(event.config);
          return;
        case "state_snapshot": {
          // H5 reconnect + GATE-3.5 A6: apply the canonical snapshot sent
          // once per WS connect. Authoritative server state — voice,
          // pending, media, notifications and the adaptive composition are
          // REPLACED (null/empty = absence, R30/R31).
          // GATE-5 (W0-SLICE): conversation HISTORY is never auto-restored
          // — fresh start is the central-mic hero ONLY (directive
          // 2026-08-08); the snapshot's history is stashed (server-side)
          // for an explicit resume. A same-tab reconnect keeps its
          // in-memory chat; a fresh load starts empty.
          const snap = event as StateSnapshotEvent;
          // R30 (A6): media=null is authoritative absence — the stale
          // player is CLEARED, never preserved. Snapshot restore is
          // another server-state input routed through the SAME
          // MediaController (A5/W3-MEDIA — single authority); the store's
          // ONE subscription mirrors the result into content.media.
          if (snap.media) {
            applyMediaServerEvent(snap.media);
          } else {
            resetMedia();
          }
          const patch: Partial<AppState> = {
            voiceState: snap.voice_state,
            pending: pendingConfirmationFromSnapshot(
              snap.pending_confirmation,
            ),
            // R34: notifications are authoritative — an empty snapshot
            // list CLEARS stale notification state.
            notifications: restoreNotifications(snap),
          };
          // R33: reconstruct the adaptive workspace through the SAME choke
          // live agent compositions use (registry-validated, inertia
          // guarded) — see state/snapshotRestore.ts. Invalid compositions
          // never crash the event path: the live desk is kept and the
          // rejection is observable.
          const restored = restoreAdaptiveFromSnapshot(
            snap.adaptive,
            applyAdaptiveSpec,
            (error) =>
              recordLayoutRejection(
                "invalid_shape",
                "snapshot composition rejected",
                error,
              ),
          );
          // ADV-F4 (2026-08-09): a restored composition must latch the
          // config-default guard too — without this, a later config_update
          // could land the default over the restored desk.
          if (restored) layoutApplied = true;
          set(patch);
          return;
        }
        case "media.state": {
          // GATE-3.5 (R24-R27 + W3-MEDIA): the authoritative server state
          // (agent tool / client action verdict) feeds the single
          // controller; the store's ONE subscription mirrors it.
          applyMediaServerEvent(event);
          return;
        }
        case "action_result": {
          // H1: server verdict on a client-initiated action. The UI may
          // have applied the action optimistically; failed/unsupported
          // means that state is a lie — surface it so the user knows the
          // action did not take effect.
          const error = actionResultError(event);
          if (error) set({ error });
          return;
        }
        case "tool_call":
        case "pong":
          return;
        default: {
          // GATE-5 (routing-parity, defect #1): an unknown event type must
          // NEVER be silently swallowed — the pre-fix switch had NO default
          // and dropped unlisted wire members (memory.search_results,
          // browser.dom_action) with no trace. Mirrors the applyUiCommand
          // default (C5/GATE-3.5): records visibly, NEVER throws, content
          // untouched. The union is exhaustive at compile time; this
          // catches runtime frames that bypass the type (ws JSON.parse as
          // ServerEvent) and future wire members waiting on a slice.
          const type = (event as { type?: unknown }).type;
          console.warn(
            `[store] unhandled ServerEvent type: ${typeof type === "string" ? type : String(type)}`,
          );
          return;
        }
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
        // W3-TRANSPORT: no store-level flush — the transport owns the
        // single outbox and flushes on its own open event.
        set({ connected });
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
          // GATE-5 (W0-SLICE): optimistic content commands reduce through
          // the ONE content registry — the store routes, the slice owns
          // the optimistic effect.
          case "youtube.search":
          case "browser.navigate":
          case "browser.back":
          case "browser.forward":
          case "browser.refresh":
          case "tasks.toggle":
          case "document.save": {
            const content = contentRegistry.applyCommand(state.content, command);
            if (content !== state.content) set({ content });
            break;
          }
          case "youtube.play":
          case "media.play_pause":
          case "media.seek": {
            // W3-MEDIA: optimistic user command through the controller —
            // the subscription mirrors only real changes (no track = no-op
            // = no fake media surface created).
            applyMediaUserCommand(command);
            break;
          }
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
        applyMediaPlayerUpdate(update);
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
          notifications: dismissNotification(
            get().notifications,
            notificationId,
          ),
        });
      },
    };
  });

  // GATE-3.5 (W3-MEDIA) / GATE-5 (W0-SLICE): ONE media authority —
  // content.media is DERIVED from the MediaController through this single
  // subscription (state/media.ts). The store is never a write-target for
  // media events: every wire path only APPLIES controller output, and the
  // subscription mirrors the authoritative result. Emits that produce no
  // real change leave the state object untouched — no re-render churn.
  subscribeMediaToStore(store);

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
