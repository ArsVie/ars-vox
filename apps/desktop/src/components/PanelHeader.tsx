import type { ReactNode } from "react";
import { useStore } from "zustand";

import type { PanelId } from "../contracts";
import { appStore } from "../store";
import { MaximizeIcon, RestoreIcon } from "./icons";

/**
 * Panel titlebar: icon + label on the left, optional chrome actions on
 * the right (currently: maximize/restore, driven by the local
 * toggleFullscreen action — never sent to the server).
 *
 * GATE-3.5 (W2-STORE carve-out): the fullscreen icon state derives from
 * the adaptive fullscreen constraint (adaptive.overrides — the choke's
 * authoritative state). The legacy fullscreenPanel mirror is deleted.
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
  const overrides = useStore(appStore, (s) => s.adaptive.overrides);
  const toggleFullscreen = useStore(appStore, (s) => s.toggleFullscreen);
  const fullscreen = overrides.bySurface[panelId]?.fullscreen === true;

  return (
    <header className="panel-header">
      <span className="panel-header-icon">{icon}</span>
      <span className="panel-header-title">{children}</span>
      <span className="panel-header-spacer" />
      <button
        type="button"
        className="panel-action"
        onClick={() => toggleFullscreen(panelId)}
        aria-label={fullscreen ? "Restaurar panel" : "Maximizar panel"}
        title={fullscreen ? "Restaurar" : "Maximizar"}
      >
        {fullscreen ? <RestoreIcon size={14} /> : <MaximizeIcon size={14} />}
      </button>
    </header>
  );
}
