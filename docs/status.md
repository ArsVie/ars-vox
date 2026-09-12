# Status — Ars-Vox v2

One page. One product number per phase. No narrative.

## W0 — voice in / voice out

Gate: 30 real utterances from the target speaker, >= 24 correct, median turn < 3 s.

| measurement | value | label |
|---|---|---|
| W0 gate | not measured | needs the real speaker on the real machine |
| baseline clip (WhatsApp voice note, 23 s) | not run | download pending approval |

## Engine comparison — synthetic Spanish audio, CPU int8

Clip: 7.7 s, 20 words, Windows SAPI voice, reference transcript known.
Clean = broadcast wav. 8k = telephone band. Noisy = 8k plus pink noise.

| model | clean | 8k | 8k + noise | RTF clean | RTF noisy | load + warm |
|---|---|---|---|---|---|---|
| tiny | 0.25 | - | - | 0.08 | - | 3.5 s |
| base | 0.40 | - | - | 0.13 | - | - |
| small | 0.20 | 0.20 | 0.40 | 0.52 | 0.55 | 2.2 s |
| medium | 0.20 | - | - | 0.68 | - | 9.1 s |
| large-v3-turbo | 0.10 | 0.05 | 0.10 | 0.62 | 0.82 | 9-15 s |

WER = word error rate against the reference. Lower is better.

## Findings

1. The harness works end to end: real engine, real audio files, WER, latency,
   JSON per run, eleven unit tests green. Product total so far: 683 lines.
2. large-v3-turbo wins on accuracy and holds up under telephone-band noise
   (0.10 against small's 0.40). Turbo is the candidate engine.
3. Turbo on CPU int8 runs at RTF 0.6-1.2. A 4 s utterance costs 2.4-4.8 s, which
   breaks the under 3 s turn budget on CPU alone. The target machine has an RTX
   GPU: measure CUDA before choosing. If CUDA fails, use small and accept the
   accuracy loss, or accept a longer turn.
4. Engine self-confidence does not track errors. Every model reported zero weak
   segments while making 3-6 word errors. Confidence gating is not a safety
   mechanism; the spoken read-back is.
5. Bigger is not monotonically better: base (0.40) is worse than tiny (0.25).
6. Load plus warm-up is 2-15 s per model. This is a once-per-boot cost for a
   resident service, not a per-turn cost. Warm up at startup.
7. Punctuation and capitalisation are unstable across models ("why despues",
   "Record Ame"). Normalise before matching intents; never match on raw text.
