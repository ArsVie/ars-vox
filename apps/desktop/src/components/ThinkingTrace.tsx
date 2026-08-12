/**
 * ThinkingTrace — muestra el trabajo actual del asistente.
 *
 * Colapsado (por defecto): una sola línea con un indicador animado sutil y la
 * etiqueta del paso ACTIVO, en español: "Pensando: buscando el video…".
 * Expandido: lista vertical de pasos con icono por tipo (step/reasoning/
 * search/coding) y punto por estado (done/active/pending).
 *
 * Integración de SOLO LECTURA con el store: cuando hay pasos, la traza es
 * visible si voiceState === "thinking" (el asistente está trabajando); la
 * prop `visible` gana si se pasa explícita. Sin pasos, la traza se oculta
 * siempre (auto-hide). Sin emojis, etiquetas solo en español.
 */
import { useId, useState, useSyncExternalStore } from "react";

import { appStore } from "../store";
import {
  ChatIcon,
  CheckIcon,
  ChevronRightIcon,
  PenIcon,
  SearchIcon,
  SparkleIcon,
} from "./icons";

export type ThinkingStepKind = "step" | "reasoning" | "search" | "coding";
export type ThinkingStepState = "done" | "active" | "pending";

export interface ThinkingStep {
  /** Texto del paso, en español. */
  label: string;
  /** Tipo de trabajo; define el icono. Por defecto: "step". */
  kind?: ThinkingStepKind;
  /** Estado del paso; define el punto. Por defecto: "pending". */
  state?: ThinkingStepState;
}

export interface ThinkingTraceProps {
  /** Pasos del trabajo actual. Vacío o ausente => la traza se oculta. */
  steps?: ThinkingStep[];
  /** Estado colapsado inicial (por defecto: true). */
  collapsed?: boolean;
  /** Override explícito de visibilidad; si se omite, decide voiceState. */
  visible?: boolean;
  /** Clase extra para el contenedor (opcional). */
  className?: string;
}

/** Texto visible del estado de cada paso (español, sin emojis). */
export const THINKING_STATE_LABELS: Record<ThinkingStepState, string> = {
  done: "Completado",
  active: "En curso",
  pending: "Pendiente",
};

const KIND_ICONS: Record<ThinkingStepKind, (props: { size?: number; className?: string }) => JSX.Element> = {
  step: CheckIcon,
  reasoning: ChatIcon,
  search: SearchIcon,
  coding: PenIcon,
};

const FALLBACK_ICON = SparkleIcon;

/** Ejemplo listo para el integrador (también usado en el test). */
export const THINKING_TRACE_DEMO_STEPS: ThinkingStep[] = [
  { label: "Entendiendo lo que pediste", kind: "reasoning", state: "done" },
  { label: "Buscando el video", kind: "search", state: "active" },
  { label: "Preparando la respuesta", kind: "step", state: "pending" },
];

/** Etiqueta del paso activo; fallback: primer pendiente, luego el último. */
function activeStepLabel(steps: ThinkingStep[]): string {
  const active = steps.find((s) => s.state === "active");
  const pending = steps.find((s) => s.state === "pending");
  const last = steps[steps.length - 1];
  return (active ?? pending ?? last).label;
}

export function ThinkingTrace({
  steps,
  collapsed = true,
  visible,
  className,
}: ThinkingTraceProps) {
  const stepsList = steps ?? [];
  const [open, setOpen] = useState(!collapsed);
  const listId = useId();

  // READ-ONLY store: voiceState === "thinking" decide la visibilidad cuando
  // hay pasos; la prop `visible` gana si se pasa explícita. useSyncExternalStore
  // con el MISMO snapshot para servidor y cliente: a diferencia de useStore
  // (zustand), el snapshot SSR lee getState() actual, así el render de
  // servidor/node ve el voiceState vigente (no el inicial).
  const voiceState = useSyncExternalStore(
    appStore.subscribe,
    () => appStore.getState().voiceState,
    () => appStore.getState().voiceState,
  );
  const visibleNow = visible !== undefined ? visible : voiceState === "thinking";

  if (stepsList.length === 0 || !visibleNow) return null;

  const expanded = open;
  const label = activeStepLabel(stepsList);

  return (
    <div
      className={`thinking-trace${className ? ` ${className}` : ""}`}
      role="status"
      aria-live="polite"
      data-expanded={expanded ? "true" : "false"}
    >
      <button
        type="button"
        className="tt-toggle"
        aria-expanded={expanded}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
        title={expanded ? "Ocultar detalles" : "Ver detalles"}
      >
        <span className="tt-indicator" aria-hidden="true" />
        <span className="tt-line">
          <span className="tt-prefix">Pensando:</span> {label}…
        </span>
        <ChevronRightIcon size={14} className="tt-chevron" />
      </button>
      {expanded ? (
        <ol className="tt-steps" id={listId}>
          {stepsList.map((step, index) => {
            const kind = step.kind ?? "step";
            const state = step.state ?? "pending";
            const Icon = KIND_ICONS[kind] ?? FALLBACK_ICON;
            return (
              <li
                key={`${index}-${step.label}`}
                className="tt-step"
                data-kind={kind}
                data-state={state}
              >
                <span className="tt-step-dot" aria-hidden="true" />
                <Icon size={14} className="tt-step-icon" />
                <span className="tt-step-label">{step.label}</span>
                <span className="tt-step-state">{THINKING_STATE_LABELS[state]}</span>
              </li>
            );
          })}
        </ol>
      ) : null}
    </div>
  );
}
