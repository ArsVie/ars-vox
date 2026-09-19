# Status — Ars-Vox v2

One page. One product number per phase. No narrative.

## W0 — voice in / voice out

Gate: 30 real utterances from the target speaker, >= 24 correct, turn under 20 s. The 20 s is Ars's
number; the `< 3 s` this file carried earlier was agent-drafted and never his.

**Result on the single recorded session: 22 of 30 understood, 4 of those 30
destroyed by the recording window, 3 genuine recognition losses.**
On the 26 valid samples that is 22 of 26, which is 85 percent against the gate's
80 percent bar. Not declared passed: the gate is written as 24 of 30 absolute.

### The recorded session, re-processed offline (no new recording)

The 30 recordings were quiet and padded with silence. Each was recognised three
ways with large-v3-turbo. Score is the tolerant matcher against the key terms.

| variant | understood | median per request |
|---|---|---|
| raw | 21 of 30 | 0.56 s |
| normalised to peak 0.7 | 22 of 30 | 0.57 s |
| normalised and silence-trimmed | 21 of 30 | 0.56 s |

Normalisation is the best variant; trimming wins one request ("hoy") and loses
two. The three variants disagree on single requests, which is itself the lesson:
run one variant, and keep the read-back as the safety net.

### Four samples the recorder destroyed (invalid, not recognition)

All four were still speaking when the fixed six-second window closed:

| request | what the window left |
|---|---|
| 7 "Abrime el diario de hoy." | "Ahora es el día de hoy, por supuesto." |
| 14 "Avisame en una hora que tengo que salir." | "Aviso." |
| 19 "Mandale un mensaje a Ana que llego a las seis." | "Mándale un mensaje a Anaki" |
| 25 "Abri el navegador y buscame el clima de hoy." | "Abre el navegador y búscame el clima de..." |

Requests 7 and 14 are the hallucination class: under 0.4 s of speech, and the
model invented a sentence. That is why the recorder now refuses to transcribe a
clip with too little speech.

### Three genuine recognition losses

| request | heard | why |
|---|---|---|
| 1 | "ponerme algo de los vídeos en YouTube" | "Beatles": an English proper noun, lost |
| 16 | "Recuerda me llamar a mi hija del senador" | "los domingos": a reminder's recurrence, lost |
| 22 | "Me contestó, ¿no?" | "Ana": a two-word request with a name, name lost |

All three are the same family: a short proper noun or a trailing time word.
Design consequence: never key an intent on a name, and read the interpreted
request back before acting.

### Latency, resolved

The session measured 5.01 s per request because the laptop was on battery at
9 percent. Confirmed by measurement, not theory:

| condition | turbo CUDA RTF | small CPU RTF |
|---|---|---|
| on mains | 0.07 - 0.21 | 0.13 - 0.37 |
| on battery | 1.04 | 0.83 |

Same clips, same models, AC against battery on this laptop. The re-process above
ran on mains and took a 0.56 s median for a six-second request.

## W1 — the loop

Gate: a real turn through the real model, tool calls writing real state, the
prefix cache hit above zero, and a restart that resumes the session from the log.
No scripted model appears anywhere in the evidence below.

| what | evidence |
|---|---|
| real model, real state | `ask "recordame tomar la pastilla del corazón a las ocho de la noche"` → `reminders_set({text: "Tomar la pastilla del corazón", when_local: "2026-09-12T20:00"})`, stored as reminder 1 |
| real speech in | five of the user's own recordings from 2026-09-12 replayed through the loop: 13, 10, 11, 15, 17 |
| prefix cache | first turn 1378 prompt tokens, 1152 cached (84%); then 88, 90, 91, 94% |
| resume from the log | each replay ran in its own process; turn 17 found reminder 2 that turn 13's process had created |
| no duplicate work | asked again for a reminder that already existed, the model called `reminders_list` and refused to add it twice |
| turn latency | 2.8 - 5.1 s per turn, of which recognition 0.62 - 0.73 s |

The five replayed requests, in the user's real voice:

| request | heard | what the loop did |
|---|---|---|
| 13 | "Recuérdame tomar la pastilla a las 8 de la noche." | found the existing reminder, did not duplicate it |
| 10 | "Anota que tengo que llamar al médico." | found the existing task, did not duplicate it |
| 11 | "Agrega a la lista de comprar pan" | `tasks_add` → task 2 |
| 15 | "¿Qué tengo que hacer hoy?" | `tasks_list` + `reminders_list` in one turn |
| 17 | "Borro el recortatorio de las 8." | `reminders_cancel(2)` → cancelled the 20:00 reminder |

Recogniser time for a six-second request: 0.62 - 0.73 s on CUDA with the loader
path set, against 5.08 s when it silently fell back to CPU. The CLI now prints
that fallback instead of hiding it.

### Shape

| file | lines | what it is |
|---|---|---|
| `services/arsvox/config.py` | 80 | settings, key resolution, one place |
| `services/arsvox/store.py` | 238 | the event log plus one projection rule, reminders, tasks, preferences |
| `services/arsvox/model.py` | 199 | raw httpx chat completions, usage and cache accounting |
| `services/arsvox/context.py` | 119 | ordered prompt sections, strict interpolation, volatile snapshot |
| `services/arsvox/limits.py` | 54 | step budget and repetition cap (Recommendation 18) |
| `services/arsvox/tools.py` | 257 | eight tools, each writing real state, validated against its own schema |
| `services/arsvox/runtime.py` | 162 | the turn loop |
| `apps/cli/arsvox_cli.py` | 361 | `ask`, `chat`, `talk`, `speak`, `listen`, `log`, `sessions` |

### What was removed, and why

A permission engine was written and then deleted, 168 lines, before anything ran
on it. The paper's grounds, quoted:

- Section 10 opens: "Safety mechanisms become important in direct proportion to
  the autonomy the agent is given." One user, one machine, eight tools writing to
  a local database is the bottom of that scale.
- Recommendation 10 scopes OS sandboxing, policy-as-code and audit trails to
  "enterprise / shared / automated contexts".
- The 16.4 scaffold "deliberately omits features for which our corpus shows
  divergence: sandbox (Recommendations 9-10 are deployment-specific)".
- It was also dead code: the tool registry is hardcoded, so an unknown tool could
  never be dispatched, and the deny-list named file and shell tools that were
  never in the registry at all.

What survives, both named by the paper: the tool's own JSON schema is the rules
as data (Recommendation 11), and the step budget plus repetition cap are the
"cheap caps" of Recommendation 18. The schema check also does product work the
deny-list never did: it turns `"reminder_id": "abc"` into a sentence the model can
act on.

## Voice out

The Windows system voice (SAPI through PowerShell) was heard on the real machine
and rejected. It is banned: it must not come back, not even as a fallback.
The product voice is edge-tts `es-MX-DaliaNeural` at -4 percent rate, converted
to wav with ffmpeg for playback. Open item: it needs network, so a local neural
voice is required before the two-week pilot.

## W2 — reminders that fire with the app closed

Gate: a reminder set through the loop fires at its time with no ars-vox process
running, and the log says so.

| step | evidence |
|---|---|
| registered by the product | `\ArsVox\reminder-5`, action `pythonw.exe "...\arsvox_cli.py" fire 5 --session cli` |
| Windows ran it | Last Run Time 4:06:00 PM, **Last Result 0** |
| the app was closed | no ars-vox process was running; only Task Scheduler |
| it fired | `results/reminders/fired.log` line at 16:06:01; `reminder-5.wav`, 175,774 bytes, the sentence synthesized |
| state updated | reminder 5 `active=0` with `fired_ts`; log event `reminder_fired` carrying the spoken sentence |
| repeats | `daily` and `weekly` use CalendarTrigger and stay active after firing (unit-tested) |
| not measured | sleep and wake: `StartWhenAvailable` and `WakeToRun` are set in the task XML, but no sleep test was run |

### The defect this wave found

The first real fire attempt never ran: `Last Result: 267011` (has not run). The
task boundary was written as bare wall-clock text, and this rig has two clocks —
WSL at -06:00, Windows at -07:00 (Mountain Standard Time, Mexico). Windows read
"17:03" as its own local time, an hour away from the intended instant.

Fix: `boundary_text()` writes the absolute instant with its offset
(`2026-09-12T17:06:00-06:00`) and Windows converts it. Confirmed: a 17:06 WSL
request showed Next Run Time 4:06:00 PM Windows-local, and ran at that second.

Re-register everything after a rebuild or on a fresh machine:

```
python apps/cli/arsvox_cli.py reminders --session cli --sync --query
```

## W3 — the window

Gate: the window dies mid-turn, comes back, and the conversation continues from
the log. Measured, all four conditions true (`results/w3-cut.json`):

| step | evidence |
|---|---|
| a turn starts | raw socket `POST /turn`, then RST (`SO_LINGER 0`) at 17:16:19 |
| the client is gone | `busy` was observed with no client alive; the service finished the turn alone in 3.8 s |
| the answer arrives anyway | `user_text` 94, `tool_call` 97 (`reminders_set`), `tool_result` 98, `assistant_text` 101 — all after the cut |
| the window comes back | Edge loaded `/`, rebuilt 10 bubbles and 4 tool chips from the log, carrying no state |
| nothing replays twice | asking for events after the last id returns an empty list |

The window is a page the service serves itself (`apps/desktop`: `index.html`,
`app.js`, `style.css`) plus an Electron main that starts the service and points a
window at it. It holds no state: on load it asks for everything after id 0, and
that is also how it recovers. `DETENER` posts `/stop`, which the loop checks each
step, so stopping costs at most one model call.

### Two real defects this wave found, both fixed

1. **The store was not thread-safe.** The interface layer answers in threads of
   its own, and the health endpoint died with
   `sqlite3.InterfaceError: bad parameter or other API misuse` while a turn was
   writing. `Store` now serializes every method with an `RLock`; four threads
   appending at once is a regression test.
2. **Shutting down mid-turn closed the store under the writer**, raising
   `sqlite3.ProgrammingError: Cannot operate on a closed database` inside the turn
   thread where nobody could see it. The service keeps its worker and joins it
   (`AgentService.shutdown`) before anything closes the store.

### The window itself

The gate ran in real Chromium (Edge, headless) rendering the same page the window
loads. The Electron main was then run for real and produced a renderer target:

```
page | Ars Vox | http://127.0.0.1:8790/
```

That run used the v0.1 tree's Electron binary under WSL, because the download for
this app's own `node_modules` fails in this network (`node node_modules\electron\install.js`
dies inside `@electron/get`). The Windows binary therefore remains uninstalled;
`npm install` in `apps/desktop` will finish it wherever that fetch works.

## W4 — the abilities

Five abilities from the sheet. Status after this wave:

| ability | tools | how it was verified |
|---|---|---|
| documents | `documents_open`, `documents_read` | opened the user's real 1,875,482-character construction spec PDF out of Downloads and read the first chunk of it |
| web | `web_search`, `web_read`, `web_open` | live: "ahora hay unos 31 grados, máxima de 36 y mínima de 26, soleado" for Mexicali. The dollar came back as pages, and the assistant said it had no number instead of inventing one |
| media | `media_play`, `media_pause` | resolution verified live (three real results for "The Beatles Let It Be"); playback deliberately not exercised — it would play music at the user unprompted. Pause sends the media key |
| reminders | `reminders_*` | fires with the app closed (W2) |
| messaging | — | not built yet: needs a bot token and the spoken read-back |

### Three defects this wave found

1. **The document search silently missed files.** `rglob` over Documents + Desktop
   + Downloads costs 25 seconds for 145,506 files, and the 4,000-file cap cut the
   walk before reaching the file the user meant — a search that says "not found"
   for a file that is right there. Now the walk is pruned (`node_modules`, `.git`,
   `.venv`, `site-packages`, `dist`, dotfolders), depth-limited to 4, deadline of
   3 seconds, and it reports when it was cut. 1,813 files in 0.64 s, and the spec
   PDF is found with the right score.
2. **The model answered a repeated request from memory.** Asked again to open a
   document it had already failed to find, it reported the old failure without
   calling the tool. The state may have changed, so the norms now say: if a tool
   answers the request, call it.
3. **`documents_read` mixed the text with its own bookkeeping**, and the model
   read "Quedan 1874082 letras" aloud. The note is now bracketed as `[Meta: ...]`
   with the tool description saying brackets are not for reading out loud.

15 tools were visible after this wave; the web work below brought the count to 17.
The paper puts deferred tool loading above about 15, so every addition from here
has to justify itself or the surface consolidates.

### El micrófono por la ventana (voice-in)

`POST /listen` records until 1.2 s of silence (cap 15 s), normalises the gain, skips
a clip with no speech, transcribes with the product engine, and runs the turn.
The window has a HABLAR button; it disables itself and says why when the machine has
no ears (`/health` reports `ears` and `voice`).

Verified on Windows with the service running on CUDA:

- `/listen` with a real recording from the user's own session: heard "Recuérdame
  tomar la pastilla a las 8 de la noche." — 0.84 s for 6.0 s of audio, then a real
  turn: `reminders_set` saved reminder 7 for 20:00 and the assistant answered. The
  reminder was cancelled afterwards (1 → 0 active, `\ArsVox\` task list empty)
  because at 20:00 it would have spoken out loud in an empty room.
- The microphone itself opens and records on Windows (`tools/mic_smoke.py`:
  captured 2.05 s, peak 0.0278, no speech — nothing was said). Pressing HABLAR is
  what exercises the live microphone → turn path.
- The transcription path was verified with a file instead of the microphone so the
  test could not act on anybody's conversation and could not leave a speaking alarm
  behind.

Two things this step cost:

- **The key needs a home.** A shipped app cannot read the developer's shell.
  `%USERPROFILE%\.arsvox\env` (KEY=VALUE, same variable names) is now first in the
  search order, after real environment variables and before `~/.hermes/.env`.
- **SQLite does not cross the two operating systems.** While the Windows service has
  `data/arsvox.db` open, a WSL process opening the same file dies with
  `disk I/O error` (WAL plus drvfs does not lock across OSes). The product runs
  entirely on Windows, so this only affects the development rig: drive the service
  over HTTP, or use the Windows python.

### What the first hand on the window found (2026-09-19, live use)

One sentence, five recordings. The log carries five `heard` rows for the same
"Hola, hola, probando 3, 2, 1.": the first became the turn, four came back
"ya estoy con otra cosa", one captured no speech — and the window showed a
duplicated bubble and note times an hour off. Four defects, all fixed:

1. **`busy` did not cover the recording.** The 700 ms poll saw `busy:false` while
   the first recording was still open, flipped the status back to "listo" and
   re-enabled HABLAR; the button was pressed again, and again. The service now
   reports `busy` while it listens (`_listening`), the poll reinforces "escuchando…"
   instead of erasing it, and the button reads ESCUCHANDO…, staying lit while the
   microphone is open.
2. **Nothing serialized `/listen`.** Each press recorded the same sentence from the
   same microphone; one of them then caught no speech at all. One recording at a
   time now (`_listen_lock`); a concurrent press is answered "todavía estoy
   escuchando lo anterior".
3. **Two overlapping polls could render one event twice** — the duplicated green
   bubble. `pull()` drops ticks while a request is in flight.
4. **Notes were stamped UTC** ("19:00") against the server's local ("12:00"). The
   window now stamps notes with the same local clock.

### Las fuentes web: weather and news measured, search no longer lies (2026-09-14)

DuckDuckGo lite soft-blocks after volume: HTTP 202, a 14 KB page, zero result
anchors. `web.search()` swallowed it, so weather, dollar and news died together
and silently — the same design flaw sat in `web.read()` and `media.resolve()`
(returning empty for "could not ask"). All three now say why.

| what | evidence |
|---|---|
| weather | `weather_get` reads open-meteo (geocode + forecast; no key, never a stale page). Real turn: "En Mexicali ahora hay 33 grados, se siente como 32" — the raw API the same minute said 32.7 / 32.1; "mañana" read the right day (máx 41 against the API's 40.8) |
| news | `news_list` reads La Jornada's RSS with a real item reader. Real turn: five titles; "Pumas CU se impone a Burros Blancos" is in the live feed |
| search | DuckDuckGo gets one retry on a soft-block, then Mojeek; blocked, empty and unreadable are three different sentences now |
| register | two drifts the guard had missed are fixed: the snapshot said "recordás" and `documents_open` said "en tus carpetas"; the guard carries "recordás" |
| tests | 103 green, from 77 |

Mojeek's parser is written to searxng's selectors (`ul.results-standard > li >
a.ob`, title in `h2 > a`, snippet in `p.s`) and unit-tested; live verification is
pending because Mojeek captcha'd this IP during the work (temporary, volume). The
dollar rate stays parked with Ars: which rate (market, DOF, bank) is his call;
only the market one is measured (`open.er-api.com`, USD→MXN).

### Los libros: books_get, and the Quijote read on the first ask (2026-09-19)

The father should be able to name any classical novel and have it read to him. One
tool covers that road: `books_get` searches Project Gutenberg through its keyless
JSON API (Gutendex), prefers a Spanish edition, fetches the plain text, strips the
Project Gutenberg header and footer, saves it under `Documents\Ars Vox Libros\` and
registers it as the current document — `documents_read` continues from there. The
visible-tool count is 18: this one is the reading feature itself, not another web
source.

| what | evidence |
|---|---|
| real turn, first ask | `ask "léame el quijote"` → `books_get({"title": "El Quijote"})` → *"Listo, ya tengo 'Don Quijote', de Cervantes Saavedra, Miguel de. Dígame 'léalo' y arranco."* → `documents_read` → the reply offers to continue: *"comencé a leerlo... Dígame 'siga' cuando quiera que continúe."* |
| the file | 2,148,396 characters of Spanish text, `Documents\Ars Vox Libros\Don Quijote - Cervantes Saavedra, Miguel de (2000).txt`, license markers stripped — verified from both WSL and Windows |
| the catalog flaps | Gutendex stalled in waves all afternoon (reads hanging into timeout, both machines) and 403s the default Python user agent. The fetch sends a browser-shaped agent; the search takes three 10-s tries. Mid-wave a turn can still miss — the tool then says why and offers to try again. |
| tests | 115 green |

A sibling check, same day, off-tree: libgen.li works end to end — search → download →
md5 of the received file equals the catalog's recorded md5 (2 of 2 downloads). The
in-copyright route stays unwired; that decision is Ars's.

## El registro — español de México, de usted

The product copy, the 30-request sheet, the search locale and the persona were all
Rioplatense voseo. Nothing stood behind that: the voice that already shipped was
`es-MX-DaliaNeural`, the user's own requests in the old logs ask about Mexicali, and
the machine runs on Mexico time. The one direct sample of the real speaker settles it —
"¿Puedes ponerme un video de YouTube?" is *tú*, not *vos*.

Now one setting decides it: `config.REGISTERS` (`ARSVOX_REGISTER`, default `es-MX`)
holds the persona text, the TTS voice and the country the search answers for. The
30-request sheet is rewritten in Mexican Spanish, tool descriptions are in the
infinitive (no person to imitate), and the assistant addresses the user as *usted* —
respectful for an elderly person in Mexico, and what the model chose on its own when
given only the persona. Two guard tests keep it: one fails the build if voseo
morphology returns to the copy, another keeps the tool sentences in the same address
form as the replies.

A third crop of voseo surfaced on 2026-09-19, in the window's own copy: the input
placeholder («Escribí o dictá lo que necesitás»), the HABLAR tooltip («Hablá y te
escucho») and the CLI banner («hablá después del aviso»). The guard's file roots
already covered those files; its token list did not carry the forms — hablá, escribí,
dictá, necesitás were all missing. Copy fixed to usted; the list now carries them plus
the same family (hablás, dictás, escribís, tené, poné, avisá, sacá, entrá, llamá,
pagá, apretá, sentate, quedate).

### The measurement trap, which is worth more than the fix

**Four services were bound to 8790 at once.** Stdlib `allow_reuse_address` let every
new instance shadow the previous one, and the *oldest* — started before any of these
changes — answered every request. So each "the model kept ignoring the persona" result
was produced by a process that did not contain the persona. A marker sentence planted
to test whether instructions were honored at all came back missing for that reason, and
I nearly recorded "the model prefers voseo" as a finding about the model. `pkill` from
WSL never killed those services: they are Windows processes, and `ps` in WSL lists none
of them.

Fixed: `allow_reuse_address = False`, a `PortBusy` error that names the problem, and a
regression test. Verified after cleaning up: exactly one listener on 8790, and 4 of 4
replies in usted.

## Packaging — what the executable should be

Measured on this machine: **Electron is the wrong tool here.**

| option | size / cost | verdict |
|---|---|---|
| Electron | ~200 MB Chromium per app, node + npm, and its binary download fails on this network | no |
| WebView2 via pywebview | runtime already installed (152.0.4191.66), one pip dependency, no node | the page stays as it is |
| tkinter | stdlib, nothing to install | only if the UI stops being a page |
| Edge in `--app=` mode | nothing to install | fine for a shortcut today |

The window is a page; it does not need its own browser. The executable is the
Python side: PyInstaller `--onedir` (never onefile: unpacking a 2 GB bundle into
temp on every launch would cost a minute), with `nvidia-cublas-cu12` and
`nvidia-cudnn-cu12` collected as data, and the whisper models left outside the
bundle in `C:\dev\models\whisper`.

The 20 s budget also settles the hardware question from the other side: **a GPU is
not required.** Measured on the target speaker's own 30 recordings, speech-trimmed
and warm, Whisper large-v3 on CPU (int8) scored mean WER 0.291 at 3.81 s per
utterance, against 0.267 at 0.84 s on CUDA. Both fit inside 20 s with the model
turn on top, so the CUDA wheels (~2 GB) and the GPU driver dependency are optional
rather than mandatory. Engine choice is now accuracy-first, and the measurement
says large-v3 rather than turbo: large-v3 beat large-v3-turbo in **both** runtimes
on this speaker (native Q8 0.242 vs 0.357; Python fp16 0.267 vs 0.294). Turbo's
speed was never needed. Nine engines were compared on the same 30 clips — Cohere
Transcribe 0.343, Voxtral Mini 4B Realtime 0.332, Qwen3-ASR 0.6B 0.381, Nemotron
3.5 0.519, Parakeet v3 0.571, Canary 180M 0.696 — and the remaining error class is
proper nouns ("los Beatles" -> "los vídeos" / "los metros" / "los mitos" across
three engines), which is a context-bias or fine-tuning problem, not a model choice.

## Engine, 12 real clips, 270 s (mains power)

| path | model | mean WER | median | worst | mean RTF |
|---|---|---|---|---|---|
| CPU int8 (WSL) | tiny | 0.633 | 0.538 | 1.55 | 0.069 |
| CPU int8 (WSL) | small | 0.424 | 0.336 | 1.55 | 0.187 |
| CPU int8 (WSL) | large-v3-turbo | 0.295 | 0.233 | 0.75 | 0.416 |
| CUDA float16 (WSL) | large-v3-turbo | 0.306 | 0.229 | 0.75 | 0.068 |
| CUDA float16 (Windows) | large-v3-turbo | 0.306 | 0.229 | 0.75 | 0.070 |
| CUDA float16 (Windows, battery) | large-v3-turbo | 0.306 | 0.229 | 0.75 | 1.041 |

Chosen: **large-v3-turbo, CUDA, float16, on mains power.**

## The transcripts are the evidence

Turbo on a 49 s clip, against a caption that says "o la vecina cómo estás que el calor...":

> Hola vecina, ¿cómo estás? ¡Qué calor que hace! ¡Por favor! Por eso te mando
> un mensaje. Te quería contar que cambié el aire acondicionado a mi pieza.
> Ahora puse uno de 5.000 frigorías... Lo pongo en 20, parece Siberia mi pieza.
> Hay que dormir tapaditos. Así que bueno, a lo mejor si estás sufriendo mucho
> el calor y tenés ganas, te vendo el aire acondicionado viejo, ¿vale?

Independent checks: clip #57 is titled "Sujetate la jeta" and turbo heard
"¡Sujétate la jeta, loca!"; #58 is "Mamá pidiendo regalos" and turbo heard the
gift list; #36 turbo heard "Villa Trebelin" (real town: Villa Trevelin, Chubut)
where the caption wrote "villa tv link". Turbo beats the reference on those
clips, so mean WER overstates its errors.

## Corpus and known failure modes

12 Argentine WhatsApp voice notes, 270 s, captions as a weak reference. WER is
agreement with a second engine, not truth. Turbo worst clip 0.75, best 0.089.

1. Intentionally distorted joke audio: unintelligible to humans too.
2. Very short noisy clips.
3. Dialect interjections ("Che" heard as "Sí").
4. Word-final details ("dale" as "¿vale?").
5. Formatting is never stable: normalise before matching, never match raw text.
6. Confidence is useless as a safety net: zero weak segments while making 3-6
   word errors, and confident hallucinations on near-silence.

## Gate command

```
powershell -ExecutionPolicy Bypass -File C:\dev\ars-vox-v2\tools\windows\run_w0_mic.ps1
```

Needs mains power. Prints each request, records until you pause, scores it, and
takes an override (Enter accepts, c correct, i incorrect, q quit).
Re-scoring a saved session without new audio: `python tools/w0_rescore.py`.

## Harness state

| item | value |
|---|---|
| runtime lines (services + cli) | 3,873 in 20 files |
| measurement tooling lines | 1,003 |
| test lines | 1,668, one hundred fifteen tests green |
| dependencies | faster-whisper, ctranslate2, numpy, sounddevice, edge-tts, httpx, ffmpeg on PATH |
| fakes | two seams only: the model, the microphone (the fake voice is test-only) |
| runs | JSON per run under results/ (git-ignored) |
| voice | edge-tts neural; SAPI banned by ear |
| window | 416 lines of plain JS in apps/desktop (HABLAR + DETENER + bubbles), no framework, no build step |
