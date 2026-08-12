/**
 * TasksPanel redesign (UI wave leaf F) — card rows + filter chips.
 *
 * SSR render coverage (node env, same zustand trick as the other surface
 * tests: attach getServerState, seed through the real applyEvent path).
 * The repo's vitest environment is node-only (no jsdom / testing-library),
 * so live chip clicks cannot be simulated; the filtering the chips drive is
 * covered through the exported pure helpers (matchesFilter / filterTodos /
 * todoStatus / progressLabel) plus SSR markup assertions for the chip row,
 * counts, aria-pressed and the per-state status-chip classes.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import type { SurfaceRole } from "../src/adaptive/contracts";
import type { TodoItem } from "../src/contracts";
import { SurfaceRoleProvider } from "../src/roles/context";
import { appStore } from "../src/store";
import {
  FILTERS,
  filterTodos,
  matchesFilter,
  progressLabel,
  TasksPanel,
  todoStatus,
  type FilterKey,
} from "../src/components/TasksPanel";

function ts(): string {
  return new Date().toISOString();
}

/** Plain wire-shape to-dos (the frozen TodoItem: no progress/status/error). */
const PLAIN_TODOS: TodoItem[] = [
  { id: "t1", title: "Comprar leche", done: false, priority: "high", due: "hoy" },
  { id: "t2", title: "Llamar a María", done: true, priority: "normal", due: null },
  { id: "t3", title: "Organizar notas", done: false, priority: "normal", due: null },
];

/** Lenient extras the wire does not carry yet — the component must read
 *  them defensively and degrade when absent. */
type TodoWithExtras = TodoItem & {
  status?: string;
  progress?: string | number;
  error?: string;
};

const EXTRA_TODOS: TodoWithExtras[] = [
  { id: "t1", title: "Comprar leche", done: false, priority: "high", due: "hoy" },
  { id: "t2", title: "Llamar a María", done: true, priority: "normal", due: null },
  {
    id: "t3",
    title: "Redactar informe",
    done: false,
    priority: "normal",
    due: null,
    status: "in-progress",
    progress: "3/5",
  },
  {
    id: "t4",
    title: "Enviar factura",
    done: false,
    priority: "normal",
    due: null,
    error: "No se pudo sincronizar",
  },
];

function tasksEvent(todos: TodoItem[]): never {
  return {
    type: "tasks.update",
    todos,
    reminders: [
      {
        id: "r1",
        title: "Revisar correo",
        cadence: "Cada día 9:00",
        next_fire: "2026-08-08 09:00",
      },
    ],
    created_at: ts(),
  } as never;
}

function renderWithRole(
  role: SurfaceRole,
  event: unknown,
  props: { meta?: { title?: string } } = {},
): string {
  if (event) appStore.getState().applyEvent(event as never);
  return renderToStaticMarkup(
    <SurfaceRoleProvider
      value={{
        surfaceId: "tasks",
        role,
        requestedRole: role,
        capabilities: ["primary", "companion", "support"],
        degraded: false,
      }}
    >
      <TasksPanel meta={{ title: "Tareas", ...props.meta }} />
    </SurfaceRoleProvider>,
  );
}

beforeEach(() => {
  (appStore as unknown as { getServerState: () => unknown }).getServerState = () =>
    appStore.getState();
  appStore.setState({ content: {} });
});

/* --------------------------------------------------- filter helpers */

describe("TasksPanel filter helpers (drive the chips)", () => {
  it("filterTodos returns the right subset per chip key", () => {
    // t3 is in-progress (extras), t4 errored, t2 done, t1 pending.
    const all = filterTodos(EXTRA_TODOS as TodoItem[], "todas");
    expect(all).toHaveLength(4);

    const pending = filterTodos(EXTRA_TODOS as TodoItem[], "pendiente");
    expect(pending.map((t) => t.id)).toEqual(["t1"]);

    const inProgress = filterTodos(EXTRA_TODOS as TodoItem[], "en-curso");
    expect(inProgress.map((t) => t.id)).toEqual(["t3"]);

    const completed = filterTodos(EXTRA_TODOS as TodoItem[], "completadas");
    expect(completed.map((t) => t.id)).toEqual(["t2"]);
  });

  it("matchesFilter with plain wire shape: only pending and done exist", () => {
    expect(matchesFilter(PLAIN_TODOS[0], "pendiente")).toBe(true);
    expect(matchesFilter(PLAIN_TODOS[0], "completadas")).toBe(false);
    expect(matchesFilter(PLAIN_TODOS[1], "completadas")).toBe(true);
    expect(matchesFilter(PLAIN_TODOS[1], "pendiente")).toBe(false);
    // No progress/status field on the wire: nothing is ever "en curso".
    expect(PLAIN_TODOS.every((t) => !matchesFilter(t, "en-curso"))).toBe(true);
    // "todas" never filters anything out.
    expect(PLAIN_TODOS.every((t) => matchesFilter(t, "todas"))).toBe(true);
  });

  it("exposes the four required chip labels in order", () => {
    expect(FILTERS.map((f) => f.label)).toEqual([
      "Todas",
      "Pendiente",
      "En curso",
      "Completadas",
    ]);
  });
});

/* --------------------------------------------------- status helpers */

describe("TasksPanel status derivation", () => {
  it("maps plain wire to-dos to pending/done only (graceful degradation)", () => {
    expect(todoStatus(PLAIN_TODOS[0])).toBe("pending");
    expect(todoStatus(PLAIN_TODOS[1])).toBe("done");
    expect(todoStatus(PLAIN_TODOS[2])).toBe("pending");
  });

  it("lights up in-progress and error states when extras arrive", () => {
    expect(todoStatus(EXTRA_TODOS[0] as TodoItem)).toBe("pending");
    expect(todoStatus(EXTRA_TODOS[1] as TodoItem)).toBe("done");
    expect(todoStatus(EXTRA_TODOS[2] as TodoItem)).toBe("in-progress");
    expect(todoStatus(EXTRA_TODOS[3] as TodoItem)).toBe("error");
  });

  it("done always wins over an in-progress extra", () => {
    const doneWithProgress: TodoWithExtras = {
      id: "t9",
      title: "Hecha con progreso",
      done: true,
      priority: "normal",
      due: null,
      status: "in-progress",
      progress: 80,
    };
    expect(todoStatus(doneWithProgress as TodoItem)).toBe("done");
  });
});

/* --------------------------------------------------- progress label */

describe("TasksPanel progressLabel", () => {
  it("formats the supported shapes", () => {
    expect(progressLabel("3/5")).toBe("3/5");
    expect(progressLabel(67)).toBe("67%");
    expect(progressLabel(0.5)).toBe("50%");
    expect(progressLabel({ done: 2, total: 5 })).toBe("2/5");
  });

  it("degrades to null for absent or unusable values", () => {
    expect(progressLabel(undefined)).toBeNull();
    expect(progressLabel(null)).toBeNull();
    expect(progressLabel("   ")).toBeNull();
    expect(progressLabel(-3)).toBeNull();
    expect(progressLabel({ done: "x", total: 5 })).toBeNull();
  });
});

/* ------------------------------------------------------- SSR markup */

describe("TasksPanel card + chip markup", () => {
  it("primary renders the four filter chips with counts, default Todas active", () => {
    const html = renderWithRole("primary", tasksEvent(PLAIN_TODOS));
    expect(html).toContain('class="filter-chips"');
    expect(html).toContain('aria-label="Filtrar tareas"');
    for (const label of ["Todas", "Pendiente", "En curso", "Completadas"]) {
      expect(html).toContain(`<span class="filter-chip-label">${label}</span>`);
    }
    // Counts: 3 todos, 2 pending, 0 in-progress (wire has none), 1 done.
    expect(html).toContain('class="filter-chip-count">3</span>');
    expect(html).toContain('class="filter-chip-count">2</span>');
    expect(html).toContain('class="filter-chip-count">0</span>');
    expect(html).toContain('class="filter-chip-count">1</span>');
    // Default filter for primary is Todas (the active chip).
    expect(html).toContain('filter-chip--active" aria-pressed="true"');
  });

  it("primary renders all rows as cards by default (Todas)", () => {
    const html = renderWithRole("primary", tasksEvent(PLAIN_TODOS));
    expect(html).toContain("Comprar leche");
    expect(html).toContain("Organizar notas");
    expect(html).toContain("Llamar a María");
    expect(html).toContain("task-card");
  });

  it("status chip classes per state + progress/error/due sublines", () => {
    const html = renderWithRole("primary", tasksEvent(EXTRA_TODOS as TodoItem[]));
    expect(html).toContain("status-chip--pending");
    expect(html).toContain("status-chip--done");
    expect(html).toContain("status-chip--in-progress");
    expect(html).toContain("status-chip--error");
    // Spanish labels for every state.
    expect(html).toContain(">Pendiente</span>");
    expect(html).toContain(">Hecha</span>");
    expect(html).toContain(">En curso</span>");
    expect(html).toContain(">Error</span>");
    // Subline: due, progress "3/5", error text.
    expect(html).toContain('class="task-due">hoy</span>');
    expect(html).toContain('class="task-progress">3/5</span>');
    expect(html).toContain('class="task-error">No se pudo sincronizar</span>');
  });

  it("plain wire shape renders no progress/error sublines or rich chips", () => {
    const html = renderWithRole("primary", tasksEvent(PLAIN_TODOS));
    expect(html).not.toContain("task-progress");
    expect(html).not.toContain("task-error");
    expect(html).not.toContain("status-chip--in-progress");
    expect(html).not.toContain("status-chip--error");
    // The legacy due subline still shows.
    expect(html).toContain('class="task-due">hoy</span>');
  });

  it("keeps the toggle affordance on every card and the toggle command wired", () => {
    const html = renderWithRole("primary", tasksEvent(PLAIN_TODOS));
    expect(html).toContain('aria-label="Marcar como hecha"');
    expect(html).toContain("task-check");
    appStore.getState().dispatchCommand({ action: "tasks.toggle", task_id: "t1" });
    expect(appStore.getState().content.tasks?.todos[0].done).toBe(true);
    const after = renderWithRole("primary", null as unknown as never);
    expect(after).toContain("task-check checked");
    expect(after).toContain('aria-label="Marcar como pendiente"');
  });

  it("companion defaults to the Pendiente filter (done rows hidden)", () => {
    const html = renderWithRole("companion", tasksEvent(PLAIN_TODOS));
    expect(html).not.toContain("panel-header");
    expect(html).toContain("Comprar leche");
    expect(html).toContain("Organizar notas");
    expect(html).not.toContain("Llamar a María");
    // The active chip is Pendiente.
    expect(html).toContain('filter-chip--active" aria-pressed="true"');
    expect(html).toContain('<span class="filter-chip-label">Pendiente</span>');
    // Reminders still listed.
    expect(html).toContain("Revisar correo");
    expect(html).toContain("Cada día 9:00 · próxima 2026-08-08 09:00");
  });

  it("support stays a compact urgent summary: no chips, next reminder only", () => {
    const html = renderWithRole("support", tasksEvent(PLAIN_TODOS));
    expect(html).toContain("Urgentes · 1/2");
    expect(html).toContain("Comprar leche");
    expect(html).not.toContain("Organizar notas");
    expect(html).not.toContain("filter-chip");
    expect(html).not.toContain("Recordatorios");
    expect(html).toContain("Próximo · Revisar correo · 2026-08-08 09:00");
  });

  it("renders the empty state with the legacy classes and copy", () => {
    const html = renderWithRole("primary", { type: "tasks.update", todos: [], reminders: [], created_at: ts() });
    expect(html).toContain("content-panel-empty-text");
    expect(html).toContain("No hay tareas. Pídeme que anote una.");
    expect(html).not.toContain("filter-chips");
  });
});
