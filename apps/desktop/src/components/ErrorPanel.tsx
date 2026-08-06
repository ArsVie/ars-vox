import { useStore } from "zustand";

import { appStore } from "../store";

export function ErrorPanel() {
  const error = useStore(appStore, (s) => s.error);
  const dismiss = useStore(appStore, (s) => s.dismissError);
  if (!error) return null;

  return (
    <div className="error-banner" role="alert">
      <span className="error-text">{error.message}</span>
      <button type="button" className="error-dismiss" onClick={dismiss} aria-label="Dismiss">
        x
      </button>
    </div>
  );
}
