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

export type VoiceState =
  | "sleeping"
  | "listening"
  | "thinking"
  | "speaking"
  | "waiting_for_confirmation"
  | "stopping"
  | "error";

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
      panel_type: PanelId;
      title?: string | null;
      content_reference?: string | null;
    }
  | {
      action: "panel.close";
      panel_type?: PanelId | null;
      panel_id?: string | null;
    }
  | { action: "panel.set_primary"; panel_type: PanelId }
  | { action: "panel.fullscreen"; panel_type: PanelId }
  | { action: "layout.restore" }
  | {
      action: "notification.show";
      notification_id: string;
      kind: string;
      title: string;
      text: string;
      sound?: boolean;
      snoozable?: boolean;
    }
  | {
      action: "media.state";
      state: string;
      title?: string | null;
      url?: string | null;
      volume?: number | null;
    }
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
  status: string;
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
  kind: string;
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
  config: Record<string, unknown> & { ui?: { reduced_motion?: boolean } };
  created_at: string;
}

export interface PongEvent {
  type: "pong";
  ts: string;
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
  | PongEvent;
