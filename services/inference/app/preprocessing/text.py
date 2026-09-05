"""Text normalisation and the input length guard.

Normalisation rules (and why each one)
--------------------------------------
The demo and first production locale is **zh-TW**, so the ordering here is chosen
to be safe for Traditional Chinese rather than convenient for English:

* **NFKC** is applied. It folds full-width ASCII (``１２３ＡＢＣ``) and the CJK
  compatibility forms that arrive from PDFs and Office documents onto their
  canonical code points, which is what the SentencePiece/WordPiece vocabularies
  of BGE and multilingual-e5 were trained on. Without it, a full-width digit
  tokenises differently from the same digit in the query and retrieval quietly
  degrades. NFKC does **not** touch the Traditional/Simplified distinction.
* **No Traditional → Simplified conversion.** It is tempting (some models score
  better on Simplified) but it is lossy and irreversible for names and legal
  terms, and it would make the stored chunk text differ from what the customer
  uploaded. The models handle Traditional directly; we keep the source.
* **No lowercasing or accent stripping here.** Both are per-model flags in the
  manifest (``lowercase`` / ``strip_accents``), applied by the tokenizer, because
  they are correct for ``bge-small-en`` and wrong for a multilingual model.
* **Control characters are removed, not replaced**, except that line and
  paragraph separators collapse to a single space. PDF extraction produces a lot
  of ``\\x0c`` and zero-width joiners; they add tokens and carry no meaning.
* **Whitespace collapses to single spaces**, and no space is inserted between
  CJK characters — CJK needs no word separator and inserting one would double
  the token count.

The length guard
----------------
:func:`guard_length` runs **before** tokenisation. Tokenising a 50 MB string
allocates on the order of the string length in Python objects and can take the
process down; a typed 413 is the only acceptable response. Note the ordering:
character count is checked first (cheap), then the per-request item count, and
only then does anything reach the tokenizer.
"""

from __future__ import annotations

import re
import unicodedata
from typing import TYPE_CHECKING, Final

from app.core.errors import FieldError, PayloadTooLargeError, ValidationFailedError

if TYPE_CHECKING:
    from collections.abc import Sequence

#: Line/paragraph separators and the form feed become a space.
_LINE_BREAKS: Final[re.Pattern[str]] = re.compile(
    r"[\r\n\x0b\x0c\x85\u2028\u2029]+"
)
#: Any remaining C0/C1 control char, plus zero-width and BOM characters, is dropped.
#: TAB is handled by the whitespace collapse below.
_CONTROL_CHARS: Final[re.Pattern[str]] = re.compile(
    r"[\x00-\x08\x0e-\x1f\x7f-\x9f\u200b-\u200f\u2060\ufeff]"
)
_WHITESPACE: Final[re.Pattern[str]] = re.compile(r"\s+")

#: Rough characters-per-token for the length pre-check. CJK is denser than
#: Latin — one character is frequently one token — so this stays conservative.
CHARS_PER_TOKEN_ESTIMATE: Final[int] = 1


def normalize_text(value: str) -> str:
    """Apply the normalisation described in the module docstring.

    Idempotent: ``normalize_text(normalize_text(x)) == normalize_text(x)``.
    """
    if not value:
        return ""
    text = unicodedata.normalize("NFKC", value)
    text = _LINE_BREAKS.sub(" ", text)
    text = _CONTROL_CHARS.sub("", text)
    text = _WHITESPACE.sub(" ", text)
    return text.strip()


def guard_length(
    values: Sequence[str],
    *,
    max_items: int,
    max_chars: int,
    field: str = "body.texts",
) -> None:
    """Reject absurd input with a typed 4xx rather than OOM-ing.

    Raises :class:`ValidationFailedError` for a structurally wrong request (empty
    list, non-string member) and :class:`PayloadTooLargeError` for one that is
    merely too big — the distinction matters because the caller's remedy differs:
    fix the request versus split the batch.
    """
    if not values:
        raise ValidationFailedError(
            "At least one input is required.",
            errors=[FieldError(field=field, message="must contain at least one item")],
            log_context={"reason": "empty_input"},
        )
    if len(values) > max_items:
        raise PayloadTooLargeError(
            f"At most {max_items} inputs are accepted per request; received {len(values)}.",
            errors=[FieldError(field=field, message=f"at most {max_items} items")],
            log_context={"reason": "too_many_items", "item_count": len(values)},
        )
    total = 0
    for index, value in enumerate(values):
        if not isinstance(value, str):
            raise ValidationFailedError(
                "Every input must be a string.",
                log_context={"reason": "non_string_input"},
            )
        length = len(value)
        if length > max_chars:
            raise PayloadTooLargeError(
                f"Input at index {index} is {length} characters; the limit is {max_chars}. "
                "Chunk the document before embedding it.",
                errors=[
                    FieldError(
                        field=f"{field}[{index}]",
                        message=f"at most {max_chars} characters",
                    )
                ],
                log_context={"reason": "item_too_long", "item_count": len(values)},
            )
        total += length
    # A request of 256 items each just under the per-item limit is still a way to
    # ask for ~8 M characters of work in one call. Cap the aggregate too.
    aggregate_limit = max_chars * 8
    if total > aggregate_limit:
        raise PayloadTooLargeError(
            f"The request totals {total} characters; the aggregate limit is "
            f"{aggregate_limit}. Split it into smaller batches.",
            errors=[
                FieldError(field=field, message=f"at most {aggregate_limit} characters in total")
            ],
            log_context={"reason": "aggregate_too_long", "item_count": len(values)},
        )


def prepare(
    values: Sequence[str],
    *,
    prefix: str = "",
    max_items: int,
    max_chars: int,
    field: str = "body.texts",
) -> list[str]:
    """Guard, normalise, and apply the model's instruction prefix.

    The prefix is applied *after* normalisation so that a prefix containing
    Traditional Chinese (``bge-large-zh-v1.5``'s query instruction does) is not
    re-normalised on every call, and so the prefix cannot be swallowed by the
    whitespace collapse — ``"query: "`` must keep its trailing space.
    """
    guard_length(values, max_items=max_items, max_chars=max_chars, field=field)
    normalised = [normalize_text(value) for value in values]
    if all(not text for text in normalised):
        raise ValidationFailedError(
            "Every input normalised to an empty string.",
            errors=[FieldError(field=field, message="contains no usable text")],
            log_context={"reason": "all_empty_after_normalisation"},
        )
    if not prefix:
        return normalised
    return [f"{prefix}{text}" for text in normalised]


def estimate_tokens(value: str) -> int:
    """Cheap upper-bound token estimate, used only for the pre-tokenisation guard."""
    return max(1, len(value) // CHARS_PER_TOKEN_ESTIMATE)


__all__ = [
    "CHARS_PER_TOKEN_ESTIMATE",
    "estimate_tokens",
    "guard_length",
    "normalize_text",
    "prepare",
]
