/**
 * App store — vanilla Zustand (no React dependency) so the full event path
 * (server event -> ui_command -> layout change) is unit-testable in node.
 */

import { createStore, type StoreApi } from "zustand/vanilla";

import type {
  AppConfigWire,
  BrowserNavigateEvent,
  DocumentKind,
  MediaKind,
  MediaSource,
  MediaState,
  MediaStateEvent,
  ReminderItem,
  ServerEvent,
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
  type LayoutResult,
  type LayoutSpec,
  type PanelId,
  type SlotName,
  type Viewport,
} from "./layout/engine";

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
  recompute: () => void;
  enqueueTts: (text: string) => void;
  ttsDone: () => void;
}

let messageSeq = 0;
function nextMessageId(prefix: string): string {
  messageSeq += 1;
  return `${prefix}${messageSeq.toString(36)}`;
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

export function createAppStore(send: SendFn): StoreApi<AppState> {
  const store = createStore<AppState>((set, get) => {
    /** True once any server layout command has been applied; guards the
     *  config-driven default from clobbering later user state on reconnect. */
    let layoutApplied = false;
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
        case "media.state":
        case "audio.play":
          // Slice: no media surface yet; the command is acknowledged by
          // the service but has no visible effect here.
          return;
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

      send,
      setConnected: (connected) => set({ connected }),
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
        // Local stop: clear the speak queue so TtsPlayer interrupts
        // playback, then tell the service to cancel the running turn.
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

export function bindTransport(send: SendFn): void {
  appStore.setState({ send });
}
