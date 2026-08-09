import { useRef, type ComponentType } from "react";
import { useStore } from "zustand";

import type { LayoutSpec, SurfaceRole } from "../adaptive/contracts";
import type { PanelId, SlotName } from "../layout/engine";
import type { PanelMeta } from "../store";
import { appStore } from "../store";

import { ConversationPanel } from "./ConversationPanel";
import { ContentPanel } from "./ContentPanel";
import { BrowserPanel } from "./BrowserPanel";
import { DocumentPanel } from "./DocumentPanel";
import { MediaDock } from "./MediaDock";
import { TasksPanel } from "./TasksPanel";
import { YoutubePanel } from "./YoutubePanel";
import { PlaceholderSurface } from "./PlaceholderSurface";

/**
 * Renders the application's activity stage (UI-101 shell).
 *
 * Regions are ARCHITECTURAL, not cards: every panel lives inside a
 * `.shell-region` (the engine geometry box) whose only chrome is the shared
 * divider language (a 1px seam on the side facing a neighboring region). The
 * stage itself carries the continuous region surface, so the engine's
 * percentage margins read as the same surface — no dark moat, no per-panel
 * borders, radius or shadows.
 *
 * The `.panel-slot` DOM contract is preserved (slot + density + animation
 * classes), now as the region's content box.
 *
 * Demo mode (`demoSpec`): renders the frozen template fixtures (UI-000)
 * with placeholder children, so the shell can be evaluated against all five
 * adaptive templates before UI-102 geometry lands. The arrangement is a
 * simple shell-level grid by slot — deliberately not real geometry.
 */

const PANEL_COMPONENTS: Partial<
  Record<PanelId, ComponentType<{ meta?: PanelMeta; panelId: PanelId }>>
> = {
  conversation: ConversationPanel,
  document_editor: DocumentPanel,
  youtube: YoutubePanel,
  media: MediaDock,
  browser: BrowserPanel,
  book_reader: ContentPanel,
  news: ContentPanel,
  notes: ContentPanel,
  tasks: TasksPanel,
  reminders: ContentPanel,
  telegram_preview: ContentPanel,
  settings: ContentPanel,
};

/**
 * The ONE separator language: a region gets a 1px seam on the side that
 * faces a neighboring region. Which side that is derives deterministically
 * from the visible slot composition:
 *   - horizontal order differs between the legacy engine (rail leftmost:
 *     rail|main|side) and the fixture demo grid (main|side|rail);
 *   - dock sits below the horizontal band and gets a top seam.
 * No region ever carries a full border.
 */
const HORIZONTAL_ORDER_LEGACY = ["rail", "main", "side"];
const HORIZONTAL_ORDER_DEMO = ["main", "side", "rail"];

function seamClasses(
  slot: SlotName | null | undefined,
  visibleSlots: ReadonlySet<string>,
  order: readonly string[],
): string[] {
  if (!slot) return [];
  if (slot === "dock") {
    return visibleSlots.has("main") ||
      visibleSlots.has("side") ||
      visibleSlots.has("rail")
      ? ["shell-region--seam-top"]
      : [];
  }
  const idx = order.indexOf(slot);
  if (idx === -1) return [];
  for (let i = idx + 1; i < order.length; i += 1) {
    if (visibleSlots.has(order[i])) return ["shell-region--seam-right"];
  }
  return [];
}

function regionClasses(
  slot: SlotName | null | undefined,
  visibleSlots: ReadonlySet<string>,
  order: readonly string[],
): string {
  return [
    "shell-region",
    slot ? `shell-region--${slot}` : "shell-region--unassigned",
    ...seamClasses(slot, visibleSlots, order),
  ]
    .filter(Boolean)
    .join(" ");
}

/** Demo (fixture) mode: one architectural region per layout assignment. */
function ShellDemo({ spec }: { spec: LayoutSpec }) {
  const visibleSlots = new Set(spec.assignments.map((a) => a.slot));
  return (
    <div className="panel-host shell-demo" data-template={spec.template}>
      {spec.assignments.map((a) => (
        <div
          key={a.surfaceId}
          className={`${regionClasses(a.slot as SlotName, visibleSlots, HORIZONTAL_ORDER_DEMO)} shell-demo-region`}
          data-role={a.role}
        >
          <div className={`panel-slot panel-slot--${a.slot}`}>
            <PlaceholderSurface role={a.role as SurfaceRole} surfaceId={a.surfaceId} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function PanelHost({
  demoSpec,
}: {
  /** When set, renders the frozen template fixture with placeholder children. */
  demoSpec?: LayoutSpec | null;
}) {
  const layout = useStore(appStore, (s) => s.layout);
  const panelMeta = useStore(appStore, (s) => s.panelMeta);
  const fullscreenPanel = useStore(appStore, (s) => s.fullscreenPanel);
  const hostRef = useRef<HTMLDivElement>(null);

  if (demoSpec) {
    return <ShellDemo spec={demoSpec} />;
  }

  if (fullscreenPanel) {
    const Component = PANEL_COMPONENTS[fullscreenPanel];
    if (Component) {
      return (
        <div className="panel-host" ref={hostRef}>
          <div className="panel fullscreen">
            <Component meta={panelMeta[fullscreenPanel]} panelId={fullscreenPanel} />
          </div>
        </div>
      );
    }
  }

  const visible = layout.panels.filter((g) => g.visible);
  const visibleSlots = new Set(visible.map((g) => g.slot).filter(Boolean) as string[]);

  return (
    <div className="panel-host" ref={hostRef}>
      {visible.map((g) => {
        const Component = PANEL_COMPONENTS[g.panel];
        if (!Component) return null;
        const style = {
          left: `${g.x * 100}%`,
          top: `${g.y * 100}%`,
          width: `${g.width * 100}%`,
          height: `${g.height * 100}%`,
          zIndex: g.zIndex,
        };
        const slotClasses = [
          "panel-slot",
          g.slot ? `panel-slot--${g.slot}` : "",
          `density-${g.density}`,
          g.composerCollapsed ? "composer-collapsed" : "",
          g.placeholderHidden ? "placeholder-hidden" : "",
          g.animation,
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <div
            key={g.panel}
            className={regionClasses(g.slot, visibleSlots, HORIZONTAL_ORDER_LEGACY)}
            style={style}
            data-panel={g.panel}
            data-role={g.role}
          >
            <div className={slotClasses}>
              <Component meta={panelMeta[g.panel]} panelId={g.panel} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
