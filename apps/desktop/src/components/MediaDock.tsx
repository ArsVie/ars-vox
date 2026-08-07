import type { PanelId } from "../layout/engine";
import type { PanelMeta } from "../store";
import { PanelHeader } from "./PanelHeader";
import { WaveformIcon } from "./icons";

/**
 * Dock-slot render target for media-type panels (youtube, media). In the
 * current slice there is no media pipeline, so the dock shows the media
 * title (when the agent supplies one) or a waiting state. The slot/density
 * chrome comes from PanelHost classes; this component only owns its body.
 */
export function MediaDock({ meta, panelId }: { meta?: PanelMeta; panelId: PanelId }) {
  const title = meta?.title ?? (panelId === "youtube" ? "YouTube" : "Medios");

  return (
    <section className="panel media-dock" aria-label="Media dock">
      <PanelHeader panelId={panelId} icon={<WaveformIcon size={15} />}>
        {title}
      </PanelHeader>
      <div className="media-dock-body">
        {meta?.title ? (
          <span className="media-dock-title">{meta.title}</span>
        ) : (
          <span className="media-dock-empty">Reproducción en espera</span>
        )}
      </div>
    </section>
  );
}
