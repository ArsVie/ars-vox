/**
 * Shell-owned persistent regions host (UI-101).
 *
 * Per the frozen contract: `persistent` surfaces (media playback bar,
 * notifications) are controlled by the SHELL, not by template slots —
 * LayoutSpec can never contain a persistent assignment. This host is where
 * persistent-capable surfaces live. It is a sibling of the activity stage
 * (never inside it), so persistent regions survive any template change.
 *
 * Wave 1: the host accepts surfaces via props and renders region shells with
 * placeholders. Product media/notifications surfaces move here in Wave 2
 * (UI-205 media, UI-204 notifications) — the wiring point is the `surfaces`
 * prop; until then the demo passes the fixture persistent surface.
 */

import {
  PersistentMediaPlaceholder,
  PersistentNotificationsPlaceholder,
} from "./PlaceholderSurface";

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
          <PersistentMediaPlaceholder key={s.surfaceId} />
        ) : (
          <PersistentNotificationsPlaceholder key={s.surfaceId} />
        ),
      )}
    </div>
  );
}
