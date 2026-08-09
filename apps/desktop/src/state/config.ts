/**
 * GATE-5 (W0-SLICE) — config application.
 *
 * The server config snapshot -> UI patch mapping (accessibility modes,
 * TTS knobs) plus the config-driven default layout application, extracted
 * from the store. The default layout is applied through a caller-supplied
 * callback so the ONE adaptive choke (applyAdaptiveSpec in store.ts)
 * stays the single layout entry point.
 */

import {
  DEFAULT_PRIMARY,
  isPanelId,
  type AppConfigWire,
  type PanelId,
} from "../contracts";
import type { AdaptiveTemplate } from "../adaptive/contracts";
import { surfaceRegistry } from "../roles/registry";
import { adaptiveTemplateFromConfig } from "./layoutBoot";
import type { AppState } from "./types";

/** The store's choke context for the config-driven default layout. */
export interface ConfigDefaultLayoutContext {
  /** True while the config-driven default may still land (before any
   *  layout command — the guard lives in the store's closure). */
  canApplyDefault: boolean;
  /** Apply the default composition through the ONE choke. May throw —
   *  the caller records the rejection and never crashes the event path. */
  applyDefault: (template: AdaptiveTemplate, primary: PanelId) => void;
}

/**
 * Apply the server config snapshot to the UI: accessibility modes, TTS
 * knobs, and (only before any layout command) the default layout.
 */
export function applyConfigToState(
  config: AppConfigWire,
  ctx: ConfigDefaultLayoutContext,
): Partial<AppState> {
  const ui = config.ui ?? {};
  const tts = config.tts ?? {};
  const patch: Partial<AppState> = {};
  if (ui.reduced_motion !== undefined) patch.reducedMotion = ui.reduced_motion;
  if (ui.large_text !== undefined) patch.largeText = ui.large_text;
  if (ui.high_contrast !== undefined) patch.highContrast = ui.high_contrast;
  if (typeof tts.speed === "number" && tts.speed > 0) patch.ttsSpeed = tts.speed;
  if (typeof tts.queue_max === "number" && tts.queue_max > 0) {
    patch.ttsQueueMax = tts.queue_max;
  }
  if (!ctx.canApplyDefault) return patch;
  // R19 (GATE-3.5): the config-driven default layout is a layout
  // source ("migration") and enters the ONE choke as the initial
  // adaptive composition — the default lands at connect, before
  // any user interaction. Legacy template ids map through the
  // planner's frozen wire map; an unregistered default_primary
  // falls back to the conversation anchor (the choke's registry
  // gate must never throw on config data).
  const template =
    typeof ui.default_template === "string" && ui.default_template
      ? adaptiveTemplateFromConfig(ui.default_template)
      : null;
  if (!template) return patch;
  // Config data must NEVER throw through the choke's registry
  // gate: an unregistered default_primary falls back to the
  // conversation anchor; when even the anchor is unregistered
  // (e.g. product surfaces not yet registered), skip the default.
  const configuredPrimary =
    typeof ui.default_primary === "string" &&
    isPanelId(ui.default_primary) &&
    surfaceRegistry.has(ui.default_primary)
      ? ui.default_primary
      : null;
  const primary =
    configuredPrimary ??
    (surfaceRegistry.has(DEFAULT_PRIMARY) ? DEFAULT_PRIMARY : null);
  if (!primary) return patch;
  try {
    ctx.applyDefault(template, primary);
  } catch (error) {
    // never crash the event path on config data
    console.warn(
      "[store] config default layout rejected:",
      (error as Error).message,
    );
  }
  return patch;
}
