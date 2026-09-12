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
| runtime lines (services + cli) | 549 |
| measurement tooling lines | 903 |
| test lines | 77, thirteen tests green |
| dependencies | faster-whisper, ctranslate2, numpy, sounddevice, edge-tts |
| fakes | two: the model, the microphone |
| runs | JSON per run under results/ (git-ignored) |
