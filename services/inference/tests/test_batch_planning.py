"""Dynamic batching: the plan is pure, stable, and respects both ceilings.

``plan_batches`` is the one piece of the embedding path with interesting
arithmetic, and the property that matters — every input appears exactly once, at
its original index — is what stops a batching change from silently
mis-attributing chunks. Testing it directly is much sharper than inferring it
from a response body.
"""

from __future__ import annotations

from app.inference.embedder import plan_batches
from app.preprocessing.tokenizer import TokenizedText, pad_batch


def _item(length: int) -> TokenizedText:
    return TokenizedText(
        input_ids=tuple(range(1, length + 1)),
        token_type_ids=(0,) * length,
        truncated=False,
    )


def test_every_input_appears_exactly_once() -> None:
    items = [_item(length) for length in (5, 100, 7, 3, 90, 4)]

    plan = plan_batches(items, max_batch_size=2, max_batch_tokens=10_000)

    covered = [index for batch in plan for index in batch.indices]
    assert sorted(covered) == list(range(len(items)))
    assert len(covered) == len(set(covered))


def test_the_item_ceiling_is_hard() -> None:
    items = [_item(4) for _ in range(9)]

    plan = plan_batches(items, max_batch_size=4, max_batch_tokens=10_000)

    assert all(len(batch.indices) <= 4 for batch in plan)
    assert len(plan) == 3


def test_the_padded_token_ceiling_closes_a_batch() -> None:
    """Thirty-two 8192-token sequences must not become one execution."""
    items = [_item(500) for _ in range(8)]

    plan = plan_batches(items, max_batch_size=32, max_batch_tokens=1000)

    assert all(len(batch.indices) <= 2 for batch in plan)


def test_length_grouping_keeps_padding_down() -> None:
    """A 12-token query batched with a 500-token chunk would pad 40x the work."""
    items = [_item(12), _item(500), _item(13), _item(498)]

    plan = plan_batches(items, max_batch_size=2, max_batch_tokens=10_000)

    widths = [max(item.length for item in batch.items) for batch in plan]
    padded = sum(width * len(batch.indices) for width, batch in zip(widths, plan, strict=True))
    naive = max(item.length for item in items) * len(items)
    assert padded < naive


def test_the_plan_is_deterministic() -> None:
    items = [_item(length) for length in (9, 9, 1, 40, 9)]

    first = plan_batches(items, max_batch_size=2, max_batch_tokens=10_000)
    second = plan_batches(items, max_batch_size=2, max_batch_tokens=10_000)

    assert [batch.indices for batch in first] == [batch.indices for batch in second]


def test_padding_is_charged_at_the_batch_width() -> None:
    encoded = pad_batch([_item(3), _item(7)], pad_id=0)

    assert encoded.size == 2
    assert encoded.padded_length == 7
    assert encoded.token_count == 10
    assert encoded.padded_token_count == 14
    assert encoded.attention_mask[0].tolist() == [1, 1, 1, 0, 0, 0, 0]
