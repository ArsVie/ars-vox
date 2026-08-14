import { useStore } from "zustand";
import { useEffect, useRef, useState } from "react";

import { useSurfaceRole } from "../roles/context";
import { appStore } from "../store";
import { PanelHeader } from "./PanelHeader";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  GlobeIcon,
  ReloadIcon,
  SearchIcon,
} from "./icons";

const START_URL = "about:blank";

/**
 * Integrated browser panel — W2-VIEW (GATE-5, ADR 0007).
 *
 * The browser surface is a WebContentsView OWNED BY THE ELECTRON MAIN
 * PROCESS (isolated partition, navigation policy, CSP, no privileged
 * preload).
 * This panel is its chrome + placeholder:
 *  - the .browser-viewport div is a transparent placeholder — the native
 *    view is layered over it, sized to the bounds THIS component measures
 *    and reports over arsvox:browser-set-bounds (ResizeObserver + window
 *    resize; zeroed on unmount so the view never floats over other UI);
 *  - navigation is MAIN-owned: the address bar and the back/forward/
 *    refresh controls ask main via arsvox:browser-* IPC (and the same
 *    commands still flow to the agent service for the wire protocol);
 *  - REAL nav capability comes back: can_go_back/can_go_forward are the
 *    view's actual navigationHistory values (published over
 *    arsvox:browser-state), so the buttons are live, not dead.
 *
 * The renderer IFRAME PATH IS REMOVED — there is exactly one browser
 * story. The agent DOM bridge (browser.dom_action) stays W2-DRIVE's
 * lane; the event is already on the wire and routed.
 *
 * UI-201: renders adaptively per its semantic role (primary = full
 * browsing; companion = subdued chrome; support = viewport only). The
 * .browser-viewport DOM contract is preserved in every variant.
 */
export function BrowserPanel({ meta }: { meta?: { title?: string } }) {
  const browser = useStore(appStore, (s) => s.content.browser);
  const dispatchCommand = useStore(appStore, (s) => s.dispatchCommand);
  const [draft, setDraft] = useState("");
  const viewportRef = useRef<HTMLDivElement | null>(null);

  const role = useSurfaceRole().role;

  const url = browser?.url ?? "";
  const loading = browser?.loading ?? false;
  const canGoBack = browser?.canGoBack ?? false;
  const canGoForward = browser?.canGoForward ?? false;
  const hasPage = url !== "" && url !== START_URL;
  // The header label is the PAGE title (functional), never a surface name.
  const title = browser?.title || meta?.title;
  // Support = compact contextual representation: viewport only, no toolbar.
  const showAddress = role !== "support";

  // The WebContentsView is layered over .browser-viewport: keep main's
  // view bounds in lockstep with the measured panel area. Zero on unmount
  // so a closed/replaced panel never leaves the native view floating over
  // other UI.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return undefined;
    const report = (): void => {
      const rect = el.getBoundingClientRect();
      window.arsvox?.browserSetBounds({
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
    };
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    window.addEventListener("resize", report);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", report);
      window.arsvox?.browserSetBounds({ x: 0, y: 0, width: 0, height: 0 });
    };
  }, []);

  const go = (raw: string): void => {
    const text = raw.trim();
    if (!text) return;
    const target = /^https?:\/\//i.test(text) ? text : `https://${text}`;
    setDraft("");
    dispatchCommand({ action: "browser.navigate", url: target });
    window.arsvox?.browserNavigate(target);
  };

  // R6 (2026-08-14, reviewer round 6 finding 3): in the packaged Electron
  // app the page lives in a MAIN-owned WebContentsView layered over the
  // transparent .browser-viewport placeholder. In the web harness (vite /
  // headless browser) there is no Electron main — the placeholder is a
  // permanent hole and the agent's "te abrí las noticias" is a lie. When
  // the bridge is absent, render a REAL IFRAME so the page is visible.
  const hasElectronBridge =
    typeof window !== "undefined" &&
    typeof window.arsvox?.browserSetBounds === "function";
  const renderIframeFallback = !hasElectronBridge && hasPage;

  const nav = (action: "browser.back" | "browser.forward" | "browser.refresh"): void => {
    dispatchCommand({ action });
    if (action === "browser.back") window.arsvox?.browserBack();
    else if (action === "browser.forward") window.arsvox?.browserForward();
    else window.arsvox?.browserRefresh();
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
          <button
            type="button"
            className="browser-nav-btn"
            aria-label="Atrás"
            title="Atrás"
            disabled={!canGoBack}
            onClick={() => nav("browser.back")}
          >
            <ChevronLeftIcon size={14} />
          </button>
          <button
            type="button"
            className="browser-nav-btn"
            aria-label="Adelante"
            title="Adelante"
            disabled={!canGoForward}
            onClick={() => nav("browser.forward")}
          >
            <ChevronRightIcon size={14} />
          </button>
          <button
            type="button"
            className="browser-nav-btn"
            aria-label="Recargar"
            title="Recargar"
            onClick={() => nav("browser.refresh")}
          >
            <ReloadIcon size={13} />
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
      ) : null}
      <div className="browser-viewport" ref={viewportRef}>
        {renderIframeFallback ? (
          <iframe
            className="browser-iframe-fallback"
            src={url}
            title={title ?? "Página web"}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
            referrerPolicy="no-referrer"
          />
        ) : hasPage ? null : (
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
