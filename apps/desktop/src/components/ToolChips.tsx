/**
 * ToolChips — compact disclosure of the assistant's tool activity.
 *
 * Collapsed: one quiet chip with plain Spanish counts ("4 acciones · 2
 * mensajes"). Expanded (toggle button, aria-expanded): one ROW per tool
 * call in the gallery "Tool Chips" pattern — a small status icon on the
 * left, a bold Spanish operation label, and, when the data carries one,
 * a rounded mono target chip with the tool argument summary (title, URL,
 * file name, command). Status: done (ok-green), running (accent,
 * pulsing), error (danger red). Auto-hides when there are no calls.
 * Dark theme, no emojis, elderly-user sized rows, high-contrast ink.
 *
 * Presentational by design: the integrator feeds it from whatever owns
 * tool-call data (see mount notes) via `calls` / `messageCount` props.
 * The wire already carries the raw material — ServerEvent `tool_call`
 * (tool, args, status) — but the store does not retain it yet, so this
 * component holds no store binding.
 *
 * Label contract (unchanged): each call is `{ label, status }`. The
 * label is either a plain Spanish phrase ("Buscar receta") or a
 * wire-style `tool · target` pair ("media.play · Mi video"). Known tool
 * names map to Spanish operation labels (media.play → "Reproducción",
 * ui.set_primary_panel → "Abrir panel"); unknown names render as-is.
 * The mono target chip renders only when the label itself carries a
 * target after " · " — targets or durations the wire does not provide
 * are never invented.
 */

import { useId, useState } from "react";

import "./tool-chips.css";

export type ToolCallStatus = "done" | "running" | "error";

export interface ToolCallChip {
  label: string;
  status?: ToolCallStatus;
}

export interface ToolChipsProps {
  /** Tool calls of the current activity. Undefined/empty hides the chip. */
  calls?: ToolCallChip[];
  /** Assistant message count shown in the collapsed summary. */
  messageCount?: number;
  /** Controlled expansion (optional). When provided it wins over state. */
  expanded?: boolean;
  /** Initial expansion when uncontrolled (default: collapsed). */
  defaultExpanded?: boolean;
  /** Notified with the next value on every toggle (controlled mode). */
  onToggle?: (open: boolean) => void;
  className?: string;
}

/** Spanish status names for screen readers (dots are decorative). */
const STATUS_LABELS: Record<ToolCallStatus, string> = {
  done: "finalizada",
  running: "en curso",
  error: "con error",
};

/** Spanish operation labels for known wire tool names (gallery pattern). */
const TOOL_OPERATIONS: Record<string, string> = {
  "media.play": "Reproducción",
  "media.play_pause": "Reproducción",
  "media.seek": "Reproducción",
  "media.select_result": "Reproducción",
  "media.search_results": "Búsqueda",
  "audio.play": "Reproducción",
  "youtube.play": "Reproducción",
  "youtube.search": "Búsqueda",
  "search.push": "Búsqueda",
  "memory.search_results": "Búsqueda",
  "memory.buffer": "Guardar en memoria",
  "browser.navigate": "Abrir página",
  "browser.dom_action": "Acción en página",
  "browser.js": "Acción en página",
  "web.dom": "Acción en página",
  "ui.set_primary_panel": "Abrir panel",
  "app.alert": "Aviso",
  "image.set": "Mostrar imagen",
};

/** Domain fallback when a tool name has no exact mapping. */
const TOOL_DOMAINS: Record<string, string> = {
  media: "Reproducción",
  audio: "Reproducción",
  youtube: "Reproducción",
  browser: "Navegación",
  web: "Página web",
  memory: "Memoria",
  search: "Búsqueda",
  image: "Imagen",
  app: "Interfaz",
  ui: "Interfaz",
  system: "Sistema",
};

/** Spanish operation label for a tool name (unknown names stay raw). */
function operationLabel(name: string): string {
  return TOOL_OPERATIONS[name] ?? TOOL_DOMAINS[name.split(".")[0]] ?? name;
}

/**
 * Splits a `tool · target` label into [operation, target]. Labels without
 * a separator (plain Spanish phrases) come back whole with no target —
 * a target is only ever the label's own text, never invented.
 */
function splitLabel(label: string): [string, string | undefined] {
  const [first, ...rest] = label.split(" · ");
  const target = rest.join(" · ");
  if (first.trim() === "" || target.trim() === "") return [label, undefined];
  return [first, target];
}

/** Demo fixture for the integrator: one of each status + a done pair. */
export const TOOLCHIPS_DEMO: { calls: ToolCallChip[]; messageCount: number } = {
  calls: [
    { label: "Buscar receta", status: "done" },
    { label: "Abrir página", status: "running" },
    { label: "Guardar nota", status: "error" },
    { label: "Leer artículo", status: "done" },
  ],
  messageCount: 2,
};

function countText(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function ToolChips({
  calls = [],
  messageCount = 0,
  expanded,
  defaultExpanded = false,
  onToggle,
  className,
}: ToolChipsProps) {
  const [internalOpen, setInternalOpen] = useState(defaultExpanded);
  const open = expanded ?? internalOpen;
  const listId = useId();

  // Auto-hide: no calls means nothing to disclose.
  if (calls.length === 0) return null;

  const summary = `${countText(calls.length, "acción", "acciones")} · ${countText(
    messageCount,
    "mensaje",
    "mensajes",
  )}`;

  const toggle = (): void => {
    const next = !open;
    setInternalOpen(next);
    onToggle?.(next);
  };

  return (
    <div className={`toolchips${className ? ` ${className}` : ""}`}>
      <button
        type="button"
        className="toolchips-summary"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={`Actividad del asistente: ${summary}`}
        onClick={toggle}
      >
        <span className="toolchips-summary-text">{summary}</span>
        <span className="toolchips-chevron" aria-hidden="true" />
      </button>
      {open ? (
        <ul id={listId} className="toolchips-list" role="list">
          {calls.map((call, index) => {
            const status: ToolCallStatus = call.status ?? "done";
            const [operation, target] = splitLabel(call.label);
            return (
              <li
                key={`${call.label}-${index}`}
                className="toolchips-item"
                role="listitem"
                data-status={status}
              >
                <span
                  className={`toolchips-dot toolchips-dot--${status}`}
                  aria-hidden="true"
                />
                <span className="toolchips-label">
                  {operationLabel(operation)}
                </span>
                {target !== undefined ? (
                  <>
                    <span className="toolchips-sep" aria-hidden="true">
                      ·
                    </span>
                    <span className="toolchips-target">{target}</span>
                  </>
                ) : null}
                <span className="toolchips-sr-only">
                  {STATUS_LABELS[status]}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
