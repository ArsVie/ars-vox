import { useStore } from "zustand";

import { appStore } from "../store";
import { ShieldIcon } from "./icons";

/** Two-phase confirmation card. Approve executes the stored snapshot.
 *  R43: human labels only — the raw `tool:` name stays in store state
 *  (A7 semantics) but is never rendered. */
export function ConfirmationPanel() {
  const pending = useStore(appStore, (s) => s.pending);
  const confirm = useStore(appStore, (s) => s.confirm);
  if (!pending) return null;

  return (
    <div className="overlay">
      <div className="confirmation-card" role="alertdialog" aria-label="Confirmación">
        <h2>
          <span className="card-icon">
            <ShieldIcon size={19} />
          </span>
          {pending.title}
        </h2>
        <p className="confirmation-detail">{pending.detail}</p>
        <div className="confirmation-actions">
          <button type="button" className="approve" onClick={() => confirm(true)}>
            Aprobar
          </button>
          <button type="button" className="deny" onClick={() => confirm(false)}>
            Rechazar
          </button>
        </div>
      </div>
    </div>
  );
}
