# LivePortrait + MuseTalk 本地虛擬人物完整實作規格
## 同時支援 Apple Silicon Mac 與 NVIDIA RTX

> 文件版本：v1.0  
> 文件定位：AI Coach / 智慧對話式場景模擬平台的本地 Digital Human / Avatar Runtime 實作規格  
> 核心方案：**LivePortrait 系列負責表情、頭部姿態、眼睛與非語音動作；MuseTalk 1.5 負責語音嘴型同步。**  
> 目標平台：Apple Silicon macOS + NVIDIA RTX Linux/Windows  
> 上層整合：Mini-Agent + MiniMax + Persona State + TTS  
> Web 呈現：右側 Persona Card，以 WebRTC 為正式串流方式，WebSocket 作控制與事件通道  
> 主要原則：**同一套 Avatar API、兩套硬體 Backend；Mac 使用 MLX，RTX 使用 CUDA/TensorRT。**

---

# 0. 最終方案摘要

本專案不直接讓單一 talking-head 模型決定人物所有表情，而是採雙引擎：

```text
Mini-Agent / MiniMax
        │
        ▼
Persona State Engine
        │
        ▼
Expression Controller
        │
        ▼
LivePortrait
表情 / 頭部 / 眼睛 / listening motion
        │
        │
TTS Audio ───────────────────┐
        │                    │
        └────────────────────▼
                          MuseTalk
                         嘴型同步
                            │
                            ▼
                     Face Composite
                            │
                            ▼
                   Temporal Smoothing
                            │
                            ▼
                      Video Encoder
                            │
                            ▼
                         WebRTC
                            │
                            ▼
                     Web Persona Card
```

平台差異：

```text
Apple Silicon Mac
├── FasterLivePortrait-MLX
└── MuseTalk-MLX

NVIDIA RTX
├── FasterLivePortrait / TensorRT
└── Official MuseTalk 1.5 / CUDA
```

---

# 1. 模型責任分工

## 1.1 LivePortrait 負責
- 頭部姿態
- 眼睛
- 眨眼
- 上半臉表情
- expression / pose retargeting
- listening / idle motion
- skeptical / frustrated / interested 等情境表情
- motion template
- identity preserving animation

## 1.2 MuseTalk 負責
- speech-driven lip sync
- lower-face / mouth region generation
- 中文 / 英文 / 日文等語音嘴型
- speaking frame refinement

核心原則：

> **LivePortrait 管「演技」，MuseTalk 管「嘴」。**

---

# 2. 不要讓兩個模型重複修改整張臉

錯誤：

```text
LivePortrait full face
↓
MuseTalk full face
↓
直接輸出
```

容易造成：
- skin texture 跳動
- mouth boundary 抖動
- identity drift
- 嘴部重複變形
- frame-to-frame jitter
- 強表情時下半臉失真

推薦：

```text
Source / Motion
↓
LivePortrait
↓
Expression / Pose Frame
↓
MuseTalk
↓
只採用 Mouth ROI
↓
Face Parsing / Soft Mask
↓
Temporal Blend
↓
Final Frame
```

也就是：

```text
upper face = LivePortrait 主導
mouth ROI  = MuseTalk 主導
boundary   = soft mask blending
```

---

# 3. 兩種 Runtime Mode

## 3.1 Mode A — Expression State Bank（P0，最推薦）

LivePortrait 不必每幀即時跑。

先為每個 Avatar 產生：
- neutral
- listening
- skeptical
- concerned
- frustrated
- angry
- interested
- thinking
- ready

等 motion template / idle loop。

Runtime：

```text
Persona State
↓
選擇 Expression Loop
↓
MuseTalk 即時 Lip Sync
↓
Output
```

優點：
- 延遲最低
- Mac 最容易達標
- RTX 負載更低
- 表情穩定
- QA 容易
- 每個 Persona 可人工校正
- 不容易兩模型互相打架

## 3.2 Mode B — Continuous Dual Inference（P1）

```text
Persona State
↓
LivePortrait 每幀 Expression
↓
MuseTalk 每幀 Mouth
↓
Composite
```

適合：
- RTX 4080 / 4090
- Mac Max / Ultra 實驗
- 更連續的情緒變化
- 研究型 Demo

缺點：
- latency 高
- 記憶體壓力較大
- blending 較難
- pipeline 必須真正 streaming

第一版不要把 Mode B 當唯一方案。

---

# 4. 跨平台統一架構

```text
                Avatar Orchestrator
                       │
               AvatarBackend API
                       │
          ┌────────────┴────────────┐
          │                         │
          ▼                         ▼
     MacBackend                 RTXBackend
          │                         │
 LivePortrait MLX            LivePortrait TRT
 MuseTalk MLX                MuseTalk CUDA
 VideoToolbox                NVENC
          │                         │
          └────────────┬────────────┘
                       ▼
                    WebRTC
```

上層 Mini-Agent / Web 不需要知道底層硬體。

---

# 5. Avatar Backend Interface

```python
from typing import Protocol, AsyncIterator

class AvatarBackend(Protocol):
    async def load_avatar(self, avatar_id: str) -> None: ...
    async def set_state(self, state: dict) -> None: ...
    async def push_audio(self, pcm: bytes) -> None: ...
    async def frames(self) -> AsyncIterator[bytes]: ...
    async def interrupt(self) -> None: ...
    async def close(self) -> None: ...
```

實作：
- `MacMLXAvatarBackend`
- `RTXCudaAvatarBackend`

---

# 6. Repository 結構

```text
avatar-runtime/
├── api/
│   ├── main.py
│   ├── routes_avatar.py
│   ├── routes_health.py
│   └── websocket.py
├── core/
│   ├── orchestrator.py
│   ├── backend.py
│   ├── frame_clock.py
│   ├── audio_clock.py
│   ├── jitter_buffer.py
│   └── event_bus.py
├── expression/
│   ├── controller.py
│   ├── mapper.py
│   ├── presets.py
│   ├── interpolator.py
│   └── state_bank.py
├── liveportrait/
│   ├── base.py
│   ├── mlx_backend.py
│   ├── rtx_backend.py
│   ├── motion_template.py
│   └── cache.py
├── musetalk/
│   ├── base.py
│   ├── mlx_backend.py
│   ├── cuda_backend.py
│   ├── audio_features.py
│   ├── roi.py
│   └── cache.py
├── compositor/
│   ├── face_mask.py
│   ├── mouth_blend.py
│   ├── temporal.py
│   └── color_match.py
├── stream/
│   ├── webrtc.py
│   ├── encoder.py
│   └── video_track.py
├── platform/
│   ├── detect.py
│   ├── mac.py
│   └── rtx.py
├── avatars/
├── configs/
│   ├── default.yaml
│   ├── mac.yaml
│   └── rtx.yaml
├── scripts/
│   ├── prepare_avatar.py
│   ├── build_expression_bank.py
│   ├── benchmark.py
│   └── verify_install.py
└── tests/
```

---

# 7. Avatar 資產格式

```text
avatars/
└── customer_001/
    ├── avatar.json
    ├── source/
    │   └── portrait.png
    ├── motion/
    │   ├── neutral.pkl
    │   ├── listening.pkl
    │   ├── skeptical.pkl
    │   ├── concerned.pkl
    │   ├── frustrated.pkl
    │   ├── angry.pkl
    │   ├── interested.pkl
    │   ├── thinking.pkl
    │   └── ready.pkl
    ├── loops/
    │   ├── neutral.mp4
    │   ├── listening.mp4
    │   ├── skeptical.mp4
    │   └── ...
    ├── cache/
    │   ├── face_geometry.bin
    │   ├── muse_latents/
    │   ├── masks/
    │   └── landmarks/
    └── license/
        └── consent.json
```

---

# 8. Persona State Schema

Mini-Agent / Scenario Director 不直接控制模型 tensor。

```json
{
  "emotion": "skeptical",
  "emotion_intensity": 0.65,
  "trust": 42,
  "interest": 36,
  "resistance": 78,
  "speaking": false,
  "listening": true,
  "gaze": "user",
  "energy": 0.45
}
```

---

# 9. Expression Controller

```python
from dataclasses import dataclass

@dataclass
class ExpressionState:
    name: str
    intensity: float
    head_yaw: float = 0.0
    head_pitch: float = 0.0
    head_roll: float = 0.0
    eye_open: float = 1.0
    blink_rate: float = 0.2
    gaze_x: float = 0.0
    gaze_y: float = 0.0
    motion_energy: float = 0.5
```

LivePortrait 並沒有原生 `emotion="angry"` 這種高階產品 API。

正確做法：

```text
semantic emotion
↓
Expression Controller
↓
curated motion template / keypoint delta
↓
LivePortrait
```

---

# 10. 表情 Preset

```yaml
neutral:
  intensity: 0.20
  head_yaw: 0
  head_pitch: 0
  head_roll: 0
  eye_open: 1.0
  blink_rate: 0.20
  motion_energy: 0.35

listening:
  intensity: 0.30
  head_pitch: -1
  eye_open: 1.02
  blink_rate: 0.18
  motion_energy: 0.35

skeptical:
  intensity: 0.65
  head_yaw: 3
  head_roll: -2
  eye_open: 0.91
  blink_rate: 0.15
  motion_energy: 0.40

concerned:
  intensity: 0.55
  head_pitch: 2
  eye_open: 1.03
  blink_rate: 0.22
  motion_energy: 0.32

frustrated:
  intensity: 0.75
  head_pitch: 3
  eye_open: 0.88
  blink_rate: 0.12
  motion_energy: 0.55

angry:
  intensity: 0.85
  head_pitch: 2
  eye_open: 0.86
  blink_rate: 0.10
  motion_energy: 0.75

interested:
  intensity: 0.60
  head_pitch: -2
  eye_open: 1.08
  blink_rate: 0.18
  motion_energy: 0.45

thinking:
  intensity: 0.45
  head_yaw: -3
  gaze_x: -0.18
  eye_open: 0.96
  blink_rate: 0.20
  motion_energy: 0.25
```

---

# 11. Motion Template 建立

每種表情準備 3–8 秒 driving clip：

```text
drivers/
├── neutral.mp4
├── skeptical.mp4
├── concerned.mp4
├── frustrated.mp4
├── angry.mp4
├── interested.mp4
└── thinking.mp4
```

要求：
- camera 固定
- 正面或輕微側面
- 光線穩定
- 不要大幅移動
- 表情自然
- 嘴部 movement 低
- 頭部 motion 不超出 UI 卡片範圍

LivePortrait：

```text
driver video
↓
motion extractor
↓
motion template
↓
.pkl
```

Runtime 重用 `.pkl`。

---

# 12. State Transition / Hysteresis

禁止：

```text
neutral
→ 1 frame
→ angry
```

推薦：

```text
normal emotion transition: 350–700ms
strong interruption:       180–350ms
recovery to neutral:       500–1200ms
```

使用 hysteresis：

```text
skeptical enter: resistance >= 65
skeptical exit : resistance <= 52
```

避免狀態在 threshold 附近抖動。

---

# 13. Persona State Mapping

```python
def map_persona_state(s):
    if s["resistance"] >= 85:
        return "angry"
    if s["resistance"] >= 68:
        return "frustrated"
    if s["trust"] < 45:
        return "skeptical"
    if s["interest"] >= 72:
        return "interested"
    if s.get("listening"):
        return "listening"
    return "neutral"
```

實際產品應同時看：
- emotion
- resistance
- trust
- interest
- current intent
- scenario phase

---

# 14. Runtime State

主狀態：

```text
IDLE
LISTENING
SPEAKING
```

附加：

```text
THINKING
INTERRUPTED
TRANSITION
```

Idle / Listening 都必須有自然 blink + 小幅 head motion，避免人物像靜態圖片。

---

# 15. Barge-in

```text
AI speaking
↓
user voice detected
↓
TTS cancel
↓
MuseTalk audio buffer flush
↓
嘴巴回閉合
↓
LISTENING
```

不能讓嘴巴在使用者插話後繼續動。

---

# 16. Audio Pipeline

MuseTalk 統一使用：

```text
mono
16 kHz
PCM float32 / int16
```

TTS 可能輸出 24 / 44.1 / 48 kHz。

建立：

```text
TTS master audio
├── Avatar media audio
└── resample 16k → MuseTalk feature path
```

正式 WebRTC 建議把 TTS audio 也從 Avatar Runtime 同一路送到 Browser，避免雙 clock。

---

# 17. Audio Clock

**Audio PTS 是主時鐘。**

25 FPS：

```text
1 frame = 40ms
frame_pts = frame_index / 25
```

每 1–2 秒檢查：

```text
video_pts - audio_pts
```

若 video 太晚，drop late frame，而不是累積延遲。

目標先設定：

```text
|A/V drift| < 80ms
```

再依實測縮小。

---

# 18. Streaming TTS Jitter Buffer

```text
TTS chunk
↓
Audio Jitter Buffer
↓
Whisper feature
↓
MuseTalk
```

第一版：

```text
target buffer 250–500ms
```

再 benchmark。

---

# 19. MuseTalk Micro-batch

25 FPS：

```text
4 frames = 160ms
8 frames = 320ms
```

不要每 40ms 重新啟動整個 Python pipeline。

Mac / RTX 分別 benchmark batch 4 / 8 / 16。

---

# 20. MuseTalk Cache

同一 Avatar 預計快取：
- face bbox
- landmarks
- crop coordinates
- parsing mask
- blend mask
- reusable latent / frame metadata
- source asset hash

State Bank 模式的可重用程度最高。

---

# 21. Expression Bank 規範

所有 loop：

```text
相同解析度
相同 FPS
相同 clip length
相同 crop
盡量相同 motion phase
```

推薦 MVP：

```text
512×512
25 fps
5 sec
125 frames
```

Expression 切換做 300–500ms face-space crossfade。

---

# 22. Mouth Compositor

```text
MuseTalk mouth
↓
Mouth Mask
↓
Feather
↓
Color Match
↓
Alpha Blend
↓
Temporal Smooth
```

Mask 使用 face parsing 或 landmark polygon，避免矩形貼嘴。

---

# 23. Temporal Smoothing

對：
- mask
- bbox
- mouth landmarks
- color correction

做 EMA：

```python
smoothed = alpha * current + (1 - alpha) * previous
```

起始可測：

```text
alpha 0.5–0.8
```

---

# 24. Mac 路線

## 24.1 LivePortrait

推薦：
`ivanfioravanti/fasterliveportrait-mlx`

理由：
- Apple Silicon
- MLX
- human image/video/camera
- stitching
- eye/lip retargeting
- quality / speed / turbo / ultra
- experimental FastAPI
- configured image/video runtime 可為 MLX-only

## 24.2 MuseTalk

推薦：
`xocialize/musetalk-mlx`

特點：
- MuseTalk 1.5 MLX 社群 port
- fp16 / q8 / q4
- realtime-oriented batched neural core
- Apple Silicon

注意：這是社群 port，不是 Tencent 官方 Mac runtime，正式版要 pin commit、weights revision、做自己的 regression。

## 24.3 備援
`barnent1/musetalk-mac`

為 PyTorch/MPS + FastAPI 參考實作；公開 benchmark 仍可能慢於 realtime，所以不列為主路徑。

---

# 25. Mac 不建議用 Docker 跑 MLX Worker

推薦：

```text
macOS host
├── avatar-api
├── fasterliveportrait-mlx
└── musetalk-mlx
```

Docker 可放：
- Redis
- PostgreSQL
- Web backend

但 MLX / Metal worker 用 host-native。

---

# 26. Mac 系統需求

開發基線：

```text
Apple Silicon
Python 3.11+
ffmpeg
uv
```

實務：
- 16GB：功能驗證
- 24GB+：較合理
- 36GB+：雙模型更舒服
- Max / Ultra：優先

真正 FPS 不預設，必須以實機 benchmark freeze。

---

# 27. Mac 安裝 FasterLivePortrait-MLX

```bash
brew install ffmpeg uv git

git clone https://github.com/ivanfioravanti/fasterliveportrait-mlx.git
cd fasterliveportrait-mlx

uv sync
uv run python webui.py
```

Realtime camera smoke test：

```bash
uv run python run.py   --cfg configs/mlx_infer.yaml   --src_image assets/examples/source/s10.jpg   --dri_video 0   --realtime   --paste-back   --mlx-profile turbo
```

再測：
- `quality`
- `speed`
- `turbo`
- `ultra`

---

# 28. Mac 安裝 MuseTalk-MLX

```bash
git clone https://github.com/xocialize/musetalk-mlx.git
cd musetalk-mlx

python3.11 -m venv .venv
source .venv/bin/activate

pip install -e .
```

先用 fp16，記憶體壓力高再測 q8 / q4。

概念：

```python
from musetalk_mlx.pipeline_mlx import MuseTalkPipeline

pipe = MuseTalkPipeline.from_pretrained_mlx("MuseTalk-1.5-fp16")
faces = pipe.run_batched(latent_stack, chunk_stack, batch_size=8)
```

低階 MLX port 主要提供 neural core；你仍要在自己的 Runtime 補：
- crop
- parsing
- paste-back
- streaming scheduler
- audio buffer

---

# 29. RTX 路線

## 29.1 LivePortrait
推薦：
`warmshao/FasterLivePortrait`

- ONNX/TensorRT
- upstream report 在 RTX 3090 可達 30+ FPS（含前後處理）
- 適合 realtime
- 可使用 Docker 或獨立 TensorRT worker

## 29.2 MuseTalk
使用官方：
`TMElyralab/MuseTalk` 1.5

- 官方 realtime inference
- multilingual lip sync
- CUDA 路徑
- 官方報告 V100 30fps+；RTX 4080 仍必須自己 benchmark

---

# 30. RTX 正式 OS

推薦：

```text
Ubuntu Linux
```

因為：
- CUDA
- TensorRT
- NVIDIA Container Toolkit
- NVENC
- ffmpeg

整體更容易固定。

Windows 可以開發，但正式 appliance 建議 Linux。

---

# 31. RTX Worker 分離

```text
avatar-orchestrator
│
├── liveportrait-worker
│     TensorRT
└── musetalk-worker
      PyTorch CUDA
```

原因：
- TensorRT / PyTorch 版本可能互相限制
- 方便獨立升級
- 方便 profiling
- 減少 dependency conflict

---

# 32. FasterLivePortrait RTX Docker

上游提供：

```bash
docker pull shaoguo/faster_liveportrait:v3
```

概念：

```bash
docker run -it --gpus=all   --name faster_liveportrait   -p 9870:9870   -v /path/to/FasterLivePortrait:/root/FasterLivePortrait   shaoguo/faster_liveportrait:v3   /bin/bash
```

Production 要 pin image digest + repo commit，不用浮動 latest。

---

# 33. FasterLivePortrait TensorRT 注意

上游文件目前建議 TensorRT 8.x，並需要 grid_sample TensorRT plugin。

因此：
- 不要假設最新 TensorRT 一定相容
- 以獨立 container 固定上游驗證版本
- 先跑官方 sample，再抽 worker API

---

# 34. MuseTalk RTX 官方環境

上游目前推薦：

```text
Python 3.10
PyTorch 2.0.1
CUDA 11.7/11.8 類路線
```

概念：

```bash
conda create -n MuseTalk python=3.10
conda activate MuseTalk

pip install torch==2.0.1   torchvision==0.15.2   torchaudio==2.0.2   --index-url https://download.pytorch.org/whl/cu118

pip install -r requirements.txt

pip install -U openmim
mim install mmengine
mim install "mmcv==2.0.1"
mim install "mmdet==3.1.0"
mim install "mmpose==1.1.0"

sh ./download_weights.sh
```

依 RTX 4080 Driver / CUDA compatibility 做測試後才 freeze。

---

# 35. RTX 4080 起始 Profile

建議第一階段：

```text
512×512 avatar stage
25 FPS target
State Bank Mode
MuseTalk realtime
NVENC H.264
```

先不要：
- 1080p full-body
- 60 FPS
- Continuous dual inference

右側 UI 卡片不需要這種成本。

---

# 36. Encoder

Mac：
```text
VideoToolbox H.264
```

RTX：
```text
NVENC H.264
```

正式：
```text
WebRTC
```

---

# 37. 開發 Streaming 階段

Phase 1：
```text
WebSocket + JPEG/WebP frames
```

驗證：
- state
- expression
- lip sync
- interruption

Phase 2：
```text
WebRTC
```

把模型與 WebRTC 分階段 debug。

---

# 38. 正式 WebRTC

```text
Avatar Runtime
↓
VideoTrack
↓
H.264
↓
WebRTC
↓
Browser
```

控制：
```text
WebSocket
```

即：
- WebRTC = media
- WebSocket = state / control / metrics

---

# 39. API

Base：
```text
http://127.0.0.1:8765
```

## Health

```http
GET /health
```

Mac：

```json
{
  "status": "ready",
  "platform": "mac_mlx",
  "liveportrait": "ready",
  "musetalk": "ready",
  "encoder": "videotoolbox"
}
```

RTX：

```json
{
  "status": "ready",
  "platform": "rtx_cuda",
  "liveportrait": "tensorrt",
  "musetalk": "cuda",
  "encoder": "nvenc"
}
```

---

# 40. Capability API

```http
GET /capabilities
```

```json
{
  "backend": "mac_mlx",
  "state_bank": true,
  "continuous_liveportrait": true,
  "musetalk": true,
  "webrtc": true,
  "max_recommended_fps": 25
}
```

`max_recommended_fps` 必須來自本機 benchmark，不硬編碼。

---

# 41. Avatar Prepare API

```http
POST /avatars
```

Multipart：
- `source_image`
- `avatar_name`

Response：

```json
{
  "avatar_id": "customer_001",
  "status": "preparing"
}
```

建立 Expression Bank：

```http
POST /avatars/customer_001/build-expression-bank
```

---

# 42. Runtime Session API

```http
POST /sessions
```

```json
{
  "avatar_id": "customer_001",
  "fps": 25,
  "width": 512,
  "height": 512,
  "mode": "state_bank"
}
```

---

# 43. Persona State API

```http
POST /sessions/{id}/state
```

```json
{
  "emotion": "skeptical",
  "emotion_intensity": 0.68,
  "trust": 42,
  "interest": 35,
  "resistance": 78,
  "listening": true
}
```

---

# 44. Audio / Interrupt

Prototype：

```http
POST /sessions/{id}/audio
Content-Type: audio/wav
```

正式建議 WebSocket binary audio。

Interrupt：

```http
POST /sessions/{id}/interrupt
```

執行：
- cancel current TTS
- flush pending audio
- flush stale MuseTalk frames
- mouth-close transition
- switch to listening

---

# 45. WebSocket Event

```text
/ws/sessions/{id}
```

事件：
- avatar.ready
- avatar.loading
- avatar.state.changed
- avatar.expression.transition
- avatar.audio.buffering
- avatar.speaking.started
- avatar.speaking.ended
- avatar.interrupted
- avatar.frame.drop
- avatar.runtime.degraded
- avatar.error

---

# 46. Mini-Agent 整合

Customer Agent 回：

```json
{
  "reply": "我還是覺得每個月這個金額有點高。",
  "persona_state": {
    "emotion": "skeptical",
    "emotion_intensity": 0.72,
    "trust": 39,
    "interest": 48,
    "resistance": 76
  }
}
```

流程：

```text
Customer Agent
↓
persist PersonaState
↓
Avatar set_state
↓
TTS reply
↓
Audio stream
↓
Avatar Runtime
↓
MuseTalk
↓
WebRTC
```

---

# 47. State 要比 Audio 早到

推薦：

```text
t=0        send state
t=50–200   start expression transition
t=150–400  audio starts
```

人物會先有「準備說話」的反應。

---

# 48. TTS Provider Abstraction

Avatar Runtime 不綁 ElevenLabs。

上層可以：
- ElevenLabs
- MiniMax Speech
- local TTS
- other

統一轉 PCM + timestamps。

---

# 49. Frame Scheduler

```python
class FrameScheduler:
    fps: int = 25
    def next_pts(self): ...
```

如果生成跟不上，不要累積數秒 latency；drop late frame 保持音訊 realtime。

---

# 50. Browser UI

```tsx
<PersonaStage>
  <AvatarVideo />
  <SpeakingIndicator />
  <PersonaStatus />
</PersonaStage>
```

Web 不知道 MLX / CUDA / TensorRT。

Admin 才顯示 runtime backend。

---

# 51. 最佳 A/V 策略

正式 WebRTC stream 同時帶：

```text
video + TTS audio
```

Browser 不另外播第二條 ElevenLabs audio。

這樣嘴型與聲音共用同一 media clock。

---

# 52. Preflight / Warmup

使用者按 Start 前：
1. backend ready
2. model loaded
3. avatar cache loaded
4. expression bank ready
5. MuseTalk warmup
6. TTS ready
7. WebRTC connected
8. audio device ready

才允許 Start Training。

---

# 53. Fallback

LivePortrait fail：
```text
freeze expression + MuseTalk only
```

MuseTalk fail：
```text
LivePortrait motion + audio
```

兩者 fail：
```text
static portrait + audio
```

**Avatar 故障不得終止 AI Training Session。**

---

# 54. Mac Config

```yaml
backend: mac_mlx

canvas:
  width: 512
  height: 512
  fps: 25

liveportrait:
  engine: fasterliveportrait_mlx
  profile: turbo
  mode: state_bank

musetalk:
  engine: musetalk_mlx
  precision: fp16
  batch_size: 8

encoder:
  engine: videotoolbox
  codec: h264

stream:
  transport: webrtc
```

---

# 55. RTX Config

```yaml
backend: rtx_cuda

canvas:
  width: 512
  height: 512
  fps: 25

liveportrait:
  engine: fasterliveportrait_trt
  mode: state_bank

musetalk:
  engine: official_musetalk_v15
  batch_size: 8

encoder:
  engine: nvenc
  codec: h264

stream:
  transport: webrtc
```

Batch size 只是起點，需 benchmark。

---

# 56. Runtime Profiles

Mac Balanced：
```text
512 / 25fps target / LP turbo / Muse fp16 / State Bank
```

Mac Memory Saver：
```text
512 / 20–25fps / LP ultra / Muse q8 / State Bank
```

RTX Balanced：
```text
512 / 25fps / LP TRT / Muse CUDA / State Bank
```

RTX Quality：
```text
720-ish stage / 25fps / richer State Bank or continuous
```

---

# 57. Benchmark

固定：
- 同 Avatar
- 同 10 秒 zh-TW audio
- 同 expression sequence
- 同 resolution
- 同 FPS target

記錄：

```text
cold_start_ms
warm_start_ms
first_frame_ms
first_lipsync_frame_ms
avg_fps
p95_frame_ms
audio_video_drift_ms
memory_mb
gpu_memory_mb
dropped_frames
```

---

# 58. Quality Test

自動：
- lip sync metric
- temporal consistency
- identity similarity
- dropped frame
- A/V drift

人工：
- 中文嘴型
- 爆破音
- 數字
- 英文縮寫
- 情緒自然度
- 眼睛
- 嘴部 boundary
- strong emotion identity stability

---

# 59. 中文測試句

```text
我想先了解一下這份保險每個月到底需要多少費用。
```

```text
如果一年要繳三萬六千元，我覺得有點超出預算。
```

```text
ROI、APR、ETF 這些條件跟你剛才說的是一樣嗎？
```

```text
新台幣二千三百五十萬元。
```

---

# 60. 情緒 A/B Test

同一句：

```text
我還想再考慮一下。
```

生成：
- neutral
- skeptical
- frustrated
- angry
- interested

確認不是只有嘴巴不同。

---

# 61. Listening Test

Avatar 10 秒不說話：
- 自然 blink
- 微小 head motion
- gaze 不漂
- 嘴巴不動
- 表情維持 current Persona State

---

# 62. Soak Test

10 分鐘：
- 無 crash
- memory 不持續增長
- drift 不累積
- crop 不漂
- expression 可切
- interruption 可恢復

正式版再跑 30 分鐘。

---

# 63. Worker IPC

同機優先：
- Unix Domain Socket
- shared memory ring buffer

不要每幀：
```text
PNG → HTTP JSON
```

MVP 可以先 HTTP / ZeroMQ，效能版再 shared memory。

---

# 64. Model Cache

模型 Session 間常駐。

Avatar source cache 使用 LRU。

例如：
```text
max_active_avatars=3
```

超過再 evict。

---

# 65. Memory Degrade

Mac：
```text
fp16 → q8
continuous → state_bank
25fps → 20fps
```

RTX：
```text
batch↓
continuous → state_bank
resolution↓
```

不能直接 OOM crash。

---

# 66. Runtime Auto Profile

啟動：

```text
detect platform
↓
warm benchmark
↓
choose profile
```

例如：
- mac_low
- mac_balanced
- mac_high
- rtx_balanced
- rtx_high

---

# 67. .env

```env
AVATAR_BACKEND=auto
AVATAR_HOST=127.0.0.1
AVATAR_PORT=8765
AVATAR_DEFAULT_FPS=25
AVATAR_DEFAULT_WIDTH=512
AVATAR_DEFAULT_HEIGHT=512
AVATAR_MODE=state_bank
AVATAR_WEBRTC=true
```

Mac：
```env
AVATAR_BACKEND=mac_mlx
LIVEPORTRAIT_ENGINE=fasterliveportrait_mlx
MUSETALK_ENGINE=musetalk_mlx
MUSETALK_PRECISION=fp16
```

RTX：
```env
AVATAR_BACKEND=rtx_cuda
LIVEPORTRAIT_ENGINE=fasterliveportrait_trt
MUSETALK_ENGINE=official_v15
```

---

# 68. 開發階段

## Phase 1 — 離線畫質
- LivePortrait
- 5 expression states
- MuseTalk
- composite
- output mp4

## Phase 2 — Local API
- state
- audio
- output

## Phase 3 — Streaming
- audio chunk
- frame queue
- clock
- interruption
- WebSocket prototype

## Phase 4 — WebRTC
- H.264
- browser video
- reconnect

## Phase 5 — Mini-Agent
- Customer Agent Persona State
- Expression Controller

## Phase 6 — Cross-platform
同一 E2E test 在 Mac / RTX 通過。

## Phase 7 — Continuous Mode
State Bank 穩定後再做。

---

# 69. 第一版只做 6 個 Expression

1. neutral
2. listening
3. skeptical
4. concerned
5. frustrated
6. interested

已足夠展示 AI Customer。

第二版再加：
- angry
- confused
- thinking
- satisfied
- ready
- disengaged

---

# 70. Head / Gaze Clamp

右側 Persona Card 第一版：
```text
yaw   ±8–12°
pitch ±5–8°
roll  ±5°
```

Gaze：
- user
- slightly_away
- down

不要一開始做複雜 eye tracking。

---

# 71. Source Image 規範

- 1024×1024 以上
- 單人
- 正面
- 頭肩
- 嘴巴自然
- 無遮臉
- 光線均勻
- 眼鏡不要強反光
- 頭部完整

你的 UI 人物在右側，可讓視線偏左 2–5°，但仍以近正面為主。

---

# 72. Transparent Avatar

第一版建議人物 video card。

若要透明：
```text
person segmentation
↓
alpha / chroma
↓
browser WebGL canvas
```

因為常規 H.264 WebRTC 不直接提供簡單 alpha channel。

---

# 73. Security / Consent

只使用：
- 自製人物
- 合成人物
- 已取得授權人物

保存：
```text
source
license
consent
owner
created_at
```

---

# 74. License 注意

## LivePortrait
Code：MIT。

但官方 License 特別說明其預設 InsightFace detection models 為 **non-commercial research only**。

若商業化：
- 替換該 detection model
- 重新審核所有 model assets

## MuseTalk
Code：MIT。

正式 redistribution 仍保留：
- MuseTalk License
- third-party notices
- dependent model licenses

## Mac Community Ports
`fasterliveportrait-mlx`、`musetalk-mlx` 皆需：
- pin SHA
- pin weights revision
- checksum
- regression
- security review
- license review

---

# 75. Model Manifest

```json
{
  "liveportrait": {
    "engine": "fasterliveportrait-mlx",
    "revision": "git-sha"
  },
  "musetalk": {
    "engine": "musetalk-mlx",
    "revision": "git-sha",
    "variant": "fp16"
  }
}
```

---

# 76. Error Codes

```text
MODEL_LOAD_FAILED
AVATAR_PREPARE_FAILED
AUDIO_FORMAT_INVALID
LIPSYNC_TIMEOUT
FRAME_QUEUE_OVERFLOW
ENCODER_FAILED
WEBRTC_DISCONNECTED
OUT_OF_MEMORY
```

---

# 77. Metrics

```text
avatar_fps
avatar_first_frame_ms
avatar_render_ms
musetalk_ms
liveportrait_ms
composite_ms
encode_ms
av_drift_ms
frame_drop_total
audio_buffer_ms
avatar_oom_total
```

---

# 78. QA Matrix

| Test | Mac | RTX |
|---|---|---|
| Load Avatar | ☐ | ☐ |
| State Bank | ☐ | ☐ |
| Neutral | ☐ | ☐ |
| Skeptical | ☐ | ☐ |
| Frustrated | ☐ | ☐ |
| Interested | ☐ | ☐ |
| Chinese Lip | ☐ | ☐ |
| English Lip | ☐ | ☐ |
| Number Speech | ☐ | ☐ |
| 10min Session | ☐ | ☐ |
| Interrupt | ☐ | ☐ |
| WebRTC reconnect | ☐ | ☐ |
| Memory pressure | ☐ | ☐ |
| Fallback | ☐ | ☐ |

---

# 79. P0

- [ ] Mac MLX backend
- [ ] RTX backend
- [ ] source avatar
- [ ] expression bank
- [ ] Persona State mapping
- [ ] MuseTalk lip sync
- [ ] mouth ROI blend
- [ ] temporal smoothing
- [ ] audio clock
- [ ] interruption
- [ ] local API
- [ ] WebSocket events
- [ ] WebRTC
- [ ] fallback
- [ ] benchmark
- [ ] soak test

---

# 80. P1 / P2

P1：
- continuous LivePortrait
- transparent/background removal
- dynamic gaze
- more expressions
- adaptive quality
- multi-avatar cache
- admin runtime panel

P2：
- full-body gesture
- hand animation
- 3D integration
- mobile
- MLX Swift native client
- direct WebCodecs pipeline

---

# 81. 最推薦 Mac MVP

```text
Apple Silicon
↓
FasterLivePortrait-MLX
↓
Expression State Bank
↓
MuseTalk-MLX fp16
↓
Mouth ROI Blend
↓
VideoToolbox
↓
WebRTC
```

速度不夠：

```text
fp16 → q8
25fps → 20fps
continuous → State Bank only
```

---

# 82. 最推薦 RTX 4080 MVP

```text
RTX 4080
↓
FasterLivePortrait TensorRT
↓
Expression State Bank
↓
MuseTalk 1.5 CUDA
↓
Mouth ROI Blend
↓
NVENC
↓
WebRTC
```

穩定後再 Continuous Mode。

---

# 83. AI Coach 最終資料流

```text
User Voice
↓
STT
↓
Mini-Agent
↓
MiniMax Customer Agent
↓
┌────────────────────────────┐
│ Reply Text                 │
│ Persona State              │
└─────────┬──────────────────┘
          │
      ┌───┴────┐
      ▼        ▼
     TTS   Expression Controller
      │        │
      │   LivePortrait
      │        │
      └────┬───┘
           ▼
        MuseTalk
           ▼
        Composite
           ▼
         WebRTC
           ▼
 Web Right Persona Card
```

---

# 84. 對產品真正有價值的亮點

不是：

> 我們有一個會說話的 Avatar。

而是：

> **模擬人物的視覺反應由 AI 情境狀態驅動。**

例如：

```text
學員過度推銷
↓
Resistance +20
↓
Persona skeptical → frustrated
↓
人物真的變得不耐煩
↓
學員立即感知溝通錯誤
```

這才與 AI Coach 的訓練目的連起來。

---

# 85. 技術亮點提案文字

> 系統設計跨平台 Local Digital Human Runtime，於 Apple Silicon 使用 MLX 推論路徑、於 NVIDIA RTX 使用 CUDA/TensorRT 路徑。LivePortrait 系列模型負責人物表情、眼神與頭部動態控制，MuseTalk 負責語音驅動之高品質嘴型同步，並由自研 Persona Expression Controller 將情境 Agent 的信任度、抗拒度與情緒狀態映射為可平滑轉換的視覺表情，使虛擬人物不僅會說話，而能隨對話策略產生可觀察的情緒反應。

---

# 86. 最低風險實作順序

```text
1. 單平台跑通 LivePortrait
2. 單平台跑通 MuseTalk
3. 離線串接
4. Mouth ROI blending
5. Expression Bank
6. Persona State Controller
7. Streaming audio
8. Interrupt
9. WebSocket prototype
10. WebRTC
11. 第二平台 Backend
12. Cross-platform regression
13. Continuous mode
```

不要同一天一起 debug：
- LivePortrait
- MuseTalk
- MiniMax
- TTS
- WebRTC

---

# 87. 第一個可展示 Demo

Avatar：陳先生

表情：
- neutral
- skeptical
- frustrated
- interested

流程：

```text
AI Customer:
「我已經有保險了，為什麼還要多買？」

學員處理不好
↓
frustrated

學員重新承接家庭壓力
↓
interested
```

搭配即時 TTS + MuseTalk Lip Sync，已足以展示核心技術。

---

# 88. 上游來源

## LivePortrait Official
https://github.com/KlingAIResearch/LivePortrait

## FasterLivePortrait — RTX
https://github.com/warmshao/FasterLivePortrait

## FasterLivePortrait-MLX — Mac
https://github.com/ivanfioravanti/fasterliveportrait-mlx

## MuseTalk Official
https://github.com/TMElyralab/MuseTalk

## MuseTalk MLX — Mac
https://github.com/xocialize/musetalk-mlx

## MuseTalk MPS Alternative
https://github.com/barnent1/musetalk-mac

---

# 89. 來源事實與工程假設區分

已由上游明確提供 / 宣稱：
- LivePortrait 官方有人類模式 Apple Silicon 支援，但官方 PyTorch macOS 路徑可能比 RTX 4090 慢很多。
- FasterLivePortrait fork 宣稱 RTX 3090 TensorRT 30+ FPS，包含前後處理。
- MuseTalk 1.5 官方提供 realtime inference，官方基準宣稱 Tesla V100 30fps+。
- FasterLivePortrait-MLX 提供 Apple Silicon MLX runtime、realtime profiles 與 experimental FastAPI。
- musetalk-mlx 社群 port 提供 MuseTalk 1.5 MLX neural core 與 fp16 / q8 / q4 variant。

本文的 512×512、25fps、batch=8、buffer 250–500ms 等：
> 都是建議起始配置，不是硬體效能保證，必須透過 benchmark freeze。

---

# 90. ADR

## ADR-001
LivePortrait 不負責主要 Lip Sync，MuseTalk 專責 Mouth。

## ADR-002
Persona Expression 由自研 Expression Controller 控制，不讓 LLM 直接改模型參數。

## ADR-003
第一版使用 Expression State Bank，而非 Continuous Dual Inference。

## ADR-004
Mac 採 MLX 原生路徑。

## ADR-005
RTX 採 CUDA/TensorRT 路徑。

## ADR-006
Web 使用同一 AvatarProvider API，不知道底層硬體。

## ADR-007
Audio Clock 是影音同步主時鐘。

## ADR-008
WebRTC 負責正式影音；WebSocket 負責控制與 Runtime Event。

## ADR-009
Avatar 故障不得導致 AI Training Session 故障。

## ADR-010
正式產品只使用有授權的合成 / 自製 / 已同意 Avatar。

---

# 91. 最終一句話

> **Mac 版本以 FasterLivePortrait-MLX + MuseTalk-MLX 建立 Apple Silicon 原生本地 Avatar Runtime；RTX 版本以 FasterLivePortrait TensorRT + MuseTalk 1.5 CUDA 建立高效能 Runtime；兩邊共用 Persona Expression Controller、Expression State Bank、Mouth ROI Composite、Audio Clock、WebRTC 與 AvatarProvider API，讓 Mini-Agent / MiniMax 只輸出語意 Persona State，就能在不同硬體上驅動一致的虛擬人物表情與嘴型。**
