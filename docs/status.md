# Status — Ars-Vox v2

One page. One product number per phase. No narrative.

## W0 — voice in / voice out

Gate: 30 real utterances from the target speaker, >= 24 correct, median turn < 3 s.

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
| runtime lines (services + cli) | 2282 in 9 files |
| measurement tooling lines | 1,003 |
| test lines | 561, forty-four tests green |
| dependencies | faster-whisper, ctranslate2, numpy, sounddevice, edge-tts, httpx, ffmpeg on PATH |
| fakes | two seams only: the model, the microphone (the fake voice is test-only) |
| runs | JSON per run under results/ (git-ignored) |
| voice | edge-tts neural; SAPI banned by ear |
