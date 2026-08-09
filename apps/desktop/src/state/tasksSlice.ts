/**
 * GATE-5 (W0-SLICE) — tasks surface slice.
 *
 * Owns the `content.tasks` bag: to-do's and constant/permanent reminders
 * (vision line: the task bar carries both). Server `tasks.update` events
 * land the authoritative list; the optimistic `tasks.toggle` command
 * flips one todo's done flag locally before the server verdict lands
 * (behavior preserved from the pre-slice store).
 */

import type { ClientCommand, ServerEvent } from "../contracts";
import type { SurfaceSlice } from "./registry";
import type { TasksContent } from "./types";

export const tasksSlice: SurfaceSlice<TasksContent> = {
  panelId: "tasks",
  eventTypes: ["tasks.update"],
  commandActions: ["tasks.toggle"],
  applyEvent(bag, event) {
    switch (event.type) {
      case "tasks.update":
        return { todos: event.todos, reminders: event.reminders };
      default:
        return bag;
    }
  },
  applyCommand(bag, command) {
    switch (command.action) {
      case "tasks.toggle":
        return bag
          ? {
              ...bag,
              todos: bag.todos.map((t) =>
                t.id === command.task_id ? { ...t, done: !t.done } : t,
              ),
            }
          : bag;
      default:
        return bag;
    }
  },
};
