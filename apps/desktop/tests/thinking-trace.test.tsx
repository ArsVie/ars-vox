/**
 * ThinkingTrace — tests.
 *
 * Node env, renderToStaticMarkup (convención del repo — no hay jsdom ni
 * @testing-library instalados):
 *   (a) colapsado por defecto: una línea con indicador, aria-expanded="false",
 *       sin lista de pasos;
 *   (b) expansión: el clic ejecuta setOpen(o => !o) — el MISMO volteo de
 *       estado se ejercita montando con collapsed={false} (cada render es un
 *       mount fresco) y produce aria-expanded="true" + la lista completa con
 *       icono por tipo y punto por estado; el botón lleva el handler de clic
 *       y el cableado aria (aria-expanded + aria-controls);
 *   (c) etiqueta del paso ACTIVO en la línea colapsada (con fallback al
 *       primer pendiente cuando no hay activo);
 *   (d) auto-hide con steps vacío o ausente;
 *   (e) integración de SOLO LECTURA con el store: voiceState "thinking"
 *       muestra, "sleeping" oculta, y la prop `visible` gana;
 *   (f) CSS: tokens oscuros con fallback y bloque prefers-reduced-motion.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  THINKING_TRACE_DEMO_STEPS,
  ThinkingTrace,
  type ThinkingStep,
} from "../src/components/ThinkingTrace";
import { appStore } from "../src/store";

const CSS = readFileSync(
  new URL("../src/components/thinking-trace.css", import.meta.url),
  "utf8",
);

/** Un paso por cada tipo (icono) y por cada estado (punto). */
const ALL_KINDS: ThinkingStep[] = [
  { label: "Comprendiendo la petición", kind: "reasoning", state: "done" },
  { label: "Buscando el video", kind: "search", state: "active" },
  { label: "Escribiendo la respuesta", kind: "coding", state: "pending" },
  { label: "Guardando el resumen", kind: "step", state: "pending" },
];

function setVoiceState(state: "thinking" | "sleeping"): void {
  appStore.getState().applyEvent({
    type: "state_update",
    voice_state: state,
    activity: null,
    created_at: new Date().toISOString(),
  });
}

beforeEach(() => {
  // El singleton persiste entre tests: siempre partir de "thinking".
  setVoiceState("thinking");
});

describe("ThinkingTrace", () => {
  it("colapsado por defecto: una línea con indicador y el paso activo", () => {
    const html = renderToStaticMarkup(
      <ThinkingTrace steps={THINKING_TRACE_DEMO_STEPS} />,
    );
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Pensando:");
    expect(html).toContain("Buscando el video…");
    expect(html).toContain("tt-indicator");
    expect(html).not.toContain("tt-steps");
  });

  it("se expande: el volteo de estado del clic muestra la lista completa", () => {
    // El clic llama setOpen(o => !o); montar con collapsed={false} aplica
    // ese mismo volteo (cada render de servidor es un mount fresco) y debe
    // producir el mismo árbol expandido.
    const html = renderToStaticMarkup(
      <ThinkingTrace steps={ALL_KINDS} collapsed={false} />,
    );
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('class="tt-steps"');
    // todas las etiquetas
    expect(html).toContain("Comprendiendo la petición");
    expect(html).toContain("Buscando el video");
    expect(html).toContain("Escribiendo la respuesta");
    expect(html).toContain("Guardando el resumen");
    // icono por tipo
    expect(html).toContain("tt-step-icon");
    expect(html).toContain('data-kind="reasoning"');
    expect(html).toContain('data-kind="search"');
    expect(html).toContain('data-kind="coding"');
    expect(html).toContain('data-kind="step"');
    // punto y texto por estado (español, sin emojis)
    expect(html).toContain('data-state="done"');
    expect(html).toContain('data-state="active"');
    expect(html).toContain('data-state="pending"');
    expect(html).toContain("Completado");
    expect(html).toContain("En curso");
    expect(html).toContain("Pendiente");
    // cableado aria del botón de expansión
    expect(html).toMatch(/aria-controls="[^"]+"/);
  });

  it("la línea colapsada usa el paso activo y cae al primer pendiente", () => {
    const noActive = renderToStaticMarkup(
      <ThinkingTrace
        steps={[
          { label: "Primer paso", state: "pending" },
          { label: "Segundo paso", state: "done" },
        ]}
      />,
    );
    expect(noActive).toContain("Primer paso…");
    expect(noActive).not.toContain("Segundo paso");
  });

  it("se oculta sola cuando no hay pasos", () => {
    expect(renderToStaticMarkup(<ThinkingTrace steps={[]} />)).toBe("");
    expect(renderToStaticMarkup(<ThinkingTrace />)).toBe("");
    expect(renderToStaticMarkup(<ThinkingTrace steps={undefined} />)).toBe("");
  });

  it("store (solo lectura): visible con thinking, oculta con sleeping, visible gana", () => {
    setVoiceState("sleeping");
    const hidden = renderToStaticMarkup(
      <ThinkingTrace steps={THINKING_TRACE_DEMO_STEPS} />,
    );
    expect(hidden).toBe("");

    const forced = renderToStaticMarkup(
      <ThinkingTrace steps={THINKING_TRACE_DEMO_STEPS} visible />,
    );
    expect(forced).toContain('aria-expanded="false"');
    expect(forced).toContain("Buscando el video…");

    setVoiceState("thinking");
    const shown = renderToStaticMarkup(
      <ThinkingTrace steps={THINKING_TRACE_DEMO_STEPS} />,
    );
    expect(shown).toContain("Pensando:");
  });

  it("fixture de demostración exportada para el integrador", () => {
    expect(THINKING_TRACE_DEMO_STEPS).toHaveLength(3);
    expect(THINKING_TRACE_DEMO_STEPS[1]).toMatchObject({
      kind: "search",
      state: "active",
    });
    expect(THINKING_TRACE_DEMO_STEPS[1].label).toContain("Buscando");
  });
});

describe("thinking-trace.css", () => {
  it("tokens oscuros con fallback y bloque prefers-reduced-motion", () => {
    expect(CSS).toContain("var(--av-accent, #3d9aff)");
    expect(CSS).toContain("var(--av-ink, #e8ecf4)");
    expect(CSS).toContain("var(--av-ink-dim, #9aa7bd)");
    expect(CSS).toContain("var(--av-inset, #1a2133)");
    expect(CSS).toContain("var(--av-line, #2a3348)");
    expect(CSS).toContain("var(--av-r-card, 10px)");
    expect(CSS).toContain("@media (prefers-reduced-motion: reduce)");
    expect(CSS).toMatch(/@keyframes tt-pulse/);
  });
});
