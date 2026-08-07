import type { ComponentType } from "react";
import { useStore } from "zustand";

import type { PanelId } from "../layout/engine";
import type { PanelMeta } from "../store";
import { appStore } from "../store";

import { ConversationPanel } from "./ConversationPanel";
import { DocumentPanel } from "./DocumentPanel";

/**
 * Renders the layout computed by the engine. The slice registers exactly
 * two panels: conversation and document_editor. Other panels may be
 * mounted/hidden by the engine but have no component yet.
 */
const PANEL_COMPONENTS: Partial<
  Record<PanelId, ComponentType<{ meta?: PanelMeta; panelId: PanelId }>>
> = {
  conversation: ConversationPanel,
  document_editor: DocumentPanel,
};

export function PanelHost() {
  const layout = useStore(appStore, (s) => s.layout);
  const panelMeta = useStore(appStore, (s) => s.panelMeta);
  const fullscreenPanel = useStore(appStore, (s) => s.fullscreenPanel);

  if (fullscreenPanel) {
    const Component = PANEL_COMPONENTS[fullscreenPanel];
    if (Component) {
      return (
        <div className="panel-host">
          <div className="panel fullscreen">
            <Component meta={panelMeta[fullscreenPanel]} panelId={fullscreenPanel} />
          </div>
        </div>
      );
    }
  }

  return (
    <div className="panel-host">
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
          return (
            <div key={g.panel} className={`panel-slot ${g.animation}`} style={style}>
              <Component meta={panelMeta[g.panel]} panelId={g.panel} />
            </div>
          );
        })}
    </div>
  );
}
