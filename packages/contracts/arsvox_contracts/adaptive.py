"""Adaptive UI contract — frozen by UI-000 (2026-08-07).

The adaptive workspace lets the agent choose the current layout template,
which activity occupies each role, and an allowed proportion. This module
is the SINGLE SOURCE OF TRUTH for that contract:

  * SurfaceRole / AdaptiveTemplate / Proportion enums (mirrored in TS),
  * LayoutSpec — the ONLY shape the agent may produce (semantic only:
    template + surface-role assignments + optional proportion; NO pixels,
    NO CSS, NO coordinates),
  * SurfaceRegistration — the interface surfaces must satisfy to be placed,
  * validate_layout_spec() — deterministic validation applied before ANY
    layout change is applied.

Invariants (frozen, see docs/adaptive-ui-contract.md):
  * Exactly one primary surface unless the template explicitly supports
    equal split (SPLIT allows two primaries).
  * No duplicate surface assignment.
  * Only registered surfaces may be placed.
  * Persistent surfaces are controlled by the shell, not template slots.
  * Layout implementation determines actual pixel geometry.
  * Surface state must not be reset merely because its role or slot changes.
"""

from enum import Enum

from pydantic import BaseModel, Field, model_validator


class SurfaceRole(str, Enum):
    """Semantic role a surface may occupy at a given moment."""

    PRIMARY = "primary"
    COMPANION = "companion"
    SUPPORT = "support"
    PERSISTENT = "persistent"


class AdaptiveTemplate(str, Enum):
    """Allowed adaptive compositions. Geometry is owned by the layout
    implementation (UI-102), never by the agent."""

    FOCUS = "focus"
    SIDECAR = "sidecar"
    STACK = "stack"
    SPLIT = "split"
    TRIPLE = "triple"


class Proportion(str, Enum):
    """Allowed relative size of the primary region."""

    NARROW = "narrow"
    BALANCED = "balanced"
    WIDE = "wide"


#: Templates that explicitly support equal split (two primaries allowed).
EQUAL_SPLIT_TEMPLATES = frozenset({AdaptiveTemplate.SPLIT})

#: Slots each template offers (semantic names; geometry is implementation's).
#: Persistent surfaces are NOT template slots — the shell owns them.
TEMPLATE_SLOTS: dict[AdaptiveTemplate, tuple[str, ...]] = {
    AdaptiveTemplate.FOCUS: ("main",),
    AdaptiveTemplate.SIDECAR: ("main", "side"),
    AdaptiveTemplate.STACK: ("main", "side"),
    AdaptiveTemplate.SPLIT: ("main", "side"),
    AdaptiveTemplate.TRIPLE: ("main", "side", "rail"),
}

#: Roles the agent may assign through LayoutSpec (persistent is shell-owned).
ASSIGNABLE_ROLES: frozenset[SurfaceRole] = frozenset(
    {SurfaceRole.PRIMARY, SurfaceRole.COMPANION, SurfaceRole.SUPPORT}
)


class LayoutAssignment(BaseModel):
    """One surface placed in one role at one semantic slot."""

    surface_id: str = Field(min_length=1)
    role: SurfaceRole
    slot: str = Field(min_length=1)


class LayoutSpec(BaseModel):
    """The ONLY layout shape the agent may produce.

    Semantic composition only — template, assignments, optional proportion.
    No coordinates, no CSS, no pixel values anywhere in this shape.
    """

    template: AdaptiveTemplate
    assignments: list[LayoutAssignment] = Field(min_length=1)
    proportion: Proportion | None = None

    @model_validator(mode="after")
    def _exactly_one_primary(self) -> "LayoutSpec":
        primaries = [a for a in self.assignments if a.role is SurfaceRole.PRIMARY]
        if self.template in EQUAL_SPLIT_TEMPLATES:
            if len(primaries) < 1 or len(primaries) > 2:
                raise ValueError(
                    "split template requires one or two primary surfaces (equal split)"
                )
        elif len(primaries) != 1:
            raise ValueError("exactly one primary surface is required")
        return self

    @model_validator(mode="after")
    def _no_duplicate_surface_assignment(self) -> "LayoutSpec":
        ids = [a.surface_id for a in self.assignments]
        if len(ids) != len(set(ids)):
            raise ValueError("a surface may be assigned at most once per layout")
        return self

    @model_validator(mode="after")
    def _assignable_roles_only(self) -> "LayoutSpec":
        for a in self.assignments:
            if a.role is SurfaceRole.PERSISTENT:
                raise ValueError(
                    "persistent surfaces are shell-controlled, not template slots"
                )
        return self

    @model_validator(mode="after")
    def _slots_match_template(self) -> "LayoutSpec":
        allowed = TEMPLATE_SLOTS[self.template]
        for a in self.assignments:
            if a.slot not in allowed:
                raise ValueError(
                    f"slot {a.slot!r} is not offered by template {self.template.value!r} "
                    f"(offers {list(allowed)})"
                )
        return self


class SurfaceRegistration(BaseModel):
    """Contract a surface must satisfy to be placeable by the layout.

    ``surface_id`` is the surface's stable identity — it does NOT change
    when the surface moves between roles or slots (state must survive).
    """

    surface_id: str = Field(min_length=1)
    #: Roles this surface declares it can render meaningfully.
    roles: list[SurfaceRole] = Field(min_length=1)
    #: Persistent-capable surfaces may be hosted by the shell outside
    #: template slots (e.g. media playback bar). The shell decides when.
    persistent_capable: bool = False


def validate_layout_spec(spec: LayoutSpec, registered: set[str]) -> None:
    """Deterministic pre-application validation against the registry.

    Raises ValueError on ANY violation — an invalid spec must never reach
    layout state. ``registered`` is the set of surface_ids currently known
    to the surface registry (UI-103 owns the registry implementation).
    """
    unknown = [a.surface_id for a in spec.assignments if a.surface_id not in registered]
    if unknown:
        raise ValueError(f"unregistered surfaces in layout: {sorted(set(unknown))}")
