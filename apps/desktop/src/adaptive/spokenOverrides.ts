/**
 * R21 (GATE-3.5) — Spoken layout overrides: deterministic speech → OverrideIntent.
 *
 * The frozen user intents ("haz esto más grande", "déjalo ahí", ...) must
 * become deterministic OverrideIntents — never vague model suggestions.
 * This module is the FRONTEND-OWNED deterministic matcher for the spoken
 * route (mic transcript → override, before any user_text reaches the
 * model). Matching mirrors the Python local-intent layer conventions
 * (services/agent/arsvox_agent/local_intents.py): accent-stripped,
 * lowercased, punctuation-free normalization; whole-utterance matching
 * (an utterance is either a layout command or it is not — mixed utterances
 * fall through to the normal model path); optional trailing politeness
 * filler (" por favor"), exactly like the STOP vocabulary.
 *
 * The surfaceId for "esto"/"lo" is NOT interpreted here by language
 * parsing — the store resolves it deterministically from the CURRENT
 * composition: the surface occupying the main (primary) slot is the
 * target of every spoken override. Pure functions only: no React, no
 * time, no randomness.
 */

import type { OverrideIntent } from "./overrides";
import type { LayoutSpec } from "./contracts";

/** A matched spoken override kind, mirroring the OverrideIntent kinds. */
export type SpokenOverrideKind =
  | "bigger"
  | "smaller"
  | "right"
  | "left"
  | "keep"
  | "showBoth"
  | "close"
  | "fullscreen"
  | "restore";

/** Accent-stripped, lowercased, punctuation-free (mirrors Python
 *  local_intents._normalize so both sides agree on what a phrase is). */
export function normalizeSpoken(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip combining accents
    .replace(/[¡!¿?.,;:()[\]]/g, "")
    .toLowerCase()
    .trim();
}

/** Politeness filler accepted after a command, mirroring the Python STOP
 *  vocabulary convention ("detente por favor" is still STOP). */
const POLITENESS_SUFFIXES = [" por favor", "por favor"];

/**
 * Frozen spoken-override vocabulary (R21). Keys are POST-normalize forms.
 * The canonical phrases from the consolidation contract plus the minimal
 * inflection variants ("hazlo" ~ "haz esto") — all deterministic and
 * documented. NOTE: no word-boundary regexes — a phrase either IS the
 * utterance or it goes to the model (same rule as STOP's "para").
 */
export const SPOKEN_OVERRIDE_PHRASES: Record<string, SpokenOverrideKind> = {
  // "haz esto más grande"
  "haz esto mas grande": "bigger",
  "hazlo mas grande": "bigger",
  // "hazlo más pequeño"
  "hazlo mas pequeno": "smaller",
  "haz esto mas pequeno": "smaller",
  // "ponlo a la derecha"
  "ponlo a la derecha": "right",
  // "ponlo a la izquierda"
  "ponlo a la izquierda": "left",
  // "déjalo ahí"
  "dejalo ahi": "keep",
  // "quítalo"
  "quitalo": "close",
  "quitarlo": "close",
  "quitame eso": "close",
  // "muéstrame los dos"
  "muestrame los dos": "showBoth",
  // "pantalla completa"
  "pantalla completa": "fullscreen",
  // "restaura el diseño" (restore-layout counterpart of the frozen family)
  "restaura el diseno": "restore",
  "restablece el diseno": "restore",
};

/** True when the utterance (already normalized) is exactly a phrase or a
 *  phrase plus politeness filler — never a word inside a sentence. */
export function matchSpokenOverrideKind(normalized: string): SpokenOverrideKind | null {
  if (SPOKEN_OVERRIDE_PHRASES[normalized]) {
    return SPOKEN_OVERRIDE_PHRASES[normalized];
  }
  for (const suffix of POLITENESS_SUFFIXES) {
    if (normalized.endsWith(suffix)) {
      const core = normalized.slice(0, -suffix.length).replace(/[ ,]+$/, "");
      if (SPOKEN_OVERRIDE_PHRASES[core]) return SPOKEN_OVERRIDE_PHRASES[core];
    }
  }
  return null;
}

/** Match a raw utterance. Returns the intent kind or null (→ normal path). */
export function matchSpokenOverride(text: string): SpokenOverrideKind | null {
  return matchSpokenOverrideKind(normalizeSpoken(text));
}

/**
 * The deterministic spoken-override target: the surface currently in the
 * MAIN (primary) slot — "esto"/"lo" in the user's command refers to the
 * activity they are looking at, and the primary is the visually obvious
 * one (frozen role semantics). Null when no composition exists yet (the
 * utterance then falls through to the normal model path).
 */
export function resolveSpokenOverrideTarget(spec: LayoutSpec | null): string | null {
  if (!spec) return null;
  const main = spec.assignments.find((a) => a.slot === "main");
  return main?.surfaceId ?? null;
}

/** Build the OverrideIntent for a matched spoken phrase. restore needs no
 *  surface; every other kind targets the current primary surface. */
export function spokenOverrideIntent(
  kind: SpokenOverrideKind,
  surfaceId: string | null,
): OverrideIntent | null {
  if (kind === "restore") return { kind: "restore" };
  if (!surfaceId) return null;
  return { kind, surfaceId };
}
