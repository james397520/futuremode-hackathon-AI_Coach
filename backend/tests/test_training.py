from tempfile import TemporaryDirectory
from threading import Event
from unittest import TestCase
from unittest.mock import patch
import time

from fastapi.testclient import TestClient
from app.main import create_app
from app.local_model import parse_test_response, build_test_request
from app.providers import AIRequest, MockAIProvider
from app.service import CoachService, ROOT
from app.sessions import TrainingSessions, SessionConflict
from app.training import screen_compliance


class TrainingTests(TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.service = CoachService(self.temp.name)
        self.sessions = TrainingSessions(self.service)
        self.addCleanup(self.sessions.close)

    def wait_for(self, predicate):
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            if predicate():
                return
            time.sleep(0.01)
        self.fail("Background evaluation timed out")

    def test_greeting_skips_all_retrieval_and_background_scoring(self):
        sid = self.sessions.create()["id"]
        with patch.object(self.service, "search", side_effect=AssertionError("greeting searched")):
            reply = self.sessions.turn(sid, "你好")
            self.assertFalse(reply["rag_used"])
            self.wait_for(lambda: self.sessions.get(sid)["evaluations"][0]["status"] != "pending")
            state = self.sessions.get(sid)
            self.assertEqual(state["evaluations"][0]["status"], "completed")
            self.assertTrue(all(s["score"] is None for s in state["latest_evaluation"]["report"]["scores"]))

    def test_risk_claim_retrieves_flags_and_preserves_history(self):
        path = ROOT / "samples/training_manual.md"
        self.service.ingest(path.name, path.read_bytes())
        sid = self.sessions.create()["id"]
        self.sessions.turn(sid, "你好")
        reply = self.sessions.turn(sid, "放心，這個一定不會賠")
        self.assertTrue(reply["rag_used"])
        self.assertTrue(any("不保本" in h["text"] for h in reply["sources"]))
        self.assertTrue(reply["compliance"])
        self.sessions.turn(sid, "對啊，保證獲利")
        self.sessions.finish(sid)
        self.wait_for(lambda: self.sessions.get(sid)["status"] == "finished")
        state = self.sessions.get(sid)
        self.assertEqual(len(state["history"]), 6)
        self.assertEqual(len(state["compliance"]), 2)
        self.assertIsNotNone(state["final_report"])
        with self.assertRaises(SessionConflict):
            self.sessions.turn(sid, "不能再說")

    def test_negations_questions_quotes_and_context(self):
        for text in ["不保證獲利", "不能說保證獲利", "本產品不保本", "你需要保本嗎", "禁止承諾一定不會賠", "客戶說「保證獲利」"]:
            self.assertEqual(screen_compliance(text, 1, []), [], text)
        history = [dict(role="assistant", content="我的本金真的完全不會受到影響嗎？")]
        self.assertTrue(screen_compliance("對啊", 2, [], history))

    def test_customer_does_not_wait_for_evaluator(self):
        started, release = Event(), Event()
        original = self.service.evaluate

        def slow(*args, **kwargs):
            started.set()
            release.wait(2)
            return original(*args, **kwargs)

        self.addCleanup(release.set)
        with patch.object(self.service, "evaluate", side_effect=slow):
            sid = self.sessions.create()["id"]
            reply = self.sessions.turn(sid, "你好")
            self.assertTrue(reply["answer"])
            self.assertTrue(started.wait(1))
            self.assertEqual(self.sessions.get(sid)["evaluations"][0]["status"], "pending")
            release.set()
            self.wait_for(lambda: self.sessions.get(sid)["evaluations"][0]["status"] == "completed")

    def test_model_scores_update_and_failed_final_can_retry(self):
        class ScoringAI(MockAIProvider):
            is_mock = False

            def generate(self, request):
                response = super().generate(request)
                if request.task == "evaluate":
                    user = [m for m in request.payload["history"] if m["role"] == "user"]
                    item = response.report["scores"][2]
                    item.update(score=40 + 10 * len(user), evidence_quote=user[-1]["content"])
                return response

        self.service.ai = ScoringAI()
        sid = self.sessions.create()["id"]
        self.sessions.turn(sid, "你好")
        self.sessions.turn(sid, "我理解你的擔憂")
        self.wait_for(lambda: all(e["status"] != "pending" for e in self.sessions.get(sid)["evaluations"]))
        state = self.sessions.get(sid)
        self.assertEqual([e["report"]["scores"][2]["score"] for e in state["evaluations"]], [50, 60])
        with patch.object(self.service, "evaluate", side_effect=RuntimeError("private payload")):
            self.sessions.finish(sid)
            self.wait_for(lambda: self.sessions.get(sid)["status"] == "final_failed")
        self.assertNotIn("private payload", self.sessions.get(sid)["final_error"])
        self.sessions.finish(sid)
        self.wait_for(lambda: self.sessions.get(sid)["status"] == "finished")

    def test_session_http_contract_and_isolation(self):
        with TestClient(create_app(self.service)) as client:
            sid = client.post("/sessions", json={}).json()["id"]
            other = client.post("/sessions", json={}).json()["id"]
            response = client.post(f"/sessions/{sid}/turns", json={"message": "你好"})
            self.assertEqual(response.status_code, 200)
            self.assertFalse(response.json()["rag_used"])
            self.assertEqual(client.get(f"/sessions/{other}").json()["history"], [])
            self.assertEqual(client.post(f"/sessions/{sid}/finish").status_code, 200)
            self.assertEqual(client.post(f"/sessions/{sid}/turns", json={"message": "你好"}).status_code, 409)
            self.assertEqual(client.get("/sessions/missing").status_code, 404)

    def test_local_model_evaluation_citations_are_mapped(self):
        request = AIRequest("evaluate", "rules", dict(history=[], sources=[dict(id="real-id", text="risk")]))
        data = {"message": {"content": '{"summary":"ok","scores":[{"citation_ids":["S1"]}]}'}}
        self.assertEqual(parse_test_response(data, request).report["scores"][0]["citation_ids"], ["real-id"])
        self.assertIn("citation_ids", build_test_request(request)["messages"][1]["content"])

    def test_roleplay_keeps_native_roles_and_one_latest_message(self):
        history = [dict(role="user", content="你好"), dict(role="assistant", content="我擔心本金虧損。")]
        request = AIRequest("roleplay", "客戶角色", dict(history=history, message="建議你買我們的基金", sources=[]))
        messages = build_test_request(request)["messages"]
        self.assertEqual([m["role"] for m in messages], ["system", "user", "assistant", "user"])
        self.assertEqual(messages[1:3], history)
        self.assertEqual(messages[-1]["content"], "建議你買我們的基金")
        self.assertIn("user 是業務員", messages[0]["content"])

    def test_evaluation_schema_limits_quotes_and_citations(self):
        request = AIRequest("evaluate", "rules", dict(history=[
            dict(role="user", content="您能承受多少損失？"),
            dict(role="assistant", content="5%")], sources=[dict(id="real-id", text="risk")]))
        body = build_test_request(request)
        self.assertFalse(body["think"])
        fields = body["format"]["$defs"]["DimensionScore"]["properties"]
        self.assertEqual(fields["evidence_quote"]["enum"], ["", "您能承受多少損失？"])
        self.assertEqual(fields["citation_ids"]["items"]["enum"], ["S1"])

    def test_cli_displays_failure_even_when_older_report_exists(self):
        from contextlib import redirect_stdout
        from io import StringIO
        from demo import show_evaluation
        state = dict(evaluations=[dict(turn=1, status="completed"),
            dict(turn=2, status="failed", error="AI 評分面向不完整。"), dict(turn=3, status="pending")],
            latest_evaluation=dict(turn=1, report=dict(scores=[])))
        output = StringIO()
        with redirect_stdout(output):
            show_evaluation(state)
        self.assertIn("第 2 輪評估失敗", output.getvalue())
        self.assertIn("AI 評分面向不完整", output.getvalue())
        self.assertIn("目前共 3 輪", output.getvalue())
