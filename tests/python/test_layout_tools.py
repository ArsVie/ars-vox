"""A3 — native agent adaptive-layout contract (GATE-3.5, R16-R18).

R16 Every valid adaptive template parses via the native model tool
    (layout.compose: sidecar/stack/split/triple + role assignments +
    proportion) — deterministic slot derivation from roles.
R17 Invalid specs — duplicate surfaces, unsupported roles, arbitrary
    geometry — are rejected deterministically and NEVER reach state
    (no UiCommandEvent is emitted).
R18 Model-visible surface vocabulary contains NO news (tool schema +
    prompt; prompt guard lives in test_prompts.py).

Validation reuses the frozen packages/contracts gates (LayoutSpec
model validators + validate_layout_spec) — no loose reimplementation.
"""

import asyncio
import json

import pytest

from arsvox_contracts import (
    AdaptiveTemplate,
    LayoutCompose,
    LayoutSpec,
    SurfaceRole,
    UiCommand,
    validate_layout_spec,
)
from arsvox_contracts.commands import LayoutApply
from arsvox_contracts.events import UiCommandEvent

from arsvox_agent.deps import Deps
from arsvox_agent.tools import ToolRegistry, build_pydantic_tools
from arsvox_agent.tools.context import ToolContext
from arsvox_agent.tools.register import register_all
from arsvox_agent.tools.ui_tools import (
    REGISTERED_SURFACES,
    LayoutAssignmentInput,
    layout_compose,
)


class _CaptureBus:
    def __init__(self) -> None:
        self.events: list = []

    async def publish(self, event) -> None:
        self.events.append(event)


class _FakePanels:
    def __init__(self) -> None:
        self.touched: list[str] = []

    def touch(self, panel_type: str) -> None:
        self.touched.append(panel_type)

    def upsert(self, *args) -> None:
        pass

    def remove(self, *args) -> None:
        pass


def _make_context() -> tuple[ToolContext, _CaptureBus]:
    from arsvox_contracts import AppConfig

    config = AppConfig()
    bus = _CaptureBus()
    deps = Deps(
        config=config,
        db=None,
        sessions=None,
        notes=None,
        tasks=None,
        reminders=None,
        notifications=None,
        panels=_FakePanels(),
        preferences=None,
        progress=None,
        pending=None,
        documents=None,
        audit=None,
        bus=bus,  # type: ignore[arg-type]
        policy=None,
        confirmations=None,
        tts=None,
        telegram=None,
        run_id="test-run",
        session_id="test-session",
    )
    tctx = ToolContext(deps=deps, run_id="test-run", session_id="test-session", bus=bus)
    return tctx, bus


def _assign(surface: str, role: str) -> LayoutAssignmentInput:
    return LayoutAssignmentInput(surface=surface, role=role)  # type: ignore[arg-type]


def _run(tctx: ToolContext, **kwargs) -> str:
    return asyncio.run(layout_compose(tctx, **kwargs))


# --------------------------------------------------------------------- #
# R16 — every valid adaptive template parses and reaches the wire


VALID_SPECS: dict[AdaptiveTemplate, list[LayoutAssignmentInput]] = {
    AdaptiveTemplate.FOCUS: [_assign("conversation", "primary")],
    AdaptiveTemplate.SIDECAR: [
        _assign("browser", "primary"),
        _assign("conversation", "companion"),
    ],
    AdaptiveTemplate.STACK: [
        _assign("document_editor", "primary"),
        _assign("conversation", "companion"),
    ],
    AdaptiveTemplate.SPLIT: [
        _assign("browser", "primary"),
        _assign("conversation", "primary"),
    ],
    AdaptiveTemplate.TRIPLE: [
        _assign("browser", "primary"),
        _assign("conversation", "companion"),
        _assign("tasks", "support"),
    ],
}


class TestR16ValidTemplates:
    @pytest.mark.parametrize("template", list(AdaptiveTemplate))
    def test_every_template_parses_and_emits_native_command(self, template):
        tctx, bus = _make_context()
        result = _run(tctx, template=template, assignments=VALID_SPECS[template])
        assert result == f"Disposición {template.value} aplicada."
        commands = [e.command for e in bus.events if isinstance(e, UiCommandEvent)]
        assert len(commands) == 1
        cmd = commands[0]
        assert isinstance(cmd, LayoutCompose)
        assert cmd.action == "layout.compose"
        assert cmd.template is template
        # the emitted spec passes the frozen gates against the registry
        spec = LayoutSpec(
            template=cmd.template,
            assignments=cmd.assignments,
            proportion=cmd.proportion,
        )
        validate_layout_spec(
            spec, REGISTERED_SURFACES
        )  # no raise

    def test_split_two_primaries_derive_main_and_side_slots(self):
        """GATE-1 regression (2026-08-09): a split with two primaries must
        derive main + side (equal 50/50), never two surfaces in one slot —
        the renderer's geometry engine rejects one-surface-per-slot, and an
        invalid spec reaching state white-screened the packaged app at boot
        (via the snapshot restore)."""
        tctx, bus = _make_context()
        result = _run(
            tctx,
            template=AdaptiveTemplate.SPLIT,
            assignments=VALID_SPECS[AdaptiveTemplate.SPLIT],
        )
        assert result == "Disposición split aplicada."
        cmd = [
            e.command
            for e in bus.events
            if isinstance(e, UiCommandEvent)
        ][0]
        assert isinstance(cmd, LayoutCompose)
        slots = [a.slot for a in cmd.assignments]
        assert slots == ["main", "side"], f"expected main+side, got {slots}"
        # geometry-level invariant: one surface per slot
        assert len(slots) == len(set(slots))

    def test_proportion_is_optional_and_roundtrips(self):
        tctx, bus = _make_context()
        _run(
            tctx,
            template=AdaptiveTemplate.SIDECAR,
            assignments=VALID_SPECS[AdaptiveTemplate.SIDECAR],
            proportion="wide",
        )
        cmd = [
            e.command for e in bus.events if isinstance(e, UiCommandEvent)
        ][0]
        assert cmd.proportion.value == "wide"

        tctx2, bus2 = _make_context()
        _run(
            tctx2,
            template=AdaptiveTemplate.SIDECAR,
            assignments=VALID_SPECS[AdaptiveTemplate.SIDECAR],
        )
        cmd2 = [
            e.command for e in bus2.events if isinstance(e, UiCommandEvent)
        ][0]
        assert cmd2.proportion is None

    def test_slots_derived_deterministically_from_roles(self):
        """The model never sends slots: primary→main, companion→side,
        support→rail (frozen contract shape on the wire)."""
        tctx, bus = _make_context()
        _run(
            tctx,
            template=AdaptiveTemplate.TRIPLE,
            assignments=VALID_SPECS[AdaptiveTemplate.TRIPLE],
        )
        cmd = [
            e.command for e in bus.events if isinstance(e, UiCommandEvent)
        ][0]
        slots = {a.surface_id: a.slot for a in cmd.assignments}
        assert slots == {
            "browser": "main",
            "conversation": "side",
            "tasks": "rail",
        }

    def test_split_allows_two_primaries(self):
        tctx, bus = _make_context()
        result = _run(
            tctx,
            template=AdaptiveTemplate.SPLIT,
            assignments=VALID_SPECS[AdaptiveTemplate.SPLIT],
        )
        assert "aplicada" in result


# --------------------------------------------------------------------- #
# R17 — invalid specs rejected deterministically, never reach state


class TestR17DeterministicRejection:
    def _assert_rejected(self, *, template, assignments, match=None) -> str:
        tctx, bus = _make_context()
        result = _run(tctx, template=template, assignments=assignments)
        assert result.startswith("Disposición rechazada:")
        if match:
            assert match in result
        # never reaches state: no ui_command (or any) event is emitted
        assert bus.events == []
        return result

    def test_duplicate_surface_rejected(self):
        self._assert_rejected(
            template=AdaptiveTemplate.SIDECAR,
            assignments=[
                _assign("conversation", "primary"),
                _assign("browser", "companion"),
                _assign("browser", "support"),
            ],
            match="at most once",
        )

    def test_unregistered_surface_rejected(self):
        self._assert_rejected(
            template=AdaptiveTemplate.SIDECAR,
            assignments=[
                _assign("conversation", "primary"),
                _assign("ghost", "companion"),
            ],
            match="unregistered",
        )

    def test_unsupported_role_rejected_at_schema(self):
        # persistent is shell-owned: it cannot even be expressed in the
        # model-visible schema (assignable roles only, frozen contract).
        with pytest.raises(Exception):
            _assign("browser", "persistent")
        with pytest.raises(Exception):
            _assign("browser", "hologram")

    def test_slot_template_mismatch_rejected(self):
        # focus offers no companion slot — the derived slot is rejected
        # by the frozen gates before anything reaches the wire.
        self._assert_rejected(
            template=AdaptiveTemplate.FOCUS,
            assignments=[
                _assign("browser", "primary"),
                _assign("conversation", "companion"),
            ],
            match="not offered by template",
        )

    def test_two_primaries_outside_split_rejected(self):
        self._assert_rejected(
            template=AdaptiveTemplate.SIDECAR,
            assignments=[
                _assign("browser", "primary"),
                _assign("conversation", "primary"),
            ],
            match="exactly one primary",
        )

    def test_empty_assignments_rejected(self):
        # R12 anchor rule: empty input is still valid — the conversation
        # anchor is injected, so a focus layout with only conversation
        # applies instead of being rejected.
        tctx, bus = _make_context()
        result = _run(tctx, template=AdaptiveTemplate.FOCUS, assignments=[])
        assert result.startswith("Disposición ")
        assert "aplicada" in result
        cmd = [e.command for e in bus.events if isinstance(e, UiCommandEvent)][0]
        assert isinstance(cmd, LayoutCompose)
        surfaces = [a.surface_id for a in cmd.assignments]
        assert surfaces == ["conversation"]
        assert cmd.template is AdaptiveTemplate.FOCUS

    def test_missing_conversation_injected_as_anchor(self):
        # R12 (reviewer round 12 finding 1): the model composed a layout
        # with ONLY document_editor and the old man lost his chat. The
        # conversation anchor is ALWAYS injected; a model primary tiles
        # the side under split (focus cannot host two primaries).
        tctx, bus = _make_context()
        result = _run(
            tctx,
            template=AdaptiveTemplate.FOCUS,
            assignments=[_assign("document_editor", "primary")],
        )
        assert result == "Disposición split aplicada."
        cmd = [e.command for e in bus.events if isinstance(e, UiCommandEvent)][0]
        assert isinstance(cmd, LayoutCompose)
        slots = {a.surface_id: a.slot for a in cmd.assignments}
        assert slots == {"conversation": "main", "document_editor": "side"}
        assert cmd.template is AdaptiveTemplate.SPLIT

    def test_rejection_is_deterministic(self):
        kwargs = dict(
            template=AdaptiveTemplate.SIDECAR,
            assignments=[
                _assign("conversation", "primary"),
                _assign("browser", "companion"),
                _assign("browser", "support"),
            ],
        )
        results = {self._assert_rejected(**kwargs) for _ in range(3)}
        assert len(results) == 1  # identical reason every time

    def test_geometry_fields_rejected_at_schema(self):
        # R17 "arbitrary geometry": the tool schema simply has no geometry
        # knobs — additionalProperties is closed and only the three
        # semantic parameters exist (no coordinate/pixel/size fields).
        schema = _layout_compose_schema()
        assert schema["additionalProperties"] is False
        assert set(schema["properties"]) == {"template", "assignments", "proportion"}
        assert set(schema["required"]) == {"template", "assignments"}
        blob = json.dumps(schema).lower()
        for geometry_word in ('"width"', '"height"', '"x"', '"y"', '"pixels"'):
            assert geometry_word not in blob, f"geometry field leaked: {geometry_word}"


# --------------------------------------------------------------------- #
# R18 — no news in any model-visible surface (tool schemas; prompt in
# test_prompts.py)


def _all_tool_schemas() -> dict[str, dict]:
    registry = ToolRegistry()
    register_all(registry)
    out = {}
    for tool in build_pydantic_tools(registry):
        out[tool.name] = tool.tool_def.parameters_json_schema
    return out


def _layout_compose_schema() -> dict:
    return _all_tool_schemas()["layout_compose"]


class TestR18NoNewsVocabulary:
    def test_no_tool_schema_mentions_news(self):
        for name, schema in _all_tool_schemas().items():
            blob = json.dumps(schema, ensure_ascii=False).lower()
            assert "news" not in blob, f"tool {name} schema mentions news"

    def test_layout_compose_schema_is_adaptive_only(self):
        schema = _layout_compose_schema()
        templates = schema["$defs"]["AdaptiveTemplate"]["enum"]
        assert templates == ["focus", "sidecar", "stack", "split", "triple"]
        roles = schema["$defs"]["LayoutAssignmentInput"]["properties"]["role"]["enum"]
        assert roles == ["primary", "companion", "support"]
        proportions = schema["$defs"]["Proportion"]["enum"]
        assert proportions == ["narrow", "balanced", "wide"]

    def test_registered_surfaces_match_frontend_registry(self):
        # Mirror of apps/desktop/src/adaptive/surfaces.ts PRODUCT_SURFACES
        # (A4-owned). The frontend planner rejects anything outside this
        # set, so the Python gate and the registry must agree.
        assert REGISTERED_SURFACES == frozenset(
            {"browser", "conversation", "document_editor", "book_reader", "tasks", "media"}
        )


# --------------------------------------------------------------------- #
# Legacy wire path (R23) — layout.apply stays parseable on the wire


def test_legacy_layout_apply_still_part_of_ui_command_union():
    """R23: the legacy wire path survives — layout.apply payloads still
    parse through the UiCommand union (the frontend planner keeps routing
    them) alongside the native layout.compose."""
    from pydantic import TypeAdapter

    cmd = LayoutApply(
        template="reading",  # type: ignore[arg-type]
        primary_panel="document_editor",  # type: ignore[arg-type]
        secondary_panel="conversation",  # type: ignore[arg-type]
    )
    assert cmd.action == "layout.apply"

    adapter = TypeAdapter(UiCommand)
    legacy = adapter.validate_json(
        '{"action": "layout.apply", "template": "reading",'
        ' "primary_panel": "document_editor"}'
    )
    native = adapter.validate_json(
        '{"action": "layout.compose", "template": "sidecar", "assignments":'
        ' [{"surface_id": "browser", "role": "primary", "slot": "main"}]}'
    )
    assert legacy.action == "layout.apply"
    assert native.action == "layout.compose"
