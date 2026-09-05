"""Local JSON recordings for completed CLI practice sessions."""
from datetime import datetime, timezone
import json
from pathlib import Path
import tempfile


def save_recording(state, model, directory=None):
    directory = Path(directory) if directory else Path(__file__).resolve().parents[1] / "reports"
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / f"session_{state['id']}.json"
    payload = dict(schema_version=1, saved_at=datetime.now(timezone.utc).isoformat(),
                   model=model, session=state)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=directory,
                                         suffix=".tmp", delete=False) as stream:
            temporary = Path(stream.name)
            json.dump(payload, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
        temporary.replace(target)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return target
