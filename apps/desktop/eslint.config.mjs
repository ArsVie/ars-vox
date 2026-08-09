/**
 * GATE-3.5 W0-TTS durable guard: no bare fetch() in renderer code.
 *
 * The W0 defect: TtsPlayer POSTed TTS through a raw fetch() — no launch
 * token in the packaged Electron build -> 401 -> the assistant was
 * SILENTLY MUTE. Every service REST call must go through
 * authenticatedFetch() from src/endpoints.ts (bridge-proxied in Electron,
 * token attached by the MAIN process; VITE_ARSVOX_TOKEN fallback in
 * plain-vite dev). endpoints.ts is the ONLY file allowed to touch the raw
 * transport.
 *
 * Toolchain note: this repo currently ships NO eslint setup (eslint and
 * @typescript-eslint/parser are not in apps/desktop/package.json). To
 * activate the rule: `npm i -D eslint @typescript-eslint/parser` inside
 * apps/desktop, then `npx eslint src/`. The rule itself is dependency-free
 * and self-contained; without the TS parser it still loads and lints any
 * .js file eslint can parse.
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// TS/TSX parsing needs @typescript-eslint/parser (not installed yet —
// see toolchain note above). Fall back to eslint's default parser so the
// config always loads.
let tsParser = null;
try {
  tsParser = require("@typescript-eslint/parser");
} catch {
  // not installed: rule stays defined, TS linting activates on install
}

const bareFetchRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Ban bare fetch() in renderer code — use authenticatedFetch() from src/endpoints.ts (carries the launch token via the Electron bridge).",
    },
    messages: {
      bareFetch:
        "Raw fetch() bypasses the authenticated transport (window.arsvox bridge / launch token). Use authenticatedFetch() from src/endpoints.ts.",
    },
    schema: [],
  },
  create(context) {
    const filename = String(
      context.filename ?? context.getFilename?.() ?? "",
    ).replaceAll("\\", "/");
    // Allowlist: endpoints.ts is the single place the raw transport may
    // be used (authenticatedFetch's dev fallback).
    if (filename.endsWith("/src/endpoints.ts")) return {};
    return {
      CallExpression(node) {
        if (node.callee.type === "Identifier" && node.callee.name === "fetch") {
          context.report({ node, messageId: "bareFetch" });
        }
      },
    };
  },
};

export default [
  {
    ignores: ["dist/**", "dist-electron/**", "node_modules/**"],
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: {
      local: { rules: { "no-bare-fetch": bareFetchRule } },
    },
    rules: {
      "local/no-bare-fetch": "error",
    },
    ...(tsParser ? { languageOptions: { parser: tsParser } } : {}),
  },
];
