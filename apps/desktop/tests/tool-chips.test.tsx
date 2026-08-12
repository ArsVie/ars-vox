/**
 * ToolChips — disclosure behavior tests.
 *
 * Repo convention (no jsdom): node env + renderToStaticMarkup. Interaction
 * can't be clicked in SSR, so expansion is exercised through the
 * defaultExpanded / controlled `expanded` branches — the same state the
 * toggle button flips (aria-expanded is asserted on both sides).
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  TOOLCHIPS_DEMO,
  ToolChips,
  type ToolCallChip,
} from "../src/components/ToolChips";

const CALLS: ToolCallChip[] = [
  { label: "Buscar receta", status: "done" },
  { label: "Abrir página", status: "running" },
  { label: "Guardar nota", status: "error" },
  { label: "Leer artículo", status: "done" },
];

describe("ToolChips — collapsed summary", () => {
  it("shows the Spanish counts on one quiet chip button", () => {
    const html = renderToStaticMarkup(
      <ToolChips calls={CALLS} messageCount={2} />,
    );

    expect(html).toContain("4 acciones · 2 mensajes");
    expect(html).toContain("toolchips-summary");
    expect(html).toContain("<button");
    // collapsed: no chip list rendered
    expect(html).not.toContain("toolchips-list");
  });

  it("uses singular forms for one call and one message", () => {
    const html = renderToStaticMarkup(
      <ToolChips
        calls={[{ label: "Buscar", status: "done" }]}
        messageCount={1}
      />,
    );

    expect(html).toContain("1 acción · 1 mensaje");
  });

  it("defaults messageCount to cero mensajes", () => {
    const html = renderToStaticMarkup(<ToolChips calls={CALLS} />);
    expect(html).toContain("4 acciones · 0 mensajes");
  });

  it("is a disclosure button: aria-expanded=false + aria-controls", () => {
    const html = renderToStaticMarkup(
      <ToolChips calls={CALLS} messageCount={2} />,
    );

    expect(html).toContain('aria-expanded="false"');
    expect(html).toMatch(/aria-controls="([^"]+)"/);
    expect(html).toContain("Actividad del asistente");
  });
});

describe("ToolChips — expanded list", () => {
  it("expands (defaultExpanded) into one chip per call with status dots", () => {
    const html = renderToStaticMarkup(
      <ToolChips calls={CALLS} messageCount={2} defaultExpanded />,
    );

    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("toolchips-list");

    for (const call of CALLS) {
      expect(html).toContain(call.label);
    }

    // one dot per status class
    expect(html).toContain("toolchips-dot--done");
    expect(html).toContain("toolchips-dot--running");
    expect(html).toContain("toolchips-dot--error");

    // machine status travels on the item for styling/tests
    expect(html).toContain('data-status="done"');
    expect(html).toContain('data-status="running"');
    expect(html).toContain('data-status="error"');
  });

  it("wires aria-controls to the expanded list id", () => {
    const html = renderToStaticMarkup(
      <ToolChips calls={CALLS} messageCount={2} defaultExpanded />,
    );

    const controls = html.match(/aria-controls="([^"]+)"/)?.[1];
    const listId = html.match(/<ul id="([^"]+)"/)?.[1];
    expect(controls).toBeTruthy();
    expect(listId).toBe(controls);
  });

  it("names each status in Spanish for screen readers", () => {
    const html = renderToStaticMarkup(
      <ToolChips calls={CALLS} messageCount={2} defaultExpanded />,
    );

    expect(html).toContain("finalizada");
    expect(html).toContain("en curso");
    expect(html).toContain("con error");
    expect(html).toContain("toolchips-sr-only");
  });

  it("defaults a missing status to done", () => {
    const html = renderToStaticMarkup(
      <ToolChips
        calls={[{ label: "Sin estado" }]}
        messageCount={0}
        defaultExpanded
      />,
    );

    expect(html).toContain('data-status="done"');
    expect(html).toContain("toolchips-dot--done");
  });

  it("controlled expanded=false stays collapsed even with defaultExpanded", () => {
    const html = renderToStaticMarkup(
      <ToolChips calls={CALLS} messageCount={2} expanded={false} defaultExpanded />,
    );

    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("toolchips-list");
  });
});

describe("ToolChips — auto-hide", () => {
  it("renders nothing when calls is empty", () => {
    const html = renderToStaticMarkup(
      <ToolChips calls={[]} messageCount={3} />,
    );
    expect(html).toBe("");
  });

  it("renders nothing when calls is undefined", () => {
    const html = renderToStaticMarkup(<ToolChips messageCount={3} />);
    expect(html).toBe("");
  });
});

describe("TOOLCHIPS_DEMO fixture", () => {
  it("is a valid mixed-status fixture for the integrator", () => {
    expect(TOOLCHIPS_DEMO.messageCount).toBe(2);
    expect(TOOLCHIPS_DEMO.calls).toHaveLength(4);
    for (const call of TOOLCHIPS_DEMO.calls) {
      expect(["done", "running", "error"]).toContain(call.status);
      expect(call.label.length).toBeGreaterThan(0);
    }

    const html = renderToStaticMarkup(
      <ToolChips
        calls={TOOLCHIPS_DEMO.calls}
        messageCount={TOOLCHIPS_DEMO.messageCount}
        defaultExpanded
      />,
    );
    expect(html).toContain("4 acciones · 2 mensajes");
    expect(html).toContain("toolchips-dot--running");
    expect(html).toContain("toolchips-dot--error");
  });
});
