import { useStore } from "zustand";

import type { SurfaceRole } from "../adaptive/contracts";
import type { TodoItem } from "../contracts";
import { useSurfaceRole, type SurfaceRoleInfo } from "../roles/context";
import { appStore } from "../store";
import { PanelHeader } from "./PanelHeader";
import { BellIcon, CheckIcon } from "./icons";

/**
 * Tasks panel — to-do's plus constant/permanent reminders. Reminders are
 * injected into the agent's context on a cadence by the backend (cron
 * style); this surface is the visible list. Toggling a to-do sends a
 * tasks.toggle command so the policy/approval path stays intact.
 *
 * UI-204: the surface adapts to its semantic role (handed down by the role
 * host through SurfaceRoleProvider):
 *   - primary   — full management list (pending + done + reminders).
 *   - companion — current tasks: pending to-dos plus reminders, less chrome.
 *   - support   — small high-priority summary: urgent (pending, high
 *                 priority) to-dos and the next reminder only.
 * The legacy PanelHost mount has no role provider — that renders as primary
 * (current behavior). Role changes never touch store.content.tasks.
 */

/** Roles this surface can render (mirrors its registry declaration). */
const TASKS_CAPABILITIES: readonly SurfaceRole[] = [
  "primary",
  "companion",
  "support",
];

/**
 * Safe role read: under the legacy PanelHost mount there is no
 * SurfaceRoleProvider, so useSurfaceRole() throws by design. Fall back to
 * primary (the full experience) there; the adaptive host always provides
 * the real role. The hook call stays unconditional (no conditional hooks).
 */
function useTasksRole(): SurfaceRoleInfo {
  try {
    return useSurfaceRole();
  } catch {
    return {
      surfaceId: "tasks",
      role: "primary",
      requestedRole: "primary",
      capabilities: TASKS_CAPABILITIES,
      degraded: false,
    };
  }
}

export function TasksPanel({ meta }: { meta?: { title?: string } }) {
  const tasks = useStore(appStore, (s) => s.content.tasks);
  const dispatchCommand = useStore(appStore, (s) => s.dispatchCommand);
  const { role } = useTasksRole();

  const todos = tasks?.todos ?? [];
  const reminders = tasks?.reminders ?? [];
  const pending = todos.filter((t) => !t.done);
  const doneCount = todos.length - pending.length;

  const urgent = pending.filter((t) => t.priority === "high");
  const nextReminder = reminders[0] ?? null;

  const renderTodoRow = (todo: TodoItem) => (
    <li key={todo.id} className={`task-row ${todo.done ? "done" : ""}`}>
      <button
        type="button"
        className={`task-check ${todo.done ? "checked" : ""}`}
        aria-label={todo.done ? "Marcar como pendiente" : "Marcar como hecha"}
        onClick={() => dispatchCommand({ action: "tasks.toggle", task_id: todo.id })}
      >
        {todo.done ? <CheckIcon size={12} /> : null}
      </button>
      <span className="task-title">{todo.title}</span>
      {todo.due ? <span className="task-due">{todo.due}</span> : null}
    </li>
  );

  const hasContent = todos.length > 0 || reminders.length > 0;

  return (
    <section className={`panel tasks-panel tasks-panel--${role}`} data-tasks-role={role}>
      {role === "primary" ? (
        <PanelHeader panelId="tasks" icon={<CheckIcon size={15} />}>
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
              <ul className="tasks-list">{urgent.map(renderTodoRow)}</ul>
            </div>
          ) : (
            <div className="tasks-section">
              <span className="tasks-section-label">Sin tareas urgentes</span>
              {pending.length > 0 ? (
                <ul className="tasks-list">{pending.slice(0, 1).map(renderTodoRow)}</ul>
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
          {pending.length > 0 ? (
            <div className="tasks-section">
              <span className="tasks-section-label">
                {`Pendientes · ${doneCount}/${todos.length}`}
              </span>
              <ul className="tasks-list">{pending.map(renderTodoRow)}</ul>
            </div>
          ) : null}
          {role === "primary" && doneCount > 0 ? (
            <div className="tasks-section">
              <span className="tasks-section-label">{`Hechas · ${doneCount}`}</span>
              <ul className="tasks-list">
                {todos.filter((t) => t.done).map(renderTodoRow)}
              </ul>
            </div>
          ) : null}
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
