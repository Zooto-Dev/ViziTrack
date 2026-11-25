"""Provider factory."""

from __future__ import annotations

from ...config import PROVIDER_PRESETS, Settings, effective_api_key
from .base import LLMProvider

# Local models good at tool calling, best first.
FALLBACK_PREFERENCE = ("qwen2.5", "qwen3", "llama3.2", "llama3.1", "mistral-nemo")


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


async def local_fallback(settings: Settings) -> LLMProvider | None:
    """The user's local Ollama model, if Ollama is running and has one downloaded."""
    if not settings.offline_fallback or settings.provider.name == "ollama":
        return None
    from .ollama import OllamaProvider

    base = PROVIDER_PRESETS["ollama"]["base_url"]
    probe = OllamaProvider(base_url=base, model="")
    models = (await probe.check()).get("models") or []
    if not models:
        return None
    ranked = sorted(models, key=lambda m: next((i for i, p in enumerate(FALLBACK_PREFERENCE) if m.startswith(p)), 99))
    return OllamaProvider(base_url=base, model=ranked[0], max_tokens=settings.provider.max_tokens)
