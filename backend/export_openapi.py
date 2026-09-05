"""Export the frontend contract without touching the real knowledge database."""
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory


def main():
    with TemporaryDirectory() as directory:
        os.environ["COACH_DATA_DIR"] = directory
        os.environ["COACH_AI"] = "mock"
        from app.main import app
        target = Path(__file__).resolve().parent / "openapi.json"
        target.write_text(json.dumps(app.openapi(), ensure_ascii=False, indent=2) + "\n")
        app.state.sessions.close()
        print("Exported:", target.name)


if __name__ == "__main__":
    main()
