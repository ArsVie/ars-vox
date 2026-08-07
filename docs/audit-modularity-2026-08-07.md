# Ars-Vox Modularity & Configuration Audit — 2026-08-07

Read-only audit of duplication, drift risk, dead code, and config hygiene across
`packages/contracts`, `services/agent`, `services/memory`, `services/voice`,
`services/tts`, `apps/desktop`, `scripts/`, `tests/`. Every claim below was
verified by reading the code and/or ripgrep reference counts.

---

## 1. Duplication / reinvented parts

- **apps/desktop/src/contracts.ts (entire file, e.g. :77, :85, :112, :127)** — The TS wire mirror is **hand-maintained**, not generated. ADR 0002 (docs/decisions/0002-contracts-single-source.md:35-38) explicitly calls it "a known duplication risk… basis for future code generation" — that risk is now realized: `notification.show.kind`, `media.state.state`, `confirmation_resolved.status` are typed `string` instead of the Python enums (`NotificationKind`, `MediaState`, `ConfirmationStatus`), so enum drift is invisible to the compiler. **HIGH** — Generate `contracts.ts` from `packages/contracts/schemas/*.schema.json` (or type the enums as unions and extend conformance tests to all 4 schemas).
- **apps/desktop/src/ws/client.ts:29, apps/desktop/src/main.tsx:10, apps/desktop/src/voice/mic.ts:31, apps/desktop/src/components/TtsPlayer.tsx:6** — The agent-service URL `ws://127.0.0.1:8765/...` / `http://127.0.0.1:8765/...` is hardcoded **four times** in the TS app and never derived from `configs/app.yaml server.host/port` (the UI receives the full config via `config_update`/GET /config). Changing `server.port` in app.yaml silently breaks the UI. **HIGH** — One shared `endpoints.ts` constant module fed from the config snapshot.
- **services/memory/arsvox_memory/repos/{notes.py:9, panels.py:10, pending.py:17, preferences.py:9, progress.py:9, reminders.py:9, tasks.py:8, documents.py:10, notifications.py:9, sessions.py:9}** — Identical `_now()` helper (UTC ISO with `timespec="seconds"`) copy-pasted into **10 repos**, while `Database.utcnow_iso()` (db.py:8) already exists with the same body. **MED** — Import `utcnow_iso` from `arsvox_memory.db`.
- **packages/contracts/arsvox_contracts/events.py:21 vs commands.py:19** — `_utcnow()` defined twice in the same package (identical bodies). **LOW** — Single helper in `arsvox_contracts/__init__.py`.
- **scripts/demo_live.py:39-81 vs scripts/smoke_mock.py:20-78** — ~60 lines of near-identical harness (threaded `run_server` + health-poll loop + WS connect + event-collection loop). Plus the "dump config to a temp YAML with the mock flag flipped" trick is implemented **three times**: `services/agent/arsvox_agent/__main__.py:27-34`, `demo_live.py:58-62`, `smoke_mock.py:31-38`. **MED** — Shared `scripts/_harness.py` with one `boot_service(config, mock: bool)` helper.
- **apps/desktop/src/store.ts:395-399 (`enqueueTts`) vs :241-246 (`tts.speak` case)** — Same queue-append-with-cap logic written twice; cap `length > 10` appears at :141, :243, :397 while the Python config declares `tts.queue_max: 20`. **MED** — One `pushSpeak` helper; use `config.tts.queue_max`.
- **apps/desktop/src/store.ts:228-240 (`notification.show` command) vs :312-323 (`notification` event)** — Same "append `title: text` system message" behavior in two branches. **LOW** — Shared local helper.
- **services/memory/arsvox_memory/repos/pending.py:14** — `STATUSES = ("pending","approved","cancelled","expired","superseded")` re-declares `ConfirmationStatus` (packages/contracts/arsvox_contracts/enums.py:61-66). Same for SQL literals `'done'/'pending'` (tasks.py:42,50), `'active'/'fired'/'cancelled'` (reminders.py:30,41,59), `'snoozed'/'dismissed'` (notifications.py:47) vs `TaskStatus`/`ReminderStatus`/`NotificationStatus` enums — the memory service never imports the contracts enums. **MED** — Import enum `.value`s in repos.
- **services/agent/arsvox_agent/prompts/system.md:9-11 and services/agent/arsvox_agent/tools/ui_tools.py:113-115** — The `PanelType` list is hand-enumerated in two prose strings (system.md already drifted: omits `settings`). **MED** — Derive from `PanelType` (or add a `test_prompts.py`-style drift guard for panel names, as exists for templates).
- **services/agent/arsvox_agent/tools/library_tools.py:14 vs :29** — Two different extension lists for the library: `_TEXT_EXTS = {".txt",".md",".epub"}` (scan) vs `(".txt",".md")` (read). **LOW** — One `_TEXT_EXTS` used by both.
- **Config defaults exist in 4 places**: `configs/app.yaml`, `packages/contracts/arsvox_contracts/config.py` (pydantic defaults), `configs/app.example.yaml`, and `tests/python/conftest.py:13-57` (`base_config` re-states the whole tree). **MED** — Tests should `load_config("configs/app.yaml")` and override only paths; keep one canonical file.
- **services/tts/arsvox_tts/providers.py:50 and scripts/demo_voice.py:25** — Default voice `"es-MX-DaliaNeural"` hardcoded in two places while `config.tts.es_voice` is `null`. **LOW** — Config-driven voice default.
- **services/agent/arsvox_agent/tools/scheduler.py:74,81,91** — `"Recordatorio"` title literal repeated; `"reminder"` kind literal at :74 duplicates `NotificationKind.REMINDER`. **LOW** — Enum + constant.
- **services/agent/arsvox_agent/local_intents.py:15-22** — `STOP_PATTERNS` (`\bstop\b`, …) re-implements the protocol-level stop (`StopMessage`, ws.py:95-97) as a text intent. Both are live paths for the same semantic. **LOW** — Keep one; document the other as fallback.

## 2. Hardcoded values that should be tuneable

- **apps/desktop/src/ws/client.ts:29, main.tsx:10, voice/mic.ts:31, components/TtsPlayer.tsx:6** — `127.0.0.1:8765` hardcoded (see §1). Config `server.host/port` (configs/app.yaml:16-17) is read only by the Python CLI (`__main__.py:21-22`). **HIGH**
- **apps/desktop/src/voice/mic.ts:24-29** — VAD thresholds hardcoded (`speechThreshold 0.015`, `silenceMs 900`, `minSpeechMs 250`, `maxDurationMs 30000`); no config keys exist for them (config only has `voice.vad.provider`, itself dead — see §5). **MED** — Add `voice.vad.*` params to AppConfig or accept as constants deliberately.
- **apps/desktop/src/store.ts:93-100 + apps/desktop/src/layout/engine.ts:113** — Initial template `"focus"` and primary `"conversation"` hardcoded while `ui.default_template: focus` / `ui.default_primary: conversation` exist in config and are **never read** (see §5). **MED** — Apply config values on `config_update`.
- **services/agent/arsvox_agent/model_provider.py:15-21** — `DEFAULT_SCRIPT` hardcodes the demo tool call (`ui_apply_layout`, `split`, `document_editor`); demo behavior not config-driven (`demo.*` keys are dead, §5). **LOW**
- **services/tts/arsvox_tts/providers.py:50** — Edge voice fallback `es-MX-DaliaNeural` hardcoded. **LOW** — Default from `tts.es_voice`.
- **apps/desktop/electron/main.ts:30-34** — Window size `1280×800`/`minWidth 800` hardcoded. **LOW** (acceptable UI constant; flagging only because no config surface exists).
- **services/agent/arsvox_agent/ws.py:32** — `_RECEIVE_TIMEOUT = 0.1` polling constant hardcoded. **LOW**

## 3. Dead code / unused parts (zero references confirmed)

- **services/voice/arsvox_voice/providers.py:7-36** — `WakeWordDetector`, `MockWakeWordDetector`, `Vad`, `MockVad` are only re-exported by `__init__.py`; the pipeline (pipeline.py) never instantiates them, and nothing else references them. **MED** — Delete or wire into `VoicePipeline` per `voice.wake_word`/`voice.vad`.
- **services/agent/arsvox_agent/tools/context.py:25-30** — `ToolContext.state_snapshot()` has zero callers. **LOW** — Remove.
- **services/memory/arsvox_memory/search.py:6** — `search_all()` is referenced only by `__init__.py` re-export and `tests/python/test_memory_repos.py`; no tool, route, or service calls it. **LOW** — Remove or expose via a `memory.search` tool.
- **services/agent/arsvox_agent/policy.py:74-80** — `DENIED_ALWAYS` entries (`shell.exec`, `file.write`, `file.delete`, `browser.generic_agent`) have no registered implementations anywhere; the deny list only guards tools that don't exist. **LOW** — Keep as defense-in-depth or drop with a comment.
- **services/tts/arsvox_tts/providers.py:108-117** — `KittenTTS` is selectable via `tts.provider: kittentts` but always returns `None` ("not wired in iteration 1"). **LOW** — Either implement or remove from `build_tts` selection.
- **scripts/demo_voice.py — `--voice es-MX-DaliaNeural` default** — duplicates provider default (see §1); otherwise live. Not dead.
- No dead TS components found: `MicButton/MicHero/StopButton/StatusBar/ConversationPanel/DocumentPanel/PanelHost/ConfirmationPanel/ErrorPanel/TtsPlayer/MediaDock` are all imported and rendered; `contracts.ts` imports verified.

## 4. Multiple sources of truth

- **packages/contracts/arsvox_contracts/enums.py:25-39 (`PanelType`, 14 values) vs apps/desktop/src/layout/engine.ts:36-49 (`KNOWN_PANELS`, 12 values)** — TS omits `confirmation` and `notification`; `isPanelId` (engine.ts:202-204) silently drops any `panel.open`/`slots` referencing them (store.ts:167-177 writes them into `panelMeta`, then `recompute` discards them). Python validation accepts them, TS silently no-ops. **MED** — Derive the TS panel union from the schema/enum or add a conformance assertion on the full value set.
- **packages/contracts/arsvox_contracts/commands.py:40 (`primary_panel: PanelType`, required) vs apps/desktop/src/contracts.ts:55 (`primary_panel: PanelId | null`)** — TS mirror loosened a required field; conformance test (tests/conformance.test.ts) only checks `slots` shape, not nullability. **MED** — Extend conformance test to assert required/optional parity per command.
- **packages/contracts/arsvox_contracts/enums.py:61-66 + pending.py:14 + SQL literals** — ConfirmationStatus/TaskStatus/ReminderStatus/NotificationStatus each exist as enum + tuple + SQL strings (see §1). **MED**
- **config defaults in 4 files** — see §1 (app.yaml / config.py / app.example.yaml / conftest.py). **MED**
- **packages/contracts/schemas/*.schema.json** — `agent-events`, `client-messages`, `app-config` schemas are guarded by **no test** (only `ui-commands` is: tests/python/test_contracts.py:134, apps/desktop/tests/conformance.test.ts) and consumed by nothing at build time; they can silently go stale relative to the pydantic models. **MED** — Add a Python test that re-exports all 4 and diffs.

## 5. Config drift (app.yaml keys with no reader / readers with no key)

Keys declared in `configs/app.yaml` + `AppConfig` (packages/contracts/arsvox_contracts/config.py) that **no code reads** (ripgrep-verified across services/, apps/, scripts/, tests/):

- **config.py:36 `agent.model.max_steps`** (app.yaml:29) — never read; runtime.py never caps steps. **MED**
- **config.py:117-118 `browser.allowlist` / `browser.home_url`** (app.yaml:78-79) — zero readers; no browser implementation exists. **MED**
- **config.py:130-131 `demo.enabled` / `demo.step_delay_s`** (app.yaml:85-86) — zero readers; demo scripts ignore config. **MED**
- **config.py:80-81 `tts.speed` / `tts.queue_max`** (app.yaml:51-52) — zero readers; TS hardcodes its own cap of 10 (§1). **MED**
- **config.py:55 `voice.vad.provider`** (app.yaml:39) — zero readers (build_stt reads only `stt`). **MED**
- **config.py:48-50 `voice.wake_word.*`** (app.yaml:35-37) — zero readers (see dead `WakeWordDetector`). **MED**
- **config.py:71-72 `voice.wake_sound` / `voice.sleep_sound`** (app.yaml:44-45) — zero readers. **LOW**
- **config.py:86-91 `ui.templates` / `ui.default_template` / `ui.default_primary` / `ui.large_text` / `ui.high_contrast`** (app.yaml:55-60) — zero readers; TS hardcodes `focus`/`conversation` (§2) and the Settings panel can PATCH these with no effect. **HIGH** (silent no-op config is worse than absent)
- **config.py:19 `app.locale`** (app.yaml:13) — zero readers; the agent is hardcoded Spanish in strings. **LOW**
- No reader-without-key cases found: every `config.X` access in code maps to a declared key.

Additional drift:

- **configs/app.example.yaml:42** — `ui.templates: [focus, split, reference, background_media]` still carries the **pre-2026-08-07 template names** (`reference`/`background_media` are deprecated aliases); `configs/app.yaml:55` has `[focus, split, reading, dashboard]`. A user copying the example gets the wrong vocabulary. **MED** — Sync the example with app.yaml.
- **packages/contracts/scripts/export_schemas.py:7-8** — Docstring references `apps/desktop/src/types.ts` and `tests/ts`, which don't exist (actual: `src/contracts.ts`, `apps/desktop/tests/conformance.test.ts`). **LOW** — Fix the comment.

---

## Top 10 by priority

1. **apps/desktop/src/{ws/client.ts:29, main.tsx:10, voice/mic.ts:31, components/TtsPlayer.tsx:6}** — agent URL hardcoded 4×; ignores `server.host/port`. HIGH — one endpoints module fed from GET /config.
2. **apps/desktop/src/contracts.ts (hand-maintained, `string`-typed enums, only ui-commands conformance-tested)** — Python↔TS drift is unchecked. HIGH — generate from schemas or type unions + conformance-test all 4 schemas.
3. **Dead config keys PATCHable via UI with no effect** — `ui.templates/default_template/default_primary/large_text/high_contrast`, `tts.speed/queue_max`, `browser.*`, `demo.*`, `agent.model.max_steps`, `voice.vad.provider`, `voice.wake_word.*`, `voice.wake_sound/sleep_sound`, `app.locale` (config.py:19-131). HIGH — wire them or delete them.
4. **store.ts:141/243/397** — TTS/history cap `>10` hardcoded 3× + `enqueueTts` duplicates the `tts.speak` case. MED — one helper, value from `tts.queue_max`.
5. **`_now()` in 10 repos vs `db.utcnow_iso()`** — MED — single import.
6. **PanelType (14) vs KNOWN_PANELS (12); `isPanelId` silently drops valid commands** — MED — derive from schema + conformance assertion.
7. **demo_live.py ↔ smoke_mock.py harness duplication + 3× temp-config-dump pattern** — MED — shared `scripts/_harness.py`.
8. **Status/kind values as SQL literals + `STATUSES` tuple, never importing contracts enums** — MED — use `Enum.value` in memory layer.
9. **system.md:9-11 and ui_tools.py:113-115 hand-enumerate PanelType (already drifted)** — MED — derive or guard with a prompt drift test.
10. **4th copy of config defaults in conftest.py + stale app.example.yaml:42 template list** — MED — tests load real app.yaml; sync example.

---

### Method notes
- Read-only: no files modified except this report.
- Cross-boundary claims verified by reading both sides (Python pydantic models, exported schemas, TS mirror) and by ripgrep reference counts for every dead-code flag.
- Tool registry ↔ policy engine cross-check: all 42 registered tool names have `TOOL_KINDS` entries and vice versa — no drift there (only the 4 DENIED_ALWAYS placeholders are unimplemented).
