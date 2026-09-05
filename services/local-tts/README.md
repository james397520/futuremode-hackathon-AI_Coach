# AI Coach — local TTS model server

Traditional-Chinese text-to-speech on this machine, no key, nothing leaves the
laptop. Runs **[hexgrad/Kokoro-82M-v1.1-zh](https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh)**
(Apache-2.0, 82 M parameters, 24 kHz) on CPU `onnxruntime`, and is reached by
`apps/api`'s `LocalHttpTts` adapter when a client asks for `engine=local` or
`TTS_PROVIDER=local`.

Why this model and not BreezyVoice, and the measured numbers, are in
`docs/HANDOFF.md` §16.15.

## Install / run

```bash
pnpm tts:install                 # = scripts/dev/install-local-tts-service.sh
scripts/dev/install-local-tts-service.sh --status
scripts/dev/install-local-tts-service.sh --uninstall
```

That creates `.venv` (uv, Python 3.12), fetches the weights into `models/`
(~380 MB, sha256-pinned; both directories are gitignored) and registers the
launchd agent `com.aicoach.local-tts` on `127.0.0.1:8795` with KeepAlive. Logs:
`/tmp/ai-coach-local-tts.log` (structlog JSON — counts and timings, never the
text).

By hand:

```bash
uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -e '.[dev]'
scripts/fetch_model.sh
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8795
```

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/healthz` | `{status: ok\|loading\|error, model, voices[], defaults{female,male}, device, rtf_last, rss_mb}`. 503 while loading. |
| `POST` | `/speak` | `{text (≤1200 chars), voice?, speed? (0.5–2), gender?: male\|female, format?: wav\|mp3}` → audio bytes. `audio/wav` by default; `mp3` goes through `/opt/homebrew/bin/ffmpeg`. Headers `X-Voice`, `X-Audio-Seconds`, `X-Rtf`, `X-Synth-Ms`. |

`voice` beats `gender`; with neither, the female default speaks. Defaults are
`zf_001` (female) and `zm_010` (male) — the two voices the model card itself
showcases; all 103 `zf_*`/`zm_*` voices in the pack are selectable by name.

```bash
curl -s localhost:8795/speak -H 'content-type: application/json' \
  -d '{"text":"好，那我們先看保障的部分。","gender":"male","format":"mp3"}' -o line.mp3
```

## Settings (`LOCAL_TTS_*`)

`PORT` 8795 · `MODEL_DIR` `./models` · `DEFAULT_FEMALE_VOICE` zf_001 ·
`DEFAULT_MALE_VOICE` zm_010 · `THREADS` 4 · `REQUEST_TIMEOUT_S` 60 ·
`MAX_TEXT_CHARS` 1200 · `FFMPEG_BIN` /opt/homebrew/bin/ffmpeg ·
`KEEP_WARM_S` 45 (idle self-synthesis so the weights stay resident on an 8 GB
machine; measured 3–6 s for the first line after a few idle minutes without it;
0 disables).

## How a request is processed

1. Split on sentence-final punctuation (。！？；…), then cut sentences longer than
   ~120 phoneme tokens at commas — the model was trained on short utterances and
   rushes / drops syllables past ~100 tokens.
2. `misaki.zh.ZHG2P(version="1.1")` (jieba + pypinyin) → Kokoro's phoneme
   alphabet; `models/config.json` vocab → ids.
3. One `onnxruntime` run per chunk with the voice's style row for that length;
   speed is the caller's × the model card's length curve (1.0 → 0.8).
4. Chunks joined with 0.18 s silence, int16 WAV, optionally ffmpeg → MP3 64 kb/s.

Requests are serialised (one graph run at a time) and bounded by a 60 s wall
clock; this is an 8 GB machine also running the API and a browser.

## Known limits

- Accent is mainland-leaning (training set: 100 professional mainland speakers).
  Taiwanese Mandarin wording is read correctly; some tones/vocabulary readings
  (e.g. 和 hàn, 垃圾) follow mainland dictionaries via pypinyin.
- Numbers and units are expanded by `cn2an` inside misaki — plain numbers are
  fine, mixed formats (`NT$1,200`, dates) can be read oddly. Pre-verbalise in
  the persona text where it matters.
- English words in a Chinese sentence are skipped (no English G2P is loaded).
- Punctuation drives pauses; a sentence with none becomes one breathless chunk.

## Tests

```bash
.venv/bin/python -m pytest tests -q && .venv/bin/ruff check app tests
```
