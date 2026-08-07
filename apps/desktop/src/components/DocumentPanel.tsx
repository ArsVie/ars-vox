import { useStore } from "zustand";

import type { PanelId } from "../layout/engine";
import type { PanelMeta } from "../store";
import { appStore } from "../store";
import { PanelHeader } from "./PanelHeader";
import { DocumentIcon } from "./icons";

export function DocumentPanel({ meta, panelId }: { meta?: PanelMeta; panelId: PanelId }) {
  const sendText = useStore(appStore, (s) => s.sendText);

  return (
    <section className="panel document-panel" aria-label="Document">
      <PanelHeader panelId={panelId} icon={<DocumentIcon size={15} />}>
        Documento
      </PanelHeader>
      <div className="document-body">
        {meta?.title || meta?.contentReference ? (
          <>
            <h2>{meta.title ?? "Documento"}</h2>
            {meta.contentReference ? (
              <p className="document-reference">{meta.contentReference}</p>
            ) : null}
          </>
        ) : (
          <div className="empty-state">
            <span className="empty-icon">
              <DocumentIcon size={34} />
            </span>
            <p className="empty-title">No hay documento abierto</p>
            <p className="empty-hint">Pídele al asistente que abra un documento.</p>
            <button
              type="button"
              className="empty-action"
              onClick={() => sendText("Abre un documento")}
            >
              Abrir documento
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
