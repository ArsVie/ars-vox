# Status — Ars-Vox v2

One page. One product number per phase. No narrative.

## W0 — voice in / voice out

Gate: 30 real utterances from the target speaker, >= 24 correct, median turn < 3 s.
Not measured yet: needs the real speaker in front of the real microphone.

## Real audio baseline — 12 Argentine WhatsApp voice notes (270 s)

Source: the "Audio de WhatsApp" series on the channel "Reíte pue mi gente",
downloaded with the owner's approval. Compressed mono speech, casual Rioplatense
Spanish, the domain the assistant will actually meet. Reference: the channel's
own auto-caption, a SECOND speech engine, not truth. Numbers below therefore
measure agreement, and they include the reference's own mistakes.

| path | model | mean WER | median | worst | mean RTF |
|---|---|---|---|---|---|
| CPU int8 (WSL) | tiny | 0.633 | 0.538 | 1.55 | 0.069 |
| CPU int8 (WSL) | small | 0.424 | 0.336 | 1.55 | 0.187 |
| CPU int8 (WSL) | large-v3-turbo | 0.295 | 0.233 | 0.75 | 0.416 |
| CUDA float16 (WSL) | small | 0.417 | 0.342 | 1.35 | 0.103 |
| CUDA float16 (WSL) | large-v3-turbo | 0.306 | 0.229 | 0.75 | 0.068 |
| CUDA float16 (Windows) | small | 0.404 | 0.321 | 1.35 | 0.129 |
| CUDA float16 (Windows) | large-v3-turbo | 0.306 | 0.229 | 0.75 | 0.070 |

Hardware: NVIDIA RTX PRO 1000 Blackwell Laptop, 8151 MiB, driver 591.64.
Windows Python 3.12.10, ctranslate2 4.8.2, faster-whisper 1.2.1.

## Decision

Engine: **large-v3-turbo, CUDA, float16**, on Windows. WSL and Windows measure
the same (RTF 0.068 against 0.070), so WSL stays the development surface and
Windows stays the shipping surface.

Latency, from RTF 0.07: a 4 s request costs 0.28 s of speech recognition, a 10 s
request costs 0.70 s, and the whole 23 s baseline clip costs 1.6 s. The 3 s turn
budget survives speech recognition with room for the model call.

Speedup from the GPU: 6.1x against CPU int8 (0.416 -> 0.068). Accuracy is
unchanged within noise (0.295 against 0.306, the difference is int8 against
float16 numerics). CPU-only operation is not viable with this engine: at RTF
0.416 a 30 s request alone spends 12 s.

## The transcripts are the evidence, and they read as correct Spanish

Turbo on a 49 s clip (the caption says "o la vecina cómo estás que el calor..."):

> Hola vecina, ¿cómo estás? ¡Qué calor que hace! ¡Por favor! Por eso te mando
> un mensaje. Te quería contar que cambié el aire acondicionado a mi pieza.
> Ahora puse uno de 5.000 frigorías... Lo pongo en 20, parece Siberia mi pieza.
> Hay que dormir tapaditos. Así que bueno, a lo mejor si estás sufriendo mucho
> el calor y tenés ganas, te vendo el aire acondicionado viejo, ¿vale?

Independent checks: the video titles match what turbo heard and the captions do
not. Clip #57 is titled "Sujetate la jeta" and turbo heard "¡Sujétate la jeta,
loca!". Clip #58 is "Mamá pidiendo regalos" and turbo heard the gift list. Clip
#36 is about a Welsh village; turbo heard "Villa Trebelin" (the real town is
Villa Trevelin, Chubut) where the caption wrote "villa tv link". On those clips
turbo is more accurate than the reference, so mean WER overstates its errors.

## Where it fails

1. Intentionally distorted joke audio (#64 "Trenpeley Tranpenley"): a made-up
   word repeated. Unintelligible to humans too; WER there is meaningless.
2. Very short noisy clips. The 9 s "#65 Café con leche" came out as "Él tomó
   café con leche, manca yo muy mal."
3. Dialect interjections. Turbo heard "Sí, ahí me avisó" where the audio says
   "Che" (medium heard "Che" correctly).
4. Word-final details: "dale" became "¿vale?".
5. Formatting never stabilises (digits, punctuation, capitals). Normalise before
   matching intents; never match raw text.

## Harness state

| item | value |
|---|---|
| product lines | 660 |
| test lines | 96, thirteen tests green |
| external dependencies | faster-whisper, ctranslate2, numpy, sounddevice, edge-tts |
| fakes | two: the model, the microphone |
| runs | one JSON per run under results/ (git-ignored); numbers above are from those runs |
