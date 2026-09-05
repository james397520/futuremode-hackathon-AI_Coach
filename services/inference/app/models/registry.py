"""The model registry: an on-disk JSON manifest, validated and hash-verified.

Why a manifest file and not a Python dict
-----------------------------------------
Weights are never in git (they are hundreds of megabytes and, for some licences,
not redistributable). ``scripts/download_models.sh`` fetches them into the
``models/`` directory and ``models/manifest.json`` describes what landed there.
Making the manifest data rather than code means:

* an air-gapped deployment can swap the model set without rebuilding the image;
* the allowlist in :class:`~app.core.config.Settings` can be checked against the
  manifest at boot, so "which models can this service load" has one answer;
* the sha256 of every file is recorded, so a truncated download or a tampered
  ``model.onnx`` is a hard failure rather than garbage vectors. Garbage vectors
  are the worst outcome available here: they are silently accepted by Qdrant and
  only show up as degraded retrieval weeks later.

Model ids
---------
Canonical ids are the HuggingFace-style names that ``apps/api/app/rag/embedder.py``
and ``reranker.py`` already send (``BAAI/bge-m3``, ``BAAI/bge-reranker-v2-m3``,
``intfloat/multilingual-e5-large``). Entries may also declare ``aliases`` so the
short ids used by the browser tier's registry
(``packages/ai-runtime/src/manifest.ts`` — ``multilingual-e5-small-int8``,
``ms-marco-minilm-l6-v2-int8``, ``bge-small-en-v1.5-int8``) resolve to the same
weights when a deployment chooses to host them server-side too. Keeping the ids
identical across tiers is what lets §54's "browser reranked first, server
rescored" comparison mean anything.
"""

from __future__ import annotations

import hashlib
import json
from enum import StrEnum
from pathlib import Path
from typing import TYPE_CHECKING, Annotated, Any, Final, Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.core.errors import (
    ModelIntegrityError,
    ModelNotAllowedError,
    ModelNotFoundError,
    ModelTaskMismatchError,
)
from app.core.logging import get_logger

if TYPE_CHECKING:
    from collections.abc import Iterable, Iterator

    from app.core.config import Settings

logger = get_logger(__name__)

MANIFEST_SCHEMA_VERSION: Final[int] = 1
#: Read the file in chunks; a 2 GB model must not be slurped into RAM to be hashed.
_HASH_CHUNK_BYTES: Final[int] = 1024 * 1024
#: Bytes of resident memory per byte of weights, when the manifest does not say.
#: onnxruntime keeps the initialisers plus arena scratch, so >1 is the honest
#: default. Only used for eviction accounting, never for allocation.
_RESIDENT_FACTOR: Final[float] = 1.35


class ModelTask(StrEnum):
    """What the model is for. Endpoints refuse a mismatched task."""

    EMBEDDING = "embedding"
    RERANK = "rerank"
    #: Reserved for the §72 "evaluation model" / parser heads. Loadable and
    #: listable, but no endpoint serves it yet, so it cannot be reached by
    #: accident: `/embed` and `/rerank` both check the task.
    SEQUENCE_CLASSIFICATION = "sequence_classification"


class Pooling(StrEnum):
    """How token states collapse to one vector.

    Getting this wrong does not error — it silently produces a worse embedding
    space, which is why it is manifest data per model rather than a global flag.
    BGE wants CLS, e5 wants mean.
    """

    CLS = "cls"
    MEAN = "mean"
    #: The graph already emits a pooled sentence embedding.
    NONE = "none"


class ScoreActivation(StrEnum):
    """Calibration applied to a reranker's raw logits."""

    NONE = "none"
    #: Single logit -> sigmoid, the bge-reranker / TEI convention.
    SIGMOID = "sigmoid"
    #: Two logits -> softmax, take the positive class (ms-marco MiniLM style).
    SOFTMAX = "softmax"


class ModelFile(BaseModel):
    """One file belonging to a model, with the hash we insist on."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str
    sha256: str
    bytes: Annotated[int, Field(ge=0)] = 0

    @field_validator("name")
    @classmethod
    def _safe_name(cls, value: str) -> str:
        """Reject anything that could escape the model directory.

        The manifest is operator-controlled, but it is still a file on disk that
        a compromised build step could edit, and ``"name": "../../etc/shadow"``
        must not become a readable path. Containment is re-checked in
        :meth:`ModelEntry.resolved_files`; this is the cheap first gate.
        """
        name = value.strip()
        if not name:
            msg = "file name must not be empty"
            raise ValueError(msg)
        candidate = Path(name)
        if candidate.is_absolute() or ".." in candidate.parts:
            msg = f"file name must be a relative path inside the model directory: {value!r}"
            raise ValueError(msg)
        return name

    @field_validator("sha256")
    @classmethod
    def _hex_digest(cls, value: str) -> str:
        digest = value.strip().lower()
        if len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest):
            msg = "sha256 must be 64 hex characters"
            raise ValueError(msg)
        return digest


class ModelEntry(BaseModel):
    """A manifest entry: everything needed to load and use one model."""

    model_config = ConfigDict(extra="forbid", frozen=True, protected_namespaces=())

    id: str
    task: ModelTask
    #: Directory under the model root holding this entry's files.
    path: str
    files: tuple[ModelFile, ...]
    #: Which file is the graph, and which is the tokenizer. Both must be in `files`.
    model_file: str = "model.onnx"
    tokenizer_file: str = "tokenizer.json"

    #: Output width. Required for embedding models: the vector store namespaces
    #: collections by (model, dimension) and mixing geometries corrupts an index.
    dimension: int | None = None
    max_sequence_length: Annotated[int, Field(ge=8, le=8192)] = 512
    pooling: Pooling = Pooling.MEAN
    normalize: bool = True
    score_activation: ScoreActivation = ScoreActivation.NONE

    #: Instruction prefixes. e5 needs `query: ` / `passage: `; BGE-zh needs an
    #: instruction on the query side only. Asymmetry is a correctness requirement,
    #: and the values here mirror `apps/api/app/rag/embedder.py::LOCAL_MODELS`.
    query_prefix: str = ""
    passage_prefix: str = ""

    #: zh-TW is the demo locale. Lower-casing is harmless for CJK but destroys
    #: information for the Latin part of a mixed string, and accent stripping is
    #: outright wrong for a multilingual model — so both are per-model flags,
    #: matching the browser tier's `hints` in packages/ai-runtime.
    lowercase: bool = False
    strip_accents: bool = False

    quantization: str = "none"
    license: str = "unknown"
    source: str = ""
    revision: str = ""
    #: Resident-memory estimate for LRU accounting. Derived from file sizes when absent.
    resident_mb: Annotated[float, Field(ge=0)] = 0.0
    #: Free-form operator note; surfaced by `GET /models`.
    notes: str = ""
    aliases: tuple[str, ...] = ()

    @field_validator("path")
    @classmethod
    def _safe_path(cls, value: str) -> str:
        path = value.strip().strip("/")
        candidate = Path(path)
        if candidate.is_absolute() or ".." in candidate.parts:
            msg = f"path must be relative and inside the model directory: {value!r}"
            raise ValueError(msg)
        return path

    @field_validator("aliases", mode="before")
    @classmethod
    def _coerce_aliases(cls, value: Any) -> tuple[str, ...]:
        if value is None:
            return ()
        if isinstance(value, str):
            return tuple(part.strip() for part in value.split(",") if part.strip())
        return tuple(str(part).strip() for part in value if str(part).strip())

    @model_validator(mode="after")
    def _check_consistency(self) -> Self:
        names = {f.name for f in self.files}
        if not names:
            msg = f"{self.id}: manifest entry lists no files"
            raise ValueError(msg)
        for required in (self.model_file, self.tokenizer_file):
            if required not in names:
                msg = f"{self.id}: {required!r} is not among the entry's files {sorted(names)}"
                raise ValueError(msg)
        if self.task is ModelTask.EMBEDDING and not self.dimension:
            msg = (
                f"{self.id}: an embedding model must declare `dimension`; the vector "
                "store namespaces collections by it"
            )
            raise ValueError(msg)
        if self.task is ModelTask.EMBEDDING and self.pooling is Pooling.NONE:
            # Allowed, but say so out loud: it means the graph pools internally.
            logger.info("registry.entry_self_pooling", model=self.id)
        return self

    # ------------------------------------------------------------------ #

    @property
    def all_ids(self) -> tuple[str, ...]:
        return (self.id, *self.aliases)

    @property
    def estimated_resident_mb(self) -> float:
        if self.resident_mb:
            return self.resident_mb
        total = sum(f.bytes for f in self.files)
        return round(total * _RESIDENT_FACTOR / (1024 * 1024), 2)

    def directory(self, model_dir: Path) -> Path:
        return (model_dir / self.path).resolve()

    def resolved_files(self, model_dir: Path) -> dict[str, Path]:
        """Absolute paths for every file, re-checked for containment.

        The validators already reject ``..`` in the manifest, but a symlink inside
        the model directory can still point outside it, so the final resolved path
        is compared against the resolved root. Belt and braces on the one code
        path that turns caller-influenced strings into file reads.
        """
        root = model_dir.resolve()
        out: dict[str, Path] = {}
        for spec in self.files:
            candidate = (root / self.path / spec.name).resolve()
            if not candidate.is_relative_to(root):
                raise ModelIntegrityError(
                    "A model file resolves outside the model directory and was refused.",
                    log_context={"model": self.id, "reason": "path_escape"},
                )
            out[spec.name] = candidate
        return out


class ManifestDocument(BaseModel):
    """Top-level shape of ``models/manifest.json``."""

    model_config = ConfigDict(extra="forbid", protected_namespaces=())

    schema_version: int = MANIFEST_SCHEMA_VERSION
    #: Informational: who generated the file and when.
    generated_by: str = ""
    generated_at: str = ""
    models: tuple[ModelEntry, ...] = ()

    @model_validator(mode="after")
    def _check_version_and_ids(self) -> Self:
        if self.schema_version != MANIFEST_SCHEMA_VERSION:
            msg = (
                f"manifest schema_version {self.schema_version} is not supported "
                f"(expected {MANIFEST_SCHEMA_VERSION})"
            )
            raise ValueError(msg)
        seen: set[str] = set()
        for entry in self.models:
            for identifier in entry.all_ids:
                if identifier in seen:
                    msg = f"duplicate model id or alias in manifest: {identifier!r}"
                    raise ValueError(msg)
                seen.add(identifier)
        return self


def sha256_file(path: Path, *, chunk_bytes: int = _HASH_CHUNK_BYTES) -> str:
    """Streaming sha256 of a file."""
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(chunk_bytes):
            digest.update(chunk)
    return digest.hexdigest()


class ModelRegistry:
    """Resolves model ids to verified, ready-to-load :class:`ModelEntry` records.

    Construction never raises on a bad manifest: the error is captured in
    :attr:`load_error` so ``/health/live`` and ``/metrics`` stay up for
    debugging while ``/health/ready`` reports red with a reason. A service that
    refuses to start is much harder to diagnose in a locked-down environment
    than one that starts and says what is wrong.
    """

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._entries: dict[str, ModelEntry] = {}
        self._by_alias: dict[str, str] = {}
        self._verified: set[str] = set()
        self.load_error: str | None = None

    # ------------------------------------------------------------------ #
    # loading
    # ------------------------------------------------------------------ #

    def load(self) -> None:
        """Read and validate the manifest. Replaces the current contents."""
        path = self._settings.manifest_path
        try:
            raw = path.read_text(encoding="utf-8")
        except FileNotFoundError:
            self._fail(
                f"model manifest not found at {path}",
                reason="manifest_missing",
            )
            return
        except OSError as exc:
            self._fail(f"model manifest unreadable: {exc.strerror}", reason="manifest_unreadable")
            return

        try:
            payload = json.loads(raw)
        except json.JSONDecodeError as exc:
            self._fail(f"model manifest is not valid JSON (line {exc.lineno})", reason="bad_json")
            return

        try:
            document = ManifestDocument.model_validate(payload)
        except ValueError as exc:
            self._fail(f"model manifest failed validation: {exc}", reason="bad_schema")
            return

        entries: dict[str, ModelEntry] = {}
        aliases: dict[str, str] = {}
        skipped: list[str] = []
        for entry in document.models:
            if not self._settings.is_model_allowed(entry.id):
                skipped.append(entry.id)
                continue
            entries[entry.id] = entry
            for alias in entry.aliases:
                aliases[alias] = entry.id

        self._entries = entries
        self._by_alias = aliases
        self._verified.clear()
        self.load_error = None
        logger.info(
            "registry.loaded",
            model_count=len(entries),
            alias_count=len(aliases),
            skipped_by_allowlist=len(skipped),
            schema_version=document.schema_version,
        )
        # A missing preload target is a configuration error worth shouting about
        # at boot rather than at first request.
        for model_id in self._settings.preload_models:
            if self._lookup(model_id) is None:
                logger.error("registry.preload_missing", model=model_id)

    def _fail(self, message: str, *, reason: str) -> None:
        self._entries = {}
        self._by_alias = {}
        self._verified.clear()
        self.load_error = message
        # `message` is built from operator configuration, never from request data.
        logger.error("registry.load_failed", reason=reason, error_type=message)

    # ------------------------------------------------------------------ #
    # lookup
    # ------------------------------------------------------------------ #

    def _lookup(self, model_id: str) -> ModelEntry | None:
        canonical = self._by_alias.get(model_id, model_id)
        return self._entries.get(canonical)

    def __contains__(self, model_id: object) -> bool:
        return isinstance(model_id, str) and self._lookup(model_id) is not None

    def __len__(self) -> int:
        return len(self._entries)

    def __iter__(self) -> Iterator[ModelEntry]:
        return iter(sorted(self._entries.values(), key=lambda e: e.id))

    def entries(self) -> tuple[ModelEntry, ...]:
        return tuple(iter(self))

    def resolve(self, model_id: str, *, task: ModelTask | None = None) -> ModelEntry:
        """Look up a model id, enforcing the allowlist and the task.

        Order matters. The allowlist is checked *before* manifest membership so
        that a caller probing for model names cannot distinguish "not permitted"
        from "not installed" for anything off the list — and so the error the
        operator sees names the real cause.
        """
        if not model_id or not model_id.strip():
            raise ModelNotAllowedError("A model id is required.")
        candidate = model_id.strip()
        canonical = self._by_alias.get(candidate, candidate)
        if not self._settings.is_model_allowed(canonical):
            raise ModelNotAllowedError(
                "The requested model is not permitted on this deployment.",
                log_context={"model": candidate, "reason": "allowlist"},
            )
        entry = self._entries.get(canonical)
        if entry is None:
            if self.load_error is not None:
                raise ModelIntegrityError(
                    "The model manifest could not be loaded; no models are available.",
                    log_context={"model": candidate, "reason": "manifest_unavailable"},
                )
            raise ModelNotFoundError(
                "The requested model is not present in the model manifest.",
                log_context={"model": candidate, "reason": "not_in_manifest"},
            )
        if task is not None and entry.task is not task:
            raise ModelTaskMismatchError(
                f"Model {entry.id} is a {entry.task.value} model and cannot serve a "
                f"{task.value} request.",
                log_context={"model": entry.id, "model_task": entry.task.value},
            )
        return entry

    def default_for(self, task: ModelTask) -> str:
        if task is ModelTask.EMBEDDING:
            return self._settings.default_embedding_model
        if task is ModelTask.RERANK:
            return self._settings.default_rerank_model
        msg = f"no default model configured for task {task.value}"
        raise ModelTaskMismatchError(msg)

    # ------------------------------------------------------------------ #
    # verification
    # ------------------------------------------------------------------ #

    def is_verified(self, model_id: str) -> bool:
        entry = self._lookup(model_id)
        return entry is not None and entry.id in self._verified

    def verify(self, entry: ModelEntry, *, force: bool = False) -> dict[str, Path]:
        """Check every file exists and hashes as declared. Returns resolved paths.

        Raises :class:`ModelIntegrityError` on a missing file, an unreadable file
        or a digest mismatch. Never falls back to loading anyway: a mismatched
        ``model.onnx`` produces plausible-looking vectors from the wrong weights,
        and those poison a vector index irreversibly.

        Verification is memoised per entry — hashing a 2 GB graph on every
        request would dominate latency — and re-run on ``force``.
        """
        paths = entry.resolved_files(self._settings.model_dir)
        if entry.id in self._verified and not force:
            return paths

        for spec in entry.files:
            path = paths[spec.name]
            if not path.is_file():
                raise ModelIntegrityError(
                    "A required model file is missing on disk. Run the model "
                    "download script for this deployment.",
                    log_context={
                        "model": entry.id,
                        "reason": "file_missing",
                        # File *name*, not the absolute path: paths leak layout.
                        "error_type": spec.name,
                    },
                )
            if spec.bytes:
                actual_bytes = path.stat().st_size
                if actual_bytes != spec.bytes:
                    raise ModelIntegrityError(
                        "A model file has an unexpected size and was refused.",
                        log_context={
                            "model": entry.id,
                            "reason": "size_mismatch",
                            "error_type": spec.name,
                        },
                    )
            if not self._settings.verify_sha256:
                continue
            try:
                digest = sha256_file(path)
            except OSError as exc:
                raise ModelIntegrityError(
                    "A model file could not be read for verification.",
                    log_context={
                        "model": entry.id,
                        "reason": "unreadable",
                        "error_type": type(exc).__name__,
                    },
                ) from exc
            if digest != spec.sha256:
                raise ModelIntegrityError(
                    "A model file failed its sha256 check and was refused. The "
                    "weights on disk do not match the manifest.",
                    log_context={
                        "model": entry.id,
                        "reason": "sha256_mismatch",
                        "error_type": spec.name,
                    },
                )

        self._verified.add(entry.id)
        logger.info(
            "registry.verified",
            model=entry.id,
            file_count=len(entry.files),
            hashed=self._settings.verify_sha256,
        )
        return paths

    def verify_all(self, model_ids: Iterable[str] | None = None) -> list[str]:
        """Verify a set of models, returning the ids that failed."""
        targets = list(model_ids) if model_ids is not None else [e.id for e in self]
        failed: list[str] = []
        for model_id in targets:
            entry = self._lookup(model_id)
            if entry is None:
                failed.append(model_id)
                continue
            try:
                self.verify(entry)
            except ModelIntegrityError:
                failed.append(model_id)
        return failed


__all__ = [
    "MANIFEST_SCHEMA_VERSION",
    "ManifestDocument",
    "ModelEntry",
    "ModelFile",
    "ModelRegistry",
    "ModelTask",
    "Pooling",
    "ScoreActivation",
    "sha256_file",
]
