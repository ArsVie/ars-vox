import { useStore } from "zustand";

import { appStore } from "../store";
import { PanelHeader } from "./PanelHeader";
import { BellIcon, CheckIcon } from "./icons";

/**
 * Tasks panel — to-do's plus constant/permanent reminders. Reminders are
 * injected into the agent's context on a cadence by the backend (cron
 * style); this surface is the visible list. Toggling a to-do sends a
 * tasks.toggle command so the policy/approval path stays intact.
 */
export function TasksPanel({ meta }: { meta?: { title?: string } }) {
  const tasks = useStore(appStore, (s) => s.content.tasks);
  const dispatchCommand = useStore(appStore, (s) => s.dispatchCommand);

  const todos = tasks?.todos ?? [];
  const reminders = tasks?.reminders ?? [];
  const doneCount = todos.filter((t) => t.done).length;

  return (
    <section className="panel tasks-panel">
      <PanelHeader panelId="tasks" icon={<CheckIcon size={15} />}>
        {meta?.title ?? "Tareas"}
      </PanelHeader>
      {todos.length === 0 && reminders.length === 0 ? (
        <div className="content-panel-empty">
          <span className="content-panel-empty-icon">
            <CheckIcon size={30} />
          </span>
          <span className="content-panel-empty-text">
            No hay tareas. Pídeme que anote una.
          </span>
        </div>
      ) : (
        <div className="tasks-body">
          <div className="tasks-section">
            <span className="tasks-section-label">
              Pendientes · {doneCount}/{todos.length}
            </span>
            <ul className="tasks-list">
              {todos.map((todo) => (
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
              ))}
            </ul>
          </div>
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
                      {rem.cadence} · próxima {rem.next_fire}
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
