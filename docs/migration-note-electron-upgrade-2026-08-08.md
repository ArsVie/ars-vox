---
type: migration-note
title: "Electron upgrade + hardened browser foundation — spike assessment (GATE-3.5 A8, R40-R42)"
description: "Electron 33 is outside the support window; the upgrade lands BEFORE arbitrary real browsing. This note records the upgrade assessment, what changes, and what the real-browser milestone (Wave 2 B2/B3) must fold in: CSP, navigation/new-window restrictions, permissions, isolated session, IPC sender validation, and the exact YouTube embed allowlist."
date: 2026-08-08
status: implemented-spike
---

# Electron upgrade + hardened browser foundation — spike assessment (A8, R40-R42)

Owner: A8 (GATE-3.5 wave 1). Authority: browser/security module
(`apps/desktop/electron/security-policy.ts` + `hardened-view.ts`). This
note accompanies the R40/R41 spike code and satisfies the R42
feasibility/assessment deliverable. The Electron upgrade itself is
EXECUTED at the Wave-2 browser milestone, BEFORE arbitrary real browsing
is enabled (contract R42, advisor addition, GATE-3.5 acceptance).

## 1. Current state (verified 2026-08-08 against the live tree)

- `apps/desktop/package.json` pins `electron ^33.2.0`; installed
  `33.4.11` (Chromium 130, Node 20.18).
- Electron's support policy is the latest **three stable majors**
  (electronjs.org/docs/latest/tutorial/electron-timelines). As of
  2026-08-08 the supported set is 43/42/41 (43 became stable 2026-06-30,
  Chromium 150; 42 = May 2026, Chromium 148, Node 24). **Electron 33 is
  outside the support window (EOL'd ~2025-01)** — no security fixes.
- The security implications are concrete for a voice assistant that will
  render arbitrary remote pages: Chromium/Electron security fixes for the
  rendering engine we expose to untrusted web content stopped arriving
  with E33.
- Recommendation: upgrade to the latest stable at the time the browser
  milestone starts (42.x today; 43.x if the milestone lands after its
  first patch releases). The upgrade is a dependency bump + API-drift
  review; the code in this spike uses only APIs stable from 30 through 42.

## 2. What changes in the upgrade (E33 → 42)

APIs this spike relies on are stable across the window (verified against
the installed 33.4.11 type definitions and current docs):

- `WebContentsView` — available since Electron 30 (replaces the
  deprecated `BrowserView`); constructor takes `{ webPreferences }` and
  exposes `view.webContents`. No change expected.
- `will-navigate` / `will-frame-navigate` — both present and stable
  (`details.url`, `details.isMainFrame`, `event.preventDefault()`).
- `session.fromPartition("persist:…", { cache })` — persistent partition
  semantics unchanged.
- `protocol.registerSchemesAsPrivileged` + `protocol.handle` — the
  supported custom-protocol surface since Electron 25 (the old
  `registerFileProtocol` family is deprecated and must not be used in
  new code).
- `webContents.setWindowOpenHandler` — unchanged.
- Known drift to watch when upgrading (from the E33→42 breaking-changes
  trail):
  - Electron 41: `WebContentsView.webContents` is `undefined` inside the
    view's own `"destroyed"` handler — cache the reference before wiring
    teardown (this spike's `createHardenedRemoteView` returns the view;
    Wave-2 teardown code must not read `view.webContents` in a destroyed
    handler).
  - Chromium-version-driven behavior changes (autoplay policy, permission
    prompt wording, `User-Agent`/client hints) — re-run the Wave-2 media
    smoke tests after the bump.
  - Node bump 20.18 → 24 affects only main-process scripts; this repo's
    main process uses no removed Node APIs (verified surface: crypto,
    path, fs, url).
- The bump is a one-commit change in `apps/desktop/package.json`
  (electron `^42.x` or `^43.x`) + typecheck/build + full suites + a
  smoke launch. It must land BEFORE the allowlist is relaxed to real
  browsing (R42) and BEFORE any remote content is shown to the user.

## 3. What the real-browser milestone (Wave 2 B2/B3) must fold in

The spike ships the foundation; the milestone wires it to the UI and
completes the policy:

- **CSP**: the spike does not inject a Content-Security-Policy. The
  milestone should inject a CSP header for remote pages (e.g.
  `default-src 'self' https:; script-src 'self' https:; object-src 'none';
  base-uri 'none'; form-action 'self' https:`) via
  `session.webRequest.onHeadersReceived`, and enforce
  `win.webContents`-level CSP meta for app-owned pages where feasible.
- **Navigation/new-window restrictions**: shipped in the spike
  (`attachRemoteNavigationGuards`: scheme blocklist, local/private
  blocking, allowlist, window-open deny). The milestone adds the
  USER-facing affordances: an in-view address bar, and a decision point
  for opening external links in the system browser (`shell.openExternal`)
  instead of denying silently.
- **Permissions**: deny-by-default ships in the spike (session-level
  permission request/check handlers). The milestone may add a per-site
  override store LATER (opt-in only, never default).
- **Session isolation**: `persist:remote-content` ships in the spike
  (persistent partition, cache off). The milestone decides cookie/
  login UX (one shared session vs per-site) and maps the
  provenance requirements (B3: origin/frame-tagged observations) onto
  this partition.
- **IPC sender validation**: ships in the spike (`isTrustedIpcSender`).
  The old `arsvox:get-token` channel no longer exists — A2/R14 removed it
  (token never enters the renderer; REST is main-proxied via
  `arsvox:fetch`). The milestone must apply sender validation to every
  handler on the current surface (`arsvox:fetch`, `arsvox:service-status`,
  `arsvox:ws-*`) and to any NEW handlers the browser bridge adds (B3 DOM
  bridge) — no unvalidated senders, ever.
- **Allowlist policy**: `browser.allowlist`/`home_url` in
  `configs/app.yaml` still have ZERO readers in Electron (the Electron
  mirror lives in `security-policy.ts` as `DEFAULT_REMOTE_ALLOWLIST`).
  The milestone must make Electron read the config (A2's config channel
  or a preload/startup bridge) so the allowlist is user-configurable —
  today it is code-constant, and the two copies can drift.
- **Local/private-network blocking**: ships in the spike as a pure,
  synchronous check (IP literals + well-known names). Known limitation:
  `will-navigate` is synchronous, so a DNS name that RESOLVES to a
  private address is not caught by the spike (only literal IPs and
  local names are). The milestone should add an async pre-flight
  (resolve via `net.lookup` before allowing a non-allowlisted host, or
  policy: allowlist-only navigation = no resolution needed) and should
  treat the allowlist as the primary gate.
- **`arsvox-doc:` local protocol**: ships in the spike
  (`registerLocalDocProtocol`; roots via `ARSVOX_DOC_ROOTS`, empty by
  default → 403). The milestone wires real roots (library/docs dirs)
  and migrates the document reader off `file:` URLs. Until then the
  renderer reader keeps using its current URL handling; remote content
  can never navigate to `arsvox-doc:` (scheme is in the blocklist).

## 4. YouTube embed origins — exact allowlist the milestone needs

The media panel's iframe player and the future browser's YouTube
navigation require these hosts. Host-level allowlist entries (current
matcher semantics: plain entry matches the domain AND its subdomains;
`*.` entry matches subdomains only):

```
youtube.com
*.youtube.com                  # www, m, music, consent, studio, ...
youtube-nocookie.com
*.youtube-nocookie.com         # privacy-enhanced embeds (www.youtube-nocookie.com)
```

Exact origins used by the embed/player flow:

- `https://www.youtube.com` — standard embeds + player API
  (`/embed/<id>`, `/iframe_api`, `/api/...`).
- `https://www.youtube-nocookie.com` — privacy-enhanced embeds (same
  player, no cookies); **separate registrable domain**.
- `https://m.youtube.com`, `https://music.youtube.com` — mobile/music
  surfaces reachable from search results.
- `https://consent.youtube.com` — EU cookie-consent redirects.

GAP (found by this spike): the current default allowlist
(`configs/app.yaml browser.allowlist` AND the pre-A8 Electron mirror)
contains `youtube.com` + `*.youtube.com` only — **`youtube-nocookie.com`
is NOT covered**. Config/contracts changes are outside this spike's
frozen scope (cross-owner), so the gap is recorded here + in the code;
the gate should add `youtube-nocookie.com` + `*.youtube-nocookie.com` to
the contract default before the media/browser milestone ships.

## 5. R40/R41 spike deliverable map (what is code vs note)

| Requirement | Status | Where |
|---|---|---|
| R40 hardened view, deny-by-default permissions | code + tests | `hardened-view.ts` `createRemoteContentSession` |
| R40 navigation filtering | code + tests | `hardened-view.ts` `attachRemoteNavigationGuards` + `security-policy.ts` `decideRemoteNavigation` |
| R40 window-open denial | code + tests | `attachRemoteNavigationGuards` (`setWindowOpenHandler`) |
| R40 custom protocol over permissive file: | code + tests | `registerLocalDocProtocol` + `resolveLocalDocPath` (roots empty until Wave 2) |
| R40 separate persistent session/partition | code + tests | `persist:remote-content` |
| R40 isolated-world DOM execution, NO privileged preload | code + tests | `createHardenedRemoteView` webPreferences (sandbox, contextIsolation, no preload) |
| R40 local/private + dangerous-scheme blocking independent of allowlist | code + tests | `security-policy.ts` (`BLOCKED_NAVIGATION_SCHEMES`, `isLocalOrPrivateHost`) |
| R40 instantiable + migration note | done | this note + module |
| R41 IPC sender validation | code + tests | `isTrustedIpcSender`; the old `arsvox:get-token` handler is gone (A2/R14 — token never enters the renderer; REST main-proxied via `arsvox:fetch`). Apply to every current and future handler. |
| R42 upgrade feasibility + fold-in list | this note | §1-§3 |

## 6. Known limitations (spike scope)

- No live Electron run in the spike environment (headless WSL, no
  display): glue is typechecked + unit-tested against a mocked
  `electron` module; the real-process smoke run belongs to the gate
  (cold launch R09) and the browser milestone.
- DNS-name → private-IP resolution is not caught synchronously (see §3).
- `arsvox-doc:` roots are empty until Wave 2 wires real directories.
- No CSP injection yet (milestone, §3).
- `browser.allowlist` config remains unread by Electron (milestone, §3).
