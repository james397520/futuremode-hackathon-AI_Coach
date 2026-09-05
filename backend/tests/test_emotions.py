import json
from tempfile import TemporaryDirectory
from unittest import TestCase
from unittest.mock import patch

from app.local_model import build_test_request, parse_test_response
from app.providers import AIRequest, AIResponse, MockAIProvider, ProviderError
from app.service import CoachService
from app.sessions import TrainingSessions


class EmotionTests(TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.service = CoachService(self.temp.name)

    def test_only_current_trainee_text_can_be_evidence(self):
        class EmotionAI(MockAIProvider):
            is_mock = False

            def generate(self, request):
                return AIResponse(text="", emotion=dict(label="緊張", intensity="medium",
                    evidence_quote="我很緊張", reason="本輪明確表達緊張。", suggestion="放慢表達速度。"))

        self.service.ai = EmotionAI()
        result = self.service.analyze_emotion("我很緊張，不知道怎麼解釋", [])
        self.assertEqual(result["label"], "緊張")
        with self.assertRaises(ProviderError):
            self.service.analyze_emotion("你好", [dict(role="assistant", content="我很緊張")])

    def test_emotion_failure_does_not_fail_evaluation(self):
        sessions = TrainingSessions(self.service)
        sid = sessions.create()["id"]
        with patch.object(self.service, "analyze_emotion", side_effect=ProviderError("情緒分析格式不符。")):
            sessions.turn(sid, "你好")
            sessions.close()
        state = sessions.get(sid)
        self.assertEqual(state["emotions"][0]["status"], "failed")
        self.assertEqual(state["evaluations"][0]["status"], "completed")

    def test_mock_is_unknown_without_rag_and_adapter_is_structured(self):
        with patch.object(self.service, "search", side_effect=AssertionError("Emotion must not use RAG")):
            result = self.service.analyze_emotion("你好", [])
        self.assertEqual(result["label"], "不明確")
        self.assertTrue(result["is_mock"])
        request = AIRequest("emotion", "rules", dict(current_message="你好", context=[]))
        body = build_test_request(request)
        self.assertIn("label", body["format"]["properties"])
        self.assertFalse(body["think"])
        content = {k: v for k, v in result.items() if k != "is_mock"}
        parsed = parse_test_response({"message": {"content": json.dumps(content)}}, request)
        self.assertEqual(parsed.emotion, content)
