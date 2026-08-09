/**
 * Shell-owned persistent regions host (UI-101).
 *
 * Per the frozen contract: `persistent` surfaces (media playback bar,
 * notifications) are controlled by the SHELL, not by template slots —
 * LayoutSpec can never contain a persistent assignment. This host is where
 * persistent-capable surfaces live. It is a sibling of the activity stage
 * (never inside it), so persistent regions survive any template change.
 *
 * UI-205 (Wave 2): the media slot is wired to the real adaptive MediaDock
 * compact playback bar. The host hands it a persistent role through
 * SurfaceRoleProvider (same contract SurfaceHost uses), so MediaDock renders
 * its `persistent` variant: title + play/pause + progress, no competition
 * with the primary activity. Playback state stays in store.content.media —
 * the bar merely mirrors it, so primary -> persistent never resets playback.
 * Notifications remain the placeholder until UI-204 lands.
 */

import { SurfaceRoleProvider } from "../roles/context";
import { NotificationRegion } from "./NotificationRegion";
import { MediaDock } from "./MediaDock";

export interface PersistentSurface {
  surfaceId: string;
  kind: "media" | "notifications";
}

export function PersistentRegions({
  surfaces,
}: {
  surfaces: PersistentSurface[];
}) {
  if (surfaces.length === 0) return null;
  return (
    <div className="app-persistent" role="region" aria-label="Regiones persistentes">
      {surfaces.map((s) =>
        s.kind === "media" ? (
          <SurfaceRoleProvider
            key={s.surfaceId}
            value={{
              surfaceId: s.surfaceId,
              role: "persistent",
              requestedRole: "persistent",
              capabilities: ["persistent"],
              degraded: false,
            }}
          >
            <MediaDock panelId="media" />
          </SurfaceRoleProvider>
        ) : (
          // GATE-3.5 (A6/R34): the notifications region renders the real
          // store list (live events + snapshot restore), not a placeholder.
          <NotificationRegion key={s.surfaceId} />
        ),
      )}
    </div>
  );
}
