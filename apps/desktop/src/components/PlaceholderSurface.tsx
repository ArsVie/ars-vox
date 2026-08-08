/**
 * Shell placeholder children (UI-101).
 *
 * Product surfaces (browser/conversation/reader/tasks/media) get their real
 * adaptive rendering in Wave 2 (UI-201..205). During Wave 1 the shell renders
 * these placeholders so the shell itself can be evaluated: the placeholder is
 * deliberately NOT a card — it has no border, no shadow, no radius. It sits
 * directly on the continuous stage surface, inside an architectural region
 * delimited only by the shared divider language.
 *
 * The visible label names the ROLE (primary/companion/support), never a fake
 * product surface name, and is demo scaffolding — it goes away when the real
 * surface lands.
 */

import type { SurfaceRole } from "../adaptive/contracts";
import { BellIcon, WaveformIcon } from "./icons";

const ROLE_LABELS: Record<SurfaceRole, string> = {
  primary: "Actividad principal",
  companion: "Acompañante",
  support: "Soporte",
  persistent: "Persistente",
};

/** Ghost skeleton bars suggesting content without pretending to be content. */
function Skeleton() {
  return (
    <div className="placeholder-skeleton" aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  );
}

export function PlaceholderSurface({
  role,
  surfaceId,
}: {
  role: SurfaceRole;
  surfaceId: string;
}) {
  return (
    <div
      className={`placeholder-surface placeholder-surface--${role}`}
      data-surface-id={surfaceId}
      data-role={role}
    >
      <span className="placeholder-role">{ROLE_LABELS[role]}</span>
      <span className="placeholder-id">{surfaceId}</span>
      <Skeleton />
    </div>
  );
}

/** Shell-owned persistent media bar placeholder (media playback region). */
export function PersistentMediaPlaceholder() {
  return (
    <div className="shell-persistent-region" data-kind="media" data-surface-id="placeholder.persistent">
      <span className="shell-persistent-icon">
        <WaveformIcon size={16} />
      </span>
      <span className="shell-persistent-label">Multimedia</span>
      <span className="shell-persistent-hint">La reproducción se mantiene aquí al cambiar de actividad</span>
    </div>
  );
}

/** Shell-owned persistent notifications region placeholder. */
export function PersistentNotificationsPlaceholder() {
  return (
    <div className="shell-persistent-region" data-kind="notifications" data-surface-id="shell.notifications">
      <span className="shell-persistent-icon">
        <BellIcon size={16} />
      </span>
      <span className="shell-persistent-label">Notificaciones</span>
      <span className="shell-persistent-hint">Avisos y recordatorios</span>
    </div>
  );
}
