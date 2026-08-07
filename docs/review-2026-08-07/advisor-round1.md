# Advisor review — Round 1 (claude-opus-4.8, 2026-08-07)

Screenshots reviewed: `docs/review-2026-08-07/01-focus.png` .. `04-dashboard.png`
(pre-fix state, after Workstream A1-A8 + ContentPanel).

## Verdict summary

Coherent dark "agent harness" language: one blue accent, elevated rounded
cards, letter-spaced headers, presence strip, large high-contrast body text.
Main problems: empty content states, a weak STOP control, composer/slot
inconsistencies that undermine the fixed-template model.

## P0 — Critical

1. STOP control too weak for voice-first + older user: small, low-contrast,
   outlined, far right. → filled high-contrast button ≥48px, red-tinted
   (stop is a legitimate exception to the single-blue system), anchored
   where muscle memory can find it.
2. Empty panels read as broken: DOCUMENTO/NOTICIAS/tasks rail/media dock
   are voids. → explicit empty/loading states (centered icon + Spanish
   line). Media dock has NO playback controls (no pipeline yet — flagged
   for when it exists).
3. Tasks rail does not read as a rail: tiny checkbox glyph, no label, no
   items → header (icon + TAREAS) + real rows eventually; even a
   placeholder communicates purpose.
4. Composer text truncates instead of collapsing ("Escribe una peticiór",
   "Escr") → enforce the collapse rule below the width floor; never a
   half-clipped placeholder.

## P1 — High

5. Main doesn't consistently out-rank side (04: conversation carries the
   only saturated color; main/side share header weight + elevation).
6. Panel elevation too subtle; cards barely lift off the page.
7. Composer geometry inconsistent across templates → ordered degrade,
   mic button size/position stable.
8. Assistant bubbles ragged (each hugs its text) → consistent max-width.

## P2 — Medium

9. Icon-only chrome (expand) below minimum touch target → ≥44px.
10. Redundant media-dock title (header + body duplicate).
11. TÚ label low contrast on the blue bubble.
12. Focus template wastes the lower half — leverage mic hero + suggestion
    chips (empty state already does this when there are no messages).
13. Presence strip right side under-weighted.

## What's working (keep)

Single-blue accent discipline; user bubble as the one saturated element;
large high-contrast Spanish copy; Escuchando presence pill; width-driven
main/side reading in split/reading; consistent premium header pattern.

## Fix order (advisor)

1. STOP prominence (P0-1) → 2. Media dock controls + empty states (P0-2)
→ 3. Tasks rail identity (P0-3) → 4. Composer collapse / stop truncation
(P0-4) → 5. Main-vs-side hierarchy + elevation (P1-5/6).

---
Round-2 delta applied (2026-08-07): STOP moved to the left cluster, filled
red-tinted 40px; ContentPanel per-type empty states (icon + Spanish hint);
rail header keeps icon + one-word label; composer-collapsed hides
placeholder (no half-clipped text); non-main slots flattened (elevation
step); assistant bubbles min-width 260px; panel-action 44px hit area;
TÚ label 0.95 white; media dock body no longer duplicates header title;
panel-2 lightened + stronger panel shadow.
