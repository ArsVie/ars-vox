/**
 * Deterministic layout engine — pure TypeScript, no DOM, no side effects.
 *
 * The model NEVER sends pixel coordinates. It selects a layout template,
 * a primary panel, a secondary panel, and a panel action. This engine
 * computes position, size, z-order, animation, and reduced-motion behavior
 * from that small, safe vocabulary.
 */

export type LayoutTemplateId = "focus" | "split";

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
  template: LayoutTemplateId;
  primaryPanel: PanelId | null;
  secondaryPanel: PanelId | null;
  /** When true the UI keeps current panels mounted; only roles change. */
  preserve: boolean;
}

export interface PanelGeometry {
  panel: PanelId;
  role: PanelRole;
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
  template: LayoutTemplateId;
  panels: PanelGeometry[];
  reducedMotion: boolean;
}

export interface ComputeLayoutOptions {
  reducedMotion: boolean;
  /** Panels the user explicitly opened (closed panels are excluded). */
  mounted: ReadonlySet<PanelId>;
  /** Previous layout, used to decide enter/exit animations. */
  previous?: LayoutResult | null;
}

/** The conversation panel is the app's constant anchor; it is always available. */
export const DEFAULT_PRIMARY: PanelId = "conversation";

export function isPanelId(value: unknown): value is PanelId {
  return typeof value === "string" && (KNOWN_PANELS as readonly string[]).includes(value);
}

export function normalizeSpec(spec: LayoutSpec): LayoutSpec {
  const template: LayoutTemplateId = spec.template === "split" ? "split" : "focus";
  const primaryPanel = isPanelId(spec.primaryPanel) ? spec.primaryPanel : DEFAULT_PRIMARY;
  let secondaryPanel: PanelId | null =
    isPanelId(spec.secondaryPanel) && spec.secondaryPanel !== primaryPanel
      ? spec.secondaryPanel
      : null;
  if (template === "focus") secondaryPanel = null;
  return { template, primaryPanel, secondaryPanel, preserve: spec.preserve };
}

function zFor(role: PanelRole): number {
  switch (role) {
    case "primary":
      return 30;
    case "secondary":
      return 20;
    default:
      return 0;
  }
}

function rectFor(
  template: LayoutTemplateId,
  role: PanelRole,
): Pick<PanelGeometry, "x" | "y" | "width" | "height"> {
  if (template === "focus" && role === "primary") {
    return { x: 0.02, y: 0.02, width: 0.96, height: 0.96 };
  }
  if (template === "split") {
    if (role === "primary") return { x: 0.02, y: 0.02, width: 0.62, height: 0.96 };
    if (role === "secondary") return { x: 0.67, y: 0.02, width: 0.31, height: 0.96 };
  }
  // hidden panels are not rendered; geometry is harmless.
  return { x: 0.02, y: 0.02, width: 0.96, height: 0.96 };
}

export function computeLayout(spec: LayoutSpec, opts: ComputeLayoutOptions): LayoutResult {
  const normalized = normalizeSpec(spec);
  const { reducedMotion } = opts;

  // Panels referenced by the spec are mounted by the layout command itself
  // (e.g. "Open a document." applies split + document_editor without a
  // separate panel.open event). Conversation is always mounted.
  const explicit = new Set(opts.mounted);
  if (isPanelId(normalized.primaryPanel)) explicit.add(normalized.primaryPanel);
  if (isPanelId(normalized.secondaryPanel)) explicit.add(normalized.secondaryPanel);
  explicit.add(DEFAULT_PRIMARY);

  let primary = normalized.primaryPanel ?? DEFAULT_PRIMARY;
  if (!explicit.has(primary)) primary = DEFAULT_PRIMARY;
  let secondary: PanelId | null = normalized.secondaryPanel;
  if (secondary !== null && (!explicit.has(secondary) || secondary === primary)) {
    secondary = null;
  }
  // The conversation panel is the app's anchor: in split, when the model
  // names only a primary panel, the conversation fills the secondary slot
  // so the assistant's replies stay visible.
  if (normalized.template === "split" && secondary === null && primary !== DEFAULT_PRIMARY) {
    secondary = DEFAULT_PRIMARY;
  }

  const roles = new Map<PanelId, PanelRole>();
  roles.set(primary, "primary");
  if (secondary) roles.set(secondary, "secondary");
  for (const panel of explicit) {
    if (!roles.has(panel)) roles.set(panel, "hidden");
  }

  const previousRoles = new Map<string, PanelRole>(
    (opts.previous?.panels ?? []).map((g) => [g.panel, g.role]),
  );

  const panels: PanelGeometry[] = [...roles.entries()].map(([panel, role]) => {
    const prevRole = previousRoles.get(panel);
    let animation: PanelAnimation = "none";
    if (!reducedMotion && role !== "hidden") {
      if (prevRole === undefined || prevRole === "hidden") animation = "fade";
      else if (prevRole !== role) animation = "slide";
    }
    return {
      panel,
      role,
      ...rectFor(normalized.template, role),
      zIndex: zFor(role),
      visible: role !== "hidden",
      animation,
    };
  });

  return { template: normalized.template, panels, reducedMotion };
}
