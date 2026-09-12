"""The model client. Raw HTTP, no agent framework.

One OpenAI-compatible call, tools passed through, usage and prefix-cache
accounting parsed from the response. FakeModel exists only as the test seam.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Any, Protocol

MIN_MAX_TOKENS = 512  # below the reasoning budget a reasoning model returns an empty body


@dataclass(slots=True)
class Usage:
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cached_tokens: int = 0
    reasoning_tokens: int = 0

    @property
    def uncached_prompt_tokens(self) -> int:
        return max(self.prompt_tokens - self.cached_tokens, 0)

    @property
    def cache_hit_rate(self) -> float:
        return self.cached_tokens / self.prompt_tokens if self.prompt_tokens else 0.0

    def as_dict(self) -> dict:
        return {
            "prompt_tokens": self.prompt_tokens,
            "completion_tokens": self.completion_tokens,
            "cached_tokens": self.cached_tokens,
            "uncached_prompt_tokens": self.uncached_prompt_tokens,
            "reasoning_tokens": self.reasoning_tokens,
            "cache_hit_rate": round(self.cache_hit_rate, 3),
        }


@dataclass(slots=True)
class ToolCall:
    id: str
    name: str
    arguments: dict
    raw_arguments: str = ""


@dataclass(slots=True)
class ModelReply:
    text: str
    tool_calls: list[ToolCall] = field(default_factory=list)
    usage: Usage = field(default_factory=Usage)
    finish_reason: str = ""
    elapsed_s: float = 0.0
    error: str | None = None


class Model(Protocol):
    name: str

    def complete(self, messages: list[dict], tools: list[dict]) -> ModelReply: ...


def parse_usage(payload: dict) -> Usage:
    """Read usage, and derive the uncached part so the two buckets always sum."""
    usage = payload.get("usage") or {}
    prompt = int(usage.get("prompt_tokens") or 0)
    completion = int(usage.get("completion_tokens") or 0)
    details = usage.get("prompt_tokens_details") or {}
    cached = int(details.get("cached_tokens") or 0)
    completion_details = usage.get("completion_tokens_details") or {}
    reasoning = int(completion_details.get("reasoning_tokens") or 0)
    if cached > prompt:  # a gateway that reports nonsense must not break the ledger
        cached = prompt
    return Usage(
        prompt_tokens=prompt, completion_tokens=completion, cached_tokens=cached,
        reasoning_tokens=reasoning,
    )


def parse_tool_calls(message: dict) -> list[ToolCall]:
    calls = []
    for index, raw in enumerate(message.get("tool_calls") or []):
        function = raw.get("function") or {}
        arguments_text = function.get("arguments") or "{}"
        try:
            arguments = json.loads(arguments_text) if isinstance(arguments_text, str) else arguments_text
        except json.JSONDecodeError:
            arguments = {}
        if not isinstance(arguments, dict):
            arguments = {"value": arguments}
        calls.append(
            ToolCall(
                id=raw.get("id") or f"call_{index}",
                name=function.get("name") or "",
                arguments=arguments,
                raw_arguments=arguments_text if isinstance(arguments_text, str) else "",
            )
        )
    return calls


class HttpChatModel:
    """OpenAI-compatible chat completions over httpx."""

    def __init__(
        self,
        base_url: str,
        model: str,
        api_key: str,
        temperature: float = 1.0,
        max_tokens: int = 1024,
        timeout_s: float = 90.0,
        retries: int = 2,
    ) -> None:
        self.name = model
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.api_key = api_key
        self.temperature = temperature
        self.max_tokens = max(max_tokens, MIN_MAX_TOKENS)
        self.timeout_s = timeout_s
        self.retries = retries

    def complete(self, messages: list[dict], tools: list[dict]) -> ModelReply:
        import httpx

        body: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
        }
        if tools:
            body["tools"] = tools
            body["tool_choice"] = "auto"
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}

        last_error = ""
        for attempt in range(self.retries + 1):
            started = time.perf_counter()
            try:
                response = httpx.post(
                    f"{self.base_url}/chat/completions",
                    json=body,
                    headers=headers,
                    timeout=self.timeout_s,
                )
                elapsed = time.perf_counter() - started
                if response.status_code >= 400:
                    last_error = f"HTTP {response.status_code}: {response.text[:300]}"
                    if response.status_code < 500:
                        return ModelReply(text="", elapsed_s=elapsed, error=last_error)
                    time.sleep(1.5 * (attempt + 1))
                    continue
                payload = response.json()
                choice = (payload.get("choices") or [{}])[0]
                message = choice.get("message") or {}
                text = (message.get("content") or "").strip()
                finish = choice.get("finish_reason") or ""
                if not text and not message.get("tool_calls") and finish == "length":
                    last_error = (
                        f"empty body with finish_reason=length: raise max_tokens "
                        f"(currently {self.max_tokens})"
                    )
                    time.sleep(1.0)
                    continue
                return ModelReply(
                    text=text,
                    tool_calls=parse_tool_calls(message),
                    usage=parse_usage(payload),
                    finish_reason=finish,
                    elapsed_s=elapsed,
                )
            except Exception as exc:  # noqa: BLE001
                last_error = f"{type(exc).__name__}: {exc}"[:300]
                time.sleep(1.5 * (attempt + 1))
        return ModelReply(text="", error=last_error or "model call failed")


class FakeModel:
    """Test seam only. Replays scripted replies and records what it was asked."""

    name = "fake"

    def __init__(self, replies: list[ModelReply]) -> None:
        self.replies = list(replies)
        self.requests: list[list[dict]] = []
        self.tool_schemas: list[list[dict]] = []

    def complete(self, messages: list[dict], tools: list[dict]) -> ModelReply:
        self.requests.append(messages)
        self.tool_schemas.append(tools)
        if not self.replies:
            return ModelReply(text="(no more scripted replies)")
        return self.replies.pop(0)
