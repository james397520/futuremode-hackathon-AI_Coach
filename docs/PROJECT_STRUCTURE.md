# 專案結構與檔案歸屬（Ownership Map）

> 對應規格：`docs/spec/AI_Coach_Spec_v3.md`
> 本文件是**唯一權威的「東西該放哪」定義**。新增檔案前先查此表。
> 多人 / 多 agent 平行開發時，**只能修改自己 Owner 欄位的子樹**。

## 1. 頂層佈局

比照成熟開源專案（一次 `git clone` 拿到全部：文件、版本、原生服務設定、前後端），
不拆成多個 repo。

```text
futuremode_rmrf2/
├── README.md                 專案首頁（中文，3–5 分鐘看懂：是什麼／能做什麼／怎麼跑）
├── CONTRIBUTING.md
├── .env.example
│
├── apps/
│   ├── web/                  Next.js App Router 前端（唯一 user-facing app）
│   └── api/                  Python FastAPI AI Orchestration API
│
├── services/                 loopback-only 的獨立執行期服務（各自 venv，不進 pnpm workspace）
│   ├── inference/            私有 AI 推論服務（embedding / reranker，§72 AMD AUP）
│   └── avatar-runtime/       本地虛擬人物 Runtime（LivePortrait 表情 + MuseTalk 嘴型）
│
├── packages/                 前後端共用的 JS/TS 套件（pnpm workspace）
│   ├── shared/                前後端共用契約：Entity / Streaming Event / Enum
│   ├── design-tokens/         Soft Aurora 設計 token（CSS vars + Tailwind preset）
│   ├── ui/                    Glassmorphism 元件庫（Radix primitives + 自訂 skin）
│   └── ai-runtime/            WebGPU → WASM → Server 三級推論 abstraction
│
├── database/
│   ├── migrations/           Alembic migrations（由 apps/api/app/db/alembic.ini 指到這裡）
│   ├── seeds/                 種子資料（seed.py，§59 demo persona/scenario）
│   └── schema/
│
├── data/
│   └── sample/                隨 repo 附的少量公開範例資料；企業真實語料絕不進版控
│
├── models/                    模型權重「不」放這裡；只放 manifest + README 說明怎麼下載
│
├── docs/                      規格、架構、部署、API、ADR、圖片
├── scripts/                   bootstrap / seed / reset / check-contracts 等操作腳本
├── infra/
│   ├── systemd/               API、worker、web、avatar、inference 的 Linux service 範本
│   ├── nginx/                 邊界代理設定（TLS、WebSocket upgrade、COOP/COEP）
│   └── kubernetes/            之後要上 K8s 時放 Helm chart（目前空）
│
├── tests/
│   ├── integration/
│   └── e2e/
├── examples/                  API 呼叫範例（curl / python / javascript）
└── .github/                   CI、Issue/PR 範本
```

理由（對應 spec §63/§64/§101）：前端 Next.js、AI API 用 Python FastAPI，
兩者語言不同 → 用 **pnpm workspace 管 JS 側，`apps/api` 自帶 pyproject**，
不強行把 Python 塞進 JS workspace。跨語言契約放 `packages/shared`
（TS 為主，Python 端在 `apps/api/app/domain/` 用 Pydantic 對映同名欄位）。

## 2. `apps/web` — 前端

```text
apps/web/src/
├── app/                              App Router。**只放路由與 layout，不放業務邏輯**
│   ├── layout.tsx                    ThemeProvider / RuntimeProvider / AuthProvider
│   ├── globals.css                   import design-tokens + Aurora 背景
│   ├── (auth)/login/                 §58-1
│   ├── (auth)/workspace-select/      §58-2
│   └── (app)/                        套 AppShell（icon rail + workspace）
│       ├── dashboard/
│       ├── simulations/              library / [id]/setup / [id]/live / [id]/voice
│       │   └── [sessionId]/review/   Session Review & Replay
│       ├── personas/                 list / new / [id] / [id]/test-lab
│       ├── scenarios/                list / [id]/builder（9-step wizard）
│       ├── knowledge/                list / [kbId] / [kbId]/documents/[docId]
│       │   ├── [kbId]/chunks/        Chunk Viewer
│       │   ├── [kbId]/playground/    Retrieval Playground
│       │   └── [kbId]/mining/        Knowledge Mining Review
│       ├── questions/                bank / [id]/edit / generate
│       ├── training/                 assignments
│       ├── performance/              individual / [userId]
│       ├── reports/                  team / skill / compliance
│       ├── team/
│       ├── security/                 findings / audit-log
│       ├── integrations/
│       └── settings/                 models / runtime / voice / appearance / profile / billing
├── features/                         **業務邏輯都在這裡**，一個 feature 一個資料夾
│   ├── simulation/                   Live Simulation（§14–§24, §91）最重要
│   │   ├── components/               SessionHeader / ConversationPanel / PersonaColumn…
│   │   ├── hooks/                    useSessionSocket / useVoiceSession / usePersonaState
│   │   ├── store/                    Zustand session store（§48.4）
│   │   └── mock/                     無後端時的假事件流（Demo 用）
│   ├── knowledge/  questions/  personas/  scenarios/
│   ├── reports/    team/       security/  settings/
├── components/                       跨 feature 的 app 級元件（非通用 UI）
│   ├── app-shell/                    AppShell / IconRail / PageHeader
│   ├── command-palette/              §79
│   ├── notifications/                §81
│   └── theme/                        ThemeProvider（light/dark/system, §6）
├── lib/                              api client / ws client / query client / utils
└── styles/                           aurora background、dot matrix pattern（§1–§2）
```

規則：
- 通用視覺元件（Button/Card/Pill/Slider…）→ `packages/ui`，**不要**放 `apps/web`。
- 顏色只能用 `packages/design-tokens` 的 CSS 變數，禁止 hardcode hex（§99）。
- Server state 用 TanStack Query，client/session state 用 Zustand（§48.4/§48.5）。

## 3. `apps/api` — FastAPI

```text
apps/api/app/
├── main.py                  app factory、middleware、router 掛載
├── core/                    config / security / logging / deps / errors
├── api/v1/routers/          一個 spec §56 端點一個檔
│                            auth, workspaces, users, teams, knowledge_bases,
│                            documents, chunks, retrieval, questions, personas,
│                            scenarios, assignments, sessions, reports,
│                            security, audit, integrations, runtime
├── domain/                  Pydantic entity / enum / streaming event（對映 shared）
├── db/                      SQLAlchemy models、session、alembic migrations
├── services/                應用服務層（§63）：session / persona / knowledge /
│                            question / evaluation / safety / report
├── agents/                  Multi-Agent（§19, §66）
│                            orchestrator, scenario_director, customer, coach,
│                            knowledge, evaluator, compliance
├── rag/                     parser / ocr / chunker / embedder / vectorstore /
│                            reranker / pipeline（§65）
├── ws/                      WebSocket gateway + event emitter（§55, §68）
└── workers/                 async 文件處理 job（parse→chunk→embed→index）
```

規則：
- router **只做 I/O 轉換**，商業邏輯進 `services/`，LLM 行為進 `agents/`。
- 所有 agent 必須回傳 structured data（§66），schema 定義在 `domain/`。
- OpenAI / ElevenLabs key 只存在 API 端（§56/§70/§71），前端永不接觸。

## 4. `packages/*`

| package | 內容 | 不該放什麼 |
|---|---|---|
| `shared` | Entity 型別、`StreamingEvent` union、狀態機 enum | React、任何 runtime 依賴 |
| `design-tokens` | light/dark CSS vars、Tailwind preset、aurora/dot-matrix | 元件 |
| `ui` | Glass 元件庫（Radix + Tailwind） | 業務語意（Persona/Scenario…） |
| `ai-runtime` | capability detection、Worker、WebGPU/WASM/Server backend | UI |

## 5. `services/*` — 獨立執行期服務

兩個服務都**只綁 loopback**，各自有獨立 venv，不屬於 pnpm workspace。
它們是「側掛」的：任一個掛掉都不得中止訓練 session。

```text
services/
├── inference/                私有 embedding / rerank；apps/api 是唯一 client
│   └── app/{core,models,inference,preprocessing,postprocessing,api}/
└── avatar-runtime/           本地 Digital Human（見 docs/spec 的 LivePortrait+MuseTalk 規格）
    ├── app/expression/       Persona State → 表情（preset / hysteresis / 內插 / state bank）
    ├── app/liveportrait/     表情、頭部、眼睛（engine port，lazy import）
    ├── app/musetalk/         語音嘴型（engine port，lazy import）
    ├── app/compositor/       只取 MuseTalk 的 mouth ROI，soft mask 融回 LivePortrait 臉
    ├── app/backends/         mac_mlx / rtx_cuda / static_portrait
    ├── app/stream/           Phase 1 WebSocket frames、Phase 2 WebRTC
    └── avatars/              人物資產；沒有 license/consent.json 一律拒絕載入
```

規則：
- **重相依一律 lazy import**。沒裝 MLX / CUDA / TensorRT 時，服務仍要能啟動並提供
  static portrait fallback —— 這是 avatar 規格 §53 的硬性要求。
- Avatar 的表情由自研 Expression Controller 決定，**不讓 LLM 直接改模型參數**。
- 瀏覽器不知道底層是 MLX 還是 CUDA；只有 admin 看得到 runtime 細節。

---

## 6. 平行開發的檔案歸屬（避免衝突）

| Owner | 可寫路徑 |
|---|---|
| 契約層（先完成，其他人只讀） | `packages/shared/**`, `packages/design-tokens/**`, `docs/**` |
| UI Kit | `packages/ui/**` |
| Web Shell & Pages | `apps/web/**` 除 `src/features/simulation/**` |
| Live Simulation | `apps/web/src/features/simulation/**` |
| API Platform | `apps/api/app/{main.py,core,api,db,domain}/**`, `apps/api/pyproject.toml` |
| Agents & RAG | `apps/api/app/{agents,rag,services,ws,workers}/**`, `apps/api/tests/**` |
| AI Runtime | `packages/ai-runtime/**` |
| Inference Service | `services/inference/**` |
| Avatar Runtime | `services/avatar-runtime/**` |
| Web Avatar Client | `apps/web/src/features/avatar/**` |
| Infra & CI | `infra/**`, `.github/**`, `scripts/**`, 根目錄 dotfiles |
