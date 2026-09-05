"""External AI / embedding integration boundary.

This module defines provider interfaces and generic adapters.

CoachService depends only on AIProvider / EmbeddingProvider.
Concrete providers can be injected by applications or users.

Embedding namespace MUST change when the embedding model,
algorithm, or dimensionality changes.
"""

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol

import hashlib
import json
import math
import re
import urllib.error
import urllib.request
import os


DIMENSIONS = [
    "專業準確度",
    "需求探索",
    "同理心",
    "異議處理",
    "風險揭露",
]


# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------

@dataclass
class AIRequest:
    task: Literal["answer", "roleplay", "evaluate"]
    instructions: str
    payload: dict[str, Any]


@dataclass
class AIResponse:
    text: str
    citation_ids: list[str] = field(default_factory=list)
    insufficient_evidence: bool = False
    report: dict[str, Any] | None = None


# ---------------------------------------------------------------------------
# Provider interfaces
# ---------------------------------------------------------------------------

class AIProvider(Protocol):
    name: str
    is_mock: bool

    def generate(self, request: AIRequest) -> AIResponse:
        """Generate an AI response.

        Concrete implementations should:
        - convert AIRequest to vendor/provider input
        - execute the model/API request
        - convert provider output to AIResponse
        - map public failures to ProviderError
        """
        ...


class EmbeddingProvider(Protocol):
    namespace: str
    is_mock: bool

    def embed(self, texts: list[str]) -> list[list[float]]:
        """Return one finite, nonzero, same-dimensional vector per input text."""
        ...


class ProviderError(Exception):
    """Public sanitized provider error.

    Never include API keys, authorization headers,
    or raw vendor responses in this exception.
    """


# ---------------------------------------------------------------------------
# Local embedding provider
# ---------------------------------------------------------------------------

class LocalEmbeddingProvider:
    """Local lexical retrieval using hashed bigrams.

    This is NOT a semantic embedding model.

    It is useful for:
    - local/offline development
    - deterministic tests
    - basic lexical RAG retrieval
    """

    namespace = "local-bigram-2048-v2"
    is_mock = False

    def embed(self, texts: list[str]) -> list[list[float]]:
        vectors: list[list[float]] = []

        for text in texts:
            compact = re.sub(
                r"[^a-z0-9\u4e00-\u9fff]",
                "",
                text.lower(),
            )

            compact = re.sub(
                r"是多少|是什麼|有什麼|請問|這個|這項|哪些|多少|什麼|嗎|呢",
                "",
                compact,
            )

            tokens = [
                compact[i : i + 2]
                for i in range(max(0, len(compact) - 1))
            ]

            tokens += re.findall(
                r"[a-z0-9]+",
                text.lower(),
            )

            if not tokens:
                tokens = [compact or " "]

            vector = [0.0] * 2048

            for token in tokens:
                digest = hashlib.sha256(
                    token.encode("utf-8")
                ).digest()

                index = int.from_bytes(
                    digest[:4],
                    "big",
                ) % 2048

                vector[index] += 1.0

            norm = math.sqrt(
                sum(value * value for value in vector)
            )

            if norm == 0:
                raise ProviderError(
                    "Local embedding produced a zero vector."
                )

            vectors.append(
                [value / norm for value in vector]
            )

        return vectors


# ---------------------------------------------------------------------------
# Mock AI provider
# ---------------------------------------------------------------------------

class MockAIProvider:
    """Predictable local rehearsal responses.

    Deliberately never assigns real AI scores.
    """

    name = "mock-script-v1"
    is_mock = True

    def generate(
        self,
        request: AIRequest,
    ) -> AIResponse:
        payload = request.payload

        if request.task == "answer":
            hits = payload.get("sources", [])[:3]

            return AIResponse(
                text=(
                    "【模擬模式：文件摘錄，非 AI 生成】\n\n"
                    + "\n\n".join(
                        f"{hit['text']}\n[{hit['id']}]"
                        for hit in hits
                    )
                ),
                citation_ids=[
                    hit["id"]
                    for hit in hits
                ],
                insufficient_evidence=not bool(hits),
            )

        if request.task == "roleplay":
            message = payload.get("message", "")
            persona = payload.get(
                "persona",
                "",
            )
            history = payload.get(
                "history",
                [],
            )

            if any(
                word in message
                for word in [
                    "保證獲利",
                    "不會賠",
                    "保本",
                ]
            ):
                text = (
                    "你剛才提到了保本或獲利，可以再說清楚嗎？"
                    "如果市場下跌，我的本金會受影響嗎？"
                )

            elif persona == "fee_sensitive":
                text = (
                    "申購和持有期間分別要付哪些費用？"
                    "可以用手冊的數字說明嗎？"
                )

            elif persona == "short_term":
                text = (
                    "我三個月後就需要這筆錢，"
                    "這個產品適合我嗎？"
                )

            elif len(history) >= 2:
                text = (
                    "如果我臨時需要用錢，"
                    "贖回要等多久？又會有哪些成本？"
                )

            else:
                text = (
                    "你好，我最近想了解一下這個產品，"
                    "不過我其實滿擔心本金虧損的。"
                )

            return AIResponse(
                text="【模擬客戶腳本】" + text
            )

        if request.task == "evaluate":
            return AIResponse(
                text="模擬報告",
                report={
                    "summary": (
                        "此為報告格式預演，尚未串接 AI，"
                        "沒有執行能力評分。"
                    ),
                    "scores": [
                        {
                            "dimension": name,
                            "score": None,
                            "reason": (
                                "待 AI 串接後，"
                                "依學員逐字稿與文件評估。"
                            ),
                            "evidence_quote": "",
                            "citation_ids": [],
                        }
                        for name in DIMENSIONS
                    ],
                    "improvements": [
                        (
                            "示範建議：先確認客戶期限與風險承受度，"
                            "再依文件說明產品。"
                        )
                    ],
                    "suggested_reply": (
                        "我理解您擔心虧損。"
                        "您預計何時需要這筆資金，"
                        "以及可以接受多少損失？"
                    ),
                },
            )

        raise ProviderError(
            f"Unsupported AI task: {request.task}"
        )


# ---------------------------------------------------------------------------
# Generic HTTP AI provider
# ---------------------------------------------------------------------------

RequestBuilder = Callable[
    [AIRequest],
    dict[str, Any],
]

ResponseParser = Callable[
    [dict[str, Any], AIRequest],
    AIResponse,
]


class HTTPAIProvider:
    """Generic HTTP adapter for external/local AI services.

    This class is intentionally vendor-agnostic.

    The caller provides:

    - endpoint
    - optional HTTP headers
    - request_builder:
        AIRequest -> provider-specific JSON request

    - response_parser:
        provider-specific JSON response -> AIResponse

    This allows the same CoachService to work with:
    - local inference servers
    - company-internal model APIs
    - OpenAI-compatible APIs
    - custom model gateways
    - other HTTP-based AI providers
    """

    is_mock = False

    def __init__(
        self,
        *,
        name: str,
        endpoint: str,
        request_builder: RequestBuilder,
        response_parser: ResponseParser,
        headers: dict[str, str] | None = None,
        timeout: float = 60.0,
    ):
        if not name:
            raise ValueError(
                "HTTPAIProvider name must not be empty."
            )

        if not endpoint:
            raise ValueError(
                "HTTPAIProvider endpoint must not be empty."
            )

        self.name = name
        self.endpoint = endpoint
        self.request_builder = request_builder
        self.response_parser = response_parser
        self.headers = headers or {}
        self.timeout = timeout

    def generate(
        self,
        request: AIRequest,
    ) -> AIResponse:
        try:
            provider_payload = (
                self.request_builder(request)
            )

            if not isinstance(
                provider_payload,
                dict,
            ):
                raise ProviderError(
                    "AI request builder must return a dict."
                )

            if os.getenv("AI_DEBUG") == "1":
                print("\n========== REQUEST TO LLM ==========")
                print(
                    json.dumps(
                        provider_payload,
                        ensure_ascii=False,
                        indent=2,
                    )
                )
                print("====================================\n")



            body = json.dumps(
                provider_payload,
                ensure_ascii=False,
            ).encode("utf-8")

            http_request = urllib.request.Request(
                self.endpoint,
                data=body,
                headers={
                    "Content-Type": "application/json",
                    **self.headers,
                },
                method="POST",
            )

            with urllib.request.urlopen(
                http_request,
                timeout=self.timeout,
            ) as response:
                raw_body = response.read()

            provider_response = json.loads(
                raw_body.decode("utf-8")
            )

            if not isinstance(
                provider_response,
                dict,
            ):
                raise ProviderError(
                    "AI provider returned a non-object JSON response."
                )

            result = self.response_parser(
                provider_response,
                request,
            )

            if not isinstance(
                result,
                AIResponse,
            ):
                raise ProviderError(
                    "AI response parser must return AIResponse."
                )

            return result

        except ProviderError:
            raise

        except urllib.error.HTTPError as exc:
            raise ProviderError(
                f"AI provider '{self.name}' returned an HTTP error."
            ) from exc

        except urllib.error.URLError as exc:
            raise ProviderError(
                f"AI provider '{self.name}' is unreachable."
            ) from exc

        except TimeoutError as exc:
            raise ProviderError(
                f"AI provider '{self.name}' timed out."
            ) from exc

        except json.JSONDecodeError as exc:
            raise ProviderError(
                f"AI provider '{self.name}' returned invalid JSON."
            ) from exc

        except Exception as exc:
            raise ProviderError(
                f"AI provider '{self.name}' request failed."
            ) from exc


# ---------------------------------------------------------------------------
# Reserved custom provider
# ---------------------------------------------------------------------------

class ExternalAIProvider:
    """Template for SDK-based or other custom AI integrations.

    Users may either:
    - implement this class
    - implement AIProvider directly
    - use HTTPAIProvider
    """

    name = "external-not-configured"
    is_mock = False

    def generate(
        self,
        request: AIRequest,
    ) -> AIResponse:
        raise ProviderError(
            "External AI provider is not configured."
        )


# ---------------------------------------------------------------------------
# Reserved embedding provider
# ---------------------------------------------------------------------------

class ExternalEmbeddingProvider:
    """Template for semantic embedding API/model integrations."""

    namespace = "external-not-configured"
    is_mock = False

    def embed(
        self,
        texts: list[str],
    ) -> list[list[float]]:
        raise ProviderError(
            "External embedding provider is not configured."
        )
