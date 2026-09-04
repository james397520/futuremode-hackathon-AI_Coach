"""HuggingFace `tokenizers`-based encoding, behind a port.

Design
------
The port yields **unpadded** per-text token ids (:class:`TokenizedText`) and
padding is a separate, pure numpy step (:func:`pad_batch`). That split is what
makes length-grouped dynamic batching possible: the embedder needs to know every
sequence's true length before it decides which items share a batch, and padding
each group to *its own* longest member is the entire saving. Padding inside the
tokenizer would force one length for the whole request and throw that away.

It also makes the test double trivial — a fake tokenizer only has to produce id
lists — and keeps `tokenizers` out of the import path of every module above.

Truncation behaviour (documented, because it is lossy)
-----------------------------------------------------
Sequences longer than the effective max length are truncated **from the right**,
keeping the special tokens: ``[CLS] first N-2 tokens [SEP]``. The tail is
discarded, not spilled into a second sequence, and the response reports how many
inputs this happened to (``truncated`` per item, ``truncated_count`` in the
response envelope) so a caller can tell the difference between "this chunk
embedded" and "the first 512 tokens of this chunk embedded".

The effective max length is ``min(settings.max_sequence_length,
entry.max_sequence_length, request.max_length or ∞)``. That means the global
ceiling always wins: a model whose manifest claims 8192 (bge-m3 does) still runs
at 512 unless the deployment raises ``INFERENCE_MAX_SEQUENCE_LENGTH``, because
attention cost is quadratic in length and one 8k request would monopolise the
device. Chunking is the API's job (§65 parse → chunk → embed → index); this
service refuses to silently paper over an unchunked document.

Traditional Chinese
-------------------
``app.preprocessing.text.normalize_text`` has already applied NFKC and stripped
control characters. What remains here is per-model and comes from the manifest:

* ``lowercase`` — applied only when the entry says so. It is a no-op for Han
  characters but destroys case in the Latin runs of a mixed zh-TW string, so it
  is on for ``bge-small-en`` and off for everything multilingual.
* ``strip_accents`` — never enabled for a multilingual model. It would fold
  Vietnamese and pinyin diacritics together, and the SentencePiece vocabularies
  of e5/bge-m3 contain the accented forms.
* No Traditional→Simplified mapping, ever. See ``text.py``.

The tokenizer's own normaliser (from ``tokenizer.json``) still runs; these flags
only control the extra pre-pass we apply on top of it.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Final, Protocol, runtime_checkable

import numpy as np

from app.core.errors import ModelLoadError, ValidationFailedError
from app.core.logging import get_logger

if TYPE_CHECKING:
    from collections.abc import Sequence
    from pathlib import Path

    from numpy.typing import NDArray

    from app.models.registry import ModelEntry

logger = get_logger(__name__)

#: Fallback pad id when the tokenizer does not declare one. 0 is the pad id for
#: BERT/XLM-R style vocabularies; the attention mask is what actually protects
#: the pooled output, so an imperfect pad id changes nothing numerically.
DEFAULT_PAD_ID: Final[int] = 0


@dataclass(frozen=True, slots=True)
class TokenizedText:
    """One encoded input, unpadded."""

    input_ids: tuple[int, ...]
    token_type_ids: tuple[int, ...]
    #: True when the input hit the length limit and lost its tail.
    truncated: bool

    @property
    def length(self) -> int:
        return len(self.input_ids)


@dataclass(frozen=True, slots=True)
class EncodedBatch:
    """A padded batch, ready to feed to a graph."""

    input_ids: NDArray[np.int64]
    attention_mask: NDArray[np.int64]
    token_type_ids: NDArray[np.int64]
    #: True token count per row, i.e. the attention mask's row sums.
    lengths: tuple[int, ...]

    @property
    def size(self) -> int:
        return int(self.input_ids.shape[0])

    @property
    def padded_length(self) -> int:
        return int(self.input_ids.shape[1])

    @property
    def token_count(self) -> int:
        """Non-padding tokens — the number worth reporting as `usage`."""
        return sum(self.lengths)

    @property
    def padded_token_count(self) -> int:
        return self.size * self.padded_length


@runtime_checkable
class TokenizerPort(Protocol):
    """Encoding surface used by the inference kernels."""

    def encode(self, texts: Sequence[str], *, max_length: int) -> list[TokenizedText]:
        """Encode single sequences."""
        ...

    def encode_pairs(
        self,
        pairs: Sequence[tuple[str, str]],
        *,
        max_length: int,
    ) -> list[TokenizedText]:
        """Encode ``(query, document)`` pairs for a cross-encoder."""
        ...


@runtime_checkable
class TokenizerFactory(Protocol):
    def __call__(self, *, tokenizer_path: Path, entry: ModelEntry) -> TokenizerPort: ...


class HuggingFaceTokenizer:
    """`tokenizers.Tokenizer` loaded from a ``tokenizer.json`` on disk.

    Padding is disabled on the underlying tokenizer on purpose (see the module
    docstring); truncation is enabled and reconfigured per call because the
    effective max length depends on the request as well as the manifest.
    """

    def __init__(self, *, tokenizer_path: Path, entry: ModelEntry) -> None:
        try:
            from tokenizers import Tokenizer
        except ImportError as exc:  # pragma: no cover - environment problem
            raise ModelLoadError(
                "The tokenizer library is not installed in this image.",
                log_context={"model": entry.id, "reason": "tokenizers_missing"},
            ) from exc
        try:
            self._tokenizer: Any = Tokenizer.from_file(str(tokenizer_path))
        except Exception as exc:  # noqa: BLE001 - the library raises bare Exception
            raise ModelLoadError(
                "The model's tokenizer could not be loaded.",
                log_context={
                    "model": entry.id,
                    "reason": "tokenizer_load_failed",
                    "error_type": type(exc).__name__,
                },
            ) from exc
        self._tokenizer.no_padding()
        self._entry = entry
        self._lowercase = entry.lowercase
        self._strip_accents = entry.strip_accents
        self._configured_max: int | None = None
        self.pad_id: int = _resolve_pad_id(self._tokenizer)

    # ------------------------------------------------------------------ #

    def _pre(self, text: str) -> str:
        """The per-model pre-pass. See "Traditional Chinese" in the docstring."""
        value = text
        if self._lowercase:
            value = value.lower()
        if self._strip_accents:
            import unicodedata

            decomposed = unicodedata.normalize("NFD", value)
            value = unicodedata.normalize(
                "NFC",
                "".join(ch for ch in decomposed if not unicodedata.combining(ch)),
            )
        return value

    def _set_truncation(self, max_length: int) -> None:
        if self._configured_max == max_length:
            return
        # `longest_first` matters for pairs: a long document must not push the
        # query out of the window, and this strategy trims the longer member.
        self._tokenizer.enable_truncation(
            max_length=max_length,
            stride=0,
            strategy="longest_first",
            direction="right",
        )
        self._configured_max = max_length

    def _convert(self, encodings: Sequence[Any], max_length: int) -> list[TokenizedText]:
        out: list[TokenizedText] = []
        for encoding in encodings:
            ids = tuple(int(i) for i in encoding.ids)
            type_ids_raw = getattr(encoding, "type_ids", None)
            type_ids = (
                tuple(int(i) for i in type_ids_raw)
                if type_ids_raw is not None
                else (0,) * len(ids)
            )
            if len(type_ids) != len(ids):  # defensive: keep the arrays aligned
                type_ids = (0,) * len(ids)
            # `tokenizers` reports the discarded tail in `overflowing` when a
            # stride is set; with stride 0 the reliable signal is hitting the cap.
            out.append(
                TokenizedText(
                    input_ids=ids,
                    token_type_ids=type_ids,
                    truncated=len(ids) >= max_length,
                )
            )
        return out

    def encode(self, texts: Sequence[str], *, max_length: int) -> list[TokenizedText]:
        if not texts:
            return []
        self._set_truncation(max_length)
        prepared = [self._pre(text) for text in texts]
        try:
            encodings = self._tokenizer.encode_batch(prepared, add_special_tokens=True)
        except Exception as exc:  # noqa: BLE001 - library raises bare Exception
            raise ValidationFailedError(
                "The input could not be tokenised.",
                log_context={
                    "model": self._entry.id,
                    "reason": "tokenize_failed",
                    "error_type": type(exc).__name__,
                },
            ) from exc
        return self._convert(encodings, max_length)

    def encode_pairs(
        self,
        pairs: Sequence[tuple[str, str]],
        *,
        max_length: int,
    ) -> list[TokenizedText]:
        if not pairs:
            return []
        self._set_truncation(max_length)
        prepared = [(self._pre(left), self._pre(right)) for left, right in pairs]
        try:
            encodings = self._tokenizer.encode_batch(prepared, add_special_tokens=True)
        except Exception as exc:  # noqa: BLE001 - library raises bare Exception
            raise ValidationFailedError(
                "The input could not be tokenised.",
                log_context={
                    "model": self._entry.id,
                    "reason": "tokenize_pairs_failed",
                    "error_type": type(exc).__name__,
                },
            ) from exc
        return self._convert(encodings, max_length)


def _resolve_pad_id(tokenizer: Any) -> int:
    """Best-effort pad id from the tokenizer's own padding configuration."""
    getter = getattr(tokenizer, "token_to_id", None)
    if callable(getter):
        for candidate in ("<pad>", "[PAD]", "<PAD>"):
            token_id = getter(candidate)
            if token_id is not None:
                return int(token_id)
    return DEFAULT_PAD_ID


def pad_batch(items: Sequence[TokenizedText], *, pad_id: int = DEFAULT_PAD_ID) -> EncodedBatch:
    """Pad a group of encodings to the group's own longest member.

    Pure numpy, no tokenizer involvement, so it is directly unit-testable and
    identical for the real and fake tokenizers.
    """
    if not items:
        msg = "pad_batch requires at least one item"
        raise ValueError(msg)
    width = max(item.length for item in items)
    # A zero-length encoding cannot be fed to an encoder; normalisation already
    # rejects all-empty requests, but a single empty member is still possible.
    width = max(width, 1)
    count = len(items)

    input_ids = np.full((count, width), pad_id, dtype=np.int64)
    attention_mask = np.zeros((count, width), dtype=np.int64)
    token_type_ids = np.zeros((count, width), dtype=np.int64)
    lengths: list[int] = []

    for row, item in enumerate(items):
        length = item.length
        lengths.append(length)
        if length == 0:
            # Attend to the single pad slot so the pooled mean is not 0/0. The
            # resulting vector is meaningless but finite, and normalisation
            # upstream already refused a request that was *entirely* empty.
            attention_mask[row, 0] = 1
            continue
        input_ids[row, :length] = np.asarray(item.input_ids, dtype=np.int64)
        attention_mask[row, :length] = 1
        token_type_ids[row, :length] = np.asarray(item.token_type_ids, dtype=np.int64)

    return EncodedBatch(
        input_ids=input_ids,
        attention_mask=attention_mask,
        token_type_ids=token_type_ids,
        lengths=tuple(lengths),
    )


def create_tokenizer(*, tokenizer_path: Path, entry: ModelEntry) -> TokenizerPort:
    """Default :class:`TokenizerFactory`."""
    return HuggingFaceTokenizer(tokenizer_path=tokenizer_path, entry=entry)


def effective_max_length(
    *,
    global_max: int,
    entry_max: int,
    requested: int | None = None,
) -> int:
    """The min of every ceiling, floored at 8. See the module docstring."""
    limit = min(global_max, entry_max)
    if requested is not None:
        if requested < 1:
            raise ValidationFailedError(
                "max_length must be a positive integer.",
                log_context={"reason": "bad_max_length"},
            )
        limit = min(limit, requested)
    return max(8, limit)


__all__ = [
    "DEFAULT_PAD_ID",
    "EncodedBatch",
    "HuggingFaceTokenizer",
    "TokenizedText",
    "TokenizerFactory",
    "TokenizerPort",
    "create_tokenizer",
    "effective_max_length",
    "pad_batch",
]
