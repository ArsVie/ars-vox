/**
 * App store — vanilla Zustand (no React dependency) so the full event path
 * (server event -> ui_command -> layout change) is unit-testable in node.
 */

import { createStore, type StoreApi } from "zustand/vanilla";

import type { ServerEvent, UiCommand, VoiceState } from "./contracts";
import {
  computeLayout,
  DEFAULT_PRIMARY,
  type LayoutResult,
  type LayoutSpec,
  type PanelId,
} from "./layout/engine";

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

  send: SendFn;
  setConnected: (connected: boolean) => void;
  setReducedMotion: (value: boolean) => void;

  applyEvent: (event: ServerEvent) => void;
  sendText: (text: string) => void;
  stop: () => void;
  confirm: (approve: boolean) => void;
  dismissError: () => void;

  applyUiCommand: (command: UiCommand) => void;
  recompute: () => void;
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

export function createAppStore(send: SendFn): StoreApi<AppState> {
  const store = createStore<AppState>((set, get) => {
    const spec = initialSpec();
    const layout = computeLayout(spec, {
      reducedMotion: false,
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

    const applyUiCommand = (command: UiCommand): void => {
      const state = get();
      switch (command.action) {
        case "layout.apply": {
          const next: LayoutSpec = {
            template: command.template,
            primaryPanel: command.primary_panel,
            secondaryPanel: command.secondary_panel,
            preserve: command.preserve ?? true,
          };
          const same =
            state.spec.template === next.template &&
            state.spec.primaryPanel === next.primaryPanel &&
            state.spec.secondaryPanel === next.secondaryPanel;
          if (same) return;
          pushHistory();
          set({ spec: next, fullscreenPanel: null });
          recompute();
          return;
        }
        case "panel.open": {
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
          const target = command.panel_type ?? (command.panel_id as PanelId | null);
          if (!target) return;
          const panelMeta = { ...state.panelMeta };
          delete panelMeta[target];
          const next: LayoutSpec = { ...state.spec };
          if (next.primaryPanel === target) next.primaryPanel = null;
          if (next.secondaryPanel === target) next.secondaryPanel = null;
          set({
            panelMeta,
            spec: next,
            fullscreenPanel: state.fullscreenPanel === target ? null : state.fullscreenPanel,
          });
          recompute();
          return;
        }
        case "panel.set_primary": {
          pushHistory();
          set({ spec: { ...state.spec, primaryPanel: command.panel_type } });
          recompute();
          return;
        }
        case "panel.fullscreen": {
          set({ fullscreenPanel: command.panel_type });
          return;
        }
        case "layout.restore": {
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
        case "tts.speak":
        case "media.state":
        case "audio.play":
          // Slice: no media/TTS surfaces yet; the command is acknowledged by
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
          if (event.config.ui?.reduced_motion !== undefined) {
            get().setReducedMotion(event.config.ui.reduced_motion);
          }
          return;
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

      send,
      setConnected: (connected) => set({ connected }),
      setReducedMotion: (value) => {
        set({ reducedMotion: value });
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
      stop: () => get().send({ type: "stop" }),
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
