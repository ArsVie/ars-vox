"""Model construction. Real provider: OpenAI-compatible endpoint
(opencode-go by default, config agent.model). Mock mode: a scripted
FunctionModel so demos and tests run with zero network and deterministic
behavior."""

import os
from typing import Any

from arsvox_contracts import AppConfig
from pydantic_ai.models.function import AgentInfo, FunctionModel
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openai import OpenAIProvider
from pydantic_ai.messages import ModelResponse, TextPart, ToolCallPart

DEFAULT_SCRIPT: list[dict[str, Any]] = [
    {"tool": "demo_populate", "args": {}},
    {
        "text": "Listo. Te he preparado el escritorio: navegador con las noticias, "
        "tus tareas, un documento abierto y opciones de vídeo en YouTube."
    },
]


class ScriptedModel:
    """Deterministic scripted model for demos and tests (no network).

    Each script entry is either {"tool": name, "args": {...}} or
    {"text": "..."}; entries replay in order and the script LOOPs, so a
    long-running demo service replays the full tool -> text flow on
    every user turn (the agent instance is cached across turns).
    """

    def __init__(self, script: list[dict[str, Any]] | None = None):
        self.script = script or DEFAULT_SCRIPT
        self._step = 0

    def _handler(self, messages, info: AgentInfo) -> ModelResponse:
        entry = self.script[self._step % len(self.script)]
        self._step += 1
        if "tool" in entry:
            return ModelResponse(
                parts=[ToolCallPart(tool_name=entry["tool"], args=entry["args"])]
            )
        return ModelResponse(parts=[TextPart(content=entry["text"])])

    def build(self) -> FunctionModel:
        return FunctionModel(self._handler, model_name="scripted")


def build_model(config: AppConfig):
    if config.agent.mock:
        return ScriptedModel().build()
    model_cfg = config.agent.model
    api_key = os.environ.get(model_cfg.api_key_env, "")
    provider = OpenAIProvider(
        api_key=api_key or "missing-key", base_url=model_cfg.base_url
    )
    return OpenAIChatModel(model_cfg.name, provider=provider)
