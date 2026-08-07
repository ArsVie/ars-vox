import type { PanelId } from "../layout/engine";
import type { PanelMeta } from "../store";
import { PanelHeader } from "./PanelHeader";
import { WaveformIcon } from "./icons";

/**
 * Dock-slot render target for media-type panels (youtube, media). In the
 * current slice there is no media pipeline, so the dock shows a waiting
 * state (the header carries the track title when the agent supplies one).
 * Playback controls land here when the media pipeline exists. The
 * slot/density chrome comes from PanelHost classes; this component only
 * owns its body.
 */
export function MediaDock({ meta, panelId }: { meta?: PanelMeta; panelId: PanelId }) {
  const title = meta?.title ?? (panelId === "youtube" ? "YouTube" : "Medios");

  return (
    <section className="panel media-dock" aria-label="Media dock">
      <PanelHeader panelId={panelId} icon={<WaveformIcon size={15} />}>
        {title}
      </PanelHeader>
      <div className="media-dock-body">
        <span className="media-dock-empty">Reproducción en espera.</span>
      </div>
    </section>
  );
}
