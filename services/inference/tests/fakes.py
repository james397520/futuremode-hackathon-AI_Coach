"""Deterministic test doubles for the session and tokenizer ports.

The whole point of the ports in :mod:`app.models.session` and
:mod:`app.preprocessing.tokenizer` is that the test suite runs with **no model
weights, no onnxruntime, no `tokenizers` wheel and no network**. These fakes are
what cashes that in.

They are deliberately *arithmetic* rather than random: a token id maps to a fixed
vector and a pair maps to a fixed logit, so "batched output equals unbatched
output" and "the ranking is by descending score" are exact assertions rather than
statistical ones.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

import numpy as np

from app.models.registry import ModelTask
from app.preprocessing.tokenizer import TokenizedText

if TYPE_CHECKING:
    from collections.abc import Mapping, Sequence
    from pathlib import Path

    from numpy.typing import NDArray

    from app.core.config import Settings
    from app.models.registry import ModelEntry

#: Vector width of the fake embedding model. Must match the manifest fixture.
FAKE_DIMENSION = 8
#: Ids reserved for the fake tokenizer's special tokens.
_CLS_ID = 1
_SEP_ID = 2


class FakeTokenizer:
    """Character-level encoder. Same text -> same ids, always."""

    def __init__(self, *, tokenizer_path: Path, entry: ModelEntry) -> None:
        self.tokenizer_path = tokenizer_path
        self.entry = entry
        self.pad_id = 0

    @staticmethod
    def _ids(text: str) -> list[int]:
        return [(ord(char) % 97) + 3 for char in text]

    def encode(self, texts: Sequence[str], *, max_length: int) -> list[TokenizedText]:
        out: list[TokenizedText] = []
        for text in texts:
            body = self._ids(text)[: max(0, max_length - 2)]
            ids = [_CLS_ID, *body, _SEP_ID]
            out.append(
                TokenizedText(
                    input_ids=tuple(ids),
                    token_type_ids=(0,) * len(ids),
                    truncated=len(ids) >= max_length,
                )
            )
        return out

    def encode_pairs(
        self,
        pairs: Sequence[tuple[str, str]],
        *,
        max_length: int,
    ) -> list[TokenizedText]:
        out: list[TokenizedText] = []
        for query, document in pairs:
            left = self._ids(query)
            right = self._ids(document)
            # `longest_first`, like the real tokenizer: trim the document before
            # the query, so a long document cannot push the query out.
            budget = max(0, max_length - 3)
            while len(left) + len(right) > budget:
                if len(right) >= len(left) and right:
                    right.pop()
                elif left:
                    left.pop()
                else:  # pragma: no cover - budget of 0
                    break
            ids = [_CLS_ID, *left, _SEP_ID, *right, _SEP_ID]
            type_ids = [0] * (len(left) + 2) + [1] * (len(right) + 1)
            out.append(
                TokenizedText(
                    input_ids=tuple(ids),
                    token_type_ids=tuple(type_ids),
                    truncated=len(ids) >= max_length,
                )
            )
        return out


@dataclass
class SessionSpy:
    """Records what the fake sessions were asked to do."""

    runs: int = 0
    batch_sizes: list[int] = field(default_factory=list)


class FakeSession:
    """A stand-in for ``onnxruntime.InferenceSession``.

    Embedding models emit ``last_hidden_state`` of shape ``(batch, seq, dim)``
    where a token's vector is a fixed function of its id; reranking models emit
    ``logits`` of shape ``(batch, 1)`` derived from the attended token ids. Both
    are independent of batch composition, which is what makes the "batching does
    not change the answer" test meaningful.
    """

    def __init__(
        self,
        *,
        model_path: Path,
        settings: Settings,
        model_id: str,
        task: ModelTask,
        dimension: int = FAKE_DIMENSION,
        gate: threading.Event | None = None,
        spy: SessionSpy | None = None,
    ) -> None:
        self.model_path = model_path
        self.settings = settings
        self.model_id = model_id
        self.task = task
        self.dimension = dimension
        self._gate = gate
        self._spy = spy
        self._closed = False

    @property
    def input_names(self) -> tuple[str, ...]:
        return ("input_ids", "attention_mask")

    @property
    def output_names(self) -> tuple[str, ...]:
        return ("last_hidden_state",) if self.task is ModelTask.EMBEDDING else ("logits",)

    def run(self, feeds: Mapping[str, NDArray[Any]]) -> list[NDArray[Any]]:
        if self._gate is not None:
            # Used by the readiness test to hold warmup open long enough to
            # observe `/readyz` reporting "warming" rather than "ready".
            self._gate.wait(timeout=10.0)
        input_ids = np.asarray(feeds["input_ids"], dtype=np.int64)
        mask = np.asarray(feeds["attention_mask"], dtype=np.int64)
        if self._spy is not None:
            self._spy.runs += 1
            self._spy.batch_sizes.append(int(input_ids.shape[0]))

        if self.task is ModelTask.EMBEDDING:
            columns = np.arange(1, self.dimension + 1, dtype=np.int64)
            states = (input_ids[:, :, None] * columns[None, None, :]) % 13
            return [states.astype(np.float32) / 13.0]

        # One logit per row, monotone in the attended token ids.
        totals = (input_ids * mask).sum(axis=1).astype(np.float32) / 1000.0
        return [totals.reshape(-1, 1)]

    def close(self) -> None:
        self._closed = True

    @property
    def closed(self) -> bool:
        return self._closed


def fake_tokenizer_factory(*, tokenizer_path: Path, entry: ModelEntry) -> FakeTokenizer:
    """A :class:`~app.preprocessing.tokenizer.TokenizerFactory`."""
    return FakeTokenizer(tokenizer_path=tokenizer_path, entry=entry)


def make_session_factory(
    *,
    gate: threading.Event | None = None,
    spy: SessionSpy | None = None,
    dimension: int = FAKE_DIMENSION,
) -> Any:
    """Build a :class:`~app.models.session.SessionFactory` over :class:`FakeSession`."""

    def factory(*, model_path: Path, settings: Settings, model_id: str) -> FakeSession:
        task = ModelTask.RERANK if "rerank" in model_id else ModelTask.EMBEDDING
        return FakeSession(
            model_path=model_path,
            settings=settings,
            model_id=model_id,
            task=task,
            dimension=dimension,
            gate=gate,
            spy=spy,
        )

    return factory


__all__ = [
    "FAKE_DIMENSION",
    "FakeSession",
    "FakeTokenizer",
    "SessionSpy",
    "fake_tokenizer_factory",
    "make_session_factory",
]
