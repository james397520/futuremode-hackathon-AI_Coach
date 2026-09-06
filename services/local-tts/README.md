# AI Coach — local TTS model server

Traditional-Chinese text-to-speech on this machine, no key, nothing leaves the
laptop. Two engines behind one HTTP surface, reached by `apps/api`'s
`LocalHttpTts` adapter when a client asks for `engine=local` or
`TTS_PROVIDER=local`:

| engine | weights | speakers | rate | notes |
|---|---|---|---|---|
| **`breeze`** (default) | [MediaTek-Research/Breeze2-VITS-onnx](https://huggingface.co/MediaTek-Research/Breeze2-VITS-onnx) | 1 | 22.05 kHz | Taiwanese voice, distilled from BreezyVoice. **Licence not stated anywhere** — see below. |
| `kokoro` | [hexgrad/Kokoro-82M-v1.1-zh](https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh) | 100 | 24 kHz | Apache-2.0, mainland-standard accent, male/female choice. |

Why Breeze became the default and how the two engines compare is measured in
the sections below.

## Install / run

```bash
pnpm tts:install                 # = scripts/dev/install-local-tts-service.sh
scripts/dev/install-local-tts-service.sh --status
scripts/dev/install-local-tts-service.sh --uninstall
```

That creates `.venv` (uv, Python 3.12), fetches both models into `models/`
(~505 MB total, sha256-pinned; both directories are gitignored) and registers
the launchd agent `com.aicoach.local-tts` on `127.0.0.1:8795` with KeepAlive.
Logs: `/tmp/ai-coach-local-tts.log` (structlog JSON — counts and timings, never
the text).

By hand:

```bash
uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -e '.[dev]'
scripts/fetch_model.sh            # or: fetch_model.sh breeze | fetch_model.sh kokoro
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8795
```

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/healthz` | `{status: ok\|loading\|error, engine, model, voices[], single_speaker, sample_rate, defaults{}, engines{}, device, rtf_last, rss_mb}`. 503 while loading. |
| `POST` | `/speak` | `{text (≤1200 chars), engine?: breeze\|kokoro, voice?, speed? (0.5–2), gender?: male\|female, format?: wav\|mp3}` → audio bytes. `audio/wav` by default; `mp3` goes through `/opt/homebrew/bin/ffmpeg`. Headers `X-Engine`, `X-Model`, `X-Voice`, `X-Voice-Ignored`, `X-Sample-Rate`, `X-Audio-Seconds`, `X-Rtf`, `X-Synth-Ms`. |

The top-level `/healthz` keys describe the engine that speaks by default, which
is what `apps/api`'s `probe_local_tts` reads; `engines` carries both, each with
`state: loaded | available | missing | error`. An engine's voices are listed even
before it is loaded (Kokoro's come out of the voice pack's zip directory), so the
browser's capabilities reply does not depend on load order.

```bash
curl -s localhost:8795/speak -H 'content-type: application/json' \
  -d '{"text":"好，那我們先看保障的部分。","format":"mp3"}' -o line.mp3
curl -s localhost:8795/speak -H 'content-type: application/json' \
  -d '{"text":"好，那我們先看保障的部分。","engine":"kokoro","gender":"male"}' -o line.wav
```

### `voice` / `gender` on `breeze`

Breeze2-VITS has **one speaker** (`n_speakers=1` in the graph's own metadata), so
`voice` and `gender` cannot do anything. They are still accepted — every persona
line arrives with a gender — but the reply says so instead of pretending:

```
X-Voice: tw_01
X-Voice-Ignored: voice=zm_010,gender=male (MediaTek-Research/Breeze2-VITS-onnx has one speaker)
```

`/healthz` reports the same as `single_speaker: true`. On `kokoro`, `voice` beats
`gender`, and with neither the female default (`zf_001`) speaks.

## Settings (`LOCAL_TTS_*`)

`ENGINE` breeze · `PORT` 8795 · `MODEL_DIR` `./models` · `BREEZE_DIR`
`./models/breeze2-vits` · `BREEZE_GAIN` 5.0 · `BREEZE_LENGTH_SCALE` 1.0 ·
`TAIWAN_LEXICON` 1 · `DEFAULT_FEMALE_VOICE` zf_001 ·
`DEFAULT_MALE_VOICE` zm_010 · `THREADS` 4 ·
`REQUEST_TIMEOUT_S` 60 · `MAX_TEXT_CHARS` 1200 · `FFMPEG_BIN`
/opt/homebrew/bin/ffmpeg · `KEEP_WARM_S` 45 (idle self-synthesis so the weights
stay resident on an 8 GB machine; measured 3–6 s for the first line after a few
idle minutes without it; 0 disables).

`ENGINE` names the engine that speaks when a request does not choose one. If its
weights are missing the service does **not** refuse to start: the first other
engine with weights takes over, `/healthz` says which and why in
`engine_fallback`, and the missing one shows `state: missing`.

Weights are loaded lazily, one engine at a time — Kokoro alone is 545–615 MB
resident and Breeze another ~130 MB, which is a lot on an 8 GB laptop that is
already swapping. The default engine loads at startup; the other one loads on the
first request that names it (~3 s, or much longer under swap).

## How a request is processed

1. `normalize()` — strip thousands separators (`1,200` would be read 一，二百),
   `NT$`/`NTD`/`TWD` → 新台幣. Shared by both engines.
2. Split on sentence-final punctuation (。！？；…), then cut over-long sentences at
   commas.
3. G2P, then one `onnxruntime` run per chunk.
4. Chunks joined with 0.18 s silence, int16 WAV, optionally ffmpeg → MP3 64 kb/s.

**`breeze` G2P** (`app/engines/breeze.py`): digits → Chinese numerals with
`cn2an`, then longest match over the model's own 68 k-entry `lexicon.txt`
(headwords are 1–10 characters; the per-character fallback is the tail of the
same loop, since every common character is also a one-character entry), with
`taiwan_readings.py` merged over that list first so 研究 comes out ㄐㄧㄡˋ rather
than the shipped ㄐㄧㄡˉ. Anything in neither the lexicon nor the punctuation
table is dropped. `tokens.txt` is
注音符號 — 21 initials, 16 finals, 5 tone marks and exactly six punctuation marks
(`，。！？—…`), so every other mark is mapped onto the nearest of those. Ids are
interleaved with the blank token (`add_blank=1`), `sid` is always 0, and `speed`
becomes VITS's inverse `length_scale`.

**`kokoro` G2P**: `misaki.zh.ZHG2P(version="1.1")` (jieba + pypinyin) →
Kokoro's phoneme alphabet, `models/config.json` vocab → ids, with the model
card's length→speed curve (1.0 → 0.8) because it rushes past ~100 tokens.

Requests are serialised (one graph run at a time) and bounded by a 60 s wall
clock; this is an 8 GB machine also running the API and a browser.

## Known limits

- **The shipped lexicon gives mainland readings**, so a 台灣讀音 table
  (`app/engines/taiwan_readings.py`) is layered over it — see §16.16 for the
  measurement and `LOCAL_TTS_TAIWAN_LEXICON=0` to hear the file unmodified. The
  table covers ~60 entries; anything outside it still reads mainland-style.
  `和` as ㄏㄢˋ is deliberately *not* included (it would break 和平/溫和/和諧).
  The readings follow 教育部《國語一字多音審訂表》 but have not been checked
  against the dictionary entry by entry — treat a wrong-sounding word as a bug
  in that table first.
- Breeze is quiet at source (peak ≈ 0.075 against Kokoro's 0.44); the engine
  applies a ×5 gain, backing it off rather than clipping.
- Breeze is stochastic (VITS noise sampling), so two calls on the same sentence
  are not byte-identical and occasionally differ in intelligibility.
- Numbers and units are expanded by `cn2an` — plain numbers are fine, mixed
  formats (`NT$1,200`, phone numbers, dates) can be read oddly. Pre-verbalise in
  the persona text where it matters.
- English words in a Chinese sentence are skipped by both engines (no English
  G2P is loaded; Breeze's token set has no Latin letters at all).
- Punctuation drives pauses; a sentence with none becomes one breathless chunk.
- No streaming: a line is synthesised whole before the first byte goes out.

## Licence

Kokoro-82M-v1.1-zh is Apache-2.0. **Breeze2-VITS-onnx states no licence
anywhere** — no `license` field in the Hugging Face repo metadata, no licence
tag, no License section in the model card, in any revision. Commercial use is
neither granted nor forbidden by any citable document. The upstream
[BreezyVoice](https://huggingface.co/MediaTek-Research/BreezyVoice) it is
distilled from *is* Apache-2.0, but that grant is on a different repo and
extending it to these weights is an inference, not a fact. Treat it as an open
risk for anything shipped commercially — `LOCAL_TTS_ENGINE=kokoro` is the one-variable way back to an
unambiguously licensed model.

## Tests

```bash
.venv/bin/python -m pytest tests -q && .venv/bin/ruff check app tests
```

`tests/test_breeze.py` runs the 注音 G2P against the shipped lexicon when it is
present and against a hand-written miniature otherwise, so a checkout without
the weights still passes; the two tests that touch the 121 MB graph skip
themselves when it is missing.
