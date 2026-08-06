/**
 * Store coverage: the vertical slice event path (user text -> tool call ->
 * policy -> ui_command -> layout change -> agent response), confirmation
 * handling, error surfacing, and layout restoration.
 */

import { describe, expect, it } from "vitest";

import type { ServerEvent } from "../src/contracts";
import { createAppStore } from "../src/store";

function ts(): string {
  return new Date().toISOString();
}

const listening = (): ServerEvent => ({
  type: "state_update",
  voice_state: "listening",
  activity: null,
  created_at: ts(),
});

describe("vertical slice: open a document", () => {
  it("user text -> ui_command -> split layout -> agent response", () => {
    const sent: unknown[] = [];
    const store = createAppStore((m) => sent.push(m));

    store.getState().sendText("Open a document.");
    expect(sent).toEqual([{ type: "user_text", text: "Open a document." }]);
    // no optimistic append: the server echo is the single source of truth
    expect(store.getState().messages).toHaveLength(0);

    // server turn, mirroring the mock scripted model
    store.getState().applyEvent({
      type: "state_update",
      voice_state: "thinking",
      activity: "Open a document.",
      created_at: ts(),
    });
    store.getState().applyEvent({
      type: "user_message",
      id: "u1",
      text: "Open a document.",
      created_at: ts(),
    });
    store.getState().applyEvent({
      type: "tool_call",
      run_id: "r1",
      tool: "ui.apply_layout",
      args: { template: "split", primary_panel: "document_editor" },
      status: "running",
      result: null,
      created_at: ts(),
    });
    store.getState().applyEvent({
      type: "ui_command",
      command: {
        action: "layout.apply",
        template: "split",
        primary_panel: "document_editor",
        secondary_panel: "conversation",
        preserve: true,
      },
      created_at: ts(),
    });
    store.getState().applyEvent({
      type: "tool_call",
      run_id: "r1",
      tool: "ui.apply_layout",
      args: { template: "split", primary_panel: "document_editor" },
      status: "done",
      result: "Disposición split aplicada.",
      created_at: ts(),
    });
    store.getState().applyEvent({
      type: "agent_message",
      text: "Listo. Apliqué la disposición dividida con el documento como panel principal.",
      delta: false,
      created_at: ts(),
    });
    store.getState().applyEvent(listening());

    const state = store.getState();
    expect(state.voiceState).toBe("listening");
    expect(state.layout.template).toBe("split");

    const doc = state.layout.panels.find((p) => p.panel === "document_editor");
    const conv = state.layout.panels.find((p) => p.panel === "conversation");
    expect(doc).toBeDefined();
    expect(conv).toBeDefined();
    expect(doc!.role).toBe("primary");
    expect(doc!.visible).toBe(true);
    expect(conv!.role).toBe("secondary");
    expect(conv!.visible).toBe(true);
    expect(doc!.zIndex).toBeGreaterThan(conv!.zIndex);
    expect(doc!.width).toBeGreaterThan(conv!.width);

    const texts = state.messages.map((m) => m.text);
    expect(texts.some((t) => t.includes("Open a document."))).toBe(true);
    expect(texts.some((t) => t.includes("documento"))).toBe(true);
  });
});

describe("agent message deltas", () => {
  it("appends delta text to the last assistant message", () => {
    const store = createAppStore(() => {});
    store.getState().applyEvent({
      type: "agent_message",
      text: "Hola, ",
      delta: true,
      created_at: ts(),
    });
    store.getState().applyEvent({
      type: "agent_message",
      text: "¿qué necesitas?",
      delta: true,
      created_at: ts(),
    });
    const messages = store.getState().messages;
    expect(messages).toHaveLength(1);
    expect(messages[0].text).toBe("Hola, ¿qué necesitas?");
  });
});

describe("confirmation flow", () => {
  it("shows a pending card and sends confirm/cancel over the transport", () => {
    const sent: unknown[] = [];
    const store = createAppStore((m) => sent.push(m));
    store.getState().applyEvent({
      type: "confirmation_requested",
      pending_id: "p1",
      tool: "telegram.send_pending",
      title: "Enviar mensaje por Telegram",
      detail: "Se enviará a la persona aprobada:\nHola",
      expires_in_s: 120,
      created_at: ts(),
    });
    expect(store.getState().pending?.pendingId).toBe("p1");

    store.getState().confirm(true);
    expect(sent).toEqual([{ type: "confirm", pending_id: "p1" }]);
    expect(store.getState().pending).toBeNull();
  });

  it("resolves pending state on confirmation_resolved", () => {
    const store = createAppStore(() => {});
    store.getState().applyEvent({
      type: "confirmation_requested",
      pending_id: "p1",
      tool: "telegram.send_pending",
      title: "Enviar",
      detail: "Detalle",
      expires_in_s: 120,
      created_at: ts(),
    });
    store.getState().applyEvent({
      type: "confirmation_resolved",
      pending_id: "p1",
      status: "approved",
      message: "Mensaje enviado",
      created_at: ts(),
    });
    expect(store.getState().pending).toBeNull();
    expect(
      store.getState().messages.some((m) => m.text.includes("approved")),
    ).toBe(true);
  });
});

describe("error surfacing", () => {
  it("stores error events and clears on dismiss", () => {
    const store = createAppStore(() => {});
    store.getState().applyEvent({
      type: "error",
      message: "No pude conectar con el modelo",
      recoverable: true,
      created_at: ts(),
    });
    expect(store.getState().error?.message).toContain("modelo");
    store.getState().dismissError();
    expect(store.getState().error).toBeNull();
  });
});

describe("layout restoration", () => {
  it("layout.restore returns to the previous layout", () => {
    const store = createAppStore(() => {});
    store.getState().applyEvent({
      type: "ui_command",
      command: {
        action: "layout.apply",
        template: "split",
        primary_panel: "document_editor",
        secondary_panel: "conversation",
        preserve: true,
      },
      created_at: ts(),
    });
    expect(store.getState().layout.template).toBe("split");

    store.getState().applyEvent({
      type: "ui_command",
      command: {
        action: "layout.apply",
        template: "focus",
        primary_panel: "conversation",
        secondary_panel: null,
        preserve: true,
      },
      created_at: ts(),
    });
    expect(store.getState().layout.template).toBe("focus");

    store.getState().applyEvent({
      type: "ui_command",
      command: { action: "layout.restore" },
      created_at: ts(),
    });
    expect(store.getState().layout.template).toBe("split");
    // the original focus spec stays on the stack for one more restore
    expect(store.getState().history).toHaveLength(1);
  });
});

describe("tts speak queue", () => {
  it("enqueues tts.speak commands and drains via ttsDone", () => {
    const store = createAppStore(() => {});
    store.getState().applyEvent({
      type: "ui_command",
      command: { action: "tts.speak", text: "Hola" },
      created_at: ts(),
    });
    store.getState().applyEvent({
      type: "ui_command",
      command: { action: "tts.speak", text: "mundo" },
      created_at: ts(),
    });
    expect(store.getState().speakTexts).toEqual(["Hola", "mundo"]);
    store.getState().ttsDone();
    expect(store.getState().speakTexts).toEqual(["mundo"]);
  });

  it("stop clears the speak queue before sending the stop message", () => {
    const sent: unknown[] = [];
    const store = createAppStore((m) => sent.push(m));
    store.getState().enqueueTts("Hola");
    store.getState().enqueueTts("mundo");
    store.getState().stop();
    expect(store.getState().speakTexts).toEqual([]);
    expect(sent).toEqual([{ type: "stop" }]);
  });
});

describe("panel close", () => {
  it("closing the primary panel falls back to the conversation panel", () => {
    const store = createAppStore(() => {});
    store.getState().applyEvent({
      type: "ui_command",
      command: {
        action: "panel.open",
        panel_type: "document_editor",
        title: "Lista de la compra",
      },
      created_at: ts(),
    });
    store.getState().applyEvent({
      type: "ui_command",
      command: {
        action: "layout.apply",
        template: "split",
        primary_panel: "document_editor",
        secondary_panel: "conversation",
        preserve: true,
      },
      created_at: ts(),
    });
    expect(
      store.getState().layout.panels.find((p) => p.panel === "document_editor")?.role,
    ).toBe("primary");

    store.getState().applyEvent({
      type: "ui_command",
      command: { action: "panel.close", panel_type: "document_editor" },
      created_at: ts(),
    });
    const state = store.getState();
    const conv = state.layout.panels.find((p) => p.panel === "conversation");
    expect(conv?.role).toBe("primary");
    expect(
      state.layout.panels.find((p) => p.panel === "document_editor"),
    ).toBeUndefined();
  });
});
