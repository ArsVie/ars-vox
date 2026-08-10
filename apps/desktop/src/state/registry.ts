/**
 * GATE-5 (W0-SLICE) — the ONE content registration seam.
 *
 * The store keeps the choke points (applyAdaptiveSpec, applyEvent,
 * dispatchCommand) but no longer holds the per-surface content bags:
 * each surface owns its bag in a slice module (state/*Slice.ts) and
 * registers here. The store's applyEvent / dispatchCommand delegate to
 * the registry, which routes each event/command to the slice that owns it.
 *
 * Product lanes (W1+) that need content state create a slice and call
 * `contentRegistry.register(slice)` — they never edit store.ts.
 *
 * Rules (deterministic, mirror roles/registry.ts):
 *  - register() throws when two slices claim the same event type or
 *    command action (a collision must be loud at registration, never
 *    silent at apply time).
 *  - Registering the same slice instance twice is a no-op.
 *  - applyEvent / applyCommand are pure: an event/command no slice owns
 *    returns the content bag UNCHANGED (same reference — no re-render),
 *    and a slice that produces the same bag reference is a no-op too.
 */

import type { ClientCommand, ServerEvent } from "../contracts";
import type { PanelContent } from "./types";

/** A per-surface content slice: the bag type, the wire surface it owns,
 *  and the pure reducers for its server events and client commands. */
export interface SurfaceSlice<Bag = unknown> {
  /** PanelContent key this slice owns (youtube | browser |
   *  document_editor | tasks | media | memory). */
  panelId: keyof PanelContent & string;
  /** Server event types this slice reduces. */
  eventTypes: readonly ServerEvent["type"][];
  /** Client command actions this slice reduces optimistically. */
  commandActions: readonly ClientCommand["action"][];
  /** Pure: reduce one server event onto the owned bag. Events outside
   *  eventTypes return the bag unchanged. */
  applyEvent(bag: Bag | undefined, event: ServerEvent): Bag | undefined;
  /** Pure: reduce one optimistic client command onto the owned bag.
   *  Commands outside commandActions return the bag unchanged. */
  applyCommand(bag: Bag | undefined, command: ClientCommand): Bag | undefined;
}

export interface ContentRegistry {
  /** Register a slice. Throws on event/command ownership collisions. */
  register(slice: SurfaceSlice): void;
  /** Route a server event to its owning slice; unknown events pass the
   *  content bag through untouched. */
  applyEvent(content: PanelContent, event: ServerEvent): PanelContent;
  /** Route an optimistic client command to its owning slice; unknown
   *  commands pass the content bag through untouched. */
  applyCommand(content: PanelContent, command: ClientCommand): PanelContent;
  /** All registered slices, in registration order. */
  registered(): readonly SurfaceSlice[];
}

export function createContentRegistry(): ContentRegistry {
  const slices: SurfaceSlice[] = [];
  const byEvent = new Map<string, SurfaceSlice>();
  const byCommand = new Map<string, SurfaceSlice>();

  const register = (slice: SurfaceSlice): void => {
    if (slices.includes(slice)) return; // same instance: idempotent
    for (const t of slice.eventTypes) {
      const owner = byEvent.get(t);
      if (owner && owner !== slice) {
        throw new Error(
          `content slice collision: event "${t}" is already owned by "${owner.panelId}"`,
        );
      }
    }
    for (const a of slice.commandActions) {
      const owner = byCommand.get(a);
      if (owner && owner !== slice) {
        throw new Error(
          `content slice collision: command "${a}" is already owned by "${owner.panelId}"`,
        );
      }
    }
    for (const t of slice.eventTypes) byEvent.set(t, slice);
    for (const a of slice.commandActions) byCommand.set(a, slice);
    slices.push(slice);
  };

  return {
    register,
    applyEvent(content, event) {
      const slice = byEvent.get(event.type);
      if (!slice) return content;
      const key = slice.panelId;
      const next = slice.applyEvent(content[key], event);
      if (next === content[key]) return content;
      return { ...content, [key]: next } as PanelContent;
    },
    applyCommand(content, command) {
      const slice = byCommand.get(command.action);
      if (!slice) return content;
      const key = slice.panelId;
      const next = slice.applyCommand(content[key], command);
      if (next === content[key]) return content;
      return { ...content, [key]: next } as PanelContent;
    },
    registered() {
      return [...slices];
    },
  };
}
