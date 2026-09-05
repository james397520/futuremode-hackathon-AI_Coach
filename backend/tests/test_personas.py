import os
from tempfile import TemporaryDirectory
from unittest import TestCase
from unittest.mock import patch

from app.local_model import build_test_request
from app.personas import PROFILES, profile_answer
from app.providers import AIResponse, MockAIProvider
from app.service import CoachService


class PersonaTests(TestCase):
    def test_two_profiles_give_consistent_distinct_facts(self):
        for persona, capital, loss in [("cautious", "30 萬元", "5%"), ("aggressive", "100 萬元", "20%")]:
            self.assertIn(capital, profile_answer("你現在本金有多少", [], persona))
            self.assertIn(loss, profile_answer("你最多承受幾%的風險？", [], persona))
            self.assertIsNone(profile_answer("這個基金保本嗎？", [], persona))

    def test_real_model_generates_personal_answer_without_rag_and_receives_profile_every_turn(self):
        requests = []

        class CaptureAI(MockAIProvider):
            is_mock = False

            def generate(self, request):
                requests.append(request)
                return AIResponse("模型自由發揮的回答")

        with TemporaryDirectory() as directory:
            service = CoachService(directory, ai=CaptureAI())
            with patch.object(service, "search", side_effect=AssertionError("personal question should not retrieve")):
                for message in ["你好", "你的風險承受度？", "你現在本金有多少"]:
                    reply = service.chat(message, [], "aggressive")
                    self.assertEqual(reply["answer"], "模型自由發揮的回答")
                    self.assertEqual(reply["response_mode"], "model")
                    self.assertFalse(reply["rag_used"])
            self.assertEqual(len(requests), 3)
            for request in requests:
                self.assertEqual(request.payload["customer_profile"], PROFILES["aggressive"])
                with patch.dict(os.environ, {"OLLAMA_MODEL": "qwen3:8b"}):
                    body = build_test_request(request)
                self.assertEqual(body["model"], "qwen3:8b")
                self.assertIn("100 萬元", body["messages"][0]["content"])
                self.assertIn("20%", body["messages"][0]["content"])
