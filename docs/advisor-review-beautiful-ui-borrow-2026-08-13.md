# Adversarial UI/UX Review — ars-vox

You borrowed a design language that is fundamentally hostile to your user. The reference (image 1) is an *AI-native gallery aesthetic*: ultra-low-contrast gray-on-black text, tiny type, hairline/dashed dividers, monospace timers, dense micro-labels. That's optimized for young designers admiring a portfolio — the **exact opposite** of large-text / high-contrast / reduced-motion for an elderly user. Most problems below trace back to inheriting that aesthetic uncritically.

---

## P0 — Broken / blocking (fix first)

**1. Header wordmark collides with panel titles.** In *both* implementation shots the "ARSVOX" logo is overprinted on top of the adjacent panel title — top-left reads as garbled `ARS VOX | WORLDS 2025…` (image 2) and `ARS VOX / TAREAS` (image 3). Two text layers occupy the same pixels. This is a z-index/layout bug and it's the first thing the eye hits. Any elderly user will read it as "broken." Give the brand its own reserved, non-overlapping region.

**2. Primary action is clipped.** In the tasks-primary view (image 3) the bottom-right **"Enviar"** button is cut to just "E…" — the conversation column's action bar is overflowing/occluded by the video panel. The single most important control (send) is physically truncated. Unacceptable for the primary interaction path.

**3. Global contrast fails the brief.** ASISTENTE bubbles are dark-gray on near-black; timestamps, uppercase labels (`CONVERSACIÓN`, `TÚ`, `MARKDOWN`), and secondary text are all low-luminance gray. None of this is plausibly ≥4.5:1, and your user needs closer to 7:1. You advertised "high-contrast" but shipped the reference's whisper-gray palette. Assistant bubbles especially need a lighter surface + near-white body text.

---

## P1 — High impact

**4. Raw ISO timestamps.** Task rows show `2026-08-14T08:00:00`. That's a machine string, in low-contrast gray, for a user who wants clarity. Humanize and localize: **"jueves 14 ago · 8:00"**. The `T` and seconds are noise.

**5. Ambiguous task-row affordances.** Each row has a left empty circle (checkbox?), the metadata cluster, *then a second empty ring* before a tiny `>` chevron. Two circles per row with no labels = which one completes the task? What's the ring — avatar, spinner, second control? The chevron is small, gray, and doesn't communicate "opens details." Collapse to one obvious, labeled complete control + one obvious "open" affordance with visible text, not a 12px glyph.

**6. Irrelevant video owns the visual hierarchy.** A full-bleed esports thumbnail — five high-contrast faces, YouTube play button, motion — dominates the frame in *both* layouts, and in image 2 it's the largest panel. For a voice assistant helping with medicine/breakfast tasks, the highest-salience element is unrelated entertainment. It out-shouts the actual assistant reply and task list. De-emphasize, shrink, or make it collapsible; the user's tasks/answers should carry the most visual weight. Autoplaying video also violates the reduced-motion requirement.

**7. Columns too narrow → choppy wrapping.** The conversation and the right "…DE AVENA" doc panel wrap after 3–4 words ("Crea una lista con 3 / tareas para mañana por / la mañana"). Short ragged lines are measurably harder to read and worse for aging vision. Three simultaneous panels is one too many at this width — the adaptive layout should drop to two and let text breathe (~45–75 chars/line).

---

## P2 — Medium

**8. Task rows waste horizontal space / force eye-travel.** Title is hard-left; date + chip + controls are hard-right with a vast dead gap between. Elderly eyes must saccade across the full width to connect "Regar las plantas" with its status. Tighten into a left-aligned grid so title, date, and status read as one unit.

**9. Leading-ellipsis document title.** The right panel header `…DE AVENA` truncates the *front* of "Receta de avena," which is the worst place to cut — the user can't tell what the doc is. Show the full title or truncate the tail.

**10. Micro uppercase labels.** `CONVERSACIÓN / ASISTENTE / TÚ / MARKDOWN` are tiny, tracked-out, low-contrast caps. Uppercase reduces word-shape legibility for older readers. Use larger sentence-case with real contrast.

**11. Verify the "redundant status" actually helps.** Icon + chip + color is genuinely good for this user *if* each state is visually distinct. Here every visible task is "Pendiente" in the same neutral gray chip — so redundancy currently conveys nothing, and the chip contrast is weak. Confirm En curso / Completadas use clearly different hue **and** shape/icon (never color alone), and that all chips clear contrast minimums.

**12. Touch/click targets too small.** Fullscreen, close (×), the stop-square on "Escuchando 0:01", tab count badges, and the row chevron are all tiny — poor for reduced motor precision. Enlarge to a consistent ~44px hit area.

---

## P3 — Polish

- **Reduced-motion:** strip shimmer/pulse/spinner idioms carried over from the reference's "Loading State / Churning" components; the borrowed pixel-grid loader and animated timer directly conflict with the brief.
- **Radius consistency:** fully-rounded capsule task rows vs. rounded-rect bubbles vs. pill chips read as three unrelated systems. Pick one radius scale.
- **Focus states:** no visible keyboard/focus ring anywhere — needed for accessibility.

---

## The one structural correction
Stop treating the reference as a style source and start treating it as an *anti-pattern*. Your top three fixes — **(1)** kill the header overlap, **(2)** un-clip "Enviar," **(3)** lift every text layer to real high contrast — will do more for this user than any amount of chip/row refinement. Then demote the video and widen the columns.

