/**
 * GATE-2 (Wave 2) — product surface wiring.
 *
 * Wave 1 registered only placeholder fixtures; UI-201..205 built the real
 * adaptive surfaces (role-driven variants via useSurfaceRole). This module
 * is the single wiring point that makes the real surfaces placeable through
 * LayoutSpec and renderable by the adaptive stage:
 *
 *  - registerProductSurfaces(): idempotent registration in the shared
 *    surfaceRegistry (roles/registry.ts) with each surface's role
 *    capabilities. Ids match the components' panelId vocabulary (browser /
 *    conversation / document / tasks / media).
 *  - SURFACE_COMPONENTS / surfaceComponent(): surfaceId → component map
 *    consumed by AdaptiveStage; unmapped ids fall back to the placeholder
 *    fixture (existing behavior preserved).
 *
 * Registry rules (frozen, UI-103): duplicate registration throws, so
 * registration is guarded with has(). Media is the only persistent-capable
 * product surface (shell-owned compact playback bar, UI-205).
 */
import type { ComponentType } from "react";

import type { SurfaceRegistration } from "./contracts";
import type { PanelId } from "../contracts";
import { surfaceRegistry } from "../roles/registry";
import { BrowserPanel } from "../components/BrowserPanel";
import { ConversationPanel } from "../components/ConversationPanel";
import { DocumentPanel } from "../components/DocumentPanel";
import { TasksPanel } from "../components/TasksPanel";
import { MediaDock } from "../components/MediaDock";

/** Product surfaces registered at GATE-2 (Wave 2). Ids follow the PanelId
 *  vocabulary so the stage can pass panelId={surfaceId} unchanged. */
export const PRODUCT_SURFACES: SurfaceRegistration[] = [
  {
    surfaceId: "browser",
    roles: ["primary", "companion", "support"],
    persistentCapable: false,
  },
  {
    surfaceId: "conversation",
    roles: ["primary", "companion", "support"],
    persistentCapable: false,
  },
  {
    // Reading surface — the wire's book_reader panel id. The library
    // tools emit panel.open book_reader; without a registered surface
    // the open silently no-ops (reviewer round 3, 2026-08-14). The
    // generic titled panel is the honest host: it shows the book title
    // + reference; the agent reads the text aloud in the chat.
    surfaceId: "book_reader",
    roles: ["primary", "companion", "support"],
    persistentCapable: false,
  },
  {
    surfaceId: "document_editor",
    roles: ["primary", "companion", "support"],
    persistentCapable: false,
  },
  {
    surfaceId: "tasks",
    roles: ["primary", "companion", "support"],
    persistentCapable: false,
  },
  {
    surfaceId: "media",
    roles: ["primary", "companion", "persistent"],
    persistentCapable: true,
  },
];

/**
 * surfaceId → real adaptive surface component (panelId == surfaceId).
 * Values have heterogeneous prop contracts ({meta}, {meta, panelId}, ...) —
 * the stage passes `panelId` which the panels that need it consume and the
 * rest ignore. ComponentType<any> is deliberate here (wiring table, not an
 * API); each panel's own props stay strictly typed at its definition.
 */
export const SURFACE_COMPONENTS: Record<string, ComponentType<any>> = {
  browser: BrowserPanel,
  conversation: ConversationPanel,
  document_editor: DocumentPanel,
  // R5 (2026-08-14, reviewer round 5 finding 1): book_reader was mapped
  // to the generic ContentPanel, which renders only its empty hint —
  // "No hay ningún libro abierto" — while the voice claimed the book was
  // open. The reading surface IS DocumentPanel (it reads
  // content.document_editor, which library.open now populates via a
  // document.load event). Same component, wire id preserved.
  book_reader: DocumentPanel,
  tasks: TasksPanel,
  media: MediaDock,
};

/** Register all product surfaces. Idempotent — safe to call from the shell
 *  entry and from tests. */
export function registerProductSurfaces(): void {
  for (const registration of PRODUCT_SURFACES) {
    if (!surfaceRegistry.has(registration.surfaceId)) {
      surfaceRegistry.register(registration);
    }
  }
}

/** Component for a surfaceId, or undefined when unmapped (stage falls back
 *  to the placeholder fixture). */
export function surfaceComponent(surfaceId: string): ComponentType<any> | undefined {
  return SURFACE_COMPONENTS[surfaceId];
}
