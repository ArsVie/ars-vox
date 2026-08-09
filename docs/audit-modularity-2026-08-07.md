---
type: audit
title: Ars-Vox modularity & configuration audit — still-true findings
description: Still-true findings from the 2026-08-07 read-only modularity/configuration audit, re-verified against the live tree 2026-08-09. Items fixed since the audit are in git history.
timestamp: 2026-08-07T00:00:00Z
---

# Ars-Vox Modularity & Configuration Audit — still-true findings

Read-only audit of duplication, drift risk, dead code, and config hygiene.
This is the subset of the 2026-08-07 audit that is still true, re-verified
2026-08-09 against the live tree (fixed items were removed; the full audit
is in git history). Priority labels are relative to the open items.

## 1. Duplication / reinvented parts

- **apps/desktop/src/contracts.ts (entire file)** — The TS wire mirror is
  **hand-maintained**, not generated. ADR 0002
  (docs/decisions/0002-contracts-single-source.md:35-38) calls it "a known
  duplication risk… basis for future code generation" — that risk is now
  realized: `notification.show.kind` is typed `string` instead of
  `NotificationKind`, so enum drift is invisible to the compiler.
  **HIGH** — Generate `contracts.ts` from
  `packages/contracts/schemas/*.schema.json` (or type the enums as unions
  and extend conformance tests to all 4 schemas). Partially addressed by
  remediation W1-PYCONTRACT (schema regen in CI + parity tests), which does
  not generate contracts.ts.
- **packages/contracts/arsvox_contracts/events.py:25 vs commands.py:25** —
  `_utcnow()` defined twice in the same package (identical bodies).
  **LOW** — Single helper in `arsvox_contracts/__init__.py`.
- **services/agent/arsvox_agent/tools/scheduler.py:78,87,97** —
  `"Recordatorio"` title literal repeated. **LOW** — Constant + enum.
- **apps/desktop/src/layout/engine.ts:52 vs contracts PanelType** — TS
  `KNOWN_PANELS` (12) omits `confirmation`/`notification`; `isPanelId`
  (engine.ts:218-219) silently drops valid commands. Resolved by
  remediation W2-STORE, which deletes `layout/engine.ts` entirely.

## 2. Hardcoded values that should be tuneable

- **apps/desktop/src/voice/mic.ts:31-34** — VAD thresholds hardcoded
  (`speechThreshold 0.015`, `silenceMs 900`, `minSpeechMs 250`,
  `maxDurationMs 30000`); no config keys exist (config `voice.vad.provider`
  is itself dead — see §5). **MED** — Add `voice.vad.*` params to AppConfig
  or accept as constants deliberately.
- **services/agent/arsvox_agent/model_provider.py:15** — `DEFAULT_SCRIPT`
  hardcodes the demo tool call (`ui_apply_layout`, `split`,
  `document_editor`); demo behavior not config-driven. **LOW**
- **apps/desktop/electron/main.ts:332-334** — Window size `1280×800` /
  `minWidth 800` hardcoded. **LOW** (acceptable UI constant; no config
  surface exists).
- **services/agent/arsvox_agent/ws.py:35** — `_RECEIVE_TIMEOUT = 0.1`
  polling constant hardcoded. **LOW**

## 3. Dead code / unused parts (zero references confirmed)

- **services/voice/arsvox_voice/providers.py:7-34** — `WakeWordDetector`,
  `MockWakeWordDetector`, `Vad`, `MockVad` are only re-exported by
  `__init__.py`; the pipeline never instantiates them, and nothing else
  references them. **MED** — Delete or wire into `VoicePipeline` per
  `voice.wake_word`/`voice.vad`.
- **services/agent/arsvox_agent/tools/context.py:32** — `ToolContext.state_snapshot()`
  has zero callers. **LOW** — Remove.
- **services/memory/arsvox_memory/search.py:6** — `search_all()` is
  referenced only by `__init__.py` re-export; no tool, route, or service
  calls it. **LOW** — Remove or expose via a `memory.search` tool.
- **services/agent/arsvox_agent/policy.py:80** — `DENIED_ALWAYS` entries
  (`shell.exec`, `file.write`, `file.delete`, `browser.generic_agent`) have
  no registered implementations; the deny list only guards tools that don't
  exist. **LOW** — Keep as defense-in-depth or drop with a comment.
- **services/tts/arsvox_tts/providers.py:111-129** — `KittenTTS` is
  selectable via `tts.provider: kittentts` but warns "not wired in
  iteration 1". **LOW** — Either implement or remove from `build_tts`.

## 4. Multiple sources of truth

- **packages/contracts/arsvox_contracts/commands.py:40 (`primary_panel:
  PanelType`, required) vs apps/desktop/src/contracts.ts:208
  (`primary_panel: PanelId | null`)** — TS mirror loosened a required
  field; conformance test only checks `slots` shape, not nullability.
  **MED** — Extend conformance test to assert required/optional parity per
  command.
- **packages/contracts/schemas/*.schema.json** — `agent-events`,
  `client-messages`, `app-config` schemas are guarded by **no test** (only
  `ui-commands` is) and consumed by nothing at build time; they can
  silently go stale relative to the pydantic models. **MED** — Add a Python
  test that re-exports all 4 and diffs. Addressed by remediation
  W1-PYCONTRACT (CI regen + diff).

## 5. Config drift (app.yaml keys with no reader)

Keys declared in `configs/app.yaml` + `AppConfig` that **no code reads**
(ripgrep-verified 2026-08-09):

- **config.py:117-118 `browser.allowlist` / `browser.home_url`** — zero
  readers in Python; Electron has its own mirror
  (`security-policy.ts DEFAULT_REMOTE_ALLOWLIST`) that also does not read
  the config. **MED** — Wire config into Electron or accept the code
  constant. See migration-note-electron-upgrade-2026-08-08.md §3.
- **config.py:130-131 `demo.enabled` / `demo.step_delay_s`** — zero
  readers; demo scripts ignore config. **MED**
- **config.py:55 `voice.vad.provider`** — zero readers (build_stt reads
  only `stt`). **MED**
- **config.py:48-50 `voice.wake_word.*`** — zero readers (see dead
  `WakeWordDetector`). **MED**
- **config.py:71-72 `voice.wake_sound` / `voice.sleep_sound`** — zero
  readers. **LOW**
- **config.py:86-91 `ui.templates`** — zero readers; the settings panel can
  PATCH it with no effect. (`ui.default_template` / `ui.default_primary` /
  `ui.large_text` / `ui.high_contrast` ARE read by store.ts since the
  config-driven-UI work.) **MED**
- **config.py:19 `app.locale`** — zero readers; the agent is hardcoded
  Spanish in strings. **LOW**

---

### Method notes

- Read-only: no source files modified; claims re-verified by reading the
  code and ripgrep reference counts on 2026-08-09.
- Tool registry ↔ policy engine cross-check (2026-08-07): all 42 registered
  tool names have `TOOL_KINDS` entries and vice versa — no drift there.
