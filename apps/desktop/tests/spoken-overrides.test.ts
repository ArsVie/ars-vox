/**
 * R21 (GATE-3.5) — Spoken layout overrides: deterministic speech →
 * OverrideIntent. Unit tests for the phrase matcher (accent-stripping,
 * politeness filler, whole-utterance semantics) + store integration (the
 * mic route consumes matched utterances through the ONE choke and never
 * sends them as user_text — no vague model suggestions).
 */
import { describe, expect, it } from "vitest";

import {
  matchSpokenOverride,
  normalizeSpoken,
  resolveSpokenOverrideTarget,
  spokenOverrideIntent,
  type SpokenOverrideKind,
} from "../src/adaptive/spokenOverrides";
import { TEMPLATE_FIXTURES } from "../src/adaptive/fixtures";
import { createAppStore } from "../src/store";

describe("R21 — spoken override phrase matching (deterministic)", () => {
  it("maps every frozen phrase to its OverrideIntent kind", () => {
    const cases: [string, SpokenOverrideKind][] = [
      ["haz esto más grande", "bigger"],
      ["hazlo más pequeño", "smaller"],
      ["ponlo a la derecha", "right"],
      ["ponlo a la izquierda", "left"],
      ["déjalo ahí", "keep"],
      ["quítalo", "close"],
      ["muéstrame los dos", "showBoth"],
      ["pantalla completa", "fullscreen"],
    ];
    for (const [phrase, kind] of cases) {
      expect(matchSpokenOverride(phrase)).toBe(kind);
    }
  });

  it("is accent-stripped, case- and punctuation-insensitive", () => {
    expect(matchSpokenOverride("¡HAZ ESTO MAS GRANDE!")).toBe("bigger");
    expect(matchSpokenOverride("Ponlo a la derecha.")).toBe("right");
    expect(matchSpokenOverride("déjalo ahí,")).toBe("keep");
  });

  it("accepts politeness filler (mirrors the STOP vocabulary rule)", () => {
    expect(matchSpokenOverride("pantalla completa por favor")).toBe(
      "fullscreen",
    );
    expect(matchSpokenOverride("haz esto mas grande, por favor")).toBe(
      "bigger",
    );
  });

  it("covers the documented inflection variants", () => {
    expect(matchSpokenOverride("hazlo mas grande")).toBe("bigger");
    expect(matchSpokenOverride("haz esto mas pequeno")).toBe("smaller");
    expect(matchSpokenOverride("quitarlo")).toBe("close");
    expect(matchSpokenOverride("restaura el diseño")).toBe("restore");
  });

  it("NEVER matches a phrase embedded in a larger utterance", () => {
    // Whole-utterance semantics: a layout command either IS the utterance
    // or it goes to the model (same rule as the Python "para" decision).
    expect(matchSpokenOverride("haz esto más grande y dime el clima")).toBeNull();
    expect(matchSpokenOverride("¿puedes ponerlo a la derecha?")).toBeNull();
    expect(matchSpokenOverride("no quiero pantalla completa")).toBeNull();
  });

  it("ignores unrelated speech", () => {
    expect(matchSpokenOverride("hola ars")).toBeNull();
    expect(matchSpokenOverride("cuéntame un chiste")).toBeNull();
  });
});

describe("R21 — target resolution + intent construction", () => {
  it("resolves the target to the main (primary) slot occupant", () => {
    expect(resolveSpokenOverrideTarget(TEMPLATE_FIXTURES.sidecar)).toBe(
      "placeholder.primary",
    );
    expect(resolveSpokenOverrideTarget(TEMPLATE_FIXTURES.triple)).toBe(
      "placeholder.primary",
    );
  });

  it("returns null before any composition exists", () => {
    expect(resolveSpokenOverrideTarget(null)).toBeNull();
  });

  it("builds the intent with the resolved surface (restore needs none)", () => {
    expect(spokenOverrideIntent("bigger", "x")).toEqual({
      kind: "bigger",
      surfaceId: "x",
    });
    expect(spokenOverrideIntent("restore", null)).toEqual({ kind: "restore" });
    expect(spokenOverrideIntent("bigger", null)).toBeNull();
  });
});

describe("R21 — store integration: speech → one choke, never the model", () => {
  const sidecar = TEMPLATE_FIXTURES.sidecar;

  it("consumes a matched utterance: applies the override, sends NO user_text", () => {
    const sent: unknown[] = [];
    const store = createAppStore((m) => sent.push(m));
    store.getState().applyAdaptiveSpec(sidecar);

    const consumed = store.getState().handleSpokenText("haz esto más grande");
    expect(consumed).toBe(true);
    // the constraint applied through the choke (proportion intent on the
    // primary's slot → wide)
    expect(store.getState().adaptive.spec?.proportion).toBe("wide");
    expect(store.getState().adaptive.overrides.bySurface["placeholder.primary"])
      .toMatchObject({ size: "bigger" });
    // consumed — nothing reached the transport (no vague model suggestion)
    expect(sent).toEqual([]);
  });

  it("routes close/right/fullscreen/showBoth deterministically", () => {
    // quítalo — removes the current primary (main slot occupant)
    {
      const store = createAppStore(() => {});
      store.getState().applyAdaptiveSpec(sidecar);
      store.getState().handleSpokenText("quítalo");
      expect(
        store.getState().adaptive.overrides.bySurface["placeholder.primary"],
      ).toMatchObject({ remove: true });
    }
    // ponlo a la derecha — the current primary moves to the side region
    {
      const store = createAppStore(() => {});
      store.getState().applyAdaptiveSpec(sidecar);
      store.getState().handleSpokenText("ponlo a la derecha");
      expect(
        store.getState().adaptive.overrides.bySurface["placeholder.primary"],
      ).toMatchObject({ position: "right" });
      expect(
        store.getState().adaptive.spec?.assignments.find(
          (a) => a.surfaceId === "placeholder.primary",
        )?.slot,
      ).toBe("side");
    }
    // pantalla completa — the current primary alone in focus
    {
      const store = createAppStore(() => {});
      store.getState().applyAdaptiveSpec(sidecar);
      store.getState().handleSpokenText("pantalla completa");
      expect(store.getState().adaptive.spec?.template).toBe("focus");
      expect(
        store.getState().adaptive.overrides.bySurface["placeholder.primary"],
      ).toMatchObject({ fullscreen: true });
    }
    // muéstrame los dos — equal two-primary split with the current primary
    {
      const store = createAppStore(() => {});
      store.getState().applyAdaptiveSpec(sidecar);
      store.getState().handleSpokenText("muéstrame los dos");
      expect(store.getState().adaptive.spec?.template).toBe("split");
      expect(
        store.getState().adaptive.spec?.assignments.filter(
          (a) => a.role === "primary",
        ),
      ).toHaveLength(2);
    }
  });

  it("restore clears the constraint set through the choke", () => {
    const store = createAppStore(() => {});
    store.getState().applyAdaptiveSpec(sidecar);
    store.getState().handleSpokenText("quítalo");
    expect(
      Object.keys(store.getState().adaptive.overrides.bySurface),
    ).not.toHaveLength(0);

    expect(store.getState().handleSpokenText("restaura el diseño")).toBe(true);
    expect(store.getState().adaptive.overrides.bySurface).toEqual({});
  });

  it("a spoken override is user-commanded: it bypasses the inertia wall", () => {
    const store = createAppStore(() => {});
    store.getState().applyAdaptiveSpec(sidecar);
    // agent-only template change is damped (baseline behavior)
    store.getState().applyAdaptiveSpec(TEMPLATE_FIXTURES.triple);
    expect(store.getState().adaptive.spec?.template).toBe("sidecar");
    // the same change via speech applies at once
    store.getState().applyAdaptiveSpec(TEMPLATE_FIXTURES.triple);
    expect(store.getState().adaptive.spec?.template).toBe("sidecar");
    store.getState().handleSpokenText("pantalla completa");
    expect(store.getState().adaptive.spec?.template).toBe("focus");
  });

  it("falls through to the normal path for non-matches and no composition", () => {
    const sent: unknown[] = [];
    const store = createAppStore((m) => sent.push(m));

    // no composition yet — even a matching phrase cannot be resolved
    expect(store.getState().handleSpokenText("quítalo")).toBe(false);
    expect(sent).toEqual([]); // not consumed, not sent either (caller sends)

    store.getState().applyAdaptiveSpec(sidecar);
    // non-match → false → the caller sends user_text
    expect(store.getState().handleSpokenText("hola ars")).toBe(false);
  });

  it("normalizes accented/punctuated speech before matching", () => {
    expect(normalizeSpoken("¡Déjalo ahí!")).toBe("dejalo ahi");
    expect(normalizeSpoken("PANTALLA COMPLETA.")).toBe("pantalla completa");
  });
});
