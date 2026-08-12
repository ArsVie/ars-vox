import { useState } from "react";
import { useStore } from "zustand";

import type { PanelId, TodoItem } from "../contracts";
import { useSurfaceRole } from "../roles/context";
import { appStore } from "../store";
import type { PanelMeta } from "../store";
import { PanelHeader } from "./PanelHeader";
import { BellIcon, CheckIcon } from "./icons";
import "./tasks-panel.css";

/**
 * Tasks panel — to-do's plus constant/permanent reminders. Reminders are
 * injected into the agent's context on a cadence by the backend (cron
 * style); this surface is the visible list. Toggling a to-do sends a
 * tasks.toggle command so the policy/approval path stays intact.
 *
 * UI-204: the surface adapts to its semantic role (handed down by the role
 * host through SurfaceRoleProvider):
 *   - primary   — full management list: filter chips (Todas / Pendiente /
 *                 En curso / Completadas) over the task card list, done
 *                 items included, reminders section.
 *   - companion — current tasks: pending to-dos first (filter defaults to
 *                 Pendiente, user can widen), reminders, less chrome.
 *   - support   — small high-priority summary: urgent (pending, high
 *                 priority) to-dos and the next reminder only.
 * The role host (SurfaceHost) hands the surface its role through
 * SurfaceRoleProvider — the adaptive mount is the ONLY mount. Role changes
 * never touch store.content.tasks.
 *
 * UI WAVE (leaf F): rows are cards with a colored status chip (pending =
 * dim, in-progress = accent, done = ok green, error = danger). The frozen
 * wire TodoItem carries no progress/status/error fields yet, so those are
 * read leniently and degrade gracefully: when the Python side adds them,
 * the subline and chips light up with no contract change; until then they
 * simply never render. Filter state is local component state — the store
 * contract is untouched (same reads: content.tasks + dispatchCommand).
 */

/** Lenient extras the frozen wire does not carry yet (read-only, optional).
 *  Absent = graceful degradation (chip/subline simply not rendered). */
interface TodoExtras {
  status?: unknown;
  progress?: unknown;
  error?: unknown;
}

export type TodoStatus = "pending" | "in-progress" | "done" | "error";

const STATUS_LABEL: Record<TodoStatus, string> = {
  pending: "Pendiente",
  "in-progress": "En curso",
  done: "Hecha",
  error: "Error",
};

/** True when the (optional) progress field carries a usable value. */
function hasProgress(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0;
  if (typeof value === "string") return value.trim() !== "";
  if (value !== null && typeof value === "object") {
    const p = value as { done?: unknown; total?: unknown };
    return typeof p.done === "number" && typeof p.total === "number" && p.total > 0;
  }
  return false;
}

/** Derived display status for one to-do. done is the authoritative wire
 *  flag; the optional extras only ever ADD richer states (in-progress via
 *  status/progress, error via status/error). */
export function todoStatus(todo: TodoItem): TodoStatus {
  const extras = todo as TodoItem & TodoExtras;
  if (typeof extras.error === "string" && extras.error.trim() !== "") return "error";
  if (extras.status === "error") return "error";
  if (todo.done) return "done";
  if (extras.status === "in-progress" || hasProgress(extras.progress)) {
    return "in-progress";
  }
  return "pending";
}

/** Human subline for an optional progress value: "3/5", "67%", number as
 *  percent (<= 1 treated as a fraction). Null when absent/unusable. */
export function progressLabel(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    const percent = value <= 1 ? Math.round(value * 100) : Math.round(value);
    return `${Math.max(0, Math.min(100, percent))}%`;
  }
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  if (value !== null && typeof value === "object") {
    const p = value as { done?: unknown; total?: unknown };
    if (typeof p.done === "number" && typeof p.total === "number" && p.total > 0) {
      const done = Math.max(0, Math.min(Math.round(p.total), Math.round(p.done)));
      return `${done}/${Math.round(p.total)}`;
    }
  }
  return null;
}

export type FilterKey = "todas" | "pendiente" | "en-curso" | "completadas";

export const FILTERS: readonly { key: FilterKey; label: string }[] = [
  { key: "todas", label: "Todas" },
  { key: "pendiente", label: "Pendiente" },
  { key: "en-curso", label: "En curso" },
  { key: "completadas", label: "Completadas" },
];

/** Pure filter predicate backing the chips (unit-tested directly). */
export function matchesFilter(todo: TodoItem, filter: FilterKey): boolean {
  switch (filter) {
    case "todas":
      return true;
    case "pendiente":
      return todoStatus(todo) === "pending";
    case "en-curso":
      return todoStatus(todo) === "in-progress";
    case "completadas":
      return todoStatus(todo) === "done";
  }
}

export function filterTodos(todos: TodoItem[], filter: FilterKey): TodoItem[] {
  return todos.filter((todo) => matchesFilter(todo, filter));
}

/** Default chip per role: companion is the compact "current tasks" list
 *  (pending first, done hidden until the user widens the filter). */
function defaultFilter(role: string): FilterKey {
  return role === "companion" ? "pendiente" : "todas";
}

export function TasksPanel({
  meta,
  panelId = "tasks",
}: {
  meta?: PanelMeta;
  panelId?: PanelId;
}) {
  const tasks = useStore(appStore, (s) => s.content.tasks);
  const dispatchCommand = useStore(appStore, (s) => s.dispatchCommand);
  const { role } = useSurfaceRole();
  const [filter, setFilter] = useState<FilterKey>(defaultFilter(role));

  const todos = tasks?.todos ?? [];
  const reminders = tasks?.reminders ?? [];
  const pending = todos.filter((t) => !t.done);
  const doneCount = todos.length - pending.length;

  const urgent = pending.filter((t) => t.priority === "high");
  const nextReminder = reminders[0] ?? null;

  const countFor = (key: FilterKey): number =>
    key === "todas" ? todos.length : filterTodos(todos, key).length;

  const visibleTodos = role === "support" ? urgent : filterTodos(todos, filter);
  const hasContent = todos.length > 0 || reminders.length > 0;

  const renderTodoCard = (todo: TodoItem) => {
    const status = todoStatus(todo);
    const extras = todo as TodoItem & TodoExtras;
    const progress = progressLabel(extras.progress);
    const errorText =
      typeof extras.error === "string" && extras.error.trim() !== ""
        ? extras.error.trim()
        : null;
    return (
      <li key={todo.id} className={`task-card task-card--${status}`}>
        <button
          type="button"
          className={`task-check ${todo.done ? "checked" : ""}`}
          aria-label={todo.done ? "Marcar como pendiente" : "Marcar como hecha"}
          onClick={() => dispatchCommand({ action: "tasks.toggle", task_id: todo.id })}
        >
          {todo.done ? <CheckIcon size={14} /> : null}
        </button>
        <div className="task-card-main">
          <div className="task-card-top">
            <span className="task-title">{todo.title}</span>
            <span className={`status-chip status-chip--${status}`}>
              {STATUS_LABEL[status]}
            </span>
          </div>
          <div className="task-card-meta">
            {todo.due ? <span className="task-due">{todo.due}</span> : null}
            {progress ? <span className="task-progress">{progress}</span> : null}
            {errorText ? <span className="task-error">{errorText}</span> : null}
          </div>
        </div>
      </li>
    );
  };

  return (
    <section
      className={`panel tasks-panel tasks-panel--${role}`}
      data-tasks-role={role}
    >
      {role === "primary" ? (
        <PanelHeader panelId={panelId} icon={<CheckIcon size={15} />}>
          {meta?.title ?? "Tareas"}
        </PanelHeader>
      ) : null}
      {!hasContent ? (
        <div className="content-panel-empty">
          <span className="content-panel-empty-icon">
            <CheckIcon size={30} />
          </span>
          <span className="content-panel-empty-text">
            {role === "support"
              ? "Sin tareas pendientes."
              : "No hay tareas. Pídeme que anote una."}
          </span>
        </div>
      ) : role === "support" ? (
        <div className="tasks-body">
          {urgent.length > 0 ? (
            <div className="tasks-section">
              <span className="tasks-section-label">
                {`Urgentes · ${urgent.length}/${pending.length}`}
              </span>
              <ul className="tasks-list">{urgent.map(renderTodoCard)}</ul>
            </div>
          ) : (
            <div className="tasks-section">
              <span className="tasks-section-label">Sin tareas urgentes</span>
              {pending.length > 0 ? (
                <ul className="tasks-list">{pending.slice(0, 1).map(renderTodoCard)}</ul>
              ) : null}
            </div>
          )}
          {nextReminder ? (
            <span className="tasks-next-reminder">
              <BellIcon size={12} />
              {`Próximo · ${nextReminder.title} · ${nextReminder.next_fire}`}
            </span>
          ) : null}
        </div>
      ) : (
        <div className="tasks-body">
          {todos.length > 0 ? (
            <div className="filter-chips" role="group" aria-label="Filtrar tareas">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  className={`filter-chip ${filter === f.key ? "filter-chip--active" : ""}`}
                  aria-pressed={filter === f.key}
                  onClick={() => setFilter(f.key)}
                >
                  <span className="filter-chip-label">{f.label}</span>
                  <span className="filter-chip-count">{countFor(f.key)}</span>
                </button>
              ))}
            </div>
          ) : null}
          {visibleTodos.length > 0 ? (
            <ul className="tasks-list task-cards">{visibleTodos.map(renderTodoCard)}</ul>
          ) : (
            <div className="tasks-filter-empty">No hay tareas en este filtro.</div>
          )}
          {reminders.length > 0 ? (
            <div className="tasks-section">
              <span className="tasks-section-label">
                <BellIcon size={12} /> Recordatorios
              </span>
              <ul className="tasks-list">
                {reminders.map((rem) => (
                  <li key={rem.id} className="reminder-row">
                    <span className="reminder-title">{rem.title}</span>
                    <span className="reminder-cadence">
                      {`${rem.cadence} · próxima ${rem.next_fire}`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
