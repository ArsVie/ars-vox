# Ars-Vox v2

A local-first voice assistant for one elderly Spanish-speaking user.
Voice in, voice out, five abilities, one always-visible stop control.

Refactor of `C:\dev\ars-vox` (archived). Plan: `C:\dev\ars-vox-refactor-plan.md`.
Direction: arXiv 2609.00006 (harness anatomy, seven subsystems) and the
DeepSeek Harness source layout.

## Shape

```
services/arsvox/   the agent runtime, one module per harness subsystem
apps/cli/          headless driver — the primary development surface
apps/desktop/      thin Electron client over the same wire
tests/             <= 60% of product lines, checked in CI
docs/subsystems/   one page per subsystem, <= 120 lines each
docs/status.md     one page, one product number per phase
```

## Waves

| wave | build | gate |
|---|---|---|
| W0 | voice in/out, push-to-talk, harness | 30 real utterances, >= 24 correct, median turn < 3 s |
| W1 | headless agent loop | prefix cache hit > 0, session resumes from the event log |
| W2 | safety floor, reminders that survive power-off | deny-list green, stop works offline, reminder fires with app closed |
| W3 | desktop shell | socket unplug/replug mid-turn, UI matches the log |
| W4 | five abilities complete | 30-utterance number re-measured on the desktop app |
| W5 | installer, pilot | two weeks of unaided tasks with the real user |

## Run (spike)

```bash
# transcribe any audio file with the real engine
python -m apps.cli.arsvox_cli transcribe clip.m4a --model small

# W0 baseline: score several models against a reference transcript
python tools/stt_baseline.py clip.m4a --reference reference.txt --models tiny base small
```
