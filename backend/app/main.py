"""Run from backend/: python -m uvicorn app.main:app --reload."""
from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
from contextlib import asynccontextmanager
import os

from .documents import MAX_BYTES
from .providers import ProviderError
from .schemas import (AskRequest, AskResponse, ChatRequest,
                      DocumentInfo, ErrorResponse, EvaluateRequest, EvaluateResponse,
                      HealthResponse, IngestResponse, SearchRequest, SearchResponse)
from .service import CoachService, PERSONAS, ROOT
from .sessions import TrainingSessions, SessionConflict, SessionNotFound
from .schemas import SessionRequest, SessionResponse, TurnRequest, TurnResponse, TurnChatResponse


def create_app(service: CoachService | None = None) -> FastAPI:
    if service is None and os.getenv("COACH_AI") == "local":
        from .local_model import create_test_ai_provider
        service = CoachService(ai=create_test_ai_provider())
    sessions = TrainingSessions(service or CoachService())

    @asynccontextmanager
    async def lifespan(app):
        yield
        sessions.close()

    app = FastAPI(title="SkillCoach AI · Backend", version="0.1.0",
                  lifespan=lifespan,
                  description="條件式 RAG、客戶對練、風險初篩與背景動態評分。COACH_AI=local 啟用本機模型。",
                  responses={400: {"model": ErrorResponse}, 502: {"model": ErrorResponse}})
    app.state.coach = sessions.service
    app.state.sessions = sessions
    app.add_middleware(CORSMiddleware, allow_origins=[
        "http://localhost:3000", "http://127.0.0.1:3000",
        "http://localhost:5173", "http://127.0.0.1:5173"],
        allow_methods=["GET", "POST"], allow_headers=["Content-Type"])

    @app.exception_handler(ValueError)
    async def invalid_input(request, exc):
        return JSONResponse(status_code=400, content={"detail": str(exc)})

    @app.exception_handler(ProviderError)
    async def provider_error(request, exc):
        return JSONResponse(status_code=502, content={"detail": str(exc)})

    @app.exception_handler(SessionConflict)
    async def conflict(request, exc):
        return JSONResponse(status_code=409, content={"detail": str(exc)})

    @app.exception_handler(SessionNotFound)
    async def missing_session(request, exc):
        return JSONResponse(status_code=404, content={"detail": "找不到練習，伺服器重啟後需重新建立。"})

    @app.get("/health", response_model=HealthResponse, tags=["system"])
    def health():
        return dict(status="ok", **app.state.coach.status())

    @app.get("/personas", response_model=dict[str, str], tags=["training"])
    def personas():
        return PERSONAS

    @app.get("/documents", response_model=list[DocumentInfo], tags=["knowledge"])
    def documents():
        return app.state.coach.documents()

    @app.post("/documents", response_model=IngestResponse, tags=["knowledge"])
    async def upload(file: UploadFile = File(...)):
        try:
            data = await file.read(MAX_BYTES + 1)
            return await run_in_threadpool(app.state.coach.ingest, file.filename or "document.txt", data)
        finally:
            await file.close()

    @app.post("/documents/demo", response_model=IngestResponse, tags=["knowledge"])
    def load_demo():
        path = ROOT / "samples" / "training_manual.md"
        return app.state.coach.ingest(path.name, path.read_bytes())

    @app.post("/search", response_model=SearchResponse, tags=["knowledge"])
    def search(body: SearchRequest):
        return dict(sources=app.state.coach.search(body.query, body.top_k))

    @app.post("/ask", response_model=AskResponse, tags=["knowledge"])
    def ask(body: AskRequest):
        return app.state.coach.ask(body.question)

    @app.post("/chat", response_model=TurnChatResponse, tags=["training"])
    def chat(body: ChatRequest):
        return app.state.coach.chat(body.message, [m.model_dump() for m in body.history], body.persona)

    @app.post("/evaluate", response_model=EvaluateResponse, tags=["training"])
    def evaluate(body: EvaluateRequest):
        return app.state.coach.evaluate([m.model_dump() for m in body.history])

    @app.post("/sessions", response_model=SessionResponse, tags=["training loop"])
    def start_session(body: SessionRequest):
        return sessions.create(body.persona)

    @app.post("/sessions/{session_id}/turns", response_model=TurnResponse, tags=["training loop"])
    def turn(session_id: str, body: TurnRequest):
        return sessions.turn(session_id, body.message)

    @app.get("/sessions/{session_id}", response_model=SessionResponse, tags=["training loop"])
    def session_state(session_id: str):
        return sessions.get(session_id)

    @app.post("/sessions/{session_id}/finish", response_model=SessionResponse, tags=["training loop"])
    def finish_session(session_id: str):
        return sessions.finish(session_id)

    return app


app = create_app()
