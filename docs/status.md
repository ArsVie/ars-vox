# Status — Ars-Vox v2

One page. One product number per phase. No narrative.

## W0 — voice in / voice out

Gate: 30 real utterances from the target speaker, >= 24 correct, median turn < 3 s.
Not measured yet: needs the real speaker on the real machine with a real microphone.

## Real audio baseline — 12 Argentine WhatsApp voice notes

Source: YouTube channel "Reíte pue mi gente", the "Audio de WhatsApp" series
(downloaded with the owner's approval). Total 270 s of compressed mono speech,
casual Rioplatense Spanish, the same domain the assistant will meet in practice.
Reference: the channel's own auto-caption, which is a SECOND speech engine and
not ground truth. So these numbers measure agreement, and they include the
reference's own mistakes.

| model | mean WER | median | worst | mean RTF (CPU int8) |
|---|---|---|---|---|
| tiny | 0.633 | 0.538 | 1.55 | 0.069 |
| small | 0.424 | 0.336 | 1.55 | 0.187 |
| large-v3-turbo | 0.295 | 0.233 | 0.75 | 0.416 |

Per-clip, turbo: best 0.089, worst 0.75. Small beat turbo on one clip.

### The transcripts are the real evidence, and they read as correct Spanish

Turbo, on a 49 s clip (captions say "o la vecina cómo estás que el calor..."):

> Hola vecina, ¿cómo estás? ¡Qué calor que hace! ¡Por favor! Por eso te mando
> un mensaje. Te quería contar que cambié el aire acondicionado a mi pieza.
> Ahora puse uno de 5.000 frigorías... Lo pongo en 20, parece Siberia mi pieza.
> Hay que dormir tapaditos. Así que bueno, a lo mejor si estás sufriendo mucho
> el calor y tenés ganas, te vendo el aire acondicionado viejo, ¿vale?

Independent check: the video titles match what the model heard, and the caption
files do not. Clip #57 is titled "Sujetate la jeta" and turbo heard "¡Sujétate
la jeta, loca!". Clip #58 is "Mamá pidiendo regalos" and turbo heard the gift
list. Clip #36 is titled about a Welsh village; turbo heard "Villa Trebelin"
(the real town is Villa Trevelin, Chubut). On those clips turbo is more accurate
than the reference, so mean WER understates its real quality.

### Where it fails

1. Intentionally distorted joke audio. Clip #64 ("Trenpeley Tranpenley") is a
   made-up word repeated; both models mangle it. WER is meaningless there.
2. Very short clips with noise. The 9 s "#65 Café con leche" came out as
   "Él tomó café con leche, manca yo muy mal."
3. Word-final details: "dale" became "¿vale?".
4. Formatting is never stable (punctuation, capitalisation, digits vs words).
   Normalise before matching intents; never match raw text.

## Decision this data supports

Use large-v3-turbo. It is the only model whose median error rate is low enough
to be safe for a user who cannot read an error message.

Blocker: turbo on CPU runs at RTF ~0.42, so a 30 s utterance costs 12 s of
engine time and breaks the under 3 s turn budget. tiny's RTF is 0.069 but its
error rate is 0.63, which is unusable. The target machine has an RTX GPU:
measure CUDA first (Windows side; WSL has no usable libcublas). If CUDA works,
turbo should land near RTF 0.03, about one second per utterance.

## Harness state

| item | value |
|---|---|
| product lines | 614 |
| test lines | 96, thirteen tests green |
| external dependencies | faster-whisper, numpy, sounddevice, edge-tts, yt-dlp (tooling) |
| fakes | two: the model, the microphone |
| evidence artifacts | one JSON per run, one run log, both under results/ (git-ignored) |
