# Avatar Runtime — measured performance

§89 of the avatar spec is explicit that its published figures (512×512, 25 fps,
batch 8, 250–500 ms buffers) are *starting configurations, not hardware
guarantees*, and must be frozen by benchmark. This file is that freeze.

Re-run with `pnpm avatar:bench`, or by probing `GET /capabilities`, which
measures the host on every call rather than reporting a constant.

---

## Host: Apple M3 (base), 10 GPU cores, 8 GB unified memory

macOS 26, Python 3.14.0, MLX 0.32.2, `musetalk-mlx` @ `c6eb30eb`,
`mlx-community/MuseTalk-1.5-q4`.

### Static portrait backend — the §53 floor, and what actually runs here

| Measure | Value |
|---|---|
| Stream | 2402 frames / 120 s = **20.00 fps** (target 20) |
| Stability | 20.0 fps across all six 20-second segments, no drift |
| Dropped frames | **0** |
| Render | 9.69 ms/frame |
| Encode (JPEG 384×512) | 0.96 ms/frame |
| Frame budget used | **10.65 ms of 50 ms — 21%** |
| Server RSS | **22.1 MB** |
| Frame size | ~12.6 KB |
| Expression transitions handled | 40 |

Headroom at 20 fps is ~39 ms/frame.

### MuseTalk 1.5 q4 — installs, loads, and is far too slow here

| Measure | Value |
|---|---|
| Weights | 1.41 GB (unet int4 1264 MB, vae fp16 160 MB, whisper fp16 16 MB) |
| Model load | 2.8 s |
| GPU peak (load) | 1442 MB |
| GPU peak (inference) | 3438 MB — stable, no swapping, no OOM |
| VAE encode, 256px face | 0.96 s warm — **once per avatar**, cached (§20) |
| **UNet, batch 1, 256px** | **62.6 s/frame** (n=6, range 49–85 s) |

No warmup trend across six frames, and the same result via `run_batched` with
the whole stack, so it is not a call-pattern artefact.

**62.6 s against a 50 ms budget is ~1250× short.** The gap is hardware, not
configuration: the upstream "~34 faces/sec" figure is an M-series *Max/Ultra*
number, and those parts carry 40–80 GPU cores against this machine's 10. No
batch size, precision or resolution setting closes three orders of magnitude.

### What the runtime does with that

`app/musetalk/mlx_backend.probe()` measures rather than assumes, so:

* this host reports `musetalk: "installed_but_unusable"` with the reason
  attached, instead of the misleading `"unavailable"` — an operator should not
  go hunting for a missing package when the real answer is core count;
* the §53 ladder falls through to the static portrait backend, which was
  verified still streaming at 20.0 fps with the engine rejected;
* on a Max/Ultra or an RTX box the same code path measures well and switches
  itself on, with no config change.

Below `MIN_MEMORY_MB` (12 GB) the probe rejects without downloading or loading
the weights — there is nothing to learn from proving 3.4 GB will not fit
alongside macOS in 8 GB.

---

## Not yet measured

* Apple Silicon Max / Ultra — expected to be the first hardware where MuseTalk
  clears the budget.
* NVIDIA RTX (TensorRT LivePortrait + CUDA MuseTalk). §33 warns that upstream
  still pins TensorRT 8.x and needs the `grid_sample` plugin, so that path
  needs its own freeze before anyone quotes a number.
* End-to-end A/V drift under real TTS (§17 targets < 80 ms). The static path
  has the headroom for it; it has not been measured with a live voice session.
