"""UI-000 contract tests: adaptive layout shapes, validation rules, fixtures."""

import json
from pathlib import Path

import pytest

from arsvox_contracts import (
    EQUAL_SPLIT_TEMPLATES,
    TEMPLATE_SLOTS,
    AdaptiveTemplate,
    LayoutAssignment,
    LayoutSpec,
    Proportion,
    SurfaceRole,
    validate_layout_spec,
)

SCHEMAS = Path(__file__).resolve().parents[2] / "packages" / "contracts" / "schemas"


def make_spec(template: AdaptiveTemplate, **overrides) -> LayoutSpec:
    """Build a valid spec for the template with default placeholder surfaces."""
    defaults: dict = {
        AdaptiveTemplate.FOCUS: {
            "assignments": [
                {"surface_id": "s1", "role": "primary", "slot": "main"}
            ]
        },
        AdaptiveTemplate.SIDECAR: {
            "assignments": [
                {"surface_id": "s1", "role": "primary", "slot": "main"},
                {"surface_id": "s2", "role": "companion", "slot": "side"},
            ]
        },
        AdaptiveTemplate.STACK: {
            "assignments": [
                {"surface_id": "s1", "role": "primary", "slot": "main"},
                {"surface_id": "s2", "role": "companion", "slot": "side"},
            ]
        },
        AdaptiveTemplate.SPLIT: {
            "assignments": [
                {"surface_id": "s1", "role": "primary", "slot": "main"},
                {"surface_id": "s2", "role": "companion", "slot": "side"},
            ]
        },
        AdaptiveTemplate.TRIPLE: {
            "assignments": [
                {"surface_id": "s1", "role": "primary", "slot": "main"},
                {"surface_id": "s2", "role": "companion", "slot": "side"},
                {"surface_id": "s3", "role": "support", "slot": "rail"},
            ]
        },
    }[template]
    payload = {"template": template.value, **defaults, **overrides}
    return LayoutSpec.model_validate(payload)


class TestLayoutSpecValidation:
    def test_all_five_templates_representable(self):
        for t in AdaptiveTemplate:
            spec = make_spec(t)
            assert spec.template is t

    def test_exactly_one_primary_required(self):
        with pytest.raises(ValueError, match="exactly one primary"):
            make_spec(
                AdaptiveTemplate.SIDECAR,
                assignments=[
                    {"surface_id": "s1", "role": "companion", "slot": "main"},
                    {"surface_id": "s2", "role": "companion", "slot": "side"},
                ],
            )

    def test_two_primaries_rejected_outside_equal_split_templates(self):
        with pytest.raises(ValueError, match="exactly one primary"):
            make_spec(
                AdaptiveTemplate.SIDECAR,
                assignments=[
                    {"surface_id": "s1", "role": "primary", "slot": "main"},
                    {"surface_id": "s2", "role": "primary", "slot": "side"},
                ],
            )

    def test_split_allows_two_primaries(self):
        assert AdaptiveTemplate.SPLIT in EQUAL_SPLIT_TEMPLATES
        spec = make_spec(
            AdaptiveTemplate.SPLIT,
            assignments=[
                {"surface_id": "s1", "role": "primary", "slot": "main"},
                {"surface_id": "s2", "role": "primary", "slot": "side"},
            ],
        )
        assert len([a for a in spec.assignments if a.role is SurfaceRole.PRIMARY]) == 2

    def test_no_duplicate_surface_assignment(self):
        with pytest.raises(ValueError, match="at most once"):
            make_spec(
                AdaptiveTemplate.SPLIT,
                assignments=[
                    {"surface_id": "s1", "role": "primary", "slot": "main"},
                    {"surface_id": "s1", "role": "companion", "slot": "side"},
                ],
            )

    def test_persistent_role_rejected_in_template_slots(self):
        with pytest.raises(ValueError, match="shell-controlled"):
            make_spec(
                AdaptiveTemplate.SIDECAR,
                assignments=[
                    {"surface_id": "s1", "role": "primary", "slot": "main"},
                    {"surface_id": "s2", "role": "persistent", "slot": "side"},
                ],
            )

    def test_slot_must_belong_to_template(self):
        with pytest.raises(ValueError, match="not offered by template"):
            make_spec(
                AdaptiveTemplate.FOCUS,
                assignments=[
                    {"surface_id": "s1", "role": "primary", "slot": "side"},
                ],
            )

    def test_empty_assignments_rejected(self):
        with pytest.raises(Exception):
            LayoutSpec.model_validate(
                {"template": "focus", "assignments": []}
            )

    def test_proportion_optional_and_typed(self):
        spec = make_spec(AdaptiveTemplate.SPLIT, proportion="wide")
        assert spec.proportion is Proportion.WIDE
        plain = make_spec(AdaptiveTemplate.SPLIT)
        assert plain.proportion is None

    def test_no_coordinate_fields_in_shape(self):
        """LayoutSpec must never carry raw geometry."""
        schema = json.loads(
            (SCHEMAS / "adaptive-layout.schema.json").read_text()
        )
        spec_schema = schema.get("properties", {})
        assert set(spec_schema.keys()) == {"template", "assignments", "proportion"}


class TestSurfaceIdentity:
    def test_same_surface_moves_between_roles_without_identity_change(self):
        """Contract invariant: role change never implies remount."""
        as_primary = make_spec(
            AdaptiveTemplate.SIDECAR,
            assignments=[
                {"surface_id": "browser", "role": "primary", "slot": "main"},
                {"surface_id": "assistant", "role": "companion", "slot": "side"},
            ],
        )
        as_companion = make_spec(
            AdaptiveTemplate.SIDECAR,
            assignments=[
                {"surface_id": "assistant", "role": "primary", "slot": "main"},
                {"surface_id": "browser", "role": "companion", "slot": "side"},
            ],
        )
        ids_a = {a.surface_id for a in as_primary.assignments}
        ids_b = {a.surface_id for a in as_companion.assignments}
        assert ids_a == ids_b  # same surfaces, swapped roles — no new instances


class TestRegistryValidation:
    def test_registered_surfaces_pass(self):
        spec = make_spec(AdaptiveTemplate.TRIPLE)
        validate_layout_spec(spec, {"s1", "s2", "s3"})  # no raise

    def test_unregistered_surface_rejected(self):
        spec = make_spec(AdaptiveTemplate.TRIPLE)
        with pytest.raises(ValueError, match="unregistered"):
            validate_layout_spec(spec, {"s1", "s2"})

    def test_validation_is_deterministic(self):
        spec = make_spec(AdaptiveTemplate.SIDECAR)
        registered = {"s1", "s2"}
        for _ in range(3):
            validate_layout_spec(spec, registered)  # stable, no side effects


class TestTemplateSlots:
    def test_persistent_surfaces_not_template_slots(self):
        for slots in TEMPLATE_SLOTS.values():
            assert "persistent" not in slots

    def test_focus_has_single_slot(self):
        assert TEMPLATE_SLOTS[AdaptiveTemplate.FOCUS] == ("main",)

    def test_every_template_has_main(self):
        for slots in TEMPLATE_SLOTS.values():
            assert slots[0] == "main"
