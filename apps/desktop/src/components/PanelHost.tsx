import { useEffect, useRef, type ComponentType } from "react";
import { useStore } from "zustand";

import type { PanelId } from "../layout/engine";
import type { PanelMeta } from "../store";
import { appStore } from "../store";

import { ConversationPanel } from "./ConversationPanel";
import { ContentPanel } from "./ContentPanel";
import { BrowserPanel } from "./BrowserPanel";
import { DocumentPanel } from "./DocumentPanel";
import { MediaDock } from "./MediaDock";
import { TasksPanel } from "./TasksPanel";
import { YoutubePanel } from "./YoutubePanel";

/**
 * Renders the layout computed by the engine. Panels are placed by SLOT:
 * each rendered slot carries `panel-slot--<slot>` and `density-<density>`
 * classes so the chrome (headers, composer) adapts deterministically.
 * Panel types without a component render nothing — no crash.
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

export function PanelHost() {
  const layout = useStore(appStore, (s) => s.layout);
  const panelMeta = useStore(appStore, (s) => s.panelMeta);
  const fullscreenPanel = useStore(appStore, (s) => s.fullscreenPanel);
  const setViewport = useStore(appStore, (s) => s.setViewport);
  const hostRef = useRef<HTMLDivElement>(null);

  // Feed the real content-viewport size (px) into the store so the engine
  // can enforce px floors and derive chrome density from actual geometry.
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const report = () => {
      const rect = el.getBoundingClientRect();
      setViewport({ width: Math.round(rect.width), height: Math.round(rect.height) });
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => observer.disconnect();
  }, [setViewport]);

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

  return (
    <div className="panel-host" ref={hostRef}>
      {layout.panels
        .filter((g) => g.visible)
        .map((g) => {
          const Component = PANEL_COMPONENTS[g.panel];
          if (!Component) return null;
          const style = {
            left: `${g.x * 100}%`,
            top: `${g.y * 100}%`,
            width: `${g.width * 100}%`,
            height: `${g.height * 100}%`,
            zIndex: g.zIndex,
          };
          const classes = [
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
            <div key={g.panel} className={classes} style={style}>
              <Component meta={panelMeta[g.panel]} panelId={g.panel} />
            </div>
          );
        })}
    </div>
  );
}
