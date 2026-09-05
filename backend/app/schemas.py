"""HTTP contract. FastAPI publishes these models in /docs and /openapi.json."""
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

NonemptyText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)]


class RequestModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Message(RequestModel):
    role: Literal["user", "assistant"]
    content: NonemptyText


class SearchRequest(RequestModel):
    query: NonemptyText
    top_k: int = Field(default=5, ge=1, le=10)


class AskRequest(RequestModel):
    question: NonemptyText


class ChatRequest(RequestModel):
    message: NonemptyText
    persona: Literal["cautious", "fee_sensitive", "short_term"] = "cautious"
    history: list[Message] = Field(default_factory=list, max_length=24)


class EvaluateRequest(RequestModel):
    history: list[Message] = Field(min_length=1, max_length=24)


class Source(BaseModel):
    id: str
    filename: str
    location: str
    text: str
    score: float = Field(description="Cosine similarity, not a confidence probability")


class SearchResponse(BaseModel):
    sources: list[Source]


class ChatResponse(BaseModel):
    answer: str
    sources: list[Source]
    is_mock: bool


class TurnChatResponse(ChatResponse):
    rag_used: bool
    evidence_status: Literal["not_needed", "retrieved_context", "missing"]


class AskResponse(ChatResponse):
    insufficient_evidence: bool


class DimensionScore(BaseModel):
    dimension: Literal["專業準確度", "需求探索", "同理心", "異議處理", "風險揭露"]
    score: int | None = Field(ge=0, le=100)
    reason: str
    evidence_quote: str
    citation_ids: list[str]


class EvaluateResponse(BaseModel):
    summary: str
    scores: list[DimensionScore]
    improvements: list[str]
    suggested_reply: str
    sources: list[Source]
    is_mock: bool


class DocumentInfo(BaseModel):
    filename: str
    chunks: int


class IngestResponse(DocumentInfo):
    duplicate: bool


class HealthResponse(BaseModel):
    status: str
    ai_provider: str
    is_mock: bool
    embedding_provider: str
    documents: int


class ErrorResponse(BaseModel):
    detail: str


class SessionRequest(RequestModel):
    persona: Literal["cautious", "fee_sensitive", "short_term"] = "cautious"


class TurnRequest(RequestModel):
    message: NonemptyText


class ComplianceFlag(BaseModel):
    turn: int
    category: str
    quote: str
    trigger: str
    status: Literal["needs_review"]
    method: Literal["local_rules"]
    reason: str
    source_ids: list[str]
    evidence_status: Literal["retrieved_context", "missing"]


class TurnResponse(TurnChatResponse):
    session_id: str
    turn: int
    compliance: list[ComplianceFlag]
    evaluation_status: Literal["pending"]


class EvaluationSnapshot(BaseModel):
    turn: int
    status: Literal["pending", "completed", "failed"]
    report: EvaluateResponse | None
    error: str | None


class StoredTurn(TurnChatResponse):
    turn: int


class SessionResponse(BaseModel):
    id: str
    persona: str
    status: Literal["active", "finishing", "finished", "final_failed"]
    history: list[Message]
    turns: list[StoredTurn]
    compliance: list[ComplianceFlag]
    evaluations: list[EvaluationSnapshot]
    latest_evaluation: EvaluationSnapshot | None
    final_report: EvaluateResponse | None
    final_error: str | None
