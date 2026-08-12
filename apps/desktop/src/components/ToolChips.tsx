/**
 * ToolChips — compact disclosure of the assistant's tool activity.
 *
 * Collapsed: one quiet chip with plain Spanish counts ("4 acciones · 2
 * mensajes"). Expanded (toggle button, aria-expanded): one chip per tool
 * call, each a label plus a status dot — done (ok-green), running
 * (accent, pulsing), error (danger red). Auto-hides when there are no
 * calls. Dark theme, no emojis, elderly-user sized tap targets.
 *
 * Presentational by design: the integrator feeds it from whatever owns
 * tool-call data (see mount notes) via `calls` / `messageCount` props.
 * The wire already carries the raw material — ServerEvent `tool_call`
 * (tool, status: running|done|error|rejected) — but the store does not
 * retain it yet, so this component holds no store binding.
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
                <span className="toolchips-label">{call.label}</span>
                <span className="toolchips-sr-only">{STATUS_LABELS[status]}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
