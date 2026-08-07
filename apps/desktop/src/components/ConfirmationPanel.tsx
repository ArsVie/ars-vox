import { useStore } from "zustand";

import { appStore } from "../store";
import { ShieldIcon } from "./icons";

/** Two-phase confirmation card. Approve executes the stored snapshot. */
export function ConfirmationPanel() {
  const pending = useStore(appStore, (s) => s.pending);
  const confirm = useStore(appStore, (s) => s.confirm);
  if (!pending) return null;

  return (
    <div className="overlay">
      <div className="confirmation-card" role="alertdialog" aria-label="Confirmation">
        <h2>
          <span className="card-icon">
            <ShieldIcon size={19} />
          </span>
          {pending.title}
        </h2>
        <p className="confirmation-detail">{pending.detail}</p>
        <p className="confirmation-tool">tool: {pending.tool}</p>
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
