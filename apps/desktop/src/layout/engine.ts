/**
 * Deterministic layout engine — pure TypeScript, no DOM, no side effects.
 *
 * Fixed-template model: the model NEVER sends pixel coordinates. It selects
 * a layout template (focus | split | reading | dashboard), assigns panels to
 * SLOTS (main | side | rail | dock), and the engine owns all geometry, px
 * floors, degrade, slot-affinity, and chrome density. Legacy
 * primary_panel/secondary_panel is mapped to main/side.
 *
 * Invariants:
 *  - main is always populated.
 *  - conversation is the anchor: mounted-but-unassigned -> best remaining slot.
 *  - unknown/legacy templates and over-assigned slots degrade deterministically
 *    (never a silent coerce-to-focus that loses panels).
 *  - no slot renders below its px floor; below-floor templates step down the
 *    ladder dashboard -> reading -> split -> focus.
 */

export type LayoutTemplateId = "focus" | "split" | "reading" | "dashboard";

/** Deprecated aliases accepted on the wire, resolved to canonical templates. */
export type LegacyTemplateAlias = "reference" | "background_media";

export type AnyTemplate = LayoutTemplateId | LegacyTemplateAlias;

export type SlotName = "main" | "side" | "rail" | "dock";

export type ChromeDensity = "full" | "compact" | "rail";

export interface Viewport {
  width: number;
  height: number;
}

/** Panels the product can host. The slice renders conversation + document_editor. */
export const KNOWN_PANELS = [
  "conversation",
  "document_editor",
  "browser",
  "youtube",
  "media",
  "book_reader",
  "news",
  "notes",
  "tasks",
  "reminders",
  "telegram_preview",
  "settings",
] as const;

export type PanelId = (typeof KNOWN_PANELS)[number];

export type PanelRole = "primary" | "secondary" | "hidden";

export type PanelAnimation = "none" | "fade" | "slide";

export interface LayoutSpec {
  template: AnyTemplate;
  primaryPanel: PanelId | null;
  secondaryPanel: PanelId | null;
  /**
   * Slot assignments (wire `slots`). When present it WINS over
   * primary/secondary (slots.main is the source of truth for main).
   * null values mean "leave this slot empty".
   */
  slots?: Partial<Record<SlotName, PanelId | null>>;
  /** When true the UI keeps current panels mounted; only roles change. */
  preserve: boolean;
}

export interface PanelGeometry {
  panel: PanelId;
  role: PanelRole;
  /** The slot this panel occupies, or null when hidden. */
  slot: SlotName | null;
  /** Chrome density derived from slot + rendered px width. */
  density: ChromeDensity;
  /** Conversation composer collapses to icon-only when true. */
  composerCollapsed: boolean;
  /** Conversation composer placeholder hidden (full density, slot too
   * narrow to fit it unclipped — deterministic, engine-computed). */
  placeholderHidden: boolean;
  /** All geometry is a fraction (0..1) of the content viewport. */
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  visible: boolean;
  animation: PanelAnimation;
}

export interface LayoutResult {
  /** The RESOLVED template (after alias resolution + px-floor degrade). */
  template: LayoutTemplateId;
  panels: PanelGeometry[];
  reducedMotion: boolean;
  /** Set when the px-floor ladder stepped below the requested template. */
  degradedFrom?: LayoutTemplateId;
}

export interface ComputeLayoutOptions {
  reducedMotion: boolean;
  /** Real content-viewport size in px (used for px floors + density). */
  viewport: Viewport;
  /** Panels the user explicitly opened (closed panels are excluded). */
  mounted: ReadonlySet<PanelId>;
  /** Previous layout, used to decide enter/exit animations. */
  previous?: LayoutResult | null;
}

/** The conversation panel is the app's constant anchor; it is always available. */
export const DEFAULT_PRIMARY: PanelId = "conversation";

/** Canonical template -> offered slots, in priority order (keep-first). */
export const TEMPLATE_SLOTS: Record<LayoutTemplateId, SlotName[]> = {
  focus: ["main"],
  split: ["main", "side"],
  reading: ["main", "side", "dock"],
  dashboard: ["main", "side", "dock", "rail"],
};

/**
 * Hard px floors (ratified 2026-08-07, UI workstream): a slot that cannot
 * meet its floor forces the deterministic degrade ladder. main is sized for
 * readable content; side for a usable conversation; rail/dock stay compact.
 */
export const MIN_SLOT_PX: Record<SlotName, { width: number; height: number }> = {
  main: { width: 480, height: 360 },
  side: { width: 280, height: 240 },
  rail: { width: 240, height: 240 },
  dock: { width: 240, height: 64 },
};

/**
 * Minimum slot px width for the FULL-density composer to render its
 * placeholder unclipped (input + placeholder + mic + labeled send).
 * Below this the placeholder is hidden by the engine (advisor round-2:
 * a half-clipped placeholder reads as broken; hiding is deterministic
 * and width-aware without container queries).
 */
export const PLACEHOLDER_MIN_PX = 540;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Slot geometry per template (fractions of the content viewport). */
const TEMPLATE_RECTS: Record<LayoutTemplateId, Partial<Record<SlotName, Rect>>> = {
  focus: {
    main: { x: 0.02, y: 0.02, width: 0.96, height: 0.96 },
  },
  split: {
    main: { x: 0.02, y: 0.02, width: 0.62, height: 0.96 },
    side: { x: 0.67, y: 0.02, width: 0.31, height: 0.96 },
  },
  reading: {
    main: { x: 0.02, y: 0.02, width: 0.62, height: 0.96 },
    side: { x: 0.67, y: 0.02, width: 0.31, height: 0.6 },
    dock: { x: 0.67, y: 0.66, width: 0.31, height: 0.32 },
  },
  dashboard: {
    rail: { x: 0.02, y: 0.02, width: 0.16, height: 0.96 },
    main: { x: 0.21, y: 0.02, width: 0.5, height: 0.96 },
    side: { x: 0.74, y: 0.02, width: 0.24, height: 0.6 },
    dock: { x: 0.74, y: 0.66, width: 0.24, height: 0.32 },
  },
};

/**
 * Slot affinity per panel type — the engine's opinion on where each panel
 * belongs. First entry is the best slot; later entries are fallbacks.
 * The engine reassigns semantically wrong placements instead of rendering
 * them where the model asked.
 */
const PANEL_AFFINITY: Record<PanelId, SlotName[]> = {
  conversation: ["side", "main", "rail", "dock"],
  document_editor: ["main", "side", "dock", "rail"],
  browser: ["main", "side", "dock", "rail"],
  youtube: ["dock", "main", "side", "rail"],
  media: ["dock", "main", "side", "rail"],
  book_reader: ["main", "side", "dock", "rail"],
  news: ["main", "side", "dock", "rail"],
  notes: ["rail", "side", "main", "dock"],
  tasks: ["rail", "side", "main", "dock"],
  reminders: ["rail", "side", "main", "dock"],
  telegram_preview: ["side", "rail", "main", "dock"],
  settings: ["side", "main", "rail", "dock"],
};

const TEMPLATE_ALIASES: Record<LegacyTemplateAlias, LayoutTemplateId> = {
  reference: "reading",
  background_media: "dashboard",
};

/** Degrade ladder, ascending: focus < split < reading < dashboard. */
const DEGRADE_LADDER: readonly LayoutTemplateId[] = ["focus", "split", "reading", "dashboard"];

export function isPanelId(value: unknown): value is PanelId {
  return typeof value === "string" && (KNOWN_PANELS as readonly string[]).includes(value);
}

export function isSlotName(value: unknown): value is SlotName {
  return value === "main" || value === "side" || value === "rail" || value === "dock";
}

export function resolveTemplate(template: string): LayoutTemplateId {
  if (template === "focus" || template === "split" || template === "reading" || template === "dashboard") {
    return template;
  }
  const alias = TEMPLATE_ALIASES[template as LegacyTemplateAlias];
  if (alias) return alias;
  // Unknown template: explicit deterministic fallback (never silent coerce
  // that drops panels — the assignment logic keeps mounted panels visible).
  return "focus";
}

export function normalizeSpec(spec: LayoutSpec): LayoutSpec & { template: LayoutTemplateId } {
  const template = resolveTemplate(spec.template);
  const primaryPanel = isPanelId(spec.primaryPanel) ? spec.primaryPanel : DEFAULT_PRIMARY;
  let secondaryPanel: PanelId | null =
    isPanelId(spec.secondaryPanel) && spec.secondaryPanel !== primaryPanel
      ? spec.secondaryPanel
      : null;
  if (template === "focus") secondaryPanel = null;
  return { template, primaryPanel, secondaryPanel, slots: spec.slots, preserve: spec.preserve };
}

function zForSlot(slot: SlotName | null): number {
  switch (slot) {
    case "main":
      return 30;
    case "side":
      return 20;
    case "dock":
      return 16;
    case "rail":
      return 12;
    default:
      return 0;
  }
}

function densityFor(slot: SlotName, pxWidth: number): ChromeDensity {
  switch (slot) {
    case "rail":
      return "rail";
    case "dock":
      return "compact";
    case "main":
      return pxWidth >= MIN_SLOT_PX.main.width ? "full" : "compact";
    case "side":
      return pxWidth >= 360 ? "full" : "compact";
  }
}

/** Whether the conversation composer collapses to icon-only controls. */
function composerCollapsedFor(panel: PanelId, density: ChromeDensity): boolean {
  return panel === DEFAULT_PRIMARY && density !== "full";
}

/** Whether the conversation placeholder is hidden because the full-density
 * composer is too narrow to fit it unclipped. Compact/rail already hide the
 * placeholder via the collapsed composer, so this only fires at full. */
function placeholderHiddenFor(
  panel: PanelId,
  density: ChromeDensity,
  pxWidth: number,
): boolean {
  return panel === DEFAULT_PRIMARY && density === "full" && pxWidth < PLACEHOLDER_MIN_PX;
}

function fitsFloor(template: LayoutTemplateId, viewport: Viewport): boolean {
  const rects = TEMPLATE_RECTS[template];
  for (const slot of TEMPLATE_SLOTS[template]) {
    const rect = rects[slot];
    if (!rect) return false;
    const floor = MIN_SLOT_PX[slot];
    if (rect.width * viewport.width + 0.001 < floor.width) return false;
    if (rect.height * viewport.height + 0.001 < floor.height) return false;
  }
  return true;
}

/** Walk the ladder down from the requested template until every slot fits. */
function resolveWithDegrade(
  requested: LayoutTemplateId,
  viewport: Viewport,
): { template: LayoutTemplateId; degradedFrom?: LayoutTemplateId } {
  const start = DEGRADE_LADDER.indexOf(requested);
  for (let i = start; i >= 0; i -= 1) {
    const candidate = DEGRADE_LADDER[i];
    if (fitsFloor(candidate, viewport)) {
      return { template: candidate, degradedFrom: i < start ? requested : undefined };
    }
  }
  return { template: "focus", degradedFrom: start > 0 ? requested : undefined };
}

/** First slot in the panel's affinity list that is offered AND currently empty. */
function bestEmptyOffered(
  panel: PanelId,
  offered: ReadonlySet<SlotName>,
  assigned: ReadonlyMap<SlotName, PanelId>,
): SlotName | null {
  for (const slot of PANEL_AFFINITY[panel]) {
    if (offered.has(slot) && !assigned.has(slot)) return slot;
  }
  return null;
}

interface Assignment {
  assigned: Map<SlotName, PanelId>;
  hidden: PanelId[];
}

/**
 * Deterministic slot assignment:
 *  1. requested mapping (slots win over primary/secondary) — model's
 *     explicit placement is the base; assignments to un-offered slots drop
 *     (those panels stay candidates for fill).
 *  2. affinity correction — one pass over requested entries in slot order;
 *     a panel moves only to a strictly-better offered slot that is empty
 *     (cascades are impossible: moves only go DOWN the affinity list).
 *  3. mandatory main — main is always populated; unplaced candidates first,
 *     then placed ones (displacement), affinity best, ties by candidate order.
 *  4. conversation anchor — mounted-but-unassigned conversation takes its
 *     best slot per affinity, displacing the occupant if every slot is full.
 *  5. fill remaining empty slots panel-driven (KNOWN_PANELS order, each
 *     panel takes its best empty offered slot).
 *  6. everything left over is hidden.
 */
function assignSlots(template: LayoutTemplateId, spec: LayoutSpec, mounted: ReadonlySet<PanelId>): Assignment {
  const offered = TEMPLATE_SLOTS[template];
  const offeredSet = new Set<SlotName>(offered);

  // 1. requested mapping (fixed slot order for determinism)
  const requested: Array<[SlotName, PanelId]> = [];
  if (spec.slots) {
    for (const slot of ["main", "side", "rail", "dock"] as SlotName[]) {
      const panel = spec.slots[slot];
      if (isPanelId(panel)) requested.push([slot, panel]);
    }
    if (!requested.some(([slot]) => slot === "main") && isPanelId(spec.primaryPanel)) {
      requested.push(["main", spec.primaryPanel]);
    }
  } else {
    if (isPanelId(spec.primaryPanel)) requested.push(["main", spec.primaryPanel]);
    if (isPanelId(spec.secondaryPanel)) requested.push(["side", spec.secondaryPanel]);
  }

  const assigned = new Map<SlotName, PanelId>();
  const placed = new Set<PanelId>();
  for (const [slot, panel] of requested) {
    if (placed.has(panel)) continue;
    if (offeredSet.has(slot)) {
      assigned.set(slot, panel);
      placed.add(panel);
    }
  }

  // 2. affinity correction — one pass, strictly-better empty slot only
  for (const [slot, panel] of requested) {
    if (assigned.get(slot) !== panel) continue; // already corrected or dropped
    const currentIndex = PANEL_AFFINITY[panel].indexOf(slot);
    const best = bestEmptyOffered(panel, offeredSet, assigned);
    if (best && PANEL_AFFINITY[panel].indexOf(best) < currentIndex) {
      assigned.delete(slot);
      assigned.set(best, panel);
    }
  }

  // candidate order: requested panels first (in slot order), then the rest
  // of the mounted set in KNOWN_PANELS order.
  const requestedPanels = requested.map(([, panel]) => panel);
  const candidates: PanelId[] = [];
  for (const panel of requestedPanels) {
    if (!candidates.includes(panel)) candidates.push(panel);
  }
  for (const panel of KNOWN_PANELS) {
    if (mounted.has(panel) && !candidates.includes(panel)) candidates.push(panel);
  }

  const affinityIndex = (panel: PanelId, slot: SlotName): number => PANEL_AFFINITY[panel].indexOf(slot);

  // 3. mandatory main
  if (!assigned.has("main")) {
    // unplaced candidates first (their best slot is main or main is all that
    // remains), then any candidate by displacement — main must never be empty.
    let best: PanelId | null = null;
    let bestIndex = Infinity;
    for (const panel of candidates) {
      if (panel === assigned.get("main")) continue;
      const index = affinityIndex(panel, "main");
      if (index < 0) continue;
      const unplaced = !placed.has(panel);
      const rank = index * 2 + (unplaced ? 0 : 1);
      if (rank < bestIndex) {
        best = panel;
        bestIndex = rank;
      }
    }
    if (best) {
      for (const [slot, panel] of assigned) {
        if (panel === best) assigned.delete(slot); // displacement frees a slot
      }
      assigned.set("main", best);
      placed.add(best);
    }
  }

  // 4. conversation anchor (displaces if every slot is full)
  if (mounted.has(DEFAULT_PRIMARY) && !placed.has(DEFAULT_PRIMARY)) {
    let target: SlotName | null = null;
    for (const slot of PANEL_AFFINITY[DEFAULT_PRIMARY]) {
      if (!offeredSet.has(slot)) continue;
      if (!assigned.has(slot)) {
        target = slot;
        break;
      }
      if (target === null) target = slot; // fallback: best occupied slot
    }
    if (target) {
      const displaced = assigned.get(target);
      if (displaced) placed.delete(displaced);
      assigned.set(target, DEFAULT_PRIMARY);
      placed.add(DEFAULT_PRIMARY);
    }
  }

  // 5. fill remaining empty slots (panel-driven, each takes best empty slot)
  for (const panel of KNOWN_PANELS) {
    if (!mounted.has(panel) || placed.has(panel)) continue;
    const best = bestEmptyOffered(panel, offeredSet, assigned);
    if (best) {
      assigned.set(best, panel);
      placed.add(panel);
    }
  }

  // 6. hidden: mounted panels without a slot (KNOWN_PANELS order)
  const hidden = KNOWN_PANELS.filter((p) => mounted.has(p) && !placed.has(p));
  return { assigned, hidden };
}

export function computeLayout(spec: LayoutSpec, opts: ComputeLayoutOptions): LayoutResult {
  const normalized = normalizeSpec(spec);
  const { reducedMotion, viewport } = opts;

  // Panels referenced by the spec are mounted by the layout command itself
  // (e.g. "Open a document." applies split + document_editor without a
  // separate panel.open event). Conversation is always mounted.
  const explicit = new Set(opts.mounted);
  if (isPanelId(normalized.primaryPanel)) explicit.add(normalized.primaryPanel);
  if (isPanelId(normalized.secondaryPanel)) explicit.add(normalized.secondaryPanel);
  if (normalized.slots) {
    for (const slot of ["main", "side", "rail", "dock"] as SlotName[]) {
      const panel = normalized.slots[slot];
      if (isPanelId(panel)) explicit.add(panel);
    }
  }
  explicit.add(DEFAULT_PRIMARY);

  const { template, degradedFrom } = resolveWithDegrade(normalized.template, viewport);
  const { assigned, hidden } = assignSlots(template, normalized, explicit);
  const rects = TEMPLATE_RECTS[template];

  const previousRoles = new Map<string, PanelRole>(
    (opts.previous?.panels ?? []).map((g) => [g.panel, g.role]),
  );

  const panels: PanelGeometry[] = [];
  for (const slot of TEMPLATE_SLOTS[template]) {
    const panel = assigned.get(slot);
    if (!panel) continue;
    const rect = rects[slot] ?? rects.main!;
    const pxWidth = rect.width * viewport.width;
    const density = densityFor(slot, pxWidth);
    const role: PanelRole = slot === "main" ? "primary" : "secondary";
    const prevRole = previousRoles.get(panel);
    let animation: PanelAnimation = "none";
    if (!reducedMotion) {
      if (prevRole === undefined || prevRole === "hidden") animation = "fade";
      else if (prevRole !== role) animation = "slide";
    }
    panels.push({
      panel,
      role,
      slot,
      density,
      composerCollapsed: composerCollapsedFor(panel, density),
      placeholderHidden: placeholderHiddenFor(panel, density, pxWidth),
      ...rect,
      zIndex: zForSlot(slot),
      visible: true,
      animation,
    });
  }

  const fallbackRect = rects.main ?? { x: 0.02, y: 0.02, width: 0.96, height: 0.96 };
  for (const panel of hidden) {
    const prevRole = previousRoles.get(panel);
    panels.push({
      panel,
      role: "hidden",
      slot: null,
      density: "full",
      composerCollapsed: false,
      placeholderHidden: false,
      ...fallbackRect,
      zIndex: 0,
      visible: false,
      animation: prevRole !== undefined && prevRole !== "hidden" && !reducedMotion ? "fade" : "none",
    });
  }

  return { template, panels, reducedMotion, ...(degradedFrom ? { degradedFrom } : {}) };
}
