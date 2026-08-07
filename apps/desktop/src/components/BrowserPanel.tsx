import { useStore } from "zustand";
import { useState } from "react";

import { appStore } from "../store";
import { PanelHeader } from "./PanelHeader";
import { ChevronLeftIcon, ChevronRightIcon, GlobeIcon, ReloadIcon, SearchIcon } from "./icons";

const START_URL = "about:blank";

/**
 * Integrated browser panel — the agent drives it (browser.navigate events
 * and DOM snapshot through the backend bridge) and the user drives it
 * directly (address bar, back/forward, refresh). News and anything else
 * on the web live here. The web demo renders an iframe; the Electron
 * build swaps in a real webview with the same chrome.
 */
export function BrowserPanel({ meta }: { meta?: { title?: string } }) {
  const browser = useStore(appStore, (s) => s.content.browser);
  const dispatchCommand = useStore(appStore, (s) => s.dispatchCommand);
  const [draft, setDraft] = useState("");

  const url = browser?.url ?? "";
  const loading = browser?.loading ?? false;
  const hasPage = url !== "" && url !== START_URL;

  const go = (raw: string): void => {
    const text = raw.trim();
    if (!text) return;
    const target = /^https?:\/\//i.test(text) ? text : `https://${text}`;
    setDraft("");
    dispatchCommand({ action: "browser.navigate", url: target });
  };

  return (
    <section className="panel browser-panel">
      <PanelHeader panelId="browser" icon={<GlobeIcon size={15} />}>
        {browser?.title || meta?.title || "Navegador"}
      </PanelHeader>
      <div className="browser-toolbar">
        <button
          type="button"
          className="browser-nav-btn"
          disabled={!browser?.canGoBack}
          onClick={() => dispatchCommand({ action: "browser.back" })}
          aria-label="Atrás"
        >
          <ChevronLeftIcon size={16} />
        </button>
        <button
          type="button"
          className="browser-nav-btn"
          disabled={!browser?.canGoForward}
          onClick={() => dispatchCommand({ action: "browser.forward" })}
          aria-label="Adelante"
        >
          <ChevronRightIcon size={16} />
        </button>
        <button
          type="button"
          className="browser-nav-btn"
          onClick={() => dispatchCommand({ action: "browser.refresh" })}
          aria-label="Recargar"
        >
          <ReloadIcon size={15} />
        </button>
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
