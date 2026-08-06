import type { PanelMeta } from "../store";

export function DocumentPanel({ meta }: { meta?: PanelMeta }) {
  return (
    <section className="panel document-panel" aria-label="Document">
      <header className="panel-header">Document</header>
      <div className="document-body">
        {meta?.title ? <h2>{meta.title}</h2> : <h2>No document open</h2>}
        {meta?.contentReference ? (
          <p className="document-reference">{meta.contentReference}</p>
        ) : (
          <p className="empty-hint">Ask the assistant to open a document.</p>
        )}
      </div>
    </section>
  );
}
