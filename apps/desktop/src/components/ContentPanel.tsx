import type { ReactNode } from "react";

import type { PanelId } from "../contracts";
import type { PanelMeta } from "../store";
import { PanelHeader } from "./PanelHeader";
import {
  BellIcon,
  BookIcon,
  CheckIcon,
  DocumentIcon,
  GearIcon,
  GlobeIcon,
  PenIcon,
  SendIcon,
} from "./icons";

const DEFAULT_TITLES: Partial<Record<PanelId, string>> = {
  browser: "Navegador",
  book_reader: "Libro",
  news: "Noticias",
  notes: "Notas",
  tasks: "Tareas",
  reminders: "Recordatorios",
  telegram_preview: "Telegram",
  settings: "Ajustes",
};

const DEFAULT_HINTS: Partial<Record<PanelId, string>> = {
  browser: "Pídeme que abra una página web.",
  book_reader: "No hay ningún libro abierto.",
  news: "Aún no hay noticias. Pídeme que las lea.",
  notes: "No hay notas guardadas.",
  tasks: "No hay tareas pendientes.",
  reminders: "No hay recordatorios.",
  telegram_preview: "Sin mensajes nuevos.",
  settings: "Ajustes del asistente.",
};

const PANEL_ICONS: Partial<Record<PanelId, ReactNode>> = {
  browser: <GlobeIcon size={15} />,
  book_reader: <BookIcon size={15} />,
  news: <DocumentIcon size={15} />,
  notes: <PenIcon size={15} />,
  tasks: <CheckIcon size={15} />,
  reminders: <BellIcon size={15} />,
  telegram_preview: <SendIcon size={15} />,
  settings: <GearIcon size={15} />,
};

/**
 * Generic content panel for panel types without a specialized component
 * (news, tasks, notes, reminders, browser, book_reader, telegram_preview,
 * settings). Renders the panel chrome + meta title/reference, or a quiet
 * empty state. The engine may still place panel types with no component
 * at all — those render nothing (no crash).
 */
export function ContentPanel({ meta, panelId }: { meta?: PanelMeta; panelId: PanelId }) {
  const title = meta?.title ?? DEFAULT_TITLES[panelId] ?? panelId;

  return (
    <section className={`panel content-panel content-panel--${panelId}`} aria-label={title}>
      <PanelHeader panelId={panelId} icon={PANEL_ICONS[panelId] ?? <DocumentIcon size={15} />}>
        {title}
      </PanelHeader>
      <div className="content-panel-body">
        {meta?.contentReference ? (
          <>
            {meta.title ? <h2>{meta.title}</h2> : null}
            <p className="document-reference">{meta.contentReference}</p>
          </>
        ) : (
          <div className="content-panel-empty">
            {meta?.title ? <h2 className="content-panel-empty-title">{meta.title}</h2> : null}
            <span className="content-panel-empty-icon">
              {PANEL_ICONS[panelId] ?? <DocumentIcon size={30} />}
            </span>
            <span className="content-panel-empty-text">
              {DEFAULT_HINTS[panelId] ?? "Sin contenido. Pídemelo en voz alta."}
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
