import logging
from functools import lru_cache
from typing import Dict, Optional

from ..settings import settings
from .providers import ProviderConfig, build_extractor
from .providers.base import BaseExtractor
from .providers.heuristic import HeuristicExtractor
from .schema import Extracted

logger = logging.getLogger(__name__)


def parse_document(
    content: bytes,
    *,
    source: str,
    metadata: Optional[Dict[str, str]] = None,
) -> Extracted:
    """
    Convert raw content into the canonical Extracted schema using whichever LLM
    provider is configured.  Defaults to the heuristic parser, and falls back to
    it automatically if the configured provider fails.
    """

    extractor = _get_extractor()
    try:
        return extractor.extract(content=content, source=source, metadata=metadata or {})
    except Exception as exc:
        if settings.llm_provider.lower() != "heuristic":
            logger.warning(
                "Primary extractor failed (%s); falling back to heuristic parser.", exc
            )
            backup = HeuristicExtractor()
            return backup.extract(content=content, source=source, metadata=metadata or {})
        raise


@lru_cache(maxsize=1)
def _get_extractor() -> BaseExtractor:
    config = ProviderConfig(
        name=settings.llm_provider,
        model=settings.llm_model,
        openai_api_key=settings.openai_api_key,
        openai_timeout_seconds=settings.openai_timeout_seconds,
        openai_max_retries=settings.openai_max_retries,
        anthropic_api_key=settings.anthropic_api_key,
    )
    try:
        return build_extractor(config)
    except Exception as exc:
        if config.name.lower() != "heuristic":
            logger.warning(
                "Failed to build %s extractor (%s); using heuristic instead.",
                config.name,
                exc,
            )
            return HeuristicExtractor()
        raise
