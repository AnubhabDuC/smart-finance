from dataclasses import dataclass
from typing import Optional

from .base import BaseExtractor
from .heuristic import HeuristicExtractor


@dataclass(frozen=True)
class ProviderConfig:
    name: str
    model: str
    openai_api_key: Optional[str] = None
    openai_timeout_seconds: int = 60
    openai_max_retries: int = 2
    anthropic_api_key: Optional[str] = None


def build_extractor(config: ProviderConfig) -> BaseExtractor:
    provider = config.name.lower()
    if provider == "openai":
        from .openai_provider import OpenAIExtractor

        return OpenAIExtractor(
            api_key=config.openai_api_key or "",
            model=config.model,
            timeout_seconds=config.openai_timeout_seconds,
            max_retries=config.openai_max_retries,
        )
    # Future providers can be added here.
    return HeuristicExtractor()
