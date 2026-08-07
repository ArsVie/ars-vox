import type { ReactNode } from "react";
import { useStore } from "zustand";

import type { PanelId } from "../layout/engine";
import { appStore } from "../store";
import { MaximizeIcon, RestoreIcon } from "./icons";

/**
 * Panel titlebar: icon + label on the left, optional chrome actions on
 * the right (currently: maximize/restore, driven by the local
 * toggleFullscreen action — never sent to the server).
 */
export function PanelHeader({
  panelId,
  icon,
  children,
}: {
  panelId: PanelId;
  icon: ReactNode;
  children: ReactNode;
}) {
  const fullscreenPanel = useStore(appStore, (s) => s.fullscreenPanel);
  const toggleFullscreen = useStore(appStore, (s) => s.toggleFullscreen);
  const fullscreen = fullscreenPanel === panelId;

  return (
    <header className="panel-header">
      <span className="panel-header-icon">{icon}</span>
      <span className="panel-header-title">{children}</span>
      <span className="panel-header-spacer" />
      <button
        type="button"
        className="panel-action"
        onClick={() => toggleFullscreen(panelId)}
        aria-label={fullscreen ? "Restore panel" : "Maximize panel"}
        title={fullscreen ? "Restore" : "Maximize"}
      >
        {fullscreen ? <RestoreIcon size={14} /> : <MaximizeIcon size={14} />}
      </button>
    </header>
  );
}
