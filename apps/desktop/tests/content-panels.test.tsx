/**
 * SSR render coverage for the five content panels (YoutubePanel,
 * BrowserPanel, TasksPanel, DocumentPanel, MediaDock) — renderToString,
 * no DOM/jsdom needed. Same zustand SSR trick as the deleted
 * panelhost.test.tsx: useStore snapshots via `api.getServerState ||
 * api.getInitialState`, so we attach a live getServerState in beforeEach
 * and seed the singleton store through the real event path (applyEvent)
 * or setState.
 *
 * W2-SURFACES: the panel components require a SurfaceRoleProvider
 * ancestor (useSurfaceRole throws without one) — every render mounts
 * through the provider the way tests/media-surface.test.tsx does.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { appStore } from "../src/store";
import { YoutubePanel } from "../src/components/YoutubePanel";
import { BrowserPanel } from "../src/components/BrowserPanel";
import { TasksPanel } from "../src/components/TasksPanel";
import { DocumentPanel } from "../src/components/DocumentPanel";
import { MediaDock } from "../src/components/MediaDock";
import {
  SurfaceRoleProvider,
  type SurfaceRoleInfo,
} from "../src/roles/context";
import type { SurfaceRole } from "../src/adaptive/contracts";

function ts(): string {
  return new Date().toISOString();
}

/** Capabilities the product surfaces declare in the shared registry. */
const STANDARD_ROLES: readonly SurfaceRole[] = [
  "primary",
  "companion",
  "support",
];
const MEDIA_ROLES: readonly SurfaceRole[] = [
  "primary",
  "companion",
  "persistent",
];

function roleInfo(
  surfaceId: string,
  capabilities: readonly SurfaceRole[],
): SurfaceRoleInfo {
  return {
    surfaceId,
    role: "primary",
    requestedRole: "primary",
    capabilities,
    degraded: false,
  };
}

/** Mount a panel as the PRIMARY surface (full variant) — the W2-SURFACES
 *  contract: surfaces render inside a SurfaceRoleProvider (same pattern
 *  as tests/media-surface.test.tsx). */
function renderPrimary(
  node: ReactNode,
  surfaceId: string,
  capabilities: readonly SurfaceRole[],
): string {
  return renderToStaticMarkup(
    <SurfaceRoleProvider value={roleInfo(surfaceId, capabilities)}>
      {node}
    </SurfaceRoleProvider>,
  );
}

beforeEach(() => {
  (appStore as unknown as { getServerState: () => unknown }).getServerState = () =>
    appStore.getState();
  // Start every test with an empty content surface.
  appStore.setState({ content: {} });
});

describe("YoutubePanel", () => {
  it("renders each search result title and channel", () => {
    appStore.getState().applyEvent({
      type: "youtube.search",
      query: "sinfonía",
      results: [
        {
          id: "v1",
          title: "Sinfonía nº 9",
          channel: "Orquesta Clásica",
          duration_s: 4520,
          published: "hace 2 años",
          thumbnail_url: null,
        },
        {
          id: "v2",
          title: "Concierto de piano",
          channel: "Música Viva",
          duration_s: 95,
          published: "hace 1 mes",
          thumbnail_url: "https://example.com/thumb.jpg",
        },
      ],
      created_at: ts(),
    });

    const html = renderPrimary(<YoutubePanel />, "youtube", STANDARD_ROLES);
    expect(html).toContain("youtube-search");
    expect(html).toContain("Sinfonía nº 9");
    expect(html).toContain("Orquesta Clásica");
    expect(html).toContain("Concierto de piano");
    expect(html).toContain("Música Viva");
    expect(html).toContain("1:15:20"); // 4520s -> h:mm:ss
    expect(html).toContain("1:35"); // 95s -> m:ss
    expect(html).not.toContain("Pídeme que busque un vídeo");
  });

  it("renders the empty-state text when there is no youtube content", () => {
    const html = renderPrimary(<YoutubePanel />, "youtube", STANDARD_ROLES);
    expect(html).toContain("content-panel-empty-text");
    expect(html).toContain("Pídeme que busque un vídeo o escribe aquí arriba.");
    expect(html).not.toContain("youtube-card");
  });

  it("renders selectable cards from the unified media.search_results bag (GATE-5 wire)", () => {
    appStore.setState({
      content: {
        youtube: {
          query: "guitarra",
          loading: false,
          results: [
            {
              id: "v1",
              title: "Clases de guitarra",
              source: "youtube",
              kind: "video",
              channel: "Marta",
              duration_s: 600,
              published: "hace 2 días",
              thumbnail_url: null,
              local_path: null,
            },
            {
              id: "v2",
              title: "Concierto de piano",
              source: "youtube",
              kind: "video",
              channel: "Música Viva",
              duration_s: 95,
              published: "hace 1 mes",
              thumbnail_url: "https://example.com/thumb.jpg",
              local_path: null,
            },
          ],
        },
      },
    });

    const html = renderPrimary(<YoutubePanel />, "youtube", STANDARD_ROLES);
    expect(html).toContain("Clases de guitarra");
    expect(html).toContain("Marta");
    expect(html).toContain("Concierto de piano");
    expect(html).toContain("Música Viva");
    expect(html).toContain("10:00"); // 600s
    expect(html).toContain("1:35"); // 95s
    // Every card is a selectable option (click -> media.select_result).
    expect(html).toContain('aria-label="Seleccionar: Clases de guitarra"');
    expect(html).toContain('aria-label="Seleccionar: Concierto de piano"');
    expect(html).not.toContain("Pídeme que busque un vídeo");
  });

  it("shows the honest 'no encontré nada' after a performed search with zero results", () => {
    appStore.setState({
      content: { youtube: { query: "xyz no existe", loading: false, results: [] } },
    });

    const html = renderPrimary(<YoutubePanel />, "youtube", STANDARD_ROLES);
    expect(html).toContain("No encontré nada para «xyz no existe».");
    expect(html).not.toContain("youtube-card");
  });
});

describe("BrowserPanel", () => {
  it("renders the toolbar, live nav controls and the viewport (no iframe)", () => {
    appStore.getState().applyEvent({
      type: "browser.navigate",
      url: "http://127.0.0.1:5173/demo-news.html",
      title: "Demo News",
      can_go_back: true,
      can_go_forward: false,
      loading: false,
      created_at: ts(),
    });

    const html = renderPrimary(<BrowserPanel />, "browser", STANDARD_ROLES);
    expect(html).toContain("browser-toolbar");
    expect(html).toContain("browser-viewport");
    // W2-VIEW (ADR 0007): back/forward/refresh are LIVE again — the
    // WebContentsView reports real can_go_back/can_go_forward, so the
    // buttons exist and are enabled exactly per that state.
    expect(html).toContain('aria-label="Atrás"');
    expect(html).toContain('aria-label="Adelante"');
    expect(html).toContain('aria-label="Recargar"');
    const back = html.match(/<button[^>]*aria-label="Atrás"[^>]*>/)?.[0] ?? "";
    expect(back).not.toContain("disabled");
    // The WebContentsView IS the browser surface — no iframe, no src=.
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("src=");
    // The header label is the PAGE title.
    expect(html).toContain("Demo News");
    expect(html).not.toContain("Pídeme que abra una página");
  });

  it("renders the empty-state text when there is no browser content", () => {
    const html = renderPrimary(<BrowserPanel />, "browser", STANDARD_ROLES);
    expect(html).toContain("content-panel-empty-text");
    expect(html).toContain("Pídeme que abra una página o escribe una dirección arriba.");
    expect(html).not.toContain("<iframe");
    expect(html).toContain("browser-viewport");
  });
});

describe("TasksPanel", () => {
  it("renders todo rows with check buttons and reminder rows with cadence", () => {
    appStore.getState().applyEvent({
      type: "tasks.update",
      todos: [
        { id: "t1", title: "Comprar leche", done: false, priority: "high", due: "hoy" },
        { id: "t2", title: "Llamar a María", done: true, priority: "normal", due: null },
      ],
      reminders: [
        { id: "r1", title: "Revisar correo", cadence: "Cada día 9:00", next_fire: "2026-08-08 09:00" },
      ],
      created_at: ts(),
    });

    const html = renderPrimary(<TasksPanel />, "tasks", STANDARD_ROLES);
    expect(html).toContain("Pendientes · 1/2");
    expect(html).toContain("Comprar leche");
    expect(html).toContain("Llamar a María");
    expect(html).toContain('aria-label="Marcar como hecha"');
    expect(html).toContain("task-check");
    expect(html).toContain("task-due");
    expect(html).toContain("hoy");
    expect(html).toContain("Revisar correo");
    expect(html).toContain("Cada día 9:00 · próxima 2026-08-08 09:00");
    expect(html).not.toContain("No hay tareas");
  });

  it("renders the empty-state text when there are no tasks", () => {
    const html = renderPrimary(<TasksPanel />, "tasks", STANDARD_ROLES);
    expect(html).toContain("content-panel-empty-text");
    expect(html).toContain("No hay tareas. Pídeme que anote una.");
  });
});

describe("DocumentPanel", () => {
  it("renders chapters, paragraphs, kind label and the edit button", () => {
    appStore.getState().applyEvent({
      type: "document.load",
      title: "Reunión",
      kind: "md",
      path: "/docs/reunion.md",
      content: "",
      chapters: [
        { title: "Reunión", content: "Aprobado el calendario.\n\n- Punto uno." },
      ],
      created_at: ts(),
    });

    const html = renderPrimary(
      <DocumentPanel panelId="document_editor" />,
      "document_editor",
      STANDARD_ROLES,
    );
    expect(html).toContain("doc-h2");
    expect(html).toContain("Reunión");
    expect(html).toContain("doc-paragraph");
    expect(html).toContain("Aprobado el calendario.");
    expect(html).toContain("Markdown");
    expect(html).toContain("document-mode-btn");
    expect(html).toContain("Editar");
    expect(html).toContain("document-path");
    expect(html).toContain("/docs/reunion.md");
  });

  it("renders the empty-state text when no document is open", () => {
    const html = renderPrimary(
      <DocumentPanel panelId="document_editor" />,
      "document_editor",
      STANDARD_ROLES,
    );
    expect(html).toContain("content-panel-empty-text");
    expect(html).toContain("No hay documento abierto. Pídeme que abra uno.");
    expect(html).not.toContain("document-mode-btn");
  });
});

describe("MediaDock", () => {
  it("renders play/pause button, elapsed/total time and the source badge", () => {
    appStore.getState().applyEvent({
      type: "media.state",
      state: "playing",
      source: "local",
      kind: "audio",
      title: "Sinfonía",
      video_id: null,
      url: null,
      position_s: 60,
      duration_s: 300,
      volume: 0.8,
      created_at: ts(),
    });

    const html = renderPrimary(<MediaDock panelId="media" />, "media", MEDIA_ROLES);
    expect(html).toContain("media-dock");
    expect(html).toContain("media-player");
    expect(html).toContain('aria-label="Pausar"');
    expect(html).toContain("1:00 / 5:00");
    expect(html).toContain("media-player-source");
    expect(html).toContain("Local");
    expect(html).toContain("Sinfonía");
    expect(html).not.toContain("Reproducción en espera");
  });

  it("idle media dock IS the search surface (W1 seam): search box, no empty chrome, no player", () => {
    const html = renderPrimary(<MediaDock panelId="media" />, "media", MEDIA_ROLES);
    expect(html).toContain("youtube-panel");
    expect(html).toContain('aria-label="Buscar en YouTube"');
    expect(html).not.toContain("media-dock-empty");
    expect(html).not.toContain("Reproducción en espera.");
    expect(html).not.toContain("media-player");
  });

  it("stopped track + new search results -> search surface again (GATE-5 reoffer)", () => {
    // The server's stopped event RETAINS the track metadata, so the
    // dock must return to the cards on the NEXT offer — not pin the
    // dead player for the rest of the session.
    appStore.getState().applyEvent({
      type: "media.state",
      state: "stopped",
      source: "youtube",
      kind: "video",
      title: "Sinfonía",
      video_id: "dQw4w9WgXcQ",
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      position_s: 60,
      duration_s: 300,
      volume: 0.8,
      created_at: ts(),
    });
    appStore.setState((s) => ({
      content: {
        ...s.content,
        youtube: {
          query: "guitarra",
          loading: false,
          results: [
            {
              id: "v1",
              title: "Clases de guitarra",
              source: "youtube",
              kind: "video",
              channel: "Marta",
              duration_s: 600,
              published: "hace 2 días",
              thumbnail_url: null,
              local_path: null,
            },
          ],
        },
      },
    }));

    const html = renderPrimary(<MediaDock panelId="media" />, "media", MEDIA_ROLES);
    expect(html).toContain("youtube-card");
    expect(html).toContain("Clases de guitarra");
    expect(html).not.toContain("media-player");
  });
});
