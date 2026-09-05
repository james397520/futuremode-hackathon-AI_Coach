from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from app.documents import make_chunks
from app.providers import AIResponse, ExternalAIProvider, LocalEmbeddingProvider, MockAIProvider, ProviderError
from app.service import CoachService, ROOT


class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.service = CoachService(self.temp.name)

    def seed(self):
        path = ROOT / "samples" / "training_manual.md"
        return self.service.ingest(path.name, path.read_bytes())

    def test_ingestion_retrieval_and_persistence(self):
        first = self.seed()
        self.assertFalse(first["duplicate"])
        self.assertTrue(self.seed()["duplicate"])
        hits = CoachService(self.temp.name).search("本產品不保本，不保證獲利")
        self.assertIn("不保本", hits[0]["text"])
        self.assertEqual(hits[0]["filename"], "training_manual.md")
        self.assertTrue(hits[0]["location"].startswith("段落"))

    def test_no_evidence_does_not_fabricate(self):
        self.assertTrue(self.service.ask("hello")["insufficient_evidence"])
        self.seed()
        self.assertTrue(self.service.ask("zzzzzzzzzzzzzzzzzzzzzz")["insufficient_evidence"])

    def test_document_replacement_and_failed_embedding_are_atomic(self):
        self.service.ingest("a.txt", "原始文件 風險說明".encode())

        class Broken(LocalEmbeddingProvider):
            def embed(self, texts):
                raise ProviderError("unavailable")

        broken = CoachService(self.temp.name, embeddings=Broken())
        with self.assertRaises(ProviderError):
            broken.ingest("a.txt", "更新文件".encode())
        self.assertIn("原始文件", self.service.search("原始文件")[0]["text"])
        self.service.ingest("a.txt", "更新後文件 風險說明".encode())
        self.assertEqual(len(self.service.documents()), 1)
        self.assertIn("更新後", self.service.search("風險說明")[0]["text"])

    def test_provider_namespace_isolation(self):
        self.seed()

        class Other(LocalEmbeddingProvider):
            namespace = "other-model"

        self.assertEqual(CoachService(self.temp.name, embeddings=Other()).documents(), [])

    def test_mock_flow_returns_sources_and_no_fake_scores(self):
        self.seed()
        answer = self.service.ask("手續費是多少？")
        self.assertTrue(answer["is_mock"])
        self.assertTrue(answer["sources"])
        reply = self.service.chat("保證獲利", [], "cautious")
        self.assertIn("本金", reply["answer"])
        report = self.service.evaluate([dict(role="user", content="請問您何時需要這筆資金？")])
        self.assertEqual(len(report["scores"]), 5)
        self.assertTrue(all(s["score"] is None for s in report["scores"]))

    def test_fake_citation_is_rejected(self):
        self.seed()

        class BadAI(MockAIProvider):
            def generate(self, request):
                return AIResponse("invented", citation_ids=["nonexistent"])

        self.service.ai = BadAI()
        with self.assertRaises(ProviderError):
            self.service.ask("風險")

    def test_invented_transcript_quote_is_rejected(self):
        self.seed()

        class BadAI(MockAIProvider):
            def generate(self, request):
                response = super().generate(request)
                response.report["scores"][0]["evidence_quote"] = "學員從未說過的話"
                return response

        self.service.ai = BadAI()
        with self.assertRaises(ProviderError):
            self.service.evaluate([dict(role="user", content="您好")])

    def test_external_provider_remains_unconnected(self):
        self.seed()
        self.service.ai = ExternalAIProvider()
        with self.assertRaises(ProviderError):
            self.service.ask("風險")

    def test_chunks_overlap_preserve_locations_and_reject_bad_inputs(self):
        text = "甲乙丙丁戊己庚辛壬癸" * 150
        chunks = make_chunks("long.txt", text.encode())
        self.assertEqual(chunks[0].text[-100:], chunks[1].text[:100])
        self.assertEqual(chunks[0].location, chunks[1].location)
        for name, data in [("a.txt", b""), ("a.exe", b"abc"), ("a.txt", b"\xff"), ("a.txt", b" \n ")]:
            with self.subTest(name=name, data=data), self.assertRaises(ValueError):
                make_chunks(name, data)

    def test_dimension_mismatch_fails_explicitly(self):
        self.seed()

        class WrongDimensions(LocalEmbeddingProvider):
            def embed(self, texts):
                return [[1.0, 2.0] for _ in texts]

        self.service.embeddings = WrongDimensions()
        with self.assertRaises(ProviderError):
            self.service.search("風險")


if __name__ == "__main__":
    unittest.main()
