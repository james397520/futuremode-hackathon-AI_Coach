"""`ReportService` — the §47 report types, exports and team analytics (§35).

Report types (§47): Individual / Team / Scenario / Skill / Compliance /
Knowledge Gap / Training Completion / Readiness.

Exports (§47): PDF / CSV / XLSX. This service produces the **export payload** — a
`TabularExport` (columns + rows + metadata) plus, for PDF, a structured document
model. Byte generation lives in the export layer/worker: CSV is emitted here because
it is pure stdlib, while XLSX needs `openpyxl` and PDF needs a renderer, both of
which are worker-image concerns (see the report notes on extra dependencies).

Every query is tenant-scoped through the repository, and any report that spans other
users requires a manager/coach/reviewer role (§9).
"""

from __future__ import annotations

import csv
import io
from collections.abc import Mapping, Sequence
from enum import StrEnum
from typing import Any

import structlog
from pydantic import BaseModel, ConfigDict, Field

from app.agents.evaluator_agent import SKILL_KEYS
from app.core.context import RequestContext  # assumed: app.core.context.RequestContext
from app.services.base import (
    MANAGEMENT_ROLES,
    REVIEW_ROLES,
    ROLE_COACH,
    BaseService,
    iso_now,
)
from app.services.exceptions import NotFoundError, ValidationFailedError
from app.services.repository import Repository, RepositoryPort, field

log = structlog.get_logger(__name__)


class ReportType(StrEnum):
    INDIVIDUAL = "individual"
    TEAM = "team"
    SCENARIO = "scenario"
    SKILL = "skill"
    COMPLIANCE = "compliance"
    KNOWLEDGE_GAP = "knowledge_gap"
    TRAINING_COMPLETION = "training_completion"
    READINESS = "readiness"


class ExportFormat(StrEnum):
    CSV = "csv"
    XLSX = "xlsx"
    PDF = "pdf"


class ReportFilter(BaseModel):
    """§35 filters: team / user / role / scenario / date / skill / score / risk."""

    model_config = ConfigDict(extra="forbid")

    user_ids: list[str] = Field(default_factory=list)
    team_ids: list[str] = Field(default_factory=list)
    scenario_ids: list[str] = Field(default_factory=list)
    skills: list[str] = Field(default_factory=list)
    role: str | None = None
    date_from: str | None = None
    date_to: str | None = None
    min_score: int | None = None
    max_score: int | None = None
    risk_at_least: str | None = None
    limit: int = 1000


class TabularExport(BaseModel):
    """Format-neutral export payload (CSV/XLSX renderers consume this directly)."""

    model_config = ConfigDict(extra="forbid")

    title: str
    columns: list[str] = Field(default_factory=list)
    rows: list[list[Any]] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    #: one sheet per key for XLSX exports
    extra_sheets: dict[str, dict[str, Any]] = Field(default_factory=dict)


class PdfSection(BaseModel):
    model_config = ConfigDict(extra="forbid")

    heading: str
    body: str = ""
    table: TabularExport | None = None
    bullets: list[str] = Field(default_factory=list)


class PdfDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str
    subtitle: str = ""
    generated_at: str = Field(default_factory=iso_now)
    sections: list[PdfSection] = Field(default_factory=list)
    footer: str = ""


class Report(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: ReportType
    title: str
    generated_at: str = Field(default_factory=iso_now)
    summary: dict[str, Any] = Field(default_factory=dict)
    data: dict[str, Any] = Field(default_factory=dict)
    export: TabularExport | None = None


RISK_ORDER = ("safe", "low", "medium", "high", "critical")


class ReportService(BaseService):
    """`Service(db_session, ctx)`."""

    def __init__(
        self,
        db: Any,
        ctx: RequestContext,
        *,
        repo: RepositoryPort | None = None,
    ) -> None:
        super().__init__(db, ctx)
        self.repo: RepositoryPort = repo or Repository(
            db, tenant_id=self.tenant_id, workspace_id=self.workspace_id
        )

    # ------------------------------------------------------------------
    # dispatch
    # ------------------------------------------------------------------
    async def build(self, report_type: ReportType, filters: ReportFilter) -> Report:
        builders = {
            ReportType.INDIVIDUAL: self.individual,
            ReportType.TEAM: self.team,
            ReportType.SCENARIO: self.scenario,
            ReportType.SKILL: self.skill,
            ReportType.COMPLIANCE: self.compliance,
            ReportType.KNOWLEDGE_GAP: self.knowledge_gap,
            ReportType.TRAINING_COMPLETION: self.training_completion,
            ReportType.READINESS: self.readiness,
        }
        builder = builders.get(report_type)
        if builder is None:
            raise ValidationFailedError(f"unknown report type: {report_type}")
        return await builder(filters)

    # ------------------------------------------------------------------
    # §47 report types
    # ------------------------------------------------------------------
    async def individual(self, filters: ReportFilter) -> Report:
        user_id = (filters.user_ids or [self.user_id])[0]
        self.require_self_or_role(
            user_id, ROLE_COACH, *MANAGEMENT_ROLES, *REVIEW_ROLES,
            action="read another user's report",
        )
        sessions = await self._sessions(filters, user_ids=[user_id])
        evaluations = await self._evaluations_for(sessions)
        profiles = await self.repo.list("SkillProfile", filters={"user_id": user_id})
        profile = profiles[0] if profiles else None

        columns = [
            "session_id", "scenario_id", "scenario_version", "mode", "started_at",
            "overall_score", "passed", "compliance_status",
        ]
        rows: list[list[Any]] = []
        for session in sessions:
            evaluation = evaluations.get(str(field(session, "session_id") or field(session, "id")))
            rows.append(
                [
                    str(field(session, "session_id") or field(session, "id")),
                    str(field(session, "scenario_id", "")),
                    int(field(session, "scenario_version", 1) or 1),
                    str(field(session, "mode", "")),
                    str(field(session, "started_at", "")),
                    int(field(evaluation, "overall_score", 0) or 0) if evaluation else None,
                    bool(field(evaluation, "passed", False)) if evaluation else None,
                    str(field(evaluation, "compliance_status", "")) if evaluation else None,
                ]
            )
        scores = [row[5] for row in rows if isinstance(row[5], int)]
        summary = {
            "user_id": user_id,
            "sessions": len(sessions),
            "average_score": round(sum(scores) / len(scores), 1) if scores else 0,
            "pass_rate": round(
                sum(1 for row in rows if row[6]) / len(rows) * 100, 1
            ) if rows else 0.0,
            "overall_score": int(field(profile, "overall_score", 0) or 0) if profile else 0,
            "weakest_skill": field(profile, "weakest_skill") if profile else None,
            "strongest_skill": field(profile, "strongest_skill") if profile else None,
        }
        return Report(
            type=ReportType.INDIVIDUAL,
            title=f"Individual Report · {user_id}",
            summary=summary,
            data={
                "skills": dict(field(profile, "skills") or {}) if profile else {},
                "compliance_trend": list(field(profile, "compliance_trend") or [])
                if profile
                else [],
            },
            export=TabularExport(
                title="Sessions", columns=columns, rows=rows, metadata=summary
            ),
        )

    async def team(self, filters: ReportFilter) -> Report:
        """§35 Manager / Team Analytics."""
        self.require_role(*MANAGEMENT_ROLES, ROLE_COACH, action="read team analytics")
        sessions = await self._sessions(filters)
        evaluations = await self._evaluations_for(sessions)
        by_user: dict[str, list[Any]] = {}
        for session in sessions:
            evaluation = evaluations.get(
                str(field(session, "session_id") or field(session, "id"))
            )
            if evaluation is not None:
                by_user.setdefault(str(field(session, "user_id", "")), []).append(evaluation)

        skill_matrix: dict[str, dict[str, float]] = {}
        rows: list[list[Any]] = []
        for user_id, items in sorted(by_user.items()):
            scores = [int(field(e, "overall_score", 0) or 0) for e in items]
            passes = [bool(field(e, "passed", False)) for e in items]
            risks = [str(field(e, "compliance_status", "safe")) for e in items]
            per_skill: dict[str, list[int]] = {}
            for evaluation in items:
                for skill in field(evaluation, "skills") or []:
                    key = str(skill.get("skill"))
                    if key in SKILL_KEYS:
                        per_skill.setdefault(key, []).append(int(skill.get("score", 0) or 0))
            skill_matrix[user_id] = {
                key: round(sum(values) / len(values), 1) for key, values in per_skill.items()
            }
            rows.append(
                [
                    user_id,
                    len(items),
                    round(sum(scores) / len(scores), 1) if scores else 0,
                    round(sum(passes) / len(passes) * 100, 1) if passes else 0.0,
                    max(risks, key=lambda r: RISK_ORDER.index(r) if r in RISK_ORDER else 0)
                    if risks
                    else "safe",
                ]
            )

        all_scores = [row[2] for row in rows]
        weakness = self._weakness_heatmap(skill_matrix)
        summary = {
            "members": len(rows),
            "team_average": round(sum(all_scores) / len(all_scores), 1) if all_scores else 0,
            "pass_rate": round(sum(row[3] for row in rows) / len(rows), 1) if rows else 0.0,
            "high_potential": [row[0] for row in rows if row[2] >= 85][:10],
            "low_readiness": [row[0] for row in rows if row[2] < 60][:10],
            "compliance_risk_members": [
                row[0] for row in rows if row[4] in ("high", "critical")
            ],
        }
        return Report(
            type=ReportType.TEAM,
            title="Team Report",
            summary=summary,
            data={"skill_matrix": skill_matrix, "weakness_heatmap": weakness},
            export=TabularExport(
                title="Team",
                columns=["user_id", "sessions", "average_score", "pass_rate", "worst_risk"],
                rows=rows,
                metadata=summary,
                extra_sheets={
                    "skill_matrix": {
                        "columns": ["user_id", *SKILL_KEYS],
                        "rows": [
                            [user_id, *[skill_matrix[user_id].get(key) for key in SKILL_KEYS]]
                            for user_id in sorted(skill_matrix)
                        ],
                    }
                },
            ),
        )

    async def scenario(self, filters: ReportFilter) -> Report:
        self.require_role(*MANAGEMENT_ROLES, ROLE_COACH, action="read scenario reports")
        sessions = await self._sessions(filters)
        evaluations = await self._evaluations_for(sessions)
        grouped: dict[tuple[str, int], list[Any]] = {}
        for session in sessions:
            evaluation = evaluations.get(
                str(field(session, "session_id") or field(session, "id"))
            )
            key = (
                str(field(session, "scenario_id", "")),
                int(field(session, "scenario_version", 1) or 1),
            )
            grouped.setdefault(key, []).append(evaluation)
        rows: list[list[Any]] = []
        for (scenario_id, version), items in sorted(grouped.items()):
            scored = [int(field(e, "overall_score", 0) or 0) for e in items if e is not None]
            passed = [bool(field(e, "passed", False)) for e in items if e is not None]
            rows.append(
                [
                    scenario_id,
                    version,
                    len(items),
                    round(sum(scored) / len(scored), 1) if scored else 0,
                    round(sum(passed) / len(passed) * 100, 1) if passed else 0.0,
                ]
            )
        return Report(
            type=ReportType.SCENARIO,
            title="Scenario Report",
            summary={"scenarios": len(rows), "attempts": len(sessions)},
            data={},
            export=TabularExport(
                title="Scenarios",
                columns=["scenario_id", "version", "attempts", "average_score", "pass_rate"],
                rows=rows,
            ),
        )

    async def skill(self, filters: ReportFilter) -> Report:
        self.require_role(*MANAGEMENT_ROLES, ROLE_COACH, action="read skill reports")
        sessions = await self._sessions(filters)
        evaluations = await self._evaluations_for(sessions)
        aggregate: dict[str, list[int]] = {}
        confidence: dict[str, list[float]] = {}
        for evaluation in evaluations.values():
            for skill in field(evaluation, "skills") or []:
                key = str(skill.get("skill"))
                if filters.skills and key not in filters.skills:
                    continue
                aggregate.setdefault(key, []).append(int(skill.get("score", 0) or 0))
                confidence.setdefault(key, []).append(float(skill.get("confidence", 0) or 0))
        rows = [
            [
                key,
                round(sum(values) / len(values), 1),
                min(values),
                max(values),
                round(sum(confidence[key]) / len(confidence[key]), 2),
                len(values),
            ]
            for key, values in sorted(aggregate.items())
        ]
        return Report(
            type=ReportType.SKILL,
            title="Skill Report",
            summary={
                "dimensions": len(rows),
                "weakest": min(rows, key=lambda r: r[1])[0] if rows else None,
            },
            data={},
            export=TabularExport(
                title="Skills",
                columns=["skill", "average", "min", "max", "mean_confidence", "samples"],
                rows=rows,
            ),
        )

    async def compliance(self, filters: ReportFilter) -> Report:
        """§32 Compliance Report."""
        self.require_role(
            *MANAGEMENT_ROLES, *REVIEW_ROLES, ROLE_COACH, action="read compliance reports"
        )
        sessions = await self._sessions(filters)
        session_ids = [
            str(field(session, "session_id") or field(session, "id")) for session in sessions
        ]
        findings = (
            await self.repo.list(
                "ComplianceFinding",
                filters={"session_id": session_ids},
                order_by="-timestamp_ms",
                limit=filters.limit,
            )
            if session_ids
            else []
        )
        threshold = (
            RISK_ORDER.index(filters.risk_at_least)
            if filters.risk_at_least in RISK_ORDER
            else 0
        )
        rows: list[list[Any]] = []
        by_type: dict[str, int] = {}
        for finding in findings:
            severity = str(field(finding, "severity", "safe"))
            if severity in RISK_ORDER and RISK_ORDER.index(severity) < threshold:
                continue
            kind = str(field(finding, "type", ""))
            by_type[kind] = by_type.get(kind, 0) + 1
            rows.append(
                [
                    str(field(finding, "session_id", "")),
                    kind,
                    severity,
                    int(field(finding, "timestamp_ms", 0) or 0),
                    str(field(finding, "evidence", "") or "")[:200],
                    str(field(finding, "policy_rule", "") or ""),
                    str(field(finding, "suggested_correction", "") or "")[:200],
                    str(field(finding, "reviewer_status", "open") or "open"),
                ]
            )
        summary = {
            "findings": len(rows),
            "by_type": by_type,
            "open": sum(1 for row in rows if row[7] == "open"),
            "critical": sum(1 for row in rows if row[2] == "critical"),
        }
        return Report(
            type=ReportType.COMPLIANCE,
            title="Compliance Report",
            summary=summary,
            data={},
            export=TabularExport(
                title="Findings",
                columns=[
                    "session_id", "type", "severity", "timestamp_ms", "evidence",
                    "policy_rule", "suggested_correction", "reviewer_status",
                ],
                rows=rows,
                metadata=summary,
            ),
        )

    async def knowledge_gap(self, filters: ReportFilter) -> Report:
        """Which knowledge the cohort keeps missing (§35 Knowledge Gap)."""
        self.require_role(*MANAGEMENT_ROLES, ROLE_COACH, action="read knowledge gap reports")
        sessions = await self._sessions(filters)
        evaluations = await self._evaluations_for(sessions)
        gaps: dict[str, int] = {}
        no_evidence: dict[str, int] = {}
        for evaluation in evaluations.values():
            for name in field(evaluation, "dimensions_without_evidence") or []:
                no_evidence[str(name)] = no_evidence.get(str(name), 0) + 1
            for skill in field(evaluation, "skills") or []:
                key = str(skill.get("skill"))
                if key in ("professional_knowledge", "product_knowledge", "compliance") and int(
                    skill.get("score", 100) or 100
                ) < 60:
                    gaps[key] = gaps.get(key, 0) + 1
        rows = [[key, count] for key, count in sorted(gaps.items(), key=lambda p: -p[1])]
        return Report(
            type=ReportType.KNOWLEDGE_GAP,
            title="Knowledge Gap Report",
            summary={"gap_dimensions": len(rows), "sessions": len(sessions)},
            data={"never_observed": no_evidence},
            export=TabularExport(
                title="Knowledge Gaps", columns=["dimension", "affected_sessions"], rows=rows
            ),
        )

    async def training_completion(self, filters: ReportFilter) -> Report:
        """§36 assignment completion."""
        self.require_role(*MANAGEMENT_ROLES, ROLE_COACH, action="read completion reports")
        assignments = await self.repo.list("Assignment", limit=filters.limit)
        sessions = await self._sessions(filters)
        rows: list[list[Any]] = []
        for assignment in assignments:
            assignees = set(field(assignment, "assignee_user_ids") or [])
            related = [
                session
                for session in sessions
                if str(field(session, "scenario_id", ""))
                == str(field(assignment, "scenario_id", ""))
            ]
            completed = {
                str(field(session, "user_id", ""))
                for session in related
                if str(field(session, "status", "")) == "completed"
            }
            rows.append(
                [
                    str(field(assignment, "id", "")),
                    str(field(assignment, "scenario_id", "")),
                    len(assignees),
                    len(assignees & completed),
                    round(len(assignees & completed) / len(assignees) * 100, 1)
                    if assignees
                    else 0.0,
                    str(field(assignment, "deadline", "") or ""),
                    bool(field(assignment, "mandatory", False)),
                ]
            )
        return Report(
            type=ReportType.TRAINING_COMPLETION,
            title="Training Completion Report",
            summary={"assignments": len(rows)},
            data={},
            export=TabularExport(
                title="Completion",
                columns=[
                    "assignment_id", "scenario_id", "assigned", "completed",
                    "completion_rate", "deadline", "mandatory",
                ],
                rows=rows,
            ),
        )

    async def readiness(self, filters: ReportFilter) -> Report:
        """Who is ready to face a real customer (§34 days_to_readiness)."""
        self.require_role(*MANAGEMENT_ROLES, ROLE_COACH, action="read readiness reports")
        profiles = await self.repo.list("SkillProfile", limit=filters.limit)
        rows: list[list[Any]] = []
        for profile in profiles:
            if filters.user_ids and str(field(profile, "user_id", "")) not in filters.user_ids:
                continue
            overall = int(field(profile, "overall_score", 0) or 0)
            trend = list(field(profile, "compliance_trend") or [])
            compliance_ok = (trend[-1] if trend else 100) >= 85
            ready = overall >= 75 and compliance_ok
            rows.append(
                [
                    str(field(profile, "user_id", "")),
                    overall,
                    int(field(profile, "completed_sessions", 0) or 0),
                    field(profile, "weakest_skill"),
                    ready,
                    field(profile, "days_to_readiness"),
                ]
            )
        return Report(
            type=ReportType.READINESS,
            title="Readiness Report",
            summary={
                "assessed": len(rows),
                "ready": sum(1 for row in rows if row[4]),
            },
            data={},
            export=TabularExport(
                title="Readiness",
                columns=[
                    "user_id", "overall_score", "completed_sessions", "weakest_skill",
                    "ready", "days_to_readiness",
                ],
                rows=rows,
            ),
        )

    # ------------------------------------------------------------------
    # exports (§47)
    # ------------------------------------------------------------------
    async def export(
        self, report_type: ReportType, filters: ReportFilter, fmt: ExportFormat
    ) -> dict[str, Any]:
        """Return an export descriptor: filename, content type and payload."""
        report = await self.build(report_type, filters)
        if report.export is None:
            raise NotFoundError(f"{report_type} report has no tabular export")
        stamp = iso_now().replace(":", "").replace("-", "")[:15]
        base = f"{report_type}_{stamp}"
        self.audit("report.export", f"report:{report_type}", format=str(fmt))
        if fmt is ExportFormat.CSV:
            return {
                "filename": f"{base}.csv",
                "content_type": "text/csv; charset=utf-8",
                "content": to_csv(report.export),
                "payload": None,
            }
        if fmt is ExportFormat.XLSX:
            # `openpyxl` is not a declared dependency (see report): the worker renders
            # this payload; the shape is deliberately renderer-agnostic.
            return {
                "filename": f"{base}.xlsx",
                "content_type": (
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                ),
                "content": None,
                "payload": to_xlsx_payload(report.export),
            }
        return {
            "filename": f"{base}.pdf",
            "content_type": "application/pdf",
            "content": None,
            "payload": to_pdf_document(report).model_dump(),
        }

    # ------------------------------------------------------------------
    # helpers
    # ------------------------------------------------------------------
    async def _sessions(
        self, filters: ReportFilter, *, user_ids: Sequence[str] | None = None
    ) -> list[Any]:
        query: dict[str, Any] = {}
        target_users = list(user_ids or filters.user_ids)
        if target_users:
            query["user_id"] = target_users
        if filters.scenario_ids:
            query["scenario_id"] = filters.scenario_ids
        rows = await self.repo.list(
            "TrainingSession", filters=query, order_by="-started_at", limit=filters.limit
        )
        if filters.team_ids:
            members = await self._team_members(filters.team_ids)
            rows = [row for row in rows if str(field(row, "user_id", "")) in members]
        if filters.date_from:
            rows = [
                row
                for row in rows
                if str(field(row, "started_at", "")) >= filters.date_from
            ]
        if filters.date_to:
            rows = [
                row for row in rows if str(field(row, "started_at", "")) <= filters.date_to
            ]
        return rows

    async def _team_members(self, team_ids: Sequence[str]) -> set[str]:
        users = await self.repo.list("User", limit=2000) if _has_user_model() else []
        members: set[str] = set()
        for user in users:
            if set(field(user, "team_ids") or []) & set(team_ids):
                members.add(str(field(user, "id", "")))
        return members

    async def _evaluations_for(self, sessions: Sequence[Any]) -> dict[str, Any]:
        ids = [
            str(field(session, "session_id") or field(session, "id")) for session in sessions
        ]
        if not ids:
            return {}
        rows = await self.repo.list(
            "Evaluation", filters={"session_id": ids}, limit=len(ids) * 2
        )
        out: dict[str, Any] = {}
        for row in rows:
            out[str(field(row, "session_id", ""))] = row
        return out

    @staticmethod
    def _weakness_heatmap(matrix: Mapping[str, Mapping[str, float]]) -> dict[str, float]:
        totals: dict[str, list[float]] = {}
        for scores in matrix.values():
            for key, value in scores.items():
                totals.setdefault(key, []).append(float(value))
        return {
            key: round(sum(values) / len(values), 1)
            for key, values in sorted(totals.items(), key=lambda pair: sum(pair[1]) / len(pair[1]))
        }


def to_csv(export: TabularExport) -> str:
    """UTF-8 CSV with a BOM so Excel on Windows opens Chinese correctly."""
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(export.columns)
    for row in export.rows:
        writer.writerow(["" if value is None else value for value in row])
    return "﻿" + buffer.getvalue()


def to_xlsx_payload(export: TabularExport) -> dict[str, Any]:
    """Renderer-agnostic workbook description: one entry per sheet."""
    sheets: list[dict[str, Any]] = [
        {
            "name": export.title[:31] or "Sheet1",
            "columns": export.columns,
            "rows": export.rows,
            "freeze_header": True,
        }
    ]
    for name, sheet in export.extra_sheets.items():
        sheets.append(
            {
                "name": name[:31],
                "columns": list(sheet.get("columns") or []),
                "rows": list(sheet.get("rows") or []),
                "freeze_header": True,
            }
        )
    return {"sheets": sheets, "metadata": export.metadata}


def to_pdf_document(report: Report) -> PdfDocument:
    sections = [
        PdfSection(
            heading="Summary",
            bullets=[f"{key}: {value}" for key, value in report.summary.items()],
        )
    ]
    if report.export is not None:
        sections.append(PdfSection(heading=report.export.title, table=report.export))
    for key, value in report.data.items():
        sections.append(PdfSection(heading=key.replace("_", " ").title(), body=str(value)[:4000]))
    return PdfDocument(
        title=report.title,
        subtitle=f"generated {report.generated_at}",
        sections=sections,
        footer="AI Coach · confidential",
    )


def _has_user_model() -> bool:
    from app.services.repository import ModelNotAvailableError, Models

    try:
        Models.get("User")
    except (ModelNotAvailableError, ModuleNotFoundError, ImportError):
        return False
    return True


__all__ = [
    "RISK_ORDER",
    "ExportFormat",
    "PdfDocument",
    "PdfSection",
    "Report",
    "ReportFilter",
    "ReportService",
    "ReportType",
    "TabularExport",
    "to_csv",
    "to_pdf_document",
    "to_xlsx_payload",
]
