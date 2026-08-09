import type { ReactNode } from "react";
import { useStore } from "zustand";

import type { PanelId } from "../contracts";
import { appStore } from "../store";
import { MaximizeIcon, RestoreIcon, XIcon } from "./icons";

/**
 * Panel titlebar: icon + label on the left, chrome actions on the right.
 *
 * W0-DIRECTIVE (GATE-5): EVERY panel header exposes a close X through this
 * shared seam — the frozen C1 human-initiated layout command
 * (panel.close through dispatchCommand; the service re-emits the
 * UiCommand and the UI reconciles against the authoritative event).
 * The maximize/restore action (local toggleFullscreen, never sent to the
 * server) is preserved.
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
  const dispatchCommand = useStore(appStore, (s) => s.dispatchCommand);
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
      <button
        type="button"
        className="panel-action panel-action--close"
        onClick={() => dispatchCommand({ action: "panel.close", panel_type: panelId })}
        aria-label="Cerrar panel"
        title="Cerrar"
      >
        <XIcon size={14} />
      </button>
    </header>
  );
}
