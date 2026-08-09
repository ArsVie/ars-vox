/**
 * GATE-5 (W0-SLICE) — document surface slice.
 *
 * Owns the `content.document_editor` bag: the PDF/EPUB/TXT reader +
 * agent-first editor payload. Server `document.load` events land the
 * document; the optimistic `document.save` command carries the editor's
 * local content and changes nothing in the store (the editor already
 * holds the text — preserved from the pre-slice store).
 */

import type { ClientCommand, ServerEvent } from "../contracts";
import type { SurfaceSlice } from "./registry";
import type { DocumentContent } from "./types";

export const documentSlice: SurfaceSlice<DocumentContent> = {
  panelId: "document_editor",
  eventTypes: ["document.load"],
  commandActions: ["document.save"],
  applyEvent(bag, event) {
    switch (event.type) {
      case "document.load":
        return {
          title: event.title,
          kind: event.kind,
          path: event.path,
          url: event.url ?? null,
          content: event.content,
          chapters: event.chapters,
        };
      default:
        return bag;
    }
  },
  applyCommand(bag, command) {
    switch (command.action) {
      case "document.save":
        // No optimistic change: the editor already holds the local
        // content; the command carries the text to the server.
        return bag;
      default:
        return bag;
    }
  },
};
