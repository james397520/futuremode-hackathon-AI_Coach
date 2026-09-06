# SkillCoach 平台技術文件

> 基於多模態 Agent 的企業與教育全情境模擬培訓平台 —— 應用程式原始碼、安裝、部署與維運手冊。
>
> 這份文件是 monorepo 的開發與部署總覽。黑客松提交總覽、產品理念與展示影片請看 [README.md](README.md)；各子系統更細的說明在 [docs/](docs/) 與各目錄自己的 README。

[![CI](https://github.com/james397520/futuremode-hackathon-AI_Coach/actions/workflows/ci.yml/badge.svg)](https://github.com/james397520/futuremode-hackathon-AI_Coach/actions/workflows/ci.yml)
![Node](https://img.shields.io/badge/node-20.18-339933?logo=node.js&logoColor=white)
![Python](https://img.shields.io/badge/python-3.12-3776AB?logo=python&logoColor=white)
![pnpm](https://img.shields.io/badge/pnpm-9.12-F69220?logo=pnpm&logoColor=white)
![Platforms](https://img.shields.io/badge/platforms-macOS%20%7C%20Windows%20%7C%20Linux-555)

---

## 目錄

- [功能總覽](#功能總覽)
- [系統架構](#系統架構)
- [技術棧](#技術棧)
- [專案結構](#專案結構)
- [快速開始（macOS，10 分鐘）](#快速開始macos10-分鐘)
- [完整安裝與部署](#完整安裝與部署)
  - [共同前置：帳號與金鑰](#共同前置帳號與金鑰)
  - [macOS 部署](#macos-部署)
  - [Windows 部署](#windows-部署)
  - [Linux 正式環境部署（systemd + nginx）](#linux-正式環境部署systemd--nginx)
- [環境變數參考](#環境變數參考)
- [語音：STT / TTS 與本地備援](#語音stt--tts-與本地備援)
- [瀏覽器端情緒辨識](#瀏覽器端情緒辨識)
- [多 Agent 對話引擎與 RAG](#多-agent-對話引擎與-rag)
- [資料庫、遷移與示範帳號](#資料庫遷移與示範帳號)
- [日常維運](#日常維運)
- [測試與品質門](#測試與品質門)
- [疑難排解](#疑難排解)
- [安全與隱私](#安全與隱私)
- [附屬子專案](#附屬子專案)
- [文件索引](#文件索引)
- [授權](#授權)

---

## 功能總覽

| 能力 | 說明 | 主要程式位置 |
| --- | --- | --- |
| AI 模擬客戶對練 | 以信任、興趣、抗拒、耐心等隱藏狀態驅動的客戶人設，依學員回應即時調整態度與難度；多 Agent 每輪依序執行合規預檢 → 情境導演 → 知識檢索 → 客戶回覆（串流）→ 合規後檢 → 教練回饋 → 評分 | `apps/api/app/agents/` |
| 模糊意圖推論與追問 | 規則式意圖判定（`AMBIGUOUS / INCOMPLETE → CLARIFY`）；客戶會在角色內反問並列出可能的意思，並以 `persona.clarify.options` 事件推給前端 | `apps/api/app/agents/intent.py`、`customer_agent.py` |
| 合規即時攔截 | 禁用話術（保證獲利、保本、節稅承諾等）逐句比對，高風險當場在對談中標示並附原話證據 | `apps/api/app/agents/compliance_agent.py` |
| 企業知識 RAG | parse → chunk → embed → index → retrieve → rerank；七種切塊策略、RRF 混合檢索、租戶隔離過濾；客戶與教練的回答附引用來源 | `apps/api/app/rag/` |
| 語音對練 | 麥克風語音辨識（macOS 本機 / 雲端）與客戶語音合成（本地模型 / 雲端 / 系統語音），三層備援，音訊與金鑰都不經瀏覽器直連供應商 | `apps/api/app/ws/voice.py`、`services/local-tts/`、`tools/mac-stt/` |
| 瀏覽器端情緒辨識 | MediaPipe Face Landmarker 在瀏覽器內算 52 個 blendshape，規則引擎判讀情緒；影像不離開瀏覽器，只送標籤與信心值；客戶會回應學員表情，教練在偵測到苦惱時主動提供協助 | `apps/web/src/features/simulation/lib/mediapipe-affect.ts`、`affect-nudge.tsx` |
| 3D 虛擬人 | 依人設性別與年齡自動配對的六個 VRM 角色，表情跟隨客戶狀態、嘴型跟隨語音 | `apps/web/src/features/avatar/` |
| 逐句可追溯評分 | 十維度技能評分，每個分數附逐字稿證據；證據核對不上的分數會被捨棄 | `apps/api/app/agents/evaluator_agent.py` |
| 成效回顧與報表 | 個人技能輪廓、趨勢、情境熟練度、團隊／合規報表 | `apps/web/src/features/performance/`、`features/reports/` |
| 多租戶、RBAC、稽核 | 工作區與團隊隔離（資料庫層強制）、五種角色權限矩陣、每個變更寫稽核紀錄 | `apps/api/app/core/` |

---

## 系統架構

```text
┌──────────────────────────────── 瀏覽器（Next.js 15, :3000）────────────────────────────────┐
│  對談介面 · 3D 虛擬人（three-vrm）· 麥克風擷取（MediaRecorder / VAD）                          │
│  MediaPipe Face Landmarker（WASM/WebGPU，情緒辨識在本機完成）· 系統語音 speechSynthesis（最後備援） │
└───────────────┬───────────────────────────────────────────────────────────┬─────────────────┘
                │ HTTPS REST + WebSocket（/api/v1/sessions/{id}/ws）          │ 只送情緒標籤＋信心值
                ▼                                                           ▼
┌──────────────────────────────── FastAPI 對話編排 API（:8000）────────────────────────────────┐
│  多 Agent：合規預檢 → 情境導演 → 知識檢索 → 客戶（串流）→ 合規後檢 → 教練 → 評分            │
│  意圖判定（釐清／收斂）· 臉部與文字情緒融合 · 版本釘選 session · RBAC · 稽核 · 限流           │
│  語音邊界：STT（mac 本機 → 雲端備援）· TTS（本地模型 → 雲端 → 交給瀏覽器系統語音）            │
└───┬──────────────┬──────────────┬──────────────┬──────────────────┬─────────────────────────┘
    │              │              │              │                  │
    ▼              ▼              ▼              ▼                  ▼
 PostgreSQL 16   Redis 7      向量庫           物件儲存        MiniMax LLM（Anthropic 相容端點）
 主資料庫        限流/佇列     memory(本機)     S3 相容        ElevenLabs（雲端 STT Scribe / TTS）
                              Qdrant(正式)    （本機可關）
    ▲ 本機 loopback 側掛服務（任一個掛掉都不會中止訓練 session）
    ├── services/local-tts   :8795  本地繁中 TTS 模型（Breeze2-VITS 預設，Kokoro 備援；onnxruntime CPU）
    ├── tools/mac-stt        :8790  macOS 原生語音辨識（Speech.framework，離線；僅 macOS）
    ├── services/avatar-runtime :8765  虛擬人 runtime（可選）
    └── services/inference   :8770  私有 embedding / rerank（可選，需自備權重）
```

### 連接埠一覽

| 服務 | 連接埠 | 綁定 | 必要性 |
| --- | --- | --- | --- |
| Web（Next.js） | 3000 | 0.0.0.0 | 必要 |
| API（FastAPI） | 8000 | 0.0.0.0（本機）/ 127.0.0.1（正式，經 nginx） | 必要 |
| PostgreSQL | 5432 | — | 必要 |
| Redis | 6379 | — | 必要 |
| 本地 TTS 模型 `services/local-tts` | 8795 | 127.0.0.1 | 建議（語音本地備援） |
| macOS 原生 STT `tools/mac-stt` | 8790 | 127.0.0.1 | 建議（僅 macOS） |
| 虛擬人 runtime | 8765 | 127.0.0.1 | 可選 |
| 私有推論服務 | 8770 | 127.0.0.1 | 可選 |
| Qdrant | 6333 | — | 正式 RAG 必要；本機可用 `memory` |
| S3 / MinIO | 9000 | — | 檔案上傳與報表匯出；本機可關 |

---

## 技術棧

| 層 | 技術 |
| --- | --- |
| 前端 | Next.js 15（App Router）、React 18、TypeScript 5、Tailwind 3、Zustand、TanStack Query、framer-motion、three.js 0.185 + @pixiv/three-vrm 3.5、@mediapipe/tasks-vision |
| 後端 | Python 3.12、FastAPI、Pydantic 2、SQLAlchemy 2（async）+ asyncpg、Alembic、Celery（Redis broker）、structlog、OpenTelemetry |
| AI | MiniMax（`MiniMax-M3`，Anthropic 相容端點）作為所有對話 Agent 的 LLM；ElevenLabs Scribe（雲端 STT）與 ElevenLabs TTS（`eleven_flash_v2_5`）；本地 TTS：MediaTek Breeze2-VITS-onnx、hexgrad Kokoro-82M-v1.1-zh（onnxruntime）；macOS Speech.framework（本機 STT）；MediaPipe Face Landmarker（瀏覽器情緒辨識） |
| 資料 | PostgreSQL 16、Redis 7、Qdrant（正式向量庫）、S3 相容物件儲存 |
| 工具鏈 | pnpm 9.12 workspace、uv（Python 環境）、ruff、mypy、pytest、vitest、shellcheck、GitHub Actions |
| 部署 | 原生程序；macOS 以 launchd 常駐、Linux 以 systemd + nginx；**不使用 Docker** |

---

## 專案結構

```text
.
├── apps/
│   ├── web/                     Next.js 前端（唯一 user-facing app）
│   │   ├── src/app/             路由與 layout（不放業務邏輯）
│   │   ├── src/features/        業務功能：simulation（對談／語音頁）、avatar、performance…
│   │   ├── src/components/      App shell、資料視覺化、逐字稿元件
│   │   └── public/mediapipe/    情緒辨識用 WASM 與模型（同源提供，26 MB）
│   └── api/                     FastAPI 對話編排 API
│       ├── app/agents/          多 Agent（orchestrator、customer、coach、compliance、evaluator、intent…）
│       ├── app/rag/             文件解析、切塊、embedding、檢索、重排
│       ├── app/ws/              WebSocket gateway、事件、語音邊界（voice.py）
│       ├── app/services/        應用服務層
│       └── app/core/            設定、安全、RBAC、租戶隔離、稽核
├── services/
│   ├── local-tts/               本地繁中 TTS 模型伺服器（loopback only）
│   ├── avatar-runtime/          虛擬人 runtime（可選）
│   └── inference/               私有 embedding / rerank（可選）
├── tools/mac-stt/               macOS 原生語音辨識 helper（Swift，.app bundle + launchd）
├── packages/                    shared（TS ↔ Pydantic 契約）、design-tokens、ui、ai-runtime
├── database/                    migrations、seeds/seed.py（示範資料）
├── scripts/
│   ├── bootstrap.sh             安裝依賴、檢查服務、migration、seed
│   ├── check-contracts.sh       TS/Python 事件契約防漂移
│   └── dev/                     launchd 安裝腳本（API、mac-stt、local-tts）、MediaPipe 資產抓取
├── infra/systemd, infra/nginx   Linux 正式環境範本
├── docs/                        規格、架構、API、部署、ADR、交付文件（HANDOFF.md）
├── backend/                     隊友的獨立 SkillCoach 後端子專案（見附屬子專案）
└── emotion_webcam/              MediaPipe blendshape 表情規則引擎的 Python 範例與規則來源
```

檔案歸屬與「東西該放哪」的權威定義在 [docs/PROJECT_STRUCTURE.md](docs/PROJECT_STRUCTURE.md)。

---

## 快速開始（macOS，10 分鐘）

適用於 Apple Silicon 或 Intel Mac。以下完成後可以在瀏覽器進行文字對談、語音對談（本機辨識＋本地模型語音）與鏡頭情緒辨識。

```bash
# 1. 系統依賴
brew install postgresql@16 redis ffmpeg uv
brew services start postgresql@16
brew services start redis
createdb aicoach
xcode-select --install          # 已安裝會提示「already installed」；mac-stt 需要 Command Line Tools

# 2. Node 與 pnpm
brew install node@20            # 或 nvm use（.nvmrc = 20.18.0）
corepack enable && corepack install --global pnpm@9.12.0
# 若 corepack 出現簽章錯誤：export COREPACK_INTEGRITY_KEYS=0

# 3. 取得程式碼與設定
git clone https://github.com/james397520/futuremode-hackathon-AI_Coach.git skillcoach
cd skillcoach
cp .env.example .env
#    編輯 .env：MINIMAX_API_KEY 必填；ELEVENLABS_API_KEY 建議填（雲端語音備援）
#    加上開發自動登入（見「資料庫、遷移與示範帳號」）：
#    NEXT_PUBLIC_DEV_LOGIN_EMAIL=trainee@demo.ai-coach.local
#    NEXT_PUBLIC_DEV_LOGIN_PASSWORD=demo-only-not-a-secret

# 4. Python 環境（釘 3.12，不要用系統的 3.14）與一鍵初始化
uv venv --python 3.12 apps/api/.venv
scripts/bootstrap.sh            # pnpm install、pip install、檢查 Postgres/Redis、migration、seed

# 5. 語音本地備援（可略過，略過則語音走雲端／系統語音）
pnpm stt:install                # 建置並常駐 macOS 原生語音辨識（首次會跳「語音辨識」授權，按允許）
pnpm tts:install                # 建 venv、下載約 505 MB 模型權重、常駐本地 TTS 模型

# 6. 啟動
pnpm dev                        # predev 會自動把 API、mac-stt、local-tts 三個 launchd 服務帶起來
```

開啟 <http://localhost:3000>，然後驗證：

```bash
curl -fsS http://localhost:8000/healthz            # API 活著
curl -s   http://localhost:8000/readyz | head -c 300 # Postgres / Redis ok
curl -s   http://127.0.0.1:8795/healthz | head -c 300 # 本地 TTS：status ok，engine breeze
scripts/dev/install-mac-stt-service.sh --status    # mac-stt：state running
```

進入「模擬練習」→ 任一情境 →「設定練習」→「開始語音練習」，輸入框旁可切換「說：本地」「聽：本地」，並以相機鈕開啟鏡頭情緒辨識。

---

## 完整安裝與部署

### 共同前置：帳號與金鑰

| 項目 | 用途 | 必要性 |
| --- | --- | --- |
| MiniMax API key | 所有對話 Agent 的 LLM（`LLM_PROVIDER=minimax`） | **必要** |
| ElevenLabs API key | 雲端語音辨識（Scribe）與雲端語音合成；也是本地語音失效時的備援 | 建議。沒有時 STT 只剩 macOS 本機、TTS 只剩本地模型與系統語音 |
| OpenAI API key | 替代的 LLM / STT / TTS 供應商 | 可選 |
| Qdrant | 正式環境的向量庫 | 正式環境必要；本機用 `VECTOR_BACKEND=memory` |
| S3 相容儲存 | 上傳文件、報表匯出、音訊 | 正式環境必要；本機 `OBJECT_STORAGE_ENABLED=false` |

所有金鑰只放在 API／worker 讀取的 `.env`，**絕不**放進 `NEXT_PUBLIC_*`、前端 bundle、git 或日誌。

### macOS 部署

macOS 是主要開發與展示平台，三個常駐服務都以 launchd user agent 管理，登入即啟動、崩潰自動重啟。

#### 1. 系統依賴

```bash
brew install postgresql@16 redis ffmpeg uv node@20
brew services start postgresql@16 redis
createdb aicoach
xcode-select --install                   # swiftc，建置 tools/mac-stt 需要
corepack enable && corepack install --global pnpm@9.12.0
```

`ffmpeg` 有兩個用途：API 把瀏覽器送來的 WebM/Opus 轉成 16 kHz wav 給 macOS 辨識器；本地 TTS 把 wav 轉成 mp3。

#### 2. 設定檔

```bash
cp .env.example .env
```

本機最小可用設定（其餘保留範例預設值）：

```env
APP_ENV=local
DATABASE_URL=postgresql+asyncpg://localhost:5432/aicoach
REDIS_URL=redis://localhost:6379/0
VECTOR_BACKEND=memory
OBJECT_STORAGE_ENABLED=false

LLM_PROVIDER=minimax
MINIMAX_API_KEY=你的金鑰
MINIMAX_MODEL=MiniMax-M3

STT_PROVIDER=mac                 # 本機辨識優先，失敗自動退到雲端
TTS_PROVIDER=local               # 本地模型優先，失敗自動退到 ElevenLabs
ELEVENLABS_API_KEY=你的金鑰       # 雲端備援；沒有可留空
ELEVENLABS_TTS_MODEL=eleven_flash_v2_5

NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
NEXT_PUBLIC_WS_BASE_URL=ws://localhost:8000
NEXT_PUBLIC_DEV_LOGIN_EMAIL=trainee@demo.ai-coach.local
NEXT_PUBLIC_DEV_LOGIN_PASSWORD=demo-only-not-a-secret
```

`.env` 只有一份，放在 monorepo 根目錄；`next.config.mjs` 會直接讀它，不要另外建 `apps/web/.env.local`。前端網址一律用 `localhost`，不要用 `127.0.0.1`，兩者是不同 cookie 網域，混用會登入後立刻掉登入。

#### 3. 安裝依賴、遷移、種子資料

```bash
uv venv --python 3.12 apps/api/.venv     # 先建好 3.12 的 venv，bootstrap 看到就不會用系統 python
scripts/bootstrap.sh                     # pnpm install → pip install -e apps/api[dev] → 檢查服務 → alembic upgrade → seed
```

`scripts/bootstrap.sh --check-services` 只檢查 `.env` 指到的 Postgres／Redis／Qdrant 是否連得到；`--no-seed` 略過示範資料。

#### 4. API 常駐（launchd）

```bash
bash scripts/dev/install-api-service.sh          # 註冊 com.aicoach.api，立即啟動
bash scripts/dev/install-api-service.sh --status
bash scripts/dev/install-api-service.sh --uninstall
```

兩層監督：`scripts/dev/run-api.sh` 在 uvicorn 退出後 2 秒內拉回並把每次啟停與退出碼記到 `/tmp/ai-coach-api-exits.log`；launchd `KeepAlive` 則負責 wrapper 本身與登入時自動啟動。API 日誌在 `/tmp/ai-coach-api.log`。設定變更後：

```bash
launchctl kickstart -k gui/$(id -u)/com.aicoach.api
```

想在前景跑（除錯用）：`pnpm api:dev`（`uvicorn --reload`，:8000）。**同一時間只能有一個 API 佔 8000**，先 `--uninstall` 或 `launchctl bootout` 再用前景模式。

#### 5. 語音本地備援常駐

```bash
pnpm stt:install     # = scripts/dev/install-mac-stt-service.sh：建置 .app、註冊 com.aicoach.mac-stt（:8790）
pnpm tts:install     # = scripts/dev/install-local-tts-service.sh：uv venv、下載模型、註冊 com.aicoach.local-tts（:8795）
```

mac-stt 首次啟動會跳出 macOS「語音辨識」授權對話框，按「允許」後記在 bundle id 上，不會再問。兩支腳本都支援 `--status` 與 `--uninstall`。細節見 [語音：STT / TTS 與本地備援](#語音stt--tts-與本地備援)。

#### 6. Web

開發：

```bash
pnpm dev             # predev = scripts/dev/ensure-services.sh，確保三個 launchd 服務在跑，再起 next dev :3000
```

正式建置與啟動：

```bash
pnpm build
pnpm --filter @ai-coach/web start --port 3000
```

`NEXT_PUBLIC_*` 會被編進前端產物，改了要重新 `pnpm build`。若要讓 web 也在登入時自動啟動，可比照 `scripts/dev/install-api-service.sh` 寫一個 launchd plist，`ProgramArguments` 指到 `pnpm --filter @ai-coach/web start`。

#### 7. 驗證

```bash
curl -fsS localhost:8000/healthz
curl -s   localhost:8000/readyz | python3 -m json.tool
curl -s   127.0.0.1:8795/healthz | python3 -m json.tool
curl -s   localhost:8000/api/v1/sessions/stt/capabilities -b "$(基於登入 cookie)"   # 或直接在瀏覽器 DevTools 看這個請求
bash scripts/check-contracts.sh        # TS ↔ Python 事件契約一致
```

瀏覽器內：語音頁輸入框下方的「辨識」pill 應能切到「Mac 本機」，「說：本地」tooltip 顯示「本地模型」而不是「系統語音」。

### Windows 部署

Windows 有兩條路。**方式 A（WSL2）**與 macOS／Linux 幾乎相同，所有 bash 腳本可直接用，建議採用；**方式 B（原生 PowerShell）**不依賴 WSL，但需手動執行腳本裡的步驟。兩種方式下：

- **語音辨識**：`tools/mac-stt` 是 macOS 專屬（Speech.framework），Windows 沒有本機辨識，`STT_PROVIDER` 請設 `elevenlabs` 或 `openai`；前端「聽：本地」會因為能力探測回報不可用而自動停用並說明原因。
- **語音合成**：本地 TTS 模型（`services/local-tts`）是純 Python + onnxruntime，Windows 可跑；沒跑時退到 ElevenLabs，再退到瀏覽器系統語音（Windows 內建的 Microsoft 中文語音也會被自動選用）。
- **情緒辨識**：在瀏覽器內完成，Windows 的 Chrome／Edge 均可；鏡頭權限需要 `localhost` 或 HTTPS。

#### 方式 A：WSL2（建議）

1. 安裝 WSL2 與 Ubuntu 24.04（PowerShell 管理員）：

   ```powershell
   wsl --install -d Ubuntu-24.04
   ```

   在 `%UserProfile%\.wslconfig` 建議至少給 8 GB 記憶體（本地 TTS 兩顆模型都載需要約 1 GB 常駐）：

   ```ini
   [wsl2]
   memory=8GB
   ```

   在 WSL 內啟用 systemd（`/etc/wsl.conf`），之後 `wsl --shutdown` 重開：

   ```ini
   [boot]
   systemd=true
   ```

2. 在 Ubuntu 內安裝依賴：

   ```bash
   sudo apt update
   sudo apt install -y postgresql redis-server ffmpeg git curl build-essential python3.12 python3.12-venv
   sudo systemctl enable --now postgresql redis-server
   sudo -u postgres createuser -s "$USER" && createdb aicoach
   curl -LsSf https://astral.sh/uv/install.sh | sh          # uv
   curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
   source ~/.bashrc && nvm install 20.18.0 && nvm use 20.18.0
   corepack enable && corepack install --global pnpm@9.12.0
   ```

3. 取得程式碼、設定、初始化：

   ```bash
   git clone https://github.com/james397520/futuremode-hackathon-AI_Coach.git skillcoach
   cd skillcoach && cp .env.example .env
   # 編輯 .env：MINIMAX_API_KEY、ELEVENLABS_API_KEY、STT_PROVIDER=elevenlabs、TTS_PROVIDER=local
   #           NEXT_PUBLIC_DEV_LOGIN_EMAIL / PASSWORD（同 macOS）
   uv venv --python 3.12 apps/api/.venv
   scripts/bootstrap.sh
   ```

4. 本地 TTS 模型（launchd 腳本在非 macOS 會直接結束，改手動）：

   ```bash
   cd services/local-tts
   uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -e '.[dev]'
   scripts/fetch_model.sh                   # 下載 Breeze2-VITS（124 MB）與 Kokoro（380 MB），sha256 驗證
   LOCAL_TTS_FFMPEG_BIN=/usr/bin/ffmpeg .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8795
   cd ../..
   ```

5. 啟動 API 與 Web（各一個終端機，或用 tmux）：

   ```bash
   bash scripts/dev/run-api.sh              # 監督式 API（:8000），從根 .env 載入設定
   pnpm dev                                 # Web（:3000）
   ```

   Windows 端瀏覽器直接開 <http://localhost:3000>；WSL2 會把 localhost 轉發到 Windows。

6. 常駐（可選）：把 [infra/systemd](infra/systemd) 的 `ai-coach-api.service`、`ai-coach-web.service` 與下方 [Linux 節](#linux-正式環境部署systemd--nginx)的 `ai-coach-local-tts.service` 範例複製到 `/etc/systemd/system/`，把路徑改成你的 clone 位置與使用者，`systemctl enable --now`。

#### 方式 B：原生 Windows（PowerShell）

1. 安裝工具（PowerShell 管理員，使用 winget）：

   ```powershell
   winget install -e --id Git.Git
   winget install -e --id OpenJS.NodeJS.LTS          # Node 20 LTS
   winget install -e --id Python.Python.3.12
   winget install -e --id PostgreSQL.PostgreSQL.16
   winget install -e --id Gyan.FFmpeg
   winget install -e --id astral-sh.uv
   winget install -e --id Memurai.MemuraiDeveloper   # Redis 相容伺服器（Windows 原生）
   ```

   重新開啟 PowerShell，確認 `node -v`、`python --version`（3.12）、`psql --version`、`ffmpeg -version`、`redis-cli ping`（Memurai 附帶）。

2. pnpm 與資料庫：

   ```powershell
   corepack enable
   corepack install --global pnpm@9.12.0
   # PostgreSQL 安裝時設定的 postgres 密碼在下一行會用到
   & "C:\Program Files\PostgreSQL\16\bin\createdb.exe" -U postgres aicoach
   ```

3. 取得程式碼與設定：

   ```powershell
   git clone https://github.com/james397520/futuremode-hackathon-AI_Coach.git skillcoach
   cd skillcoach
   Copy-Item .env.example .env
   notepad .env
   ```

   Windows 上 `DATABASE_URL` 需帶帳密：`postgresql+asyncpg://postgres:你的密碼@localhost:5432/aicoach`。其餘同 WSL2：`STT_PROVIDER=elevenlabs`、`TTS_PROVIDER=local`、填入 `MINIMAX_API_KEY`、`ELEVENLABS_API_KEY`、`NEXT_PUBLIC_DEV_LOGIN_*`。

4. 安裝依賴（`scripts/bootstrap.sh` 是 bash，這裡手動執行等價步驟）：

   ```powershell
   pnpm install
   uv venv --python 3.12 apps\api\.venv
   uv pip install --python apps\api\.venv\Scripts\python.exe -e "apps\api[dev]"
   ```

5. 遷移與種子資料（API 從環境變數讀設定，先把 `.env` 載進目前的 PowerShell）：

   ```powershell
   Get-Content .env | Where-Object { $_ -match '^\s*[^#][^=]*=' } | ForEach-Object {
     $k, $v = $_ -split '=', 2; $v = ($v -split '\s+#')[0].Trim().Trim('"')
     [Environment]::SetEnvironmentVariable($k.Trim(), $v, 'Process')
   }
   Push-Location apps\api
   .\.venv\Scripts\alembic.exe -c app\db\alembic.ini upgrade head
   Pop-Location
   apps\api\.venv\Scripts\python.exe database\seeds\seed.py
   ```

6. 本地 TTS 模型：

   ```powershell
   Push-Location services\local-tts
   uv venv --python 3.12 .venv
   uv pip install --python .venv\Scripts\python.exe -e ".[dev]"
   # 模型下載腳本是 bash：用 Git Bash 執行
   & "C:\Program Files\Git\bin\bash.exe" scripts/fetch_model.sh
   $env:LOCAL_TTS_FFMPEG_BIN = (Get-Command ffmpeg).Source
   .\.venv\Scripts\uvicorn.exe app.main:app --host 127.0.0.1 --port 8795
   Pop-Location
   ```

   `LOCAL_TTS_FFMPEG_BIN` 必須指到 ffmpeg，否則 `/speak?format=mp3` 會失敗（預設值是 Homebrew 路徑）。

7. 啟動 API 與 Web（各開一個 PowerShell，都先執行步驟 5 的 `.env` 載入迴圈）：

   ```powershell
   Push-Location apps\api
   .\.venv\Scripts\uvicorn.exe app.main:app --host 0.0.0.0 --port 8000
   ```

   ```powershell
   pnpm dev
   ```

   `pnpm dev` 的 `predev` 在非 macOS 會直接結束，不會嘗試安裝任何服務。

8. 常駐（可選）：用 [NSSM](https://nssm.cc/) 把 API、local-tts、web 各註冊成 Windows 服務，`Application` 指到對應的 `uvicorn.exe` 或 `pnpm.cmd`，`AppEnvironmentExtra` 放 `.env` 內容；或使用工作排程器在登入時啟動。

### Linux 正式環境部署（systemd + nginx）

完整流程在 [docs/deployment.md](docs/deployment.md)，重點如下。

**拓撲**：Internet → nginx（TLS、WebSocket upgrade、COOP/COEP、限流）→ Next.js :3000 與 FastAPI :8000（皆綁 127.0.0.1）；資料服務建議用受管版本。**正式環境拒絕** `VECTOR_BACKEND=memory`、關閉物件儲存、預設 `JWT_SECRET`、缺少 MiniMax 金鑰、`CORS_ALLOW_ORIGINS` 為空或 `*`。

```bash
# /opt/ai-coach，使用者 ai-coach
corepack enable && corepack install --global pnpm@9.12.0
pnpm install --frozen-lockfile
uv venv --python 3.12 apps/api/.venv
uv pip install --python apps/api/.venv/bin/python -e 'apps/api'
pnpm build

# 每次更新：先 migration 再重啟
cd apps/api && .venv/bin/alembic -c app/db/alembic.ini upgrade head && cd ../..
sudo systemctl restart ai-coach-api ai-coach-worker ai-coach-web
```

環境檔 `/etc/ai-coach/ai-coach.env`（API／worker，權限 0600）與 `/etc/ai-coach/ai-coach-web.env`（web，只含 `NEXT_PUBLIC_*`）：

```env
APP_ENV=production
DATABASE_URL=postgresql+asyncpg://USER:PASSWORD@postgres.example.com:5432/aicoach
REDIS_URL=rediss://:PASSWORD@redis.example.com:6380/0
VECTOR_BACKEND=qdrant
QDRANT_URL=https://qdrant.example.com
QDRANT_API_KEY=...
OBJECT_STORAGE_ENABLED=true
S3_ENDPOINT=https://s3.example.com
S3_ACCESS_KEY=...
S3_SECRET_KEY=...
S3_BUCKET=ai-coach-prod
LLM_PROVIDER=minimax
MINIMAX_API_KEY=...
MINIMAX_MODEL=MiniMax-M3
STT_PROVIDER=elevenlabs
TTS_PROVIDER=local
LOCAL_TTS_URL=http://127.0.0.1:8795
ELEVENLABS_API_KEY=...
JWT_SECRET=至少32字元的隨機值
CORS_ALLOW_ORIGINS=https://app.example.com
```

systemd 範本在 [infra/systemd](infra/systemd)（api、worker、web、avatar、inference）。本地 TTS 沒有附範本，可用下面這個：

```ini
# /etc/systemd/system/ai-coach-local-tts.service
[Unit]
Description=AI Coach local TTS model server (Breeze2-VITS / Kokoro on onnxruntime)
After=network-online.target

[Service]
Type=exec
User=ai-coach
WorkingDirectory=/opt/ai-coach/services/local-tts
Environment=LOCAL_TTS_PORT=8795
Environment=LOCAL_TTS_FFMPEG_BIN=/usr/bin/ffmpeg
Environment=OMP_NUM_THREADS=4
ExecStart=/opt/ai-coach/services/local-tts/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8795 --log-level warning
Restart=always
RestartSec=2
TimeoutStartSec=120
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo cp infra/systemd/*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ai-coach-api ai-coach-worker ai-coach-web ai-coach-local-tts
sudo systemctl status ai-coach-api ai-coach-web
```

nginx 設定在 [infra/nginx/nginx.conf](infra/nginx/nginx.conf)：只開 443、HSTS、`/ws` 與 `/avatar/` 的 WebSocket upgrade 與 3600 秒讀取逾時、`/api/v1/auth/*` 較嚴的限流、`Permissions-Policy: microphone=(self), camera=(self)`（語音與鏡頭需要）、COOP/COEP 跨來源隔離（多執行緒 WASM 需要）。web 的 CSP 由 `apps/web/next.config.mjs` 發出，nginx 不要再加一份。

健康檢查與回復：

```bash
curl -fsS https://app.example.com/api/healthz
curl -fsS https://app.example.com/api/readyz
journalctl -u ai-coach-api -f
```

回復時切回前一個已建置的 git revision，執行相容的 migration，再重啟服務；不得以刪除資料庫或向量資料作為回復手段。

---

## 環境變數參考

設定由根目錄 `.env` 提供給 API、worker、`run-api.sh` 與 Next.js（透過 `next.config.mjs` 的 `loadRootEnv()`）。完整欄位以 `.env.example` 與 `apps/api/app/core/config.py` 為準。

### 核心

| 變數 | 預設 | 說明 |
| --- | --- | --- |
| `APP_ENV` | `local` | `local` / `test` / `staging` / `production`。非 local/test 會啟用 fail-fast 檢查 |
| `DATABASE_URL` | `postgresql+asyncpg://localhost:5432/aicoach` | PostgreSQL asyncpg URL |
| `REDIS_URL` | `redis://localhost:6379/0` | 限流、Celery broker、WebSocket fan-out |
| `VECTOR_BACKEND` | `memory` | `memory` / `qdrant`（正式必須 qdrant） |
| `QDRANT_URL` / `QDRANT_API_KEY` | `http://localhost:6333` / 空 | 向量庫 |
| `OBJECT_STORAGE_ENABLED` | `false` | 開啟後需要下列 S3 設定，`/readyz` 會檢查 bucket |
| `S3_ENDPOINT` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` / `S3_BUCKET` | MinIO 本機預設 | S3 相容儲存 |
| `JWT_SECRET` | `change-me` | 正式環境必須 32 字元以上隨機值 |
| `CORS_ALLOW_ORIGINS` | local 自動允許 loopback 與私網 | 正式環境必須明確列出，不可 `*` |
| `API_PREFIX` | `/api/v1` | |
| `LOG_LEVEL` / `DEBUG_SQL` | `INFO` / `false` | |

### LLM

| 變數 | 預設 | 說明 |
| --- | --- | --- |
| `LLM_PROVIDER` | `openai`（`.env.example` 為 `minimax`） | `openai` / `azure_openai` / `aup` / `minimax` / `none` |
| `MINIMAX_API_KEY` | 空 | 必填 |
| `MINIMAX_BASE_URL` | `https://api.minimax.io/anthropic/v1` | Anthropic 相容端點 |
| `MINIMAX_MODEL` | `MiniMax-M3` | 實測延遲：M3 3.3 s、M2.1 4.6 s、M2.5-highspeed 11.6 s、M2.7-highspeed 35.3 s |
| `OPENAI_API_KEY` / `LLM_MODEL` | 空 / `gpt-4o` | 使用 OpenAI 時 |
| `LLM_TIMEOUT_SECONDS` | `30` | |
| `EMBEDDING_MODEL` / `EMBEDDING_DIMENSION` | 見 config | 兩者必須一起改，改了要重建索引 |

### 語音

| 變數 | 預設 | 說明 |
| --- | --- | --- |
| `STT_PROVIDER` | `elevenlabs` | `mac` / `elevenlabs` / `openai` / `none`。`mac` 僅 macOS，失敗自動退到雲端 |
| `MAC_STT_PORT` | `8790` | mac-stt daemon 連接埠 |
| `MAC_STT_BIN` | `tools/mac-stt/bin/mac-stt` | daemon 不通時的 exec 備援（API 下通常被 TCC 擋，僅供除錯） |
| `TTS_PROVIDER` | `elevenlabs` | `elevenlabs` / `openai` / `local` / `none` |
| `LOCAL_TTS_URL` | `http://127.0.0.1:8795` | 本地 TTS 模型伺服器 |
| `ELEVENLABS_API_KEY` | 空 | 雲端 STT 與 TTS |
| `ELEVENLABS_TTS_MODEL` | `eleven_flash_v2_5` | 首位元組約 0.2 s；`eleven_multilingual_v2` 音質較好但約 1 s |

### 本地 TTS 模型伺服器（`services/local-tts`，前綴 `LOCAL_TTS_`）

| 變數 | 預設 | 說明 |
| --- | --- | --- |
| `LOCAL_TTS_ENGINE` | `breeze` | 預設引擎：`breeze`（台灣口音，單一女聲）或 `kokoro`（100 支聲音、男女可選、口音偏大陸） |
| `LOCAL_TTS_PORT` | `8795` | |
| `LOCAL_TTS_MODEL_DIR` / `LOCAL_TTS_BREEZE_DIR` | `./models` / `./models/breeze2-vits` | 權重位置（gitignored） |
| `LOCAL_TTS_FFMPEG_BIN` | `/opt/homebrew/bin/ffmpeg` | mp3 轉檔；Linux 與 Windows **必須**改 |
| `LOCAL_TTS_THREADS` | `4` | onnxruntime 執行緒 |
| `LOCAL_TTS_KEEP_WARM_S` | `45` | 閒置多久自我合成一次以避免權重被換出；`0` 關閉 |
| `LOCAL_TTS_BREEZE_GAIN` | `5.0` | Breeze 原始音量偏小，固定增益 |
| `LOCAL_TTS_TAIWAN_LEXICON` | `1` | 疊加 61 條台灣讀音修正表 |
| `LOCAL_TTS_DEFAULT_FEMALE_VOICE` / `_MALE_VOICE` | `zf_001` / `zm_010` | Kokoro 預設聲音 |
| `LOCAL_TTS_MAX_TEXT_CHARS` / `LOCAL_TTS_REQUEST_TIMEOUT_S` | `1200` / `60` | |

### Web（編進前端產物，不可放密鑰）

| 變數 | 本機值 | 說明 |
| --- | --- | --- |
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:8000` | |
| `NEXT_PUBLIC_WS_BASE_URL` | `ws://localhost:8000` | |
| `NEXT_PUBLIC_ENABLE_WEBGPU` | `auto` | `auto` / `on` / `off` |
| `NEXT_PUBLIC_DEV_LOGIN_EMAIL` / `NEXT_PUBLIC_DEV_LOGIN_PASSWORD` | 示範帳號 | 載入頁面時對 API 發真的登入請求。目前版本沒有登入頁，身分由這組設定決定；正式部署前請改為正式帳號或補上登入介面 |
| `NEXT_PUBLIC_USE_MOCK` | 未設 | 設 `1` 才會播放無後端的假事件流；預設連不上 API 會直接報錯，不會偷換成腳本 |
| `NEXT_PUBLIC_AVATAR_BASE_URL` / `NEXT_PUBLIC_AVATAR_WS_URL` | `http://127.0.0.1:8765` | 虛擬人 runtime（可選） |

### 其他

`ACCESS_TOKEN_TTL_SECONDS`、`REFRESH_TOKEN_TTL_SECONDS`、`COOKIE_DOMAIN`、`RATE_LIMIT_*`、`ALLOW_LOCAL_MODEL_CACHE`、`ALLOW_SENSITIVE_DATA_CACHE`、`CLEAR_ON_LOGOUT`、`TRANSCRIPT_RETENTION_DAYS`、`OTEL_*`、`S3_REGION`、`S3_SIGNED_URL_TTL_SECONDS`、`INFERENCE_*`、`AVATAR_*` 皆有安全預設，見 `apps/api/app/core/config.py` 與 `.env.example`。

---

## 語音：STT / TTS 與本地備援

### 設計原則

- **瀏覽器永遠不直接接觸語音供應商**。麥克風音訊送到 API，API 才決定用哪個引擎；金鑰只存在 API 行程。瀏覽器內建的 `SpeechRecognition` 在 Chromium 會把音訊送到 Google，本專案不使用。
- **三層備援，任一層失效都不會讓客戶「失聲」或讓學員「講了沒反應」**。每次辨識與合成的回應都帶 `provider`／`X-Tts-Provider`，UI 會把結果（引擎、耗時、失敗原因）寫在輸入框下方，不會靜默。
- **本地優先是隱私與成本立場**，兩個開關存在 `localStorage`，重新載入仍保留。

### 語音辨識（STT）流程

```text
麥克風 ── MediaRecorder（Opus/WebM）──▶ 端點偵測 ──▶ POST /api/v1/sessions/{id}/transcribe
                                       │                        │
        VAD 靜音 ≥ 900 ms 才算一句；     │        ┌───────────────┴───────────────┐
        放開空白鍵／按靜音立刻收句        │        ▼                               ▼
                                       │   Mac 本機：tools/mac-stt daemon       雲端：ElevenLabs Scribe
                                       │   127.0.0.1:8790，Speech.framework     或 OpenAI
                                       │   on-device zh-TW；API 先以 ffmpeg     （本機不可用、拒絕授權、
                                       │   轉 16 kHz mono wav                    或失敗時自動退到這裡）
                                       │                        │
                                       │                        ▼
                                       │   OpenCC s2twp 簡轉繁＋台灣用語 → 剝除 [音樂]/(silence) 等非語音標籤
                                       ▼                        ▼
                                  文字回到前端 → 顯示「已送出 · Mac 本機 510ms」→ 以一般 message.send 送出
```

- 引擎選擇：前端「辨識」pill 循環 **自動 → Mac 本機 → 雲端**；API 端 `STT_PROVIDER=mac` 時預設本機優先。`GET /api/v1/sessions/stt/capabilities` 回報 `mac.available / authorization`，本機不可用時 UI 直接停用該選項並說明原因。
- 客戶語音播放期間麥克風只做插話偵測不錄音（避免把喇叭聲轉成學員訊息）；插話會立刻中止客戶語音。
- 限流：`transcribe` 120 次／分鐘，突發 20。
- macOS 原生辨識實測單句約 0.5 秒；雲端約 1.7 秒。

### 語音合成（TTS）流程

```text
客戶每句回覆 ──▶ POST /api/v1/sessions/{id}/speak?engine=auto|cloud|local ──▶ audio/mpeg
                          │
        ┌─────────────────┼──────────────────────────┐
        ▼                 ▼                          ▼
  local：services/local-tts    cloud：ElevenLabs          瀏覽器 speechSynthesis（系統語音）
  127.0.0.1:8795               eleven_flash_v2_5，        ＝最後備援。macOS 可下載「美佳（進階）」
  Breeze2-VITS（預設）          voice_catalog 依人設        提升品質；Windows 用內建 Microsoft 中文語音
  → Kokoro（備援）              性別／年齡選 Yui / Ian
  服務不在 → 退到 cloud          失敗且 engine=auto → 退到系統語音；兩邊都掛回 502，不回空的 200
```

- 前端「說：本地」開＝優先本地模型（能力探測可用時），否則系統語音；關＝雲端。
- ElevenLabs 參數預設 stability 0.75、style 0（有情緒風格時 0.15）、speaker boost 開、速度限制 0.7–1.2，避免英文母語聲音唸中文「上飄」。「音訊與語音」對話框可微調並試聽。
- 語音選角：人設可指定 `voice_id`；未指定時依 `gender` 與年齡（<35 青年、≥35 中年，長者沿用中年）查表，同一人設永遠同一個聲音。

### 本地 TTS 模型伺服器（`services/local-tts`）

| 引擎 | 權重 | 聲音 | 取樣率 | 特性 |
| --- | --- | --- | --- | --- |
| **`breeze`**（預設） | MediaTek-Research/Breeze2-VITS-onnx，124 MB | 1（女聲，無法選） | 22.05 kHz | 台灣口音、注音 token；VITS 非自迴歸；峰值 RSS 約 266 MB；RTF 約 0.2 |
| `kokoro` | hexgrad/Kokoro-82M-v1.1-zh，380 MB，Apache-2.0 | 100（男女可選） | 24 kHz | 口音偏大陸標準；常駐約 550–615 MB；RTF 約 0.22–0.4 |

兩顆都跑在 CPU `onnxruntime`，不需要 GPU 也不裝 torch。權重 lazy 載入：啟動只載預設引擎，另一顆等第一個指名它的請求才載。預設引擎權重不在時服務不會拒絕啟動，會改用另一顆並在 `/healthz.engine_fallback` 說明。

**安裝**

```bash
# macOS：一鍵（uv venv、下載權重、註冊 launchd com.aicoach.local-tts）
pnpm tts:install
scripts/dev/install-local-tts-service.sh --status | --uninstall

# Linux / Windows(WSL) / 手動
cd services/local-tts
uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -e '.[dev]'
scripts/fetch_model.sh            # 或 fetch_model.sh breeze | kokoro；sha256 鎖定
LOCAL_TTS_FFMPEG_BIN=$(command -v ffmpeg) .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8795
```

**端點**

| 方法 | 路徑 | 說明 |
| --- | --- | --- |
| `GET` | `/healthz` | `status ok/loading/error`、`engine`、`voices[]`、`single_speaker`、`engines{}` 各引擎 `loaded/available/missing/error`、`rtf_last`、`rss_mb`；載入中回 503 |
| `POST` | `/speak` | `{text ≤1200 字, engine?, voice?, gender?, speed? 0.5–2, format? wav\|mp3}` → 音訊；回應標頭 `X-Engine`、`X-Voice`、`X-Voice-Ignored`、`X-Rtf`、`X-Synth-Ms` |

```bash
curl -s 127.0.0.1:8795/speak -H 'content-type: application/json' \
  -d '{"text":"好，那我們先看保障的部分。","format":"mp3"}' -o line.mp3
```

**處理流程**：正規化（去千分位、`NT$`→新台幣）→ 依句末標點斷句、過長再依逗號切 → G2P（Breeze：cn2an 數字轉中文 → 68k 詞典最長比對 → 疊加台灣讀音表；Kokoro：misaki jieba + pypinyin）→ 每段一次 onnxruntime → 0.18 秒段間靜音 → wav 或 ffmpeg mp3。

**已知限制**：Breeze 只有一個女聲，本地模式下男性人設也是女聲（回應以 `X-Voice-Ignored` 明示，UI tooltip 會提示）；中文句子裡的英文單字兩顆引擎都會略過；沒有串流，一句合成完才開始播。詳細量測與決策紀錄在 [docs/HANDOFF.md](docs/HANDOFF.md) §16.15–§16.16。

### macOS 原生語音辨識（`tools/mac-stt`）

Swift 寫的 Speech.framework helper，以 `.app` bundle 形式打包並用 launchd 常駐（TCC 只認 bundle 的 `Info.plist` 與負責的父程式，直接由 API 或終端機 spawn 會被系統中止）。

```bash
pnpm stt:install                                  # 建置（需 Command Line Tools）、註冊 com.aicoach.mac-stt、啟動
scripts/dev/install-mac-stt-service.sh --status   # state / pid / last exit
scripts/dev/install-mac-stt-service.sh --uninstall
scripts/dev/check-voices.sh                       # 列出系統中文語音與品質等級（系統語音 TTS 用）
```

- 首次啟動彈出「語音辨識」授權，允許一次即可；拒絕後 `capabilities.mac.authorization=denied`，UI 會停用本機選項。
- daemon 監聽 `127.0.0.1:8790`，`--locale zh-TW --on-device`，音訊不離開機器。
- 需要 `ffmpeg`（WebM/Opus → wav）。
- 日誌 `/tmp/ai-coach-mac-stt.log`。

### 語音功能驗證清單

1. `curl -s 127.0.0.1:8795/healthz` 回 `status: ok`。
2. `scripts/dev/install-mac-stt-service.sh --status` 顯示 running（macOS）。
3. 語音頁「辨識」pill 可切到「Mac 本機」；「說：本地」tooltip 顯示「本地模型」。
4. 講一句話，輸入框下方出現「已送出 · Mac 本機 NNN ms」，客戶回覆有聲音。
5. 客戶講話時插話，客戶語音立刻停止。

---

## 瀏覽器端情緒辨識

### 流程

```text
鏡頭影格（每 250 ms 取樣一幀，只在瀏覽器）
  └─ MediaPipe Face Landmarker（WASM，GPU delegate；同源載入 /mediapipe/）
       └─ 52 個 ARKit blendshape 分數（0–1）
            └─ 指數平滑（alpha 0.35）
                 └─ 規則引擎：blendshape → 語意特徵 → 8 種情緒分數
                      （neutral / happy / surprised / sad / angry / fearful / disgusted / contempt）
                      └─ 勝出標籤為負向且最高負向分數 ≥ 0.25 才算有效讀數
                           └─ 只在標籤改變或信心明顯變動時，經 session WebSocket 送「標籤＋信心值」
                                ├─ API：與文字語氣做非對稱融合（衝突時文字勝，因為有逐字證據）
                                │      → 客戶在回合開始就拿到臉部讀數，先用一句確認再繼續
                                │      → 教練卡依學員情緒調整提示語氣
                                └─ 前端：自我畫面徽章顯示「偵測到你的情緒：苦惱」
                                       持續 3 秒且 session 進行中 → 輸入框上方出現「這句不好接？」提示卡
                                       （12 秒內只出現一次，15 秒自動收；評測模式只有徽章）
```

### 隱私

- **影像不離開瀏覽器**。沒有任何影片上傳路徑；經 WebSocket 送出的只有情緒標籤與 0–1 的信心值。
- 鏡頭預設關閉，由輸入框旁的相機鈕開啟；模型（3.6 MB）在第一次開鏡頭時才載入。
- 門檻 0.25 在四處保持一致（前端送出下限、提示卡、API 的 `FACE_MIN_CONFIDENCE` 與 `FACE_REACT_MIN_CONFIDENCE`），任一處改動要同步。

### 部署需求

- MediaPipe 的 WASM 與模型必須**同源**提供：`apps/web/next.config.mjs` 的 CSP `connect-src` 只允許自家 API／WS，從 Google CDN 載入會被靜默擋掉（沒有錯誤，鏡頭就是不分類）。資產已放在 `apps/web/public/mediapipe/`（26 MB，含 SIMD 與 non-SIMD 兩版 WASM），若缺少：

  ```bash
  pnpm install && bash scripts/dev/fetch-mediapipe.sh
  ```

- 瀏覽器需允許鏡頭：`localhost` 或 HTTPS。正式環境 nginx 已設 `Permissions-Policy: camera=(self)`。
- 支援 Chrome、Edge、Safari；沒有 WebGPU 的機器會退到 WASM 多執行緒（需要 nginx 的 COOP/COEP 跨來源隔離標頭）。
- 開發時可在 DevTools 用 `await window.__aiCoachAffect.init(); window.__aiCoachAffect.analyze(document.querySelector('video'))` 讀原始分數以調門檻。

### 規則引擎與 Python 對照範例（`emotion_webcam/`）

前端的規則（`apps/web/src/features/simulation/lib/blendshape-expressions.ts`）移植自 `emotion_webcam/expressions.py`：52 條規則分三層（8 種通用情緒、12 種對齊虛擬人的人設表情、32 種臉部動作），權重依 FACS 手調，尚未用標記資料校準，不同人臉可能需要調 `threshold`。

Python 版可獨立驗證與調參（MediaPipe 目前沒有 Python 3.13 的 wheel，請用 3.9–3.12）：

```bash
cd emotion_webcam
python3.12 -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python selftest.py                     # 離線規則測試，不需鏡頭
python webcam_demo.py                  # 開鏡頭即時判讀（q 離開、b blendshape 長條圖、a 動作列表）
python webcam_demo.py --image face.jpg # 單張圖片
```

---

## 多 Agent 對話引擎與 RAG

### 一輪對話

```text
學員訊息 ──▶ 合規預檢 ──▶ 意圖判定 ──▶ 情境導演 ──▶ 知識檢索（need/not_needed/missing）
         ──▶ 客戶 Agent（串流回覆，帶隱藏狀態：信任/興趣/抗拒/耐心；含臉部讀數）
         ──▶ 合規後檢（逐句比對禁用話術，附證據）──▶ 教練 Agent（預設「被問才答」）──▶ 背景評分
```

- **意圖判定**（`agents/intent.py`）：規則式，不呼叫 LLM。無指涉評價句（「這個划算嗎？」「那這樣呢？」「要多少？」）判為 `AMBIGUOUS/INCOMPLETE → CLARIFY`，客戶 prompt 拿到 `candidate_meanings` 與 `suggested_clarifying_question`，反問時會列出可能的意思；同時 orchestrator 在最終回覆後發 `persona.clarify.options` 事件給前端。超綱話題（`OFF_TOPIC_SIGNALS` 或情境 `restricted_topics`）判為 `REDIRECT`，客戶不會說「我無法回答」，而是短短帶過再導回主題。
- **動態難度**：決定性規則引擎依學員連續表現調整異議複雜度；訓練模式可降難度，評測模式禁止自動降難度。
- **客戶開場**：session 首次就緒時，客戶先以情境 `opening_context` 的引句開口（第 0 輪）。
- **評分**：十維度，每個分數附逐字稿證據；模型引用的證據會逐字核對，對不上就捨棄、證據不足強制中性分。人工覆核存 `human_override`，不覆寫 AI 分數。
- **非關鍵環節失敗會降級不中斷**：知識檢索失敗標示 `missing`、教練失敗略過、評分失敗留待下輪。

### RAG

parse（PDF/DOCX/Markdown/TXT，含 OCR）→ chunk（標題、段落、固定 token、語意、表格、FAQ 等七種策略自動選用）→ embed → index（Qdrant，或本機 `memory`）→ retrieve（RRF 混合向量與關鍵字）→ rerank（cross-encoder 或決定性 `LexicalReranker` 備援）。每個 Qdrant 過濾都帶 `tenant_id + workspace_id + knowledge_base_id`；換 embedding 模型會寫到新的 collection，必須重新處理文件（`POST /api/v1/documents/{id}/reprocess`）。

### 主要 API

| 路徑 | 說明 |
| --- | --- |
| `POST /api/v1/auth/login`、`GET /api/v1/auth/me` | HttpOnly cookie 登入 |
| `GET/POST /api/v1/scenarios`、`/personas`、`/knowledge-bases`、`/documents`、`/chunks`、`/questions`、`/assignments` | 內容管理 |
| `POST /api/v1/sessions` → `ws://…/api/v1/sessions/{id}/ws` | 建立 session（釘選情境與人設版本）並連上事件串流 |
| `POST /sessions/{id}/message`、`/hint`、`/pause`、`/resume`、`/end` | 對談控制 |
| `GET /sessions/stt/capabilities`、`POST /sessions/{id}/transcribe`、`POST /sessions/{id}/speak` | 語音 |
| `GET /sessions/{id}/transcript`、`/events?since_seq=`、`/evaluation` | 逐字稿、事件重播、評分 |
| `GET /api/v1/reports/*`、`/security/findings`、`/audit/events` | 報表、合規、稽核 |
| `GET /healthz`、`GET /readyz`、`GET /docs` | 健康檢查與 OpenAPI（production 關閉 `/docs`） |

完整契約見 [docs/api.md](docs/api.md)，事件型別以 `packages/shared/src/events.ts` 為真相來源、Pydantic 鏡射，`scripts/check-contracts.sh` 防漂移。

---

## 資料庫、遷移與示範帳號

```bash
cd apps/api
.venv/bin/alembic -c app/db/alembic.ini upgrade head                       # 套用
.venv/bin/alembic -c app/db/alembic.ini revision --autogenerate -m "..."   # 新版本
.venv/bin/alembic -c app/db/alembic.ini downgrade -1
```

`alembic.ini` 不含連線字串，`env.py` 讀 `DATABASE_URL`。

示範資料（增量寫入，重跑不覆蓋；`--force` 會反序刪除後重建）：

```bash
set -a; . ./.env; set +a
apps/api/.venv/bin/python database/seeds/seed.py            # 或加 --force
```

| 帳號 | 密碼 | 角色 |
| --- | --- | --- |
| `trainee@demo.ai-coach.local` | `demo-only-not-a-secret` | 學員 |
| `coach@demo.ai-coach.local` | 同上 | 教練、審核者 |
| `manager@demo.ai-coach.local` | 同上 | 主管、教練 |
| `admin@demo.ai-coach.local` | 同上 | 系統管理員 |

種子包含五個保險業情境（含三個能力展示情境：模糊提問釐清、超綱話題收斂、續保費率調漲的情緒應對）、對應人設、知識庫與評分準則。目前版本沒有登入頁，前端載入時以 `NEXT_PUBLIC_DEV_LOGIN_*` 對 API 發真的登入請求取得 HttpOnly cookie；右上角可切換身分。

---

## 日常維運

### 啟停

| 平台 | API | 本地 TTS | mac-stt | Web |
| --- | --- | --- | --- | --- |
| macOS | `launchctl kickstart -k gui/$(id -u)/com.aicoach.api`；`scripts/dev/install-api-service.sh --status/--uninstall` | `com.aicoach.local-tts`，同上腳本 `install-local-tts-service.sh` | `com.aicoach.mac-stt`，`install-mac-stt-service.sh` | `pnpm dev` 或 `pnpm build && pnpm --filter @ai-coach/web start` |
| Linux | `systemctl restart ai-coach-api` | `systemctl restart ai-coach-local-tts` | 不適用 | `systemctl restart ai-coach-web` |
| Windows 原生 | uvicorn 前景或 NSSM 服務 | 同左 | 不適用 | `pnpm dev` / NSSM |

### 日誌

| 服務 | macOS | Linux |
| --- | --- | --- |
| API | `/tmp/ai-coach-api.log`、`/tmp/ai-coach-api-exits.log`（每次啟停與退出碼） | `journalctl -u ai-coach-api -f` |
| 本地 TTS | `/tmp/ai-coach-local-tts.log`（structlog JSON，只記字數與時間，不記文字） | `journalctl -u ai-coach-local-tts -f` |
| mac-stt | `/tmp/ai-coach-mac-stt.log` | — |
| Web dev | 終端機輸出 | `journalctl -u ai-coach-web -f` |

API 日誌有強制遮罩：逐字稿、prompt、e-mail、IP、金鑰形狀的字串一律 `[redacted]`。

### 健康檢查

```bash
curl -fsS localhost:8000/healthz                 # 只看行程
curl -s   localhost:8000/readyz | python3 -m json.tool   # Postgres、Redis；qdrant 與 S3 只在啟用時檢查
curl -s   127.0.0.1:8795/healthz | python3 -m json.tool
scripts/bootstrap.sh --check-services
```

### 更新版本

```bash
git pull
pnpm install
uv pip install --python apps/api/.venv/bin/python -e 'apps/api[dev]'
cd apps/api && .venv/bin/alembic -c app/db/alembic.ini upgrade head && cd ../..
pnpm build                                        # 正式環境
launchctl kickstart -k gui/$(id -u)/com.aicoach.api   # macOS；Linux 用 systemctl restart
```

---

## 測試與品質門

```bash
pnpm -r typecheck                    # TypeScript（web + packages）
pnpm -r lint
pnpm --filter @ai-coach/web test     # vitest
cd apps/api && .venv/bin/python -m pytest -q          # 293 個測試，含語音、意圖、合規、評分、租戶隔離
cd apps/api && .venv/bin/ruff check app && .venv/bin/mypy app
cd services/local-tts && .venv/bin/pytest -q          # 引擎、正規化、台灣讀音表
bash scripts/check-contracts.sh      # TS ↔ Pydantic 事件契約
node scripts/audit-contrast.mjs      # 設計 token 對比度（WCAG AA）
```

CI（`.github/workflows/ci.yml`）四個 job：web（typecheck、lint、build）、api（ruff、mypy、alembic、pytest，使用原生 PostgreSQL 與 Redis）、contracts、shell（shellcheck）；`ci` 匯總 job 作為分支保護的必要檢查。

---

## 疑難排解

完整版在 [docs/troubleshooting.md](docs/troubleshooting.md) 與 [docs/HANDOFF.md](docs/HANDOFF.md) §7。最常見的幾個：

| 症狀 | 原因 | 處理 |
| --- | --- | --- |
| `pnpm` 找不到或 corepack 簽章錯誤 | corepack 內建金鑰過期 | `export COREPACK_INTEGRITY_KEYS=0`，或 `npm i -g pnpm@9.12.0` |
| 頁面 500、整頁沒有 CSS | 兩個 `next dev` 同時寫 `.next/` | `pkill -f "next dev"; rm -rf apps/web/.next; pnpm dev` |
| 用區網 IP 開頁面沒有樣式，localhost 正常 | CSP `upgrade-insecure-requests` 只放行 localhost | 已在 dev 模式排除；用 localhost 或走 HTTPS |
| 登入後立刻掉登入、`/auth/me` 401 循環 | 頁面 `localhost`、API 設 `127.0.0.1`，cookie 網域不同 | `.env` 全部統一 `localhost` |
| API 每 8–50 分鐘自己重啟（exit 134/139） | venv 用了 Python 3.14，原生擴充崩潰 | `uv venv --python 3.12 apps/api/.venv` 重建；不要在 3.14 上建 |
| 「聽：本地」灰掉、`capabilities.mac.available=false` | mac-stt 未跑、未授權、或缺 ffmpeg | `install-mac-stt-service.sh --status`；系統設定 → 隱私權 → 語音辨識 允許 mac-stt；`brew install ffmpeg` |
| 講話沒反應、輸入框下顯示 HTTP 429 | 轉寫限流 | 稍候；限流 120/分 |
| 「說：本地」是系統語音不是模型 | local-tts 未跑或 `/healthz` 503（載入中） | `curl 127.0.0.1:8795/healthz`；等 `status: ok`；看 `/tmp/ai-coach-local-tts.log` |
| 本地 TTS 第一句要 3–6 秒 | 權重被換出（記憶體不足） | 保留 `LOCAL_TTS_KEEP_WARM_S=45`；關掉吃記憶體的程式；16 GB 以上機器穩定 0.8–1.7 秒 |
| `/speak?format=mp3` 失敗（Linux/Windows） | `LOCAL_TTS_FFMPEG_BIN` 仍是 Homebrew 路徑 | 設成 `$(command -v ffmpeg)` 或 Windows 的 ffmpeg.exe 路徑 |
| 鏡頭開了但從不分類 | MediaPipe 資產缺少或被 CSP 擋 | `bash scripts/dev/fetch-mediapipe.sh`；確認由 `/mediapipe/` 同源載入 |
| `/readyz` 說 ready 但知識庫檢索沒結果 | `VECTOR_BACKEND=memory` 重啟後資料消失，或換了 embedding 模型寫到新 collection | 正式用 Qdrant；`EMBEDDING_MODEL` 與 `EMBEDDING_DIMENSION` 一起改並 reprocess 文件 |
| WebSocket 403 | Starlette 對沒匹配的 WS 路徑回 403 | 路徑是 `/api/v1/sessions/{id}/ws` |
| 客戶回覆是空字串 | 推理模型的 thinking 吃掉 token 預算 | 已修（`max_tokens` 下限 16384）；換模型用 `MINIMAX_MODEL` |

---

## 安全與隱私

- **金鑰邊界**：MiniMax、ElevenLabs、OpenAI、資料庫、Qdrant、S3 的憑證只在 API／worker 行程；`/integrations` 只接受 `secret_ref`，不接受原始憑證。非 local/test 環境若 `JWT_SECRET` 為預設值、CORS 為空或 `*`、啟用供應商卻缺金鑰，行程拒絕啟動。
- **認證**：HS256 access token 於 `HttpOnly SameSite=Lax` cookie；refresh token 於獨立 `SameSite=Strict` cookie；雙提交 CSRF token 與 session `jti` HMAC 綁定；服務端可用 bearer。
- **RBAC 與租戶隔離**：五種角色權限矩陣單一來源（`app/core/deps.py`）；任何缺少 `tenant_id + workspace_id` 條件的 SELECT/UPDATE/DELETE 在 ORM 層直接拒絕並以 404 回應；Qdrant 過濾強制帶租戶。
- **語音與影像**：麥克風音訊只送自家 API；本機模式（mac-stt、local-tts）音訊與文字都不離開機器；鏡頭影格永遠不離開瀏覽器。
- **日誌與稽核**：structlog 強制遮罩內容與 PII；每個變更寫稽核紀錄，`detail` 只放 id、數量與欄位名稱；nginx access log 不記 query string 與 body。
- **限流**：Redis token bucket（Lua 原子），一般端點 fail-open、憑證端點 fail-closed；nginx 對 `/api/v1/auth/*` 另設 5 次／分鐘。
- **瀏覽器**：CSP `connect-src` 只允許自家來源、`wasm-unsafe-eval` 供 MediaPipe／本地推論、COOP/COEP 跨來源隔離；`Permissions-Policy` 僅允許自家使用麥克風與鏡頭。
- **資料保留**：逐字稿依 `TRANSCRIPT_RETENTION_DAYS` 由 Celery 定期清理；S3 建議開版本控制、Qdrant 定期 snapshot、PostgreSQL 每日備份與 PITR。

---

## 附屬子專案

| 目錄 | 內容 | 執行 |
| --- | --- | --- |
| `backend/` | 隊友的獨立 SkillCoach 後端（FastAPI + SQLite RAG，可接 Ollama `qwen3:8b` 本機模型做終端機對練、文字情緒分析、`/finish` 總評）。與主 API 同樣預設 8000，**不要同時啟動** | `python3 -m venv .venv && source .venv/bin/activate && pip install -r backend/requirements.lock.txt && cd backend && uvicorn app.main:app --port 8000`；文件見 [backend/README.md](backend/README.md)、[backend/docs/API_DEPLOYMENT.md](backend/docs/API_DEPLOYMENT.md)、[backend/docs/RAG_DEPLOYMENT.md](backend/docs/RAG_DEPLOYMENT.md) |
| `emotion_webcam/` | MediaPipe 52 blendshape 表情規則引擎的 Python 實作、離線自我測試與鏡頭示範；是前端情緒辨識規則的來源 | 見 [瀏覽器端情緒辨識](#規則引擎與-python-對照範例emotion_webcam) |
| `arkit52-avatar/` | 3D 頭像的概念驗證 viewer（Three.js、Rocketbox 角色、老化貼圖工具、Mixamo 動作 retarget） | `cd arkit52-avatar && ./serve.sh`，開 <http://localhost:8000>（與 API 埠衝突，擇一） |
| `services/avatar-runtime/`、`services/inference/` | 可選側掛服務：虛擬人 runtime 與私有 embedding/rerank；沒有它們 session 仍完整可用 | `pnpm avatar:dev`、`pnpm inference:dev` |

---

## 文件索引

| 文件 | 內容 |
| --- | --- |
| [README.md](README.md) | 黑客松提交總覽、產品理念、展示影片 |
| [docs/installation.md](docs/installation.md) | 安裝與本機開發 |
| [docs/deployment.md](docs/deployment.md) | Linux 正式環境部署 |
| [docs/configuration.md](docs/configuration.md) | 設定參考 |
| [docs/development.md](docs/development.md) | 日常開發流程、跨語言契約怎麼改、五個新增功能的食譜 |
| [docs/architecture.md](docs/architecture.md) | 系統架構、三條即時通道、多 Agent 迴圈、安全模型 |
| [docs/api.md](docs/api.md) | API 契約 |
| [docs/model.md](docs/model.md) | 模型三層（伺服器／API／瀏覽器）、權重放哪、換 embedding 模型 |
| [docs/dataset.md](docs/dataset.md) | 資料與隱私 |
| [docs/troubleshooting.md](docs/troubleshooting.md) | 症狀 → 原因 → 修法 |
| [docs/HANDOFF.md](docs/HANDOFF.md) | 交付文件：語音（§16）、情緒融合（§18）、每個踩過的坑與量測數據 |
| [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md) | 三個能力展示情境的台詞卡與觸發條件 |
| [docs/PROJECT_STRUCTURE.md](docs/PROJECT_STRUCTURE.md) | 檔案歸屬 |
| [docs/adr/](docs/adr/) | 架構決策紀錄（pnpm workspace、TS 為契約真相、Qdrant、systemd 而非 Docker、虛擬人決策…） |
| [services/local-tts/README.md](services/local-tts/README.md) | 本地 TTS 模型伺服器 |
| [services/inference/README.md](services/inference/README.md) | 私有推論服務 |
| [apps/api/README.md](apps/api/README.md)、[apps/web/README.md](apps/web/README.md) | 各應用的分層規則與慣例 |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 貢獻指南 |

---

## 授權

專案原始碼授權見 [LICENSE](LICENSE)。第三方模型與資產：Kokoro-82M-v1.1-zh、MediaPipe、Microsoft Rocketbox 角色、Breeze2-VITS-onnx。
