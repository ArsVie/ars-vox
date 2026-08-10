/**
 * GATE-5 (routing-parity, defect #1) — memory slice.
 *
 * The memory.search_results wire member now has an honest consumer:
 * the memorySlice owns content.memory. (.tsx name matches the brief's
 * verification command; no JSX here.)
 */

import { describe, expect, it } from "vitest";

import { createContentRegistry, memorySlice } from "../src/state";
import type { PanelContent } from "../src/state/types";

function ts(): string {
  return new Date().toISOString();
}

describe("memorySlice (content.memory bag)", () => {
  it("claims exactly memory.search_results and no command actions", () => {
    expect(memorySlice.panelId).toBe("memory");
    expect(memorySlice.eventTypes).toEqual(["memory.search_results"]);
    expect(memorySlice.commandActions).toEqual([]);
  });

  it("stores memory.search_results results through the registry (honest consumer, no silent drop)", () => {
    const registry = createContentRegistry();
    registry.register(memorySlice);
    const content: PanelContent = {};
    const createdAt = ts();
    const after = registry.applyEvent(content, {
      type: "memory.search_results",
      query: "guitarra",
      results: [
        {
          id: "m1",
          kind: "note",
          text: "La guitarra de la abuela",
          created_at: null,
          source: "memory",
        },
      ],
      created_at: createdAt,
    });
    expect(after.memory).toEqual({
      query: "guitarra",
      results: [
        {
          id: "m1",
          kind: "note",
          text: "La guitarra de la abuela",
          created_at: null,
          source: "memory",
        },
      ],
      createdAt,
    });
    // other panels untouched
    expect(after.youtube).toBeUndefined();
    expect(after.browser).toBeUndefined();
  });

  it("passes unrelated events through unchanged", () => {
    const registry = createContentRegistry();
    registry.register(memorySlice);
    const content: PanelContent = { memory: { query: "q", results: [], createdAt: ts() } };
    const after = registry.applyEvent(content, {
      type: "browser.navigate",
      url: "https://example.com",
      title: "Example",
      can_go_back: false,
      can_go_forward: false,
      loading: false,
      created_at: ts(),
    });
    expect(after).toBe(content);
  });
});
