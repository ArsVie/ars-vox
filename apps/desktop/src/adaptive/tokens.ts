/**
 * Design-token NAMING contract (UI-000, 2026-08-07).
 *
 * UI-000 freezes the token NAMES every UI worker consumes; UI-104 implements
 * their VALUES. Workers must NOT invent token names outside this catalog —
 * that is what makes surfaces look like one application instead of five.
 *
 * Naming rules (frozen):
 *   - Groups below are exhaustive for the redesign. No new groups.
 *   - Tokens are kebab-case, prefixed by group.
 *   - Semantic scale, not arbitrary numbers: -xs -sm -md -lg -xl (as needed).
 *   - Strong/normal/subordinate hierarchy is expressed by -strong/-normal/
 *     -subordinate suffixes on typography tokens.
 *   - Values are implementation (UI-104); names are contract (here).
 */

export const TOKEN_GROUPS = [
  "typography",
  "spacing",
  "divider",
  "surface",
  "radius",
  "control",
  "icon",
  "state",
] as const;

export type TokenGroup = (typeof TOKEN_GROUPS)[number];

/** Canonical token names — the complete catalog UI-104 must implement. */
export const TOKEN_NAMES: Record<TokenGroup, readonly string[]> = {
  typography: [
    "typography-display-strong",
    "typography-display-normal",
    "typography-title-strong",
    "typography-title-normal",
    "typography-body-strong",
    "typography-body-normal",
    "typography-body-subordinate",
    "typography-caption-strong",
    "typography-caption-normal",
    "typography-caption-subordinate",
  ],
  spacing: [
    "spacing-xs",
    "spacing-sm",
    "spacing-md",
    "spacing-lg",
    "spacing-xl",
  ],
  divider: ["divider-strong", "divider-normal", "divider-subordinate"],
  surface: [
    "surface-app",
    "surface-region",
    "surface-region-active",
    "surface-overlay",
    "surface-card",
  ],
  radius: ["radius-xs", "radius-sm", "radius-md", "radius-lg", "radius-pill"],
  control: [
    "control-height-sm",
    "control-height-md",
    "control-height-lg",
    "control-touch-target",
  ],
  icon: ["icon-size-sm", "icon-size-md", "icon-size-lg"],
  state: [
    "state-focus-ring",
    "state-hover",
    "state-active",
    "state-disabled",
    "state-reduced-motion",
  ],
};

/** Flat set for cheap lookup (workers may only use names in this set). */
export const ALL_TOKEN_NAMES: ReadonlySet<string> = new Set(
  Object.values(TOKEN_NAMES).flat(),
);

export function isTokenName(name: string): boolean {
  return ALL_TOKEN_NAMES.has(name);
}
