# Ars-Vox handoff — 2026-08-06 (after vertical slice + live model + voice start)

This handoff supersedes the previous one (its priorities 1-5 and the
docs are complete). See `docs/vertical-slice-split-layout.png` for the
working UI: document panel primary (62%) + conversation panel secondary
(31%) after "Open a document."

## State summary

The project is: **a verified agent-service foundation with a working
desktop vertical slice, a verified live model path, and a partially
wired real voice path (TTS end to end; STT provider proven; mic capture
pending).**

Everything below was verified live during this session, not just coded:

- 45/45 Python tests, 20/20 Vitest, typecheck clean, renderer + Electron
  build clean.
- Browser end-to-end (real Chromium via CDP): "Open a document." ->
  user_message -> tool_call -> policy -> ui_command -> split layout ->
  document panel appears -> agent response appears. Stop button returns
  to Sleeping and the service stays responsive. SQLite holds sessions,
  FTS5-indexed turns, audit events.
- Live model (opencode-go / Console Go, deepseek-v4-flash):
  `scripts/demo_live.py` -> LIVE_OK with TWO typed tool calls in one
  turn (ui_open_panel, ui_apply_layout) and typed ui_commands.
- Real voice round trip, no mic needed: `scripts/demo_voice.py` ->
  VOICE_OK (edge_tts synthesizes Spanish, faster-whisper transcribes it,
  100% word overlap).
- GET /tts returns real MP3 (verified via curl: 200, audio/mpeg).
- POST /api/stt endpoint added (uploads -> faster-whisper text).

## Commits this session

- `85be4cc` fix: ws e2e test breaks on pipeline wake, not turn end
- `04cd68b` feat: electron vertical slice — layout engine, store, ws
  client, panels (23 files)
- `32f9dad` fix: flatten tool names for live provider (dots -> _)
- `b818f3e` docs: README, architecture, threat model, ADRs 0001-0006;
  + `--mock` temp-config fix
- (uncommitted on top: the voice work below + this handoff)

## Voice work — status and the ONE interrupted verification

Done (uncommitted in this working tree):

- `services/tts/arsvox_tts/providers.py`: media_type per provider.
- `services/voice/arsvox_voice/providers.py`: FasterWhisperSTT
  (lazy model, int8, thread-offloaded) + build_stt(config).
- `services/agent/arsvox_agent/app.py`: GET /tts?text=... (audio
  bytes), POST /api/stt (UploadFile -> text, language es).
- `services/agent/arsvox_agent/runtime.py`: auto_speak now emits a
  real TtsSpeak ui_command instead of a fake sleep.
- Desktop: store speakTexts queue + ttsDone + stop clears the queue;
  TtsPlayer component (fetch /tts, sequential playback);
  StatusBar shows Speaking while audio plays; Electron main sets
  `autoplay-policy=no-user-gesture-required` (voice-first product must
  speak without clicks); TtsPlayer has a muted-then-unmute fallback for
  plain browsers.
- `scripts/demo_voice.py`: real STT round trip (no mic needed).
- Tests: 2 new Vitest cases (enqueue/drain, stop clears queue). Python
  suite unchanged at 45/45.

INTERRUPTED (NOW VERIFIED): the browser verification of the autoplay
fix was cut off in the previous session and is now complete. What was
proven in the browser BEFORE the fix: the store processed tts.speak
(status bar showed "Speaking"), but Chrome's autoplay policy blocked
the audio element from even issuing the GET /tts request (CDP
synthetic clicks carry no user activation).

Verification completed 2026-08-06 (plain Edge via CDP, mock agent +
edge TTS + auto_speak):

- REAL CDP Input click on Send -> agent turn -> TtsSpeak -> the
  renderer issued `GET /tts?text=...` (200 OK in service log) and
  `HTMLMediaElement.play()` RESOLVED unmuted (`muted:false,
  paused:false`) — audible playback on the Windows machine.
- The muted-then-unmute fallback is reached on a zero-activation page
  (first play() rejected with NotAllowedError), BUT in current
  Chromium even muted play() is rejected without user activation —
  the fallback cannot rescue a never-interacted page in a plain
  browser. Electron's `autoplay-policy=no-user-gesture-required`
  (committed in `apps/desktop/electron/main.ts`) is the real fix for
  the voice-first product; in plain browsers the product flow always
  starts from a real user gesture (Send click / mic permission), so
  unmuted play succeeds.

Next-session first step: priority 2 below — the microphone path. The
TTS playback side is verified; what remains for "the user speaks and
the assistant answers out loud" is renderer mic capture -> POST
/api/stt -> user_text.

REMEMBER: vite on /mnt/c does NOT see file changes — restart vite after
any source edit, or the browser serves stale modules (this burned 20
minutes this session).

## Next steps, priority order

1. ~~Finish the TTS browser verification~~ DONE 2026-08-06 (see the
   INTERRUPTED section above); voice work committed as `e88a3a7` and
   README voice section updated. No action left here.
2. Microphone path: the missing half of the voice demo. The renderer
   must capture mic audio (getUserMedia; Electron main grants audio
   device permission) and POST it to /api/stt (faster-whisper, es),
   then send the resulting text as user_text. VAD + 60s silence + local
   stop recognition can ride on the existing VoicePipeline state
   machine; barge-in = stop() already clears the speak queue. Plan the
   audio framing (blob per utterance vs chunked stream) before coding.
   NOTE from verification: in plain browsers the mic permission grant
   itself is the user gesture that makes unmuted TTS autoplay legal —
   the mic flow and TTS playback compose cleanly, no extra work needed
   there for the browser case.
3. Expand panels (browser/youtube via allowlisted WebContentsView,
   media, news, notes, tasks, settings) only after 1-2 work.
4. MacBook Air 2014 spike (real hardware): Electron launch + Big Sur,
   Python without system dependency, SQLite WAL + FTS5, mic permission,
   STT/TTS latency, embedded browser, reconnect, memory/CPU idle,
   scheduler across restart. Pin Electron only after the spike.
5. Docs already exist (README, architecture, threat model, ADRs
   0001-0006) — update the README voice section after step 1.

## Environment quirks (learned this session)

- vite on /mnt/c: file watcher misses edits — restart the dev server.
- agent-browser binary: `~/.hermes/node/lib/node_modules/agent-browser/
  bin/agent-browser-linux-x64` (the global bin symlink is broken).
  CDP `click` can hit stale nodes after a page reload; `fill` works;
  `eval` with JS .click() does NOT grant user activation (autoplay!).
- Real-model key: source `/home/vruizes/.hermes/.env`
  (OPENCODE_GO_API_KEY) — never print it.
- Tool names on the wire are underscore-flattened (ui_apply_layout);
  internal dotted names stay (policy, confirmations, audit, events).
- The mock model LOOPs its script, so a long-running demo replays
  tool -> text on every turn.

## Bigger picture

The milestone demonstration (old HANDOFF.md section 9) is now met for
the text path: service connects, voice state shows, request in,
typed tool call, policy, ui_command, layout change, panel appears,
stop works, app responsive, SQLite has sessions/audit. The remaining
gap to "the user speaks and the assistant answers out loud" is exactly
the mic capture half of step 2 plus audible TTS playback on the target
machine. Until that works, describe the product as a verified
agent-service foundation with a working desktop vertical slice and a
live model path — NOT a complete demo.
