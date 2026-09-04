"""§41 avatar preparation and listing."""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

import structlog
from fastapi import APIRouter, File, Form, Request, UploadFile

from app.core.errors import AvatarPrepareFailedError, PayloadTooLargeError

log = structlog.get_logger(__name__)
router = APIRouter(prefix="/avatars", tags=["avatars"])

MAX_PORTRAIT_BYTES = 16 * 1024 * 1024
ALLOWED_SUFFIX = {".png", ".jpg", ".jpeg", ".webp"}


@router.get("")
async def list_avatars(request: Request) -> dict[str, Any]:
    store = request.app.state.orchestrator.store
    out = []
    for avatar_id in store.list_ids():
        try:
            out.append(store.load(avatar_id).to_json())
        except Exception as exc:  # noqa: BLE001 - one bad avatar must not hide the rest
            out.append({"avatar_id": avatar_id, "error": str(exc)})
    return {"avatars": out}


@router.post("", status_code=201)
async def create_avatar(
    request: Request,
    avatar_name: str = Form(...),
    source_image: UploadFile = File(...),
) -> dict[str, Any]:
    """Register a new avatar from a source portrait (§41).

    The consent record is written as `depicts_real_person: true` with no owner,
    which the store refuses to load. That is deliberate: uploading a face is not
    the same as being allowed to animate it, so the operator has to fill in the
    provenance before the avatar can be used (§73 / ADR-010).
    """
    store = request.app.state.orchestrator.store
    avatar_id = "".join(c if c.isalnum() or c in "-_" else "_" for c in avatar_name).strip("_")
    if not avatar_id:
        raise AvatarPrepareFailedError("avatar_name did not contain any usable characters")

    suffix = Path(source_image.filename or "").suffix.lower()
    if suffix not in ALLOWED_SUFFIX:
        raise AvatarPrepareFailedError(f"unsupported portrait type {suffix!r}")

    payload = await source_image.read()
    if len(payload) > MAX_PORTRAIT_BYTES:
        raise PayloadTooLargeError(f"portrait is {len(payload)} bytes; max {MAX_PORTRAIT_BYTES}")

    root = store.root / avatar_id
    if root.exists():
        raise AvatarPrepareFailedError(f"avatar {avatar_id!r} already exists")

    try:
        (root / "source").mkdir(parents=True)
        (root / "license").mkdir(parents=True)
        (root / "loops").mkdir(parents=True)
        (root / "motion").mkdir(parents=True)
        (root / "cache").mkdir(parents=True)
        (root / "source" / f"portrait{suffix}").write_bytes(payload)
        (root / "avatar.json").write_text(
            json.dumps(
                {
                    "avatar_id": avatar_id,
                    "display_name": avatar_name,
                    "source": {"image": f"source/portrait{suffix}", "kind": "uploaded"},
                    "expressions": [
                        "neutral", "listening", "skeptical",
                        "concerned", "frustrated", "interested",
                    ],
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        (root / "license" / "consent.json").write_text(
            json.dumps(
                {
                    "likeness_kind": "uploaded",
                    "depicts_real_person": True,
                    "owner": None,
                    "license": None,
                    "consent_basis": None,
                    "_note": (
                        "Incomplete on purpose. The store refuses to load an avatar that "
                        "claims a real person without naming who consented (§73). Fill in "
                        "owner/license/consent_basis, or set depicts_real_person=false if "
                        "this likeness is synthetic."
                    ),
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
    except OSError as exc:
        shutil.rmtree(root, ignore_errors=True)
        raise AvatarPrepareFailedError(f"could not write avatar {avatar_id!r}: {exc}") from exc

    log.info("avatar.prepared", avatar_id=avatar_id, bytes=len(payload))
    return {
        "avatar_id": avatar_id,
        "status": "preparing",
        "consent_required": True,
        "next": f"complete {root / 'license' / 'consent.json'} before starting a session",
    }


@router.post("/{avatar_id}/build-expression-bank")
async def build_expression_bank(avatar_id: str, request: Request) -> dict[str, Any]:
    """§41: generate the prerendered expression loops.

    This needs LivePortrait, which is an offline, one-off job rather than
    something the request path should block on. Reports what is missing instead
    of pretending to start.
    """
    from app.platform.detect import cached_platform

    store = request.app.state.orchestrator.store
    avatar = store.load(avatar_id)
    platform = cached_platform()
    if not platform.modules.get("mlx", False):
        return {
            "avatar_id": avatar_id,
            "status": "unavailable",
            "reason": "liveportrait_engine_not_installed",
            "detail": (
                "Expression loops are generated offline by scripts/build_expression_bank.py "
                "with the LivePortrait engine installed. Until then the runtime animates the "
                "source portrait directly, which is the §53 floor and needs no engine."
            ),
            "has_expression_bank": avatar.has_expression_bank,
        }
    return {"avatar_id": avatar_id, "status": "queued", "has_expression_bank": avatar.has_expression_bank}
