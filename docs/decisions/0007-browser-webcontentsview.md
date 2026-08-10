---
type: adr
title: ADR 0007 — Integrated browser via main-process WebContentsView
description: Reverses 8d1fb3f (browser story = renderer iframe); the integrated browser is a WebContentsView owned by the Electron main process, isolated partition + allowlist + main-owned navigation, no renderer iframe
---
# ADR 0007: Integrated browser via main-process WebContentsView

Status: Accepted

## Context

`8d1fb3f` (2026-08-09) recorded the decision "browser story = renderer
iframe" and deleted `apps/desktop/electron/hardened-view.ts` +
`apps/desktop/electron/security-policy.ts` (4 files, 1093 deletions).
Its rationale: full `WebContentsView` wiring needed renderer changes
outside that lane's ownership, half-wiring would leave the module
governing nothing, and the iframe path is real Chromium isolation for a
single-user local app.

The frozen vision (docs/panel-vision.md, browser row) requires an
INTEGRATED browser the agent can drive — search bar, scroll, click,
read — with the user manipulating the SAME view. An iframe cannot
provide that: the cross-origin sandbox gives the app no DOM access to
arbitrary sites, no real back/forward, and no scroll/click bridge. The
GATE-5 plan (docs/plans/gate-5-vision-conformance-orchestration-2026-08-09.md,
Wave 2) states this explicitly:

> The largest and riskiest lane, and the one that requires reversing a
> decision. `8d1fb3f` deleted `hardened-view.ts` + `security-policy.ts`
> on the grounds that "browser story = renderer iframe". The vision
> requires an integrated browser the **agent can drive**, which an
> iframe cannot provide.
>
> That ADR must be re-decided explicitly before any code is written.
> Reversing it without a written decision is how the repo grows a third
> browser story.

This ADR is that explicit re-decision, recorded before any code.

## Decision

**THIS LANE REVERSES `8d1fb3f`.** The integrated browser is a
`WebContentsView` owned by the Electron MAIN process (Electron 42,
after the E33→42 upgrade that is a precondition for showing arbitrary
remote content — R42):

- The view is created from the reinstated hardened foundation
  (`hardened-view.ts` `createHardenedRemoteView`), bound to its OWN
  isolated session partition (`persist:remote-content`, cache off),
  deny-by-default permissions, sandboxed + contextIsolation, and NO
  privileged preload (`no nodeIntegration`, no `window.arsvox`, no
  token — R14 unchanged).
- The allowlist (migration note's exact list: `youtube.com`,
  `*.youtube.com`, `youtube-nocookie.com`, `*.youtube-nocookie.com`,
  plus `wikipedia.org`, `openstreetmap.org`) is enforced by
  `security-policy.ts` navigation decisions AND at the session
  `webRequest` layer BEFORE any remote load; local/private-network and
  dangerous-scheme blocking is independent of the allowlist (R40).
- Navigation is MAIN-owned: the renderer asks main via IPC
  (navigate/back/forward/refresh/bounds); the view reports REAL
  `can_go_back`/`can_go_forward`/`url`/`title`/`loading`, which main
  publishes to the renderer (IPC) and to the agent service (authenticated
  HTTP), so `actions.py` emits real values instead of hardcoded `False`
  (plan §Wave 2 W2-VIEW).
- The renderer iframe path is REMOVED — `BrowserPanel` no longer hosts
  an iframe; the `WebContentsView` IS the browser surface. Nav controls
  (back/forward/refresh) return to `BrowserPanel`, wired to main via
  IPC. There is exactly ONE browser story.

Security posture carried forward unchanged:

- `ipc-guard.ts` `isTrustedIpcSender` (R41) validates EVERY ipcMain
  handler — live WebContents + mainFrame checks; all new browser
  channels (`arsvox:browser-*`) apply it.
- R09–R14 token model unchanged: the per-launch token lives only in
  main; remote content never sees it.
- The `arsvox-doc:` local-document protocol returns with the hardened
  modules (roots empty by default → inert 403), and remote content can
  never navigate to it (scheme blocklist).
- The app's own window keeps its scoped media permission grant; the
  remote partition denies everything.

## Consequences

- The agent DOM bridge (`browser.dom_action` execution) remains
  W2-DRIVE's lane; this lane only reinstates and wires the view, its
  hardening, and the real navigation-state channel. The event is
  already on the wire and routed (GATE-5 routing-parity fix #1).
- `configs/app.yaml` `browser.allowlist` gains the
  `youtube-nocookie.com` entries (R42 gap fix) and stays mirrored by
  `DEFAULT_REMOTE_ALLOWLIST` in `security-policy.ts`.
- The migration note's hardening checklist (CSP injection for remote
  pages, navigation/new-window restrictions, deny-by-default
  permissions, isolated session, IPC sender validation) lands WITH the
  E33→42 upgrade, per R42.
- Tests restored to the deleted suites' rigor (397 + 187 lines) and
  extended: nav-state IPC, bounds IPC, allowlist enforcement at the
  webRequest layer, real-value `actions.py` emission.
