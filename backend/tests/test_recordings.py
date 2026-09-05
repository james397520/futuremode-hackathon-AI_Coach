import json
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase
from unittest.mock import patch
from contextlib import redirect_stdout
from io import StringIO

from app.recordings import save_recording
from app.providers import MockAIProvider


class RecordingTests(TestCase):
    def test_updates_same_recording_and_preserves_failed_report_transcript(self):
        with TemporaryDirectory() as directory:
            state = dict(id="test123", history=[dict(role="user", content="你好")], status="active")
            target = save_recording(state, "test-model", directory)
            state.update(status="final_failed", final_report=None, final_error="模型失敗")
            self.assertEqual(save_recording(state, "test-model", directory), target)
            saved = json.loads(target.read_text())
            self.assertEqual(saved["session"]["history"][0]["content"], "你好")
            self.assertEqual(saved["session"]["status"], "final_failed")
            self.assertEqual(len(list(Path(directory).iterdir())), 1)

    def test_cli_finish_writes_complete_session(self):
        import demo
        with TemporaryDirectory() as directory:
            def save(state, model):
                return save_recording(state, model, Path(directory) / "reports")
            with patch.dict("os.environ", {"COACH_DATA_DIR": str(Path(directory) / "data")}), \
                 patch("sys.argv", ["demo.py"]), \
                 patch("builtins.input", side_effect=["你好", "/finish"]), \
                 patch.object(demo, "create_test_ai_provider", return_value=MockAIProvider()), \
                 patch.object(demo, "save_recording", side_effect=save), redirect_stdout(StringIO()):
                demo.main()
            files = list((Path(directory) / "reports").glob("*.json"))
            self.assertEqual(len(files), 1)
            session = json.loads(files[0].read_text())["session"]
            self.assertEqual(session["status"], "finished")
            self.assertEqual(len(session["history"]), 2)
            self.assertIsNotNone(session["final_report"])
            self.assertTrue(all(e["status"] == "completed" for e in session["evaluations"]))
            self.assertEqual(session["emotions"][0]["status"], "completed")
            self.assertEqual(session["emotions"][0]["analysis"]["label"], "不明確")
