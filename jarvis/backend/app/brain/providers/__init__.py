"""Provider factory."""

from __future__ import annotations

from ...config import PROVIDER_PRESETS, Settings, effective_api_key
from .base import LLMProvider


def build_provider(settings: Settings) -> LLMProvider:
    p = settings.provider
    kind = PROVIDER_PRESETS.get(p.name, {}).get("kind", "openai_compat")
    key = effective_api_key(settings)
    if kind == "ollama":
        from .ollama import OllamaProvider

        return OllamaProvider(base_url=p.base_url, model=p.model, timeout_s=p.timeout_s, max_tokens=p.max_tokens)
    if kind == "anthropic":
        from .anthropic_provider import AnthropicProvider

        return AnthropicProvider(api_key=key, model=p.model, timeout_s=p.timeout_s, max_tokens=p.max_tokens)
    from .openai_compat import OpenAICompatProvider

    return OpenAICompatProvider(
        base_url=p.base_url, model=p.model, api_key=key, timeout_s=p.timeout_s, max_tokens=p.max_tokens, label=p.name
    )
