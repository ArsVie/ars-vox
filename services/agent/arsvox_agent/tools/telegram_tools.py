"""Telegram tools. One approved recipient (config.telegram.chat_id).
prepare_message shows the exact preview and creates the pending action;
the send only happens through the confirmation executor with the stored
snapshot — the model can never change the text after approval."""

from arsvox_contracts import PanelType
from arsvox_contracts.commands import PanelOpen, TtsSpeak
from arsvox_contracts.events import UiCommandEvent

from arsvox_agent.tools.context import ToolContext


async def telegram_prepare_message(tctx: ToolContext, text: str) -> str:
    chat_id = tctx.deps.config.telegram.chat_id
    if not chat_id:
        return "No hay un destinatario aprobado configurado (telegram.chat_id en la configuración)."
    await tctx.emit(
        UiCommandEvent(
            command=PanelOpen(
                panel_type=PanelType.TELEGRAM_PREVIEW,
                title="Mensaje para la persona aprobada",
                content_reference=text[:400],
            )
        )
    )
    # read the message back so the user hears exactly what will be sent
    await tctx.emit(UiCommandEvent(command=TtsSpeak(text=text, priority=True)))
    pending_id = await tctx.deps.confirmations.request(
        tctx.run_id,
        "telegram.send_pending",
        {"text": text},
        "Enviar mensaje por Telegram",
        f"Se enviará a la persona aprobada:\n{text}",
    )
    return (
        f"PENDING_APPROVAL:{pending_id} — El mensaje está preparado y visible en pantalla. "
        "El usuario debe confirmar antes de enviar."
    )


async def telegram_send_pending(tctx: ToolContext, text: str) -> str:
    chat_id = tctx.deps.config.telegram.chat_id
    if not chat_id:
        return "No hay un destinatario aprobado configurado."
    # R38 point of no return: the instant telegram.send() is invoked the
    # message is handed to the provider and may be delivered even if STOP
    # arrives right after. STOP before this line cancels the execution;
    # after it, the result is surfaced. (POINT_OF_NO_RETURN table in
    # confirmations.py documents this per tool.)
    if tctx.cancel_token is not None:
        tctx.cancel_token.raise_if_cancelled()
        tctx.cancel_token.mark_point_of_no_return()
    result = await tctx.deps.telegram.send(chat_id, text)
    tctx.deps.audit.log(
        "telegram",
        "sent",
        {"chat_id": chat_id, "text": text, "result": result},
    )
    return f"Mensaje enviado: {text}"


# --------------------------------------------------------------------- #
from arsvox_contracts import PolicyKind

from arsvox_agent.tools import ToolSpec

SPECS = [
    ToolSpec(
        "telegram.prepare_message",
        "Prepare a Telegram message to the single approved recipient: shows the exact"
        " text on screen, reads it back, and requests confirmation. Never call"
        " telegram.send_pending directly; confirmation triggers it with the stored text.",
        telegram_prepare_message,
        PolicyKind.USER_VISIBLE,
    ),
    ToolSpec(
        "telegram.send_pending",
        "Send the approved Telegram message (executed only through the confirmation flow).",
        telegram_send_pending,
        PolicyKind.EXTERNAL,
        approval=True,
    ),
]
