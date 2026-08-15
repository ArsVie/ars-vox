/**
 * UI-204 — Tasks/reminders adaptive surface.
 *
 * SSR render coverage per role variant (renderToStaticMarkup, node env):
 *  - primary   renders the full management list (done items included).
 *  - companion renders only pending to-dos + reminders (compact).
 *  - support   renders a SUBSET: urgent (pending, high-priority) to-dos and
 *              the next reminder — normal-priority items must NOT appear.
 *  - State survival: role changes never clear store.content.tasks.
 *  - Interaction: the check button's tasks.toggle command still toggles.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import type { SurfaceRole } from "../src/adaptive/contracts";
import { SurfaceRoleProvider } from "../src/roles/context";
import { appStore } from "../src/store";
import { TasksPanel } from "../src/components/TasksPanel";

function ts(): string {
  return new Date().toISOString();
}

const TASKS_EVENT = {
  type: "tasks.update" as const,
  todos: [
    { id: "t1", title: "Comprar leche", done: false, priority: "high", due: "hoy" },
    { id: "t2", title: "Llamar a María", done: true, priority: "normal", due: null },
    { id: "t3", title: "Organizar notas", done: false, priority: "normal", due: null },
  ],
  reminders: [
    { id: "r1", title: "Revisar correo", cadence: "Cada día 9:00", next_fire: "2026-08-08 09:00" },
  ],
  created_at: ts(),
};

function renderWithRole(role: SurfaceRole, event: unknown = TASKS_EVENT): string {
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
      <TasksPanel meta={{ title: "Tareas" }} />
    </SurfaceRoleProvider>,
  );
}

beforeEach(() => {
  (appStore as unknown as { getServerState: () => unknown }).getServerState = () =>
    appStore.getState();
  appStore.setState({ content: {} });
});

describe("TasksPanel role variants (UI-204)", () => {
  it("primary renders the full management list (done items included)", () => {
    const html = renderWithRole("primary");
    expect(html).toContain("panel-header");
    expect(html).toContain("Tareas");
    expect(html).toContain("filter-chips");
    expect(html).toContain("Todas");
    expect(html).toContain("Pendiente");
    expect(html).toContain("Completadas");
    expect(html).toContain("Comprar leche");
    expect(html).toContain("Organizar notas");
    expect(html).toContain("Llamar a María"); // done items stay visible
    expect(html).toContain("status-chip--done");
    expect(html).toContain("Completada");
    expect(html).toContain("Revisar correo");
    expect(html).toContain("Cada día 9:00 · sábado 8 de ago, 9 de la mañana");
  });

  it("companion renders pending to-dos plus reminders, less chrome", () => {
    const html = renderWithRole("companion");
    expect(html).not.toContain("panel-header");
    expect(html).toContain("filter-chips");
    expect(html).toContain("filter-chip--active");
    expect(html).toContain("Comprar leche");
    expect(html).toContain("Organizar notas");
    expect(html).not.toContain("Llamar a María"); // done items hidden
    expect(html).not.toContain("status-chip--done");
    expect(html).toContain("Revisar correo");
    expect(html).toContain("tasks-panel--companion");
  });

  it("support shows only the most relevant subset (urgent + next reminder)", () => {
    const html = renderWithRole("support");
    expect(html).toContain("tasks-panel--support");
    expect(html).toContain("Urgentes · 1/2");
    expect(html).toContain("Comprar leche"); // high priority, pending
    expect(html).not.toContain("Organizar notas"); // normal priority filtered
    expect(html).not.toContain("Llamar a María"); // done filtered
    expect(html).not.toContain("Recordatorios");
    expect(html).toContain("Próximo · Revisar correo · sábado 8 de ago, 9 de la mañana");
  });

  it("support with no urgent items falls back to a minimal summary", () => {
    const html = renderWithRole("support", {
      type: "tasks.update",
      todos: [
        { id: "t3", title: "Organizar notas", done: false, priority: "normal", due: null },
        { id: "t2", title: "Llamar a María", done: true, priority: "high", due: null },
      ],
      reminders: [
        { id: "r1", title: "Revisar correo", cadence: "Cada día 9:00", next_fire: "2026-08-08 09:00" },
      ],
      created_at: ts(),
    });
    expect(html).toContain("Sin tareas urgentes");
    expect(html).toContain("Organizar notas");
    expect(html).not.toContain("Llamar a María");
    expect(html).toContain("Próximo · Revisar correo · sábado 8 de ago, 9 de la mañana");
  });

  it("renders the RESOLVED role when the requested role was degraded (ladder output is authoritative)", () => {
    appStore.getState().applyEvent(TASKS_EVENT as never);
    // A degraded request (requestedRole != role) must render the role the
    // host RESOLVED — never a component-side default. Here the ladder
    // resolved a companion request down to support.
    const html = renderToStaticMarkup(
      <SurfaceRoleProvider
        value={{
          surfaceId: "tasks",
          role: "support",
          requestedRole: "companion",
          capabilities: ["primary", "companion", "support"],
          degraded: true,
        }}
      >
        <TasksPanel meta={{ title: "Tareas" }} />
      </SurfaceRoleProvider>,
    );
    expect(html).toContain('data-tasks-role="support"');
    expect(html).toContain("tasks-panel--support");
    // Support chrome: urgent subset, no management header.
    expect(html).not.toContain("panel-header");
    expect(html).not.toContain("filter-chips");
    expect(html).toContain("Comprar leche");
  });

  it("preserves tasks state across role changes (never clears content)", () => {
    renderWithRole("primary");
    expect(appStore.getState().content.tasks?.todos).toHaveLength(3);
    // Second render with NO event: pure role switch, content untouched.
    renderWithRole("support", null);
    expect(appStore.getState().content.tasks?.todos).toHaveLength(3);
    expect(appStore.getState().content.tasks?.reminders).toHaveLength(1);
    expect(appStore.getState().content.tasks?.todos[0].title).toBe("Comprar leche");
  });

  it("keeps the completion toggle interaction functional in every variant", () => {
    const html = renderWithRole("support");
    // The toggle affordance is present for the urgent row.
    expect(html).toContain('aria-label="Marcar como hecha"');
    expect(html).toContain("task-check");
    // The command the button dispatches still toggles through the store.
    appStore.getState().dispatchCommand({ action: "tasks.toggle", task_id: "t1" });
    expect(appStore.getState().content.tasks?.todos[0].done).toBe(true);
    // Support now filters the finished urgent item out; primary shows it checked.
    const supportAfter = renderWithRole("support", null);
    expect(supportAfter).not.toContain("Comprar leche");
    expect(supportAfter).toContain("Sin tareas urgentes");
    const primaryAfter = renderWithRole("primary", null);
    expect(primaryAfter).toContain("task-check checked");
    expect((primaryAfter.match(/status-chip--done/g) ?? []).length).toBe(2);
  });
});
