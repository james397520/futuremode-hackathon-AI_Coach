"""In-memory demo sessions. Customer replies do not wait for evaluator inference."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from threading import RLock
from uuid import uuid4
from .providers import ProviderError

from .service import PERSONAS
from .training import screen_compliance


class SessionConflict(ValueError):
    pass


class SessionNotFound(LookupError):
    pass


class TrainingSessions:
    def __init__(self, service):
        self.service = service
        self.pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="coach-evaluator")
        self.lock = RLock()
        self.sessions = {}

    def create(self, persona="cautious"):
        if persona not in PERSONAS:
            raise ValueError("未知客戶角色。")
        sid = uuid4().hex
        with self.lock:
            self.sessions[sid] = dict(id=sid, persona=persona, status="active", history=[], turns=[],
                compliance=[], evaluations=[], emotions=[], final_report=None, final_error=None, busy=False)
        return self.get(sid)

    def _session(self, sid):
        if sid not in self.sessions:
            raise SessionNotFound(sid)
        return self.sessions[sid]

    def get(self, sid):
        with self.lock:
            state = deepcopy(self._session(sid))
        state.pop("busy")
        completed = [e for e in state["evaluations"] if e["status"] == "completed"]
        state["latest_evaluation"] = max(completed, key=lambda e: e["turn"]) if completed else None
        emotions = [e for e in state["emotions"] if e["status"] == "completed"]
        state["latest_emotion"] = max(emotions, key=lambda e: e["turn"]) if emotions else None
        return state

    def turn(self, sid, message):
        if not message.strip() or len(message) > 4000:
            raise ValueError("發言需為 1–4000 字元。")
        with self.lock:
            session = self._session(sid)
            if session["status"] != "active" or session["busy"]:
                raise SessionConflict("練習已結束，或上一個客戶回覆仍在生成。")
            session["busy"] = True
            history = deepcopy(session["history"])
            persona = session["persona"]
        try:
            reply = self.service.chat(message, history, persona)
            turn = len(history) // 2 + 1
            flags = screen_compliance(message, turn, reply["sources"], history)
            with self.lock:
                session["history"].extend([dict(role="user", content=message), dict(role="assistant", content=reply["answer"])])
                session["turns"].append(dict(turn=turn, **reply))
                session["compliance"].extend(flags)
                session["evaluations"].append(dict(turn=turn, status="pending", report=None, error=None))
                session["emotions"].append(dict(turn=turn, status="pending", analysis=None, error=None))
                snapshot = deepcopy(session)
                self.pool.submit(self._evaluate, sid, snapshot, False)
            return dict(session_id=sid, turn=turn, **reply, compliance=flags,
                        evaluation_status="pending", emotion_status="pending")
        finally:
            with self.lock:
                session["busy"] = False

    def finish(self, sid):
        with self.lock:
            session = self._session(sid)
            if session["busy"]:
                raise SessionConflict("請等待客戶回覆後再結束。")
            if not session["turns"]:
                raise ValueError("請先完成一輪對話。")
            if session["status"] in {"active", "final_failed"}:
                session["status"] = "finishing"
                session["final_error"] = None
                self.pool.submit(self._evaluate, sid, deepcopy(session), True)
        return self.get(sid)

    def _evaluate(self, sid, snapshot, final):
        if not final:
            self._emotion(sid, snapshot)
        report, error = None, None
        try:
            sources = {h["id"]: h for t in snapshot["turns"] for h in t["sources"]}
            report = self.service.evaluate(snapshot["history"], list(sources.values()), snapshot["compliance"], final)
        except ProviderError as exc:
            error = str(exc)
        except Exception:
            # Never expose provider payloads or fabricate fallback scores.
            error = "評估未完成，請確認模型輸出格式或模型服務；已保留對話。"
        with self.lock:
            session = self._session(sid)
            if final:
                session["final_report"] = report
                session["final_error"] = error
                session["status"] = "final_failed" if error else "finished"
            else:
                evaluation = session["evaluations"][len(snapshot["turns"])-1]
                evaluation.update(status="failed" if error else "completed", report=report, error=error)

    def _emotion(self, sid, snapshot):
        analysis, error = None, None
        try:
            history = snapshot["history"]
            analysis = self.service.analyze_emotion(history[-2]["content"], history[:-2])
        except ProviderError as exc:
            error = str(exc)
        except Exception:
            error = "情緒分析未完成，已保留對話。"
        with self.lock:
            item = self._session(sid)["emotions"][len(snapshot["turns"])-1]
            item.update(status="failed" if error else "completed", analysis=analysis, error=error)

    def close(self):
        self.pool.shutdown(wait=True)
