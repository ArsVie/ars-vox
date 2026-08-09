import { useStore } from "zustand";
import { useState } from "react";

import { useSurfaceRole } from "../roles/context";
import { appStore } from "../store";
import { PanelHeader } from "./PanelHeader";
import { GlobeIcon, SearchIcon } from "./icons";

const START_URL = "about:blank";

/**
 * Integrated browser panel — the agent drives it (browser.navigate events
 * and DOM snapshot through the backend bridge) and the user drives it
 * directly (address bar). News and anything else on the web live here.
 * The panel renders a sandboxed iframe to the current URL — the Electron
 * build keeps the same iframe (W1-ELECTRON: no WebContentsView engine;
 * hardened-view deleted).
 *
 * UI-201: renders adaptively per its semantic role. primary = the full
 * browsing experience (Ars Vox IS the browser); companion = reduced
 * chrome for side-by-side workflows (subdued, smaller controls);
 * support = compact contextual representation (viewport only — no
 * address entry). The .browser-viewport DOM contract is preserved in
 * every variant. State lives in store.content.browser and local
 * component state (address draft) — the role host keys surfaces by
 * surfaceId, so role/template changes never remount this component.
 *
 * GATE-3.5 (W3-BROWSER): the back/forward/refresh toolbar buttons were
 * DEAD and are removed. The service hardcodes can_go_back=false
 * (actions.py:254) and there is no browser engine to report history
 * state, so the buttons were permanently disabled; driving the iframe's
 * history from the parent is also impossible under the cross-origin
 * sandbox (history.back/forward throw SecurityError; reload is not
 * exposed cross-origin). Navigation happens through the address bar
 * (browser.navigate), which the backend honors. The browser.back /
 * browser.forward / browser.refresh client actions stay in the wire
 * contract (R39 drift guard pins them against the Python ClientAction
 * union) — the UI just no longer ships dead buttons for them.
 */
export function BrowserPanel({ meta }: { meta?: { title?: string } }) {
  const browser = useStore(appStore, (s) => s.content.browser);
  const dispatchCommand = useStore(appStore, (s) => s.dispatchCommand);
  const [draft, setDraft] = useState("");

  const role = useSurfaceRole().role;

  const url = browser?.url ?? "";
  const loading = browser?.loading ?? false;
  const hasPage = url !== "" && url !== START_URL;
  // The header label is the PAGE title (functional), never a surface name.
  const title = browser?.title || meta?.title;
  // Support = compact contextual representation: viewport only, no toolbar.
  const showAddress = role !== "support";

  const go = (raw: string): void => {
    const text = raw.trim();
    if (!text) return;
    const target = /^https?:\/\//i.test(text) ? text : `https://${text}`;
    setDraft("");
    dispatchCommand({ action: "browser.navigate", url: target });
  };

  return (
    <section
      className={`panel browser-panel browser-surface--${role}`}
      data-browser-role={role}
    >
      <PanelHeader panelId="browser" icon={<GlobeIcon size={15} />}>
        {title}
      </PanelHeader>
      {showAddress ? (
        <div className="browser-toolbar">
          <form
            className="browser-address"
            onSubmit={(e) => {
              e.preventDefault();
              go(draft);
            }}
          >
            <SearchIcon size={13} className="browser-address-icon" />
            <input
              type="text"
              value={draft}
              placeholder="Busca o escribe una dirección…"
              aria-label="Dirección web"
              onChange={(e) => setDraft(e.target.value)}
              spellCheck={false}
            />
            {loading ? <span className="browser-spinner" aria-label="Cargando" /> : null}
          </form>
        </div>
      ) : null}
      <div className="browser-viewport">
        {hasPage ? (
          <iframe
            key={url}
            src={url}
            title="Página web"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="content-panel-empty">
            <span className="content-panel-empty-icon">
              <GlobeIcon size={30} />
            </span>
            <span className="content-panel-empty-text">
              Pídeme que abra una página o escribe una dirección arriba.
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
