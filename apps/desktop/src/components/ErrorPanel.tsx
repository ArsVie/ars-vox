import { useStore } from "zustand";

import { appStore } from "../store";
import { WarningIcon, XIcon } from "./icons";

export function ErrorPanel() {
  const error = useStore(appStore, (s) => s.error);
  const dismiss = useStore(appStore, (s) => s.dismissError);
  if (!error) return null;

  return (
    <div className="error-banner" role="alert">
      <span className="error-icon">
        <WarningIcon size={16} />
      </span>
      <span className="error-text">{error.message}</span>
      <button type="button" className="error-dismiss" onClick={dismiss} aria-label="Cerrar">
        <XIcon size={14} />
      </button>
    </div>
  );
}
