import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";

import { appStore } from "../store";
import "./selection-actions.css";

/**
 * Leaf G (Wave UI) — SelectionActions: floating action bar over the
 * document surface.
 *
 * When the user selects text inside the document panel, a floating pill
 * bar appears next to the selection with four actions: Explicar, Mejorar,
 * Acortar, Leer en voz alta. Clicking an action composes a Spanish
 * instruction and sends it through the store's sendText hook — the same
 * user_text path as the conversation input (no optimistic append: the
 * server echoes the message back).
 *
 * Behavior guarantees:
 *   - the bar never steals focus and never blocks text editing: no
 *     autofocus, and mousedown on the bar is prevented so the selection
 *     and the editor's focus survive a click;
 *   - the selection TEXT is captured when the bar appears, so clicking
 *     an action still works after the browser collapses the selection;
 *   - Escape, tapping outside, scrolling the panel, or collapsing/moving
 *     the selection closes the bar.
 *
 * Caveats (pdf/epub): epub.js renders inside an iframe — selections made
 * there belong to the iframe's document and never reach
 * window.getSelection, so the bar only surfaces for the rendered text
 * reader (and the pdf text layer, when the engine exposes one).
 */
const MAX_SELECTION_LENGTH = 500;

const ACTIONS: ReadonlyArray<{
  key: string;
  label: string;
  compose: (text: string) => string;
}> = [
  { key: "explicar", label: "Explicar", compose: (t) => `Explicá esto: "${t}"` },
  { key: "mejorar", label: "Mejorar", compose: (t) => `Mejorá esto: "${t}"` },
  { key: "acortar", label: "Acortar", compose: (t) => `Acortá esto: "${t}"` },
  { key: "leer", label: "Leer en voz alta", compose: (t) => `Leé en voz alta: "${t}"` },
];

interface BarState {
  text: string;
  top: number;
  left: number;
}

/** Collapse whitespace, drop double quotes (they delimit the instruction
 *  payload) and cap the length so a huge selection cannot flood the
 *  conversation. */
function cleanSelection(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .replace(/"/g, "'")
    .trim()
    .slice(0, MAX_SELECTION_LENGTH);
}

export function SelectionActions() {
  const sendText = useStore(appStore, (s) => s.sendText);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const [bar, setBar] = useState<BarState | null>(null);

  useEffect(() => {
    // SSR-safe: the listeners only make sense in a real browser surface.
    if (typeof window === "undefined" || typeof document === "undefined") return;
    const root = rootRef.current;
    const panel = root?.closest?.(".document-panel") ?? null;

    const onSelectionChange = (): void => {
      const selection = window.getSelection?.();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        setBar(null);
        return;
      }
      const anchor = selection.anchorNode;
      const surface = panel ?? root;
      if (!anchor || !surface || !surface.contains(anchor)) {
        setBar(null);
        return;
      }
      const text = cleanSelection(selection.toString());
      if (!text) {
        setBar(null);
        return;
      }
      const rect = selection.getRangeAt(0).getBoundingClientRect?.();
      const viewportWidth = window.innerWidth || 0;
      const left =
        viewportWidth > 0
          ? Math.max(8, Math.min(rect?.left ?? 0, viewportWidth - 360))
          : (rect?.left ?? 0);
      setBar({ text, top: Math.max(8, (rect?.bottom ?? 0) + 8), left });
    };

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setBar(null);
    };

    const onPointerDown = (e: PointerEvent): void => {
      const barEl = barRef.current;
      if (!barEl) return;
      const target = e.target as { closest?: (sel: string) => unknown } | null;
      const inside =
        typeof target?.closest === "function" &&
        target.closest(".selection-actions-bar") !== null;
      if (!inside) setBar(null);
    };

    const onScroll = (): void => setBar(null);

    document.addEventListener("selectionchange", onSelectionChange);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    panel?.addEventListener("scroll", onScroll, { capture: true });

    return () => {
      document.removeEventListener("selectionchange", onSelectionChange);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
      panel?.removeEventListener("scroll", onScroll, { capture: true });
    };
  }, []);

  const runAction = (compose: (text: string) => string): void => {
    if (!bar) return;
    sendText(compose(bar.text));
    setBar(null);
  };

  return (
    <div className="selection-actions" ref={rootRef}>
      {bar ? (
        <div
          ref={barRef}
          className="selection-actions-bar"
          role="toolbar"
          aria-label="Acciones sobre el texto seleccionado"
          style={{ top: bar.top, left: bar.left }}
          onMouseDown={(e) => e.preventDefault()}
        >
          {ACTIONS.map((action) => (
            <button
              key={action.key}
              type="button"
              className="selection-actions-btn"
              onClick={() => runAction(action.compose)}
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
