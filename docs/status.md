# Status — Ars-Vox v2

One page. One product number per phase. No narrative.

## W0 — voice in / voice out

Gate: 30 real utterances from the target speaker, >= 24 correct, median turn < 3 s.
**Not yet valid.** One microphone session has run; two harness faults made it
unusable as a gate. Both are fixed. A clean session is one command away.

## Microphone session, 2026-09-12 15:13 (real mic, turbo)

| measure | value |
|---|---|
| strict automatic score | 19 of 30 |
| fair score, tolerant matching, same audio | 22 of 30 |
| invalid samples | 3 (recording cut short, or hallucinated on near-silence) |
| real failures | 5 |
| recognition median | 5.01 s — invalid, see fault 1 |

### Fault 1: the machine was on battery at 9 percent

Power plan Balanced, GPU SM clock 442 MHz of 3090. Measured in that state:
turbo on CUDA RTF 1.04 (against 0.068 on mains), small on CPU RTF 0.83 (against
0.13), recognition median 5.01 s (against 0.57 s in the dry run). Every timing
from this session measures the power state, not the engine. The gate now reads
the power source and refuses to look valid on battery.

### Fault 2: a fixed six-second recording window

13 of 30 clips were still speaking when the window closed. Truncation explains
the worst outcomes: request 7 became "Ahora es el día de hoy, por supuesto" and
request 14 became "Aviso." The recogniser invented text where the recording held
almost no speech. The recorder now stops after 1.2 s of silence (15 s cap),
normalises gain to peak 0.7, and skips any clip with under 0.4 s of speech
instead of transcribing it.

### Real failures worth keeping

- "Beatles" became "vídeos". Proper nouns from another language are lost.
- "los domingos" became "del señor". A reminder's recurrence is lost.
- "Ana" became "Anaki", "Anike", "¿no?". A short name never survives.
- "hoy" was lost twice at the tail of a sentence.
- "el dólar, güey": a hallucinated word appended to a correct request.

Design consequences already written into the code: never key an intent on a
name; read the interpreted request back before acting; treat a no-speech clip as
no request rather than trusting the model's text.

## Engine, on mains power (12 real clips, 270 s)

| path | model | mean WER | median | worst | mean RTF |
|---|---|---|---|---|---|
| CPU int8 (WSL) | tiny | 0.633 | 0.538 | 1.55 | 0.069 |
| CPU int8 (WSL) | small | 0.424 | 0.336 | 1.55 | 0.187 |
| CPU int8 (WSL) | large-v3-turbo | 0.295 | 0.233 | 0.75 | 0.416 |
| CUDA float16 (WSL) | large-v3-turbo | 0.306 | 0.229 | 0.75 | 0.068 |
| CUDA float16 (Windows) | large-v3-turbo | 0.306 | 0.229 | 0.75 | 0.070 |
| CUDA float16 (Windows, on battery) | large-v3-turbo | 0.306 | 0.229 | 0.75 | 1.041 |

Chosen: **large-v3-turbo, CUDA, float16**, on mains power. At RTF 0.07 a 4 s
request costs 0.28 s of recognition. Corpus and failure modes: section below.

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
| runtime lines (services + cli) | 549 |
| measurement tooling lines | 903 |
| test lines | 77, thirteen tests green |
| dependencies | faster-whisper, ctranslate2, numpy, sounddevice, edge-tts |
| fakes | two: the model, the microphone |
| runs | JSON per run under results/ (git-ignored) |
