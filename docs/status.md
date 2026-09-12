# Status — Ars-Vox v2

One page. One product number per phase. No narrative.

## W0 — voice in / voice out

Gate: 30 real utterances from the target speaker, >= 24 correct, median turn < 3 s.

| measurement | value | label |
|---|---|---|
| W0 gate | not measured | needs the real speaker on the real machine |
| synthetic self-test (Windows SAPI, 7.7 s, 20 words) | WER: tiny 0.25, base 0.40, small 0.20 | harness check only, not speaker data |
| engine speed, CPU int8 | RTF: tiny 0.10, base 0.13, small 0.31 | 7.7 s clip, cold start excluded |
| baseline clip (WhatsApp voice note, 23 s) | blocked | download needs approval |

### Findings so far

1. The harness works: real engine, real audio file, WER, latency, JSON per run.
2. Engine self-confidence does not track errors. On the self-test the failing
   transcripts still reported no weak segments (mean logprob -0.58). Gating on
   confidence is not enough; the user must hear a read-back.
3. Bigger is not monotonically better on short noisy audio: base scored worse
   than tiny and small.
4. Latency budget: small runs at RTF 0.31 on CPU. A 4 s utterance costs about
   1.2 s of engine time, so the turn budget of under 3 s stays reachable.
