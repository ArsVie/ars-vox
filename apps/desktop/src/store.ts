/**
 * App store — vanilla Zustand (no React dependency) so the full event path
 * (server event -> ui_command -> layout change) is unit-testable in node.
 */

import { createStore, type StoreApi } from "zustand/vanilla";

import type {
  ActionResultEvent,
  AppConfigWire,
  BrowserNavigateEvent,
  DocumentKind,
  MediaKind,
  MediaSource,
  MediaState,
  MediaStateEvent,
  ReminderItem,
  ServerEvent,
  StateSnapshotEvent,
  TodoItem,
  UiCommand,
  VoiceState,
  YoutubeVideoResult,
} from "./contracts";
import {
  computeLayout,
  DEFAULT_PRIMARY,
  isPanelId,
  resolveTemplate,
  TEMPLATE_SLOTS,
  type LayoutResult,
  type LayoutSpec,
  type LayoutTemplateId,
  type PanelId,
  type SlotName,
  type Viewport,
} from "./layout/engine";
import { surfaceRegistry } from "./roles/registry";
import { resolveLayout, type ResolvedAssignment } from "./roles/fallback";
import type { LayoutSpec as AdaptiveLayoutSpec } from "./adaptive/contracts";
import {
  applyOverrides,
  EMPTY_OVERRIDES,
  mergeOverrideIntent,
  type OverrideIntent,
  type OverrideSet,
} from "./adaptive/overrides";
import { scoreChange } from "./layout/inertia";

/** Default content viewport used until the renderer reports real size. */
export const DEFAULT_VIEWPORT: Viewport = { width: 1280, height: 800 };

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
}

export interface PanelMeta {
  title?: string;
  contentReference?: string;
}

/**
 * UI-103 adaptive state: the last validated adaptive LayoutSpec plus its
 * role-resolved assignments (empty until the agent sends one).
 * UI-302: plus the persistent user constraint set (pin/stick/position/...)
 * that the override layer applies AFTER planner output.
 */
export interface AdaptiveState {
  spec: AdaptiveLayoutSpec | null;
  assignments: ResolvedAssignment[];
  /** UI-302: active user layout constraints, keyed by surfaceId. */
  overrides: OverrideSet;
}

export const EMPTY_ADAPTIVE: AdaptiveState = {
  spec: null,
  assignments: [],
  overrides: EMPTY_OVERRIDES,
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

export interface MediaContent {
  state: MediaState;
  source: MediaSource;
  kind: MediaKind;
  title: string;
  videoId: string | null;
  url: string | null;
  positionS: number;
  durationS: number;
  volume: number;
}

export interface PanelContent {
  youtube?: YoutubeContent;
  browser?: BrowserContent;
  document_editor?: DocumentContent;
  tasks?: TasksContent;
  media?: MediaContent;
}

export const EMPTY_MEDIA: MediaContent = {
  state: "stopped",
  source: "local",
  kind: "audio",
  title: "",
  videoId: null,
  url: null,
  positionS: 0,
  durationS: 0,
  volume: 1,
};

export type SendFn = (message: unknown) => void;

export interface AppState {
  connected: boolean;
  voiceState: VoiceState;
  activity: string | null;
  messages: ChatMessage[];
  spec: LayoutSpec;
  layout: LayoutResult;
  /** Stack of previous specs for layout.restore. */
  history: LayoutSpec[];
  panelMeta: Partial<Record<PanelId, PanelMeta>>;
  pending: ConfirmationInfo | null;
  error: ErrorInfo | null;
  fullscreenPanel: PanelId | null;
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
  /** UI-103: validated adaptive LayoutSpec + role-resolved assignments. */
  adaptive: AdaptiveState;
  /** Per-surface state bag keyed by surfaceId (UI-103). The role framework
   *  never touches this on role/slot changes — surface state survives. */
  surfaceState: Record<string, Record<string, unknown>>;

  send: SendFn;
  setConnected: (connected: boolean) => void;
  setReducedMotion: (value: boolean) => void;
  setViewport: (viewport: Viewport) => void;

  applyEvent: (event: ServerEvent) => void;
  sendText: (text: string) => void;
  stop: () => void;
  confirm: (approve: boolean) => void;
  dismissError: () => void;

  /** Local UI action: toggle a panel's fullscreen state (never sent to the server). */
  toggleFullscreen: (panel: PanelId) => void;

  /** User-initiated command: optimistic local effect + send to the server. */
  dispatchCommand: (command: UiCommand) => void;

  applyUiCommand: (command: UiCommand) => void;
  /** UI-103: validate + apply an adaptive LayoutSpec (registry + fallback
   *  ladder). Throws on invalid specs; state is never partially updated.
   *  UI-302: options carry the user-initiated signal (bypasses UI-207's
   *  damping wall) and user override intents (applied AFTER the planner
   *  output — explicit user constraints beat planner preferences). */
  applyAdaptiveSpec: (
    spec: AdaptiveLayoutSpec,
    options?: ApplyAdaptiveSpecOptions,
  ) => void;
  /** UI-103: write a per-surface state value (keyed by surfaceId). */
  setSurfaceState: (surfaceId: string, key: string, value: unknown) => void;
  recompute: () => void;
  enqueueTts: (text: string) => void;
  ttsDone: () => void;
}

let messageSeq = 0;
function nextMessageId(prefix: string): string {
  messageSeq += 1;
  return `${prefix}${messageSeq.toString(36)}`;
}

/**
 * H7 (GATE-2.5): extract a YouTube video id from a watch/embed/short URL so
 * the media.state COMMAND path (UiCommandEvent media.state carries only
 * url/title/volume — no video_id field) can drive the real YouTube iframe
 * surface. Non-YouTube or unparseable urls yield null.
 */
function mediaVideoIdFromUrl(url: string | null): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null; // local path or bare name — not a YouTube URL
  }
  const host = parsed.hostname.replace(/^www\./, "");
  if (host === "youtu.be") {
    const id = parsed.pathname.slice(1);
    return id.length > 0 ? id : null;
  }
  if (host === "youtube.com" || host === "m.youtube.com") {
    const v = parsed.searchParams.get("v");
    if (v) return v;
    const embed = parsed.pathname.match(/^\/embed\/([\w-]+)/);
    if (embed) return embed[1];
  }
  return null;
}

/**
 * H7 (GATE-2.5): the media.state COMMAND payload (MediaStateChange) is a
 * partial update — it carries state/title/url/volume but no source/kind/
 * video_id/position. Merge it over the current media surface state (the
 * same surface the MediaStateEvent path populates), deriving the youtube
 * source/kind/videoId from the url when one is provided.
 */
function applyMediaStateCommand(
  state: AppState,
  command: Extract<UiCommand, { action: "media.state" }>,
): Partial<AppState> {
  const m = state.content.media ?? EMPTY_MEDIA;
  const url = command.url ?? m.url;
  const videoId =
    command.url != null ? (mediaVideoIdFromUrl(command.url) ?? m.videoId) : m.videoId;
  const isYoutube = videoId !== null;
  return {
    content: {
      ...state.content,
      media: {
        ...m,
        state: command.state,
        title: command.title ?? m.title,
        url,
        videoId,
        source: command.url != null ? (isYoutube ? "youtube" : "local") : m.source,
        kind: command.url != null ? (isYoutube ? "video" : "audio") : m.kind,
        volume: command.volume ?? m.volume,
      },
    },
  };
}

/**
 * H7 (GATE-2.5): the audio.play COMMAND payload names an asset (url, path or
 * bare name). Treat it as a fresh local audio track on the media surface —
 * the same state the MediaStateEvent path would carry for local audio.
 */
function applyAudioPlayCommand(
  state: AppState,
  command: Extract<UiCommand, { action: "audio.play" }>,
): Partial<AppState> {
  const m = state.content.media ?? EMPTY_MEDIA;
  const asset = command.asset;
  const isUrl =
    /^(https?:)?\/\//.test(asset) || asset.startsWith("/") || asset.startsWith(".");
  const title = m.title || asset.split(/[\\/]/).pop() || asset;
  return {
    content: {
      ...state.content,
      media: {
        ...m,
        state: "playing",
        source: "local",
        kind: "audio",
        title,
        url: isUrl ? asset : m.url,
        videoId: null,
        positionS: 0,
      },
    },
  };
}

function initialSpec(): LayoutSpec {
  return {
    template: "focus",
    primaryPanel: DEFAULT_PRIMARY,
    secondaryPanel: null,
    preserve: true,
  };
}

function slotsEqual(
  a: LayoutSpec["slots"],
  b: LayoutSpec["slots"],
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  for (const slot of ["main", "side", "rail", "dock"] as SlotName[]) {
    if (a[slot] !== b[slot]) return false;
  }
  return true;
}

/** H5: raw transport send slot for the outbound buffer. Rebound by
 *  bindTransport (singleton) or left as the createAppStore argument for
 *  per-store instances; the store's `send` stays the buffering wrapper
 *  so reconnect sends are queued, never silently dropped. Declared
 *  before createAppStore so the singleton's module-load instantiation
 *  can register its rebind hook. */
let rebindRawSend: (send: SendFn) => void = () => {};

export function createAppStore(send: SendFn): StoreApi<AppState> {
  const store = createStore<AppState>((set, get) => {
    /** True once any server layout command has been applied; guards the
     *  config-driven default from clobbering later user state on reconnect. */
    let layoutApplied = false;
    // H5 reconnect: outbound buffering. The raw transport send is rebound
    // by bindTransport (the singleton); per-store instances keep the send
    // passed to createAppStore. While the store is in a known-disconnected
    // state (connected before, now not), outgoing messages are queued and
    // flushed in order on the next connect — the WebSocket client's send()
    // silently drops frames when the socket is not OPEN, which is exactly
    // the loss this buffer prevents. Before the FIRST connection sends
    // pass straight through (legacy startup behavior, tiny window).
    let rawSend: SendFn = send;
    let hasConnected = false;
    const outbox: unknown[] = [];
    const OUTBOX_CAP = 200;
    rebindRawSend = (next: SendFn): void => {
      rawSend = next;
    };
    const transportSend = (message: unknown): void => {
      if (hasConnected && !get().connected) {
        outbox.push(message);
        if (outbox.length > OUTBOX_CAP) outbox.shift();
        return;
      }
      rawSend(message);
    };
    const spec = initialSpec();
    const layout = computeLayout(spec, {
      reducedMotion: false,
      viewport: DEFAULT_VIEWPORT,
      mounted: new Set(),
      previous: null,
    });

    const recompute = (): void => {
      const state = get();
      const mounted = new Set<PanelId>(
        Object.keys(state.panelMeta) as PanelId[],
      );
      const next = computeLayout(state.spec, {
        reducedMotion: state.reducedMotion,
        viewport: state.viewport,
        mounted,
        previous: state.layout,
      });
      set({ layout: next });
    };

    const pushHistory = (): void => {
      const state = get();
      const history = [...state.history, state.spec];
      if (history.length > 10) history.shift();
      set({ history });
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
        const template =
          typeof ui.default_template === "string" && ui.default_template
            ? resolveTemplate(ui.default_template)
            : null;
        if (template && template !== state.spec.template) {
          const primaryPanel =
            typeof ui.default_primary === "string" &&
            isPanelId(ui.default_primary) &&
            ui.default_primary !== state.spec.primaryPanel
              ? ui.default_primary
              : state.spec.primaryPanel;
          patch.spec = { ...state.spec, template, primaryPanel };
        }
      }
      set(patch);
      if (patch.spec) recompute();
    };

    /**
     * UI-103: validate the adaptive LayoutSpec against the surface registry,
     * resolve every role through the deterministic fallback ladder, and
     * store the result. Invalid specs throw and never reach state.
     *
     * UI-207: spatial inertia guard — the ONLY wave-2 store.ts integration.
     * After validation, the pure scorer (layout/inertia.ts) decides whether
     * applying the requested spec is worth its movement cost. Agent chatter
     * (equivalent layouts, sub-bar movement, unjustified template changes)
     * is damped: the current composition is kept untouched (zero churn).
     * User-initiated changes and primary re-focusing always apply — the
     * policy never blocks a real signal. The legacy engine path
     * (applyUiCommand / layout.apply) does not flow through this choke
     * point and is untouched.
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
      const overrides = options.overrideIntent
        ? mergeOverrideIntent(state.adaptive.overrides, options.overrideIntent, spec)
        : state.adaptive.overrides;
      const constrained = applyOverrides(
        spec,
        overrides,
        surfaceRegistry.registeredIds(),
      );
      const assignments = resolveLayout(constrained, surfaceRegistry);
      const userInitiated =
        options.userInitiated === true || options.overrideIntent !== undefined;
      const verdict = scoreChange(state.adaptive.spec, constrained, {
        userInitiated,
      });
      if (verdict.decision === "keep") {
        // No layout churn — but a fresh constraint set must still persist
        // (a no-op user command still pins for future planner rounds).
        if (overrides !== state.adaptive.overrides) {
          set({ adaptive: { ...state.adaptive, overrides } });
        }
        return;
      }
      set({ adaptive: { spec: constrained, assignments, overrides } });
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

    const applyUiCommand = (command: UiCommand): void => {
      const state = get();
      switch (command.action) {
        case "layout.apply": {
          layoutApplied = true;
          const next: LayoutSpec = {
            template: command.template,
            primaryPanel: command.primary_panel,
            secondaryPanel: command.secondary_panel,
            slots: command.slots ? { ...command.slots } : undefined,
            preserve: command.preserve ?? true,
          };
          const same =
            state.spec.template === next.template &&
            state.spec.primaryPanel === next.primaryPanel &&
            state.spec.secondaryPanel === next.secondaryPanel &&
            slotsEqual(state.spec.slots, next.slots);
          if (same) return;
          pushHistory();
          set({ spec: next, fullscreenPanel: null });
          recompute();
          return;
        }
        case "panel.open": {
          // Overlay panels (confirmation/notification) use their own
          // channels; only layout panels enter the panel registry.
          if (!isPanelId(command.panel_type)) return;
          const panelMeta = {
            ...state.panelMeta,
            [command.panel_type]: {
              title: command.title ?? undefined,
              contentReference: command.content_reference ?? undefined,
            },
          };
          set({ panelMeta });
          recompute();
          return;
        }
        case "panel.close": {
          const target = isPanelId(command.panel_type ?? "")
            ? (command.panel_type as PanelId)
            : (command.panel_id as PanelId | null);
          if (!target) return;
          const panelMeta = { ...state.panelMeta };
          delete panelMeta[target];
          const next: LayoutSpec = { ...state.spec };
          if (next.primaryPanel === target) next.primaryPanel = null;
          if (next.secondaryPanel === target) next.secondaryPanel = null;
          if (next.slots) {
            const slots = { ...next.slots };
            for (const slot of Object.keys(slots) as SlotName[]) {
              if (slots[slot] === target) slots[slot] = null;
            }
            next.slots = slots;
          }
          set({
            panelMeta,
            spec: next,
            fullscreenPanel: state.fullscreenPanel === target ? null : state.fullscreenPanel,
          });
          recompute();
          return;
        }
        case "panel.set_primary": {
          if (!isPanelId(command.panel_type)) return;
          layoutApplied = true;
          pushHistory();
          set({
            spec: {
              ...state.spec,
              primaryPanel: command.panel_type,
              slots: state.spec.slots
                ? { ...state.spec.slots, main: command.panel_type }
                : undefined,
            },
          });
          recompute();
          return;
        }
        case "panel.fullscreen": {
          if (!isPanelId(command.panel_type)) return;
          set({ fullscreenPanel: command.panel_type });
          return;
        }
        case "layout.restore": {
          layoutApplied = true;
          const history = [...state.history];
          const previous = history.pop();
          if (!previous) return;
          set({ history, spec: previous, fullscreenPanel: null });
          recompute();
          return;
        }
        case "notification.show": {
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
          // H7 (GATE-2.5): the media surface exists — merge the backend
          // command into the surface state (same state MediaStateEvent
          // populates) instead of dropping it.
          set(applyMediaStateCommand(state, command));
          return;
        }
        case "audio.play": {
          // H7 (GATE-2.5): surface the named asset as a local audio track.
          set(applyAudioPlayCommand(state, command));
          return;
        }
      }
    };

    const applyEvent = (event: ServerEvent): void => {
      const state = get();
      switch (event.type) {
        case "state_update":
          set({ voiceState: event.voice_state, activity: event.activity ?? null });
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
          applyUiCommand(event.command);
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
          // H5 reconnect: apply the canonical snapshot sent once per WS
          // connect. Authoritative server state — pending card, open
          // panels and voice are REPLACED (a reconnect after a service
          // restart must clear stale UI state, not merge into it). Media
          // is restored only when the service reports it; an absent media
          // field leaves the current player untouched (no fabricated
          // "stopped" — the next media.state event re-syncs).
          const snap = event as StateSnapshotEvent;
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
          };
          const panelMeta: Partial<Record<PanelId, PanelMeta>> = {};
          for (const p of snap.layout?.panels ?? []) {
            if (isPanelId(p.panel_type)) {
              panelMeta[p.panel_type as PanelId] = {
                title: p.title ?? undefined,
                contentReference: p.content_reference ?? undefined,
              };
            }
          }
          patch.panelMeta = panelMeta;
          layoutApplied = true; // snapshot is authoritative server layout
          // Template upgrade: the snapshot carries panels, not a template.
          // The engine always anchors conversation (affinity: side/main) and
          // hides panels that fit no offered slot — on a one-slot template a
          // restored non-conversation panel would come back invisible. Step
          // up to "split" (the canonical two-panel template) so the engine's
          // deterministic fill places restored panels (conversation -> side,
          // first restored panel -> main). No history push — a reconnect
          // restore is not an undoable user action.
          const restored = Object.keys(panelMeta) as PanelId[];
          const nonConversation = restored.filter((p) => p !== DEFAULT_PRIMARY);
          if (
            nonConversation.length > 0 &&
            (TEMPLATE_SLOTS[state.spec.template as LayoutTemplateId] ?? TEMPLATE_SLOTS.split)
              .length < 2
          ) {
            patch.spec = { ...state.spec, template: "split" };
          }
          if (snap.media) {
            patch.content = {
              ...state.content,
              media: {
                state: snap.media.state,
                source: snap.media.source,
                kind: snap.media.kind,
                title: snap.media.title,
                videoId: snap.media.video_id,
                url: snap.media.url,
                positionS: snap.media.position_s,
                durationS: snap.media.duration_s,
                volume: snap.media.volume,
              },
            };
          }
          set(patch);
          recompute();
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
          set({
            content: {
              ...state.content,
              media: {
                state: ev.state,
                source: ev.source,
                kind: ev.kind,
                title: ev.title,
                videoId: ev.video_id,
                url: ev.url,
                positionS: ev.position_s,
                durationS: ev.duration_s,
                volume: ev.volume,
              },
            },
          });
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
      spec,
      layout,
      history: [],
      panelMeta: {},
      pending: null,
      error: null,
      fullscreenPanel: null,
      reducedMotion: false,
      largeText: false,
      highContrast: false,
      ttsSpeed: 1.0,
      ttsQueueMax: 10,
      viewport: DEFAULT_VIEWPORT,
      speakTexts: [],
      content: {},
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
        recompute();
      },
      setViewport: (viewport) => {
        set({ viewport });
        recompute();
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
        set({ fullscreenPanel: state.fullscreenPanel === panel ? null : panel });
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
            set({
              content: {
                ...state.content,
                media: {
                  state: "playing",
                  source: "youtube",
                  kind: "video",
                  title: command.title,
                  videoId: command.video_id,
                  url: `https://www.youtube.com/embed/${command.video_id}`,
                  positionS: 0,
                  durationS: 0,
                  volume: state.content.media?.volume ?? 1,
                },
              },
            });
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
            const m = state.content.media;
            if (m && m.state !== "stopped") {
              set({
                content: {
                  ...state.content,
                  media: { ...m, state: m.state === "playing" ? "paused" : "playing" },
                },
              });
            }
            break;
          }
          case "media.seek": {
            const m = state.content.media;
            if (m) {
              set({
                content: { ...state.content, media: { ...m, positionS: command.position_s } },
              });
            }
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

      applyUiCommand,
      applyAdaptiveSpec,
      setSurfaceState,
      recompute,
      enqueueTts: pushSpeak,
      ttsDone: () => {
        set({ speakTexts: get().speakTexts.slice(1) });
      },
    };
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
