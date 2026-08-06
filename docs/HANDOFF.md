---
type: handoff
title: Ars-Vox handoff — 2026-08-06
description: Authoritative roadmap and latest session state (mic path verified; next step is the real-mic smoke test)
---
# Ars-Vox handoff — 2026-08-06 (mic path: energy VAD + STT round trip done)

This handoff supersedes the previous one (TTS autoplay verification done,
voice work committed, README voice section updated). See
`docs/vertical-slice-split-layout.png` for the working UI.

## State summary

The project is: **a verified agent-service foundation with a working
desktop vertical slice, a verified live model path, and a fully wired
real voice path EXCEPT the physical microphone on the target machine.**
TTS (edge, autoplay-safe) and STT (faster-whisper, es) both work end to
end; mic capture is implemented and browser-verified with a fake audio
device; only a real-mic smoke test on the Windows machine remains.

## Commits this session

- `20b0f5b` feat: microphone path — energy VAD + blob-per-utterance STT
  round trip (MicButton, voice/vad.ts, voice/mic.ts, Electron media
  permission, vad tests)
- `82cbd10` docs: mark TTS autoplay verification done, update README
  voice status

## Voice path — now fully implemented

Framing decision: **blob per utterance** (not chunked stream). The
renderer records with getUserMedia + MediaRecorder (webm/opus), a pure
energy VAD (RMS via AnalyserNode) ends the utterance on ~900ms silence
or a 30s cap, the blob is POSTed to the existing `/api/stt`
(faster-whisper, es), and the transcript is sent as a normal
`user_text` message. Zero server changes were needed — the STT endpoint
and user_text protocol already existed.

New files (apps/desktop):
- `src/voice/vad.ts` — EnergyVad, pure + clock-injected, 8 unit tests
  (threshold, silence-end, blip rejection, max-duration, reset).
- `src/voice/mic.ts` — MicCapture: start/stop/abort, RMS loop,
  recorder ondataavailable -> Blob -> FormData POST, phase callbacks
  (idle/recording/transcribing/error).
- `src/components/MicButton.tsx` — tap to talk in the composer;
  auto-stop on silence; second tap stops; app STOP aborts an in-flight
  recording (barge-in: stop() clears the speak queue).
- `electron/main.ts` — grants the `media` permission (request + check
  handlers) so the mic works without site-permission fiddling.

Desktop suite: 30/30 (was 20/20). Typecheck clean. Python suite
unchanged at 45/45.

## VERIFIED: full voice loop in real Edge (fake mic)

The complete loop was proven end to end in real Edge via CDP with a
fake audio device:

```bash
# fake-mic.wav = edge-tts Spanish phrase + 3s silence, 16k mono,
# boosted to ~0 dB (fake device attenuates a lot):
ffmpeg -i /tmp/fake-mic.wav -af "volume=8dB,alimiter=limit=0.95" \
  -ar 48000 -ac 1 -c:a pcm_s16le /mnt/c/tmp/fake-mic-loud.wav

# service config: agent.mock=True, tts edge + auto_speak,
# voice.stt provider=faster-whisper model=tiny
# Edge launch flags (REQUIRED — the file flag alone does nothing):
#   --use-fake-ui-for-media-stream
#   --use-fake-device-for-media-stream
#   --use-file-for-fake-audio-capture=C:\tmp\fake-mic-loud.wav
```

Then: real CDP click on the MIC button -> "Listening..." -> VAD ends
the utterance -> service log shows `POST /api/stt 200 OK` ->
faster-whisper transcript -> user_message -> mock agent turn ->
`GET /tts 200 OK` -> playback. **Two full loops landed in the DOM**
(user: "¡Claro! ¡Claro! ¡Claro, lo." / "Hola hola, esta es una
prueba"; assistant: the scripted reply twice).

Honest caveats:
- The hidden-CDP-tab rAF throttling does NOT stop the loop (it ran
  twice while the tab was `visibilityState=hidden`), but a real
  foreground window is the normal case; no action needed.
- Whisper-tiny transcription of the synthetic file was rough. The
  demo_voice.py file path got ~100% overlap; the fake-device path is
  lower quality. On real hardware, if accuracy disappoints, bump
  `voice.stt.model` (tiny -> base/small) — one config line.

## Next steps, priority order

1. REAL-MIC SMOKE TEST (the only remaining gap to "the user speaks
   and the assistant answers out loud"): run the app (mock service +
   vite, or the Electron build) on the Windows machine, click MIC,
   speak Spanish, confirm the reply is spoken. This is a physical
   hardware check that cannot be done from WSL. If transcription
   accuracy is poor on a real mic, try model=base.
2. Product polish only after 1: wake word (openWakeWord provider in
   services/voice), VAD-driven auto-start of recording, mic state
   feedback in the StatusBar (currently only the button shows
   recording/transcribing).
3. Expand panels (browser/youtube via allowlisted WebContentsView,
   media, news, notes, tasks, settings).
4. MacBook Air 2014 spike (real hardware): Electron launch + Big Sur,
   Python without system dependency, SQLite WAL + FTS5, mic
   permission, STT/TTS latency, embedded browser, reconnect,
   memory/CPU idle, scheduler across restart. Pin Electron after.
5. README: the voice section already reflects TTS/STT; add one line
   about the MIC button + fake-device verification recipe if desired.

## Environment quirks (learned this session, all verified)

- **Edge fake-mic flags**: `--use-file-for-fake-audio-capture` alone
  does nothing; you must ALSO pass `--use-fake-device-for-media-stream`
  and `--use-fake-ui-for-media-stream` (auto-grants the prompt).
- **Fake device attenuates**: a file at -4.2 dB max came out ~0.013
  RMS in the browser; boost to ~0 dB before using it, or lower the VAD
  speechThreshold (default 0.015 in mic.ts).
- **Hidden tab throttles rAF** but doesn't halt it — the VAD still
  eventually fires; don't burn time fighting window focus for e2e.
- **agent-browser eval with long async loops times out** (80 x 100ms
  exceeded the CDP eval limit). Use a detached loop writing to
  `window.__probe`, then poll with short evals.
- **My first play() probe lied**: a monkey-patched
  HTMLMediaElement.prototype.play whose rejection handler returned
  undefined swallowed the NotAllowedError, so the app's fallback never
  saw it. Re-throw in probes: `.then(ok, (e) => { log(e); throw e; })`.
- vite on /mnt/c: restart after source edits (no inotify).
- agent-browser binary: `~/.hermes/node/lib/node_modules/agent-browser/
  bin/agent-browser-linux-x64` (global symlink broken).
- Real-model key: source `/home/vruizes/.hermes/.env`
  (OPENCODE_GO_API_KEY) — never print it.
- Tool names on the wire are underscore-flattened (ui_apply_layout).

## Bigger picture

The milestone demonstration is now met end to end for the text path
AND the voice path (via fake mic): service connects, voice state
shows, typed or spoken request in, typed tool call, policy,
ui_command, layout change, panel appears, stop works, app responsive,
SQLite has sessions/audit, TTS plays, STT transcribes. The single
remaining demo gap is the physical microphone on the target machine
(step 1 above). Until that runs, describe the product as a verified
agent-service foundation with a working desktop slice and a browser-
verified voice path — the final real-mic smoke test is a 10-minute
task, not an architecture gap.
