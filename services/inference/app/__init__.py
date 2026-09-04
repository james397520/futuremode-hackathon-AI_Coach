"""AI Coach — private inference service (spec §72).

Serves **open-weight** models only: BGE / multilingual-e5 class embedders and
cross-encoder rerankers. It never serves, proxies or emulates OpenAI's
``text-embedding-3-*`` — that is an API model with no deployable weights (§2.1).
"""

from __future__ import annotations

from typing import Final

__version__: Final[str] = "0.1.0"

__all__ = ["__version__"]
