"""Demo content tool (mock mode only): populates every panel surface with
representative content so the UI is demonstrable end to end without a
live model. Emits the typed content events exactly as the real tools
will: youtube.search, browser.navigate, document.load, tasks.update,
media.state. Registered only when config.agent.mock is true (register.py
checks; the module itself is inert otherwise).
"""

from arsvox_contracts import PanelType, PolicyKind
from arsvox_contracts.commands import LayoutApply, LayoutSlots, PanelOpen
from arsvox_contracts.events import (
    BrowserNavigateEvent,
    DocumentLoadEvent,
    MediaStateEvent,
    ReminderItem,
    TasksUpdateEvent,
    TodoItem,
    UiCommandEvent,
    YoutubeSearchEvent,
    YoutubeVideoResult,
)

from arsvox_agent.tools import ToolSpec
from arsvox_agent.tools.context import ToolContext

DEMO_NEWS_URL = "http://127.0.0.1:5173/demo-news.html"


async def demo_populate(tctx: ToolContext) -> str:
    """Populate all panel surfaces with representative demo content."""
    if not tctx.deps.config.agent.mock:
        return "demo_populate solo está disponible en modo mock."
    deps = tctx.deps

    # Open the multi-zone surface first so every slot has a panel.
    await tctx.emit(
        UiCommandEvent(
            command=PanelOpen(panel_type=PanelType.YOUTUBE, title="YouTube")
        )
    )
    await tctx.emit(
        UiCommandEvent(command=PanelOpen(panel_type=PanelType.BROWSER, title="Navegador"))
    )
    await tctx.emit(
        UiCommandEvent(
            command=PanelOpen(panel_type=PanelType.DOCUMENT_EDITOR, title="Notas de obra")
        )
    )
    await tctx.emit(
        UiCommandEvent(command=PanelOpen(panel_type=PanelType.TASKS, title="Tareas"))
    )
    await tctx.emit(
        UiCommandEvent(
            command=LayoutApply(
                template="dashboard",
                primary_panel=PanelType.BROWSER,
                secondary_panel=PanelType.CONVERSATION,
                slots=LayoutSlots(
                    main=PanelType.BROWSER,
                    side=PanelType.CONVERSATION,
                    rail=PanelType.TASKS,
                    dock=PanelType.MEDIA,
                ),
            )
        )
    )

    # YouTube search results (agent offers options; user picks one).
    await tctx.emit(
        YoutubeSearchEvent(
            query="cocina italiana fácil",
            results=[
                YoutubeVideoResult(
                    id="dQw4w9WgXcQ",
                    title="Pasta fresca en casa: receta paso a paso",
                    channel="Cocina con Marta",
                    duration_s=742,
                    published="hace 3 días",
                    thumbnail_url=None,
                ),
                YoutubeVideoResult(
                    id="9bZkp7q19f0",
                    title="Risotto cremoso sin fallos",
                    channel="La Cocina de Luis",
                    duration_s=1015,
                    published="hace 1 semana",
                    thumbnail_url=None,
                ),
                YoutubeVideoResult(
                    id="kJQP7kiw5Fk",
                    title="Cinco salsas italianas para pasta",
                    channel="Sabores del Sur",
                    duration_s=598,
                    published="hace 2 semanas",
                    thumbnail_url=None,
                ),
            ],
        )
    )

    # Browser: local demo news page (same chrome the real webview uses).
    await tctx.emit(
        BrowserNavigateEvent(
            url=DEMO_NEWS_URL,
            title="El Diario — Noticias locales",
            can_go_back=False,
            can_go_forward=False,
            loading=False,
        )
    )

    # Document: a real EPUB book rendered by epub.js (demo fixture).
    await tctx.emit(
        DocumentLoadEvent(
            title="Don Quijote de la Mancha (fragmento)",
            kind="epub",
            path="biblioteca/don-quijote-fragmento.epub",
            url="http://127.0.0.1:5173/demo-book.epub",
            content="",
            chapters=[],
        )
    )

    # Tasks: to-dos + permanent reminders (reminders also feed the agent
    # context on a cadence in the real backend).
    await tctx.emit(
        TasksUpdateEvent(
            todos=[
                TodoItem(id="t1", title="Llamar al fontanero", done=False, priority="high"),
                TodoItem(id="t2", title="Comprar el pan", done=True),
                TodoItem(id="t3", title="Pagar la factura de la luz", done=False, due="lun"),
            ],
            reminders=[
                ReminderItem(
                    id="r1",
                    title="Tomar la medicación",
                    cadence="Cada día 9:00",
                    next_fire="mañana 9:00",
                ),
                ReminderItem(
                    id="r2",
                    title="Regar las plantas",
                    cadence="Cada 3 días",
                    next_fire="sábado",
                ),
            ],
        )
    )

    # Media: local audio playing (the same player chrome shows YouTube).
    await tctx.emit(
        MediaStateEvent(
            state="playing",
            source="local",
            kind="audio",
            title="Sinfonía Nº 5 — Adagietto",
            url=None,
            position_s=142,
            duration_s=642,
            volume=0.8,
        )
    )

    deps.panels.touch("browser")
    return "Demo: paneles poblados."


SPECS = [
    ToolSpec(
        "demo_populate",
        "Populate every panel surface with representative demo content "
        "(mock mode only).",
        demo_populate,
        PolicyKind.REVERSIBLE,
    ),
]
