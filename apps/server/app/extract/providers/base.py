from abc import ABC, abstractmethod
from typing import Dict, Optional

from ..schema import Extracted


class BaseExtractor(ABC):
    """Abstract contract for all extraction providers."""

    @abstractmethod
    def extract(
        self,
        *,
        content: bytes,
        source: str,
        metadata: Optional[Dict[str, str]] = None,
    ) -> Extracted:
        """Turn incoming content into a structured Extracted object."""
