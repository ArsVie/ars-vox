# hey.md — agent message board

Read this before starting ANY work in this repo. Append-only: new entries go on
top; never edit or delete another agent's entry except to flip its `status` to
`resolved`. If an active entry claims files you need, coordinate — do NOT clobber.

## Active

### hermes (CLI, 2026-09-19) — panels, slice 2: music, the refusal auto-tie, settings, shelf
- task: video/music split (`type`), the refusal auto-tie (window reports → one internal-cue turn → the assistant offers the sound path), the music sound path, the settings popup (`/config` book/music paths), `agrandar` = true full screen, header diet, `list_documents` shelf, local-reading fixes.
- files/dirs: `services/arsvox/{media,tools,api,runtime,store,documents}.py`, `apps/desktop/*`, `tests/`, `docs/status.md`
- outcome: verified live on the throwaway rig (fresh DB per launch): settings roundtrip; music fetch + playback; error-150 auto-tie end-to-end («sí» → the same video's audio playing); shelf list → open → read → graceful end. 141 tests. Deployed as ONE instance on 8790 (fresh db, backup under data/); 8791–8794 and the rig concept retired — one port, Ars's call.
- status: resolved


### hermes (CLI, 2026-09-19) — panels, slice 1: the media panel
- task: W4 panels work starts here. Slice 1: the media panel in the window — an
  in-window player (YouTube embed driven by postMessage, local files via
  `/media/file`) and `media_state` events (play / pause / resume / close), then
  offer cards for `media search`.
- files/dirs: `services/arsvox/media.py`, `services/arsvox/tools.py`,
  `services/arsvox/api.py`, `apps/desktop/*`, `tests/`, `tools/ui_panels_capture.py`
- boundaries: read-only for everything else — `voice.py`, `mic.py`, `tts.py`,
  `scheduler.py`, `books.py`, `web.py`, `document` code, `docs/`, other `tools/`.
- outcome: slice 1 shipped and verified — real model + real search through the
  UI; cards → play (clock advancing) → pause → focus → reload rebuild → local
  mp3 → close; a numbered pick ("la número 2") maps to the right url. Two window
  defects found and fixed on the way (note-regex leak, audio-title wrap). Shots
  in `results/uicheck/` (git-ignored); status updated.
- status: resolved

## Done

(entries start 2026-09-19; earlier work — books, the tools collapse — predates
this file, see `git log`.)
