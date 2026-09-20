# hey.md — agent message board

Read this before starting ANY work in this repo. Append-only: new entries go on
top; never edit or delete another agent's entry except to flip its `status` to
`resolved`. If an active entry claims files you need, coordinate — do NOT clobber.

## Active

### hermes (CLI, 2026-09-19) — panels, slice 2: music, the refusal auto-tie, settings, shelf
- task: video/music split (`type`), the refusal auto-tie (window reports → one internal-cue turn → the assistant offers the sound path), the music sound path, the settings popup (`/config` book/music paths), `agrandar` = true full screen, header diet, `list_documents` shelf, local-reading fixes.
- files/dirs: `services/arsvox/{media,tools,api,runtime,store,documents}.py`, `apps/desktop/*`, `tests/`, `docs/status.md`
- outcome: verified live on the throwaway rig (fresh DB per launch): settings roundtrip; music fetch + playback; error-150 auto-tie end-to-end («sí» → the same video's audio playing); shelf list → open → read → graceful end. 141 tests. Deployed as ONE instance on 8790 (fresh db, backup under data/); 8791–8794 and the rig concept retired — one port, Ars's call.
- follow-up: the book panel — documents auto-show a page in the same panel (`document_state`; `/documents/control` close; full-screen reading). Verified live on 8790 with real turns; captures `book-0*.png`; 143 green.
- follow-up 2 (same night): Ars corrected the reader — book read-aloud was to stay deferred: `read_next` and the read path are deleted, nothing narrates documents; the reader is a VIEWER with fit-to-width default (pdf pages rendered via `/documents/page`, text cut into pages, panel arrows, same-name dedupe, `._` skip). Verified live with a REAL 85-page pdf (fit 1136==1136, grown 1904, text full width, route 404 when not a pdf); 146 tests; captures `viewer-0*.png`.
- follow-up 3 (his live check found two): the voice said «13 de abril de 471» for "13 de 471" (Azure date normalizer; proof + fix `tts.speakable()` — the voice spells numbers; 3 tests) and the book had little air (book-mode 1fr:3fr: conversation 768→480, book 1152→1440; paddings trimmed). Verified live on his own Quijote PDF (fit 1424==1424) + `/speak` round-trip; 149 tests; capture `view-fix-01-bookmode.png`.
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
