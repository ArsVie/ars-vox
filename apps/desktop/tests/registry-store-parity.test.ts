/**
 * GATE-5 (routing-parity, finding #2) — registry <-> store routing parity.
 *
 * The slices' event claims (state/registry.ts byEvent, walked here through
 * contentRegistry.registered()) and the store's applyEvent routing must
 * never drift. CONTENT_ROUTED_EVENTS (store.ts) is the single source of
 * truth: applyEvent's switch derives from it, so the store cannot drift on
 * its own — this test cross-checks it against the live registry in BOTH
 * directions:
 *   - a slice-claimed event type the store never routes is dead on the
 *     wire (the defect that killed memory.search_results and
 *     browser.dom_action — frames dropped silently);
 *   - a store-routed event nobody claims (or two slices claim) is a
 *     silent no-op / registration-time collision.
 * This is the guard that makes the "never edit store.ts" promise
 * enforceable.
 */

import { describe, expect, it } from "vitest";

import { CONTENT_ROUTED_EVENTS } from "../src/store";
import { contentRegistry } from "../src/state";

describe("registry <-> store routing parity (GATE-5)", () => {
  const registered = contentRegistry.registered();

  it("every event type claimed by a registered slice is routed in applyEvent", () => {
    const routed = new Set<string>(CONTENT_ROUTED_EVENTS);
    for (const slice of registered) {
      for (const type of slice.eventTypes) {
        expect(
          routed.has(type),
          `"${type}" is claimed by slice "${slice.panelId}" but applyEvent never routes it — frames would be dropped silently`,
        ).toBe(true);
      }
    }
  });

  it("every content-routed event type is claimed by exactly one slice", () => {
    for (const type of CONTENT_ROUTED_EVENTS) {
      const owners = registered.filter((slice) =>
        slice.eventTypes.includes(type),
      );
      expect(
        owners.length,
        `"${type}" is routed in applyEvent but claimed by ${owners.length} slices (${owners
          .map((o) => o.panelId)
          .join(", ") || "none"}) — exactly one owner required`,
      ).toBe(1);
    }
  });
});
