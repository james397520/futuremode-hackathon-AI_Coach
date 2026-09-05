# 交付文件 — 給接手的下一個對話

> 最後更新：2026-09-05。這份文件的目的是讓一個**沒有任何前文**的對話能在 10 分鐘內接手繼續改。
> 先讀這份，再讀 `docs/PROJECT_STRUCTURE.md`，最後才碰程式碼。

---

## 0. 一句話現況

AI Coach 是一個「AI 模擬客戶 + 即時虛擬人物 + 評測」的企業訓練平台。目前**整條鏈路是真的在跑**：
瀏覽器登入真後端 → 建立 session → 訊息送到 MiniMax → 客戶 persona 用中文回覆 → 右側虛擬人物依 persona state 換表情、依語音包絡動嘴。
剩下的工作是**視覺打磨、嘴型換成 Wav2Lip、接 TTS**，以及一批已知小 bug（見 §6）。

---

## 1. 怎麼把整套跑起來（本機）

前置：macOS、Node 22、Python 3.14、Postgres 與 Redis 已在跑（Homebrew services）。

```bash
# 1) pnpm — corepack 內建簽章金鑰過期，必須加這個環境變數，否則 pnpm 指令直接失敗
export COREPACK_INTEGRITY_KEYS=0
corepack pnpm install

# 2) 資料庫（已 migrate 過就跳過 alembic）
cd apps/api && .venv/bin/alembic -c app/db/alembic.ini upgrade head && cd ../..
set -a; . ./.env; set +a
apps/api/.venv/bin/python database/seeds/seed.py --force
#   demo 帳號：trainee@demo.ai-coach.local / demo-only-not-a-secret（另有 coach/manager/admin@...）

# 3) API（:8000）
( cd apps/api && set -a && . ../../.env && set +a && \
  nohup .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 > /tmp/api.log 2>&1 & )

# 4) Avatar runtime（:8765，loopback only）
( cd services/avatar-runtime && AVATARS_DIR=./avatars \
  nohup .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8765 > /tmp/avatar.log 2>&1 & )

# 5) Web（:3000）— 環境變數必須用 localhost，不能用 127.0.0.1（見 §7 陷阱 2）
( cd apps/web && \
  NEXT_PUBLIC_API_BASE_URL=http://localhost:8000 \
  NEXT_PUBLIC_WS_BASE_URL=ws://localhost:8000 \
  NEXT_PUBLIC_AVATAR_BASE_URL=http://localhost:8765 \
  NEXT_PUBLIC_AVATAR_WS_URL=ws://localhost:8765 \
  NEXT_PUBLIC_DEV_LOGIN_EMAIL=trainee@demo.ai-coach.local \
  NEXT_PUBLIC_DEV_LOGIN_PASSWORD=demo-only-not-a-secret \
  nohup ./node_modules/.bin/next dev > /tmp/web.log 2>&1 & )
```

**只能有一個 `next dev`。** 兩個 process 同時寫 `.next/` 會弄壞 `routes-manifest.json`，症狀是 500 + 整頁無 CSS。若發生：`pkill -f "next dev"; rm -rf apps/web/.next`，重啟一份。

`NEXT_PUBLIC_DEV_LOGIN_*` 是本機開發用的自動登入（`apps/web/src/lib/auth-context.tsx`）；沒設就會退回 fixture 假資料，**對話會變成預錄劇本** —— 這正是前一輪被使用者抓到的問題。

驗證整套活著：
```bash
curl -s localhost:8000/readyz | head -c 200          # postgres/redis ok
curl -s localhost:8765/health                        # status ready, musetalk installed_but_unusable
node scripts/audit-contrast.mjs                      # token 對比度矩陣
bash scripts/check-contracts.sh                      # TS/Python 事件契約同步（26 個）
```

---

## 2. 目錄與歸屬（詳見 `docs/PROJECT_STRUCTURE.md`）

| 路徑 | 是什麼 |
|---|---|
| `apps/web` | Next.js 15 前端。`features/simulation` 是最重要的頁；`features/avatar` 是虛擬人物客戶端 |
| `apps/api` | FastAPI。`app/agents/` 多 agent、`app/rag/`、`app/services/`、`app/ws/gateway.py` |
| `services/avatar-runtime` | 虛擬人物 runtime（表情控制、嘴型、合成、串流）。`BENCHMARK.md` 有實測數據 |
| `services/inference` | 私有 embedding/rerank 服務。可啟動但未佈署模型（`/readyz` 回 degraded 是正常的） |
| `packages/shared` | 跨語言契約（TS 為真相來源，Pydantic 鏡射，`scripts/check-contracts.sh` 防漂移） |
| `packages/design-tokens` | `tokens.css`（顏色/圓角/陰影）、`aurora.css`（背景 + `.liquid-glass`） |
| `packages/ui` | Glass UI kit。**注意：元件用 Tailwind class 上色，不是 aurora.css 的 `.glass-card`**（見 §7 陷阱 6） |
| `database/seeds/seed.py` | demo 資料。有 `_orm_extra` 慣例：ORM 需要但契約沒有的欄位放這裡，不進驗證 |
| `docs/spec/` | 兩份權威規格：平台規格 v3、LivePortrait+MuseTalk 虛擬人物規格 |
| `scripts/` | `bootstrap.sh`、`check-contracts.sh`、`audit-contrast.mjs`、`browser/contrast-audit.js` |

---

## 3. 已驗證可運作的（附證據）

- **真對話**：MiniMax `MiniMax-M2.7-highspeed`，Anthropic 相容端點。實測回覆：「最擔心？直接說重點吧，你們業務不都先套話再推產品嗎？」— 符合 persona。
- **登入 / RBAC / 租戶**：瀏覽器有 `aicoach_csrf` cookie，`/auth/me` 回種子使用者與 workspace；`/assignments`、`/sessions` 回真資料，session 有 scenario/persona 版本釘選。
- **虛擬人物**：static portrait backend 在 M3/8GB 實測 **20.00 fps、2402 幀零掉幀、22 MB RSS、幀預算用 21%**（`services/avatar-runtime/BENCHMARK.md`）。瀏覽器 canvas 實際接收並繪製影格（像素會變）。嘴巴由音訊 RMS 包絡驅動，有牙齒亮帶與下顎下移。
- **五官校準**：`scripts/calibrate_avatar.py` 用 YuNet（OpenCV 5，Apache-2.0）量出眼/嘴位置寫入 `avatar.json → geometry`。換照片後必跑。
- **測試**：`apps/api` 242 passed、`services/inference` 56、`services/avatar-runtime` 29；`pnpm -r typecheck` 5/5；`next build` 40+ 路由。

---

## 4. 硬體結論（決定了很多設計）

這台是 **Apple M3 base、10 GPU 核、8 GB**。

| 引擎 | 實測 | 結論 |
|---|---|---|
| MuseTalk 1.5 q4（MLX） | 載入 2.8s、GPU peak 3.4GB、**UNet 62.6 秒/幀** | 慢 1250 倍，此機不可行。上游 34 faces/s 是 M-Max/Ultra 的數字 |
| **Wav2Lip GAN（ONNX）** | **CoreML batch 8：9.3 ms/幀；CPU 27.6 ms** | **可行**，20fps 預算只用 19%。模型 138MB 在 `services/avatar-runtime/models/` |
| Static portrait | 10.65 ms/幀 | 永遠可用的保底（規格 §53） |

`app/musetalk/mlx_backend.py` 與 `wav2lip_backend.py` 都有 `probe()` —— **靠量測決定是否啟用**，不靠規格表。`/health` 回 `installed_but_unusable` 而非 `unavailable`，理由附在 `/capabilities.musetalk_probe`。

---

## 5. 視覺方向（刻意偏離規格的部分，不是誤改）

產品負責人在對話中明確要求，已 commit 並在 commit message 註明：
- 圓角 **4–8px**（規格 §9 說 30/24/22、§99 禁 8px）
- chip / 按鈕**無邊框**（23 處），結構分隔線保留
- primary 按鈕**單色**不漸層
- 淺色畫布 `#d9e3f3`（比規格深）、玻璃 alpha 卡片 0.30 / 外框 0.16、blur 32–36px
- `--text-tertiary` 淺色改 `#5a6272` 以保 4.5:1
- `--text-on-media` 新 token：疊在照片上的文字兩主題都亮色（原本用 `--bg-canvas-soft` 在深色會變黑字）
- 深淺色切換**只在設定頁**，已移出側欄
- `.liquid-glass`：rim 高光 + 色散 hairline + 頂部 sheen（`aurora.css`），**尚未做邊緣折射**

---

## 6. 未完成 / 已知問題（接手優先順序）

1. **[進行中，4 個 agent 平行]** 全站 UI 審核：陰影、透明度、對比。結果與 commit 見本檔 §9（待補）。
2. **AbortError `signal is aborted without reason`**（`features/avatar/avatar-client.ts:209` ← `use-avatar-session.ts:275` cleanup）。cleanup 的 abort 是刻意的，但某個 promise 未被接住。靜態分析：`request()` 有 try/catch、`createImageBitmap` 有 `.catch`；最可疑是 `client.pushState(...).then(...)` 沒 `.catch`，以及 abort 沒帶 reason。已指派 agent 修。
3. **Wav2Lip 尚未接進渲染迴圈**：`wav2lip_backend.py` 可 load/generate/probe，但 `orchestrator.py` 的 `_build_backend()` 仍只回 `StaticPortraitBackend`。要做：以 Wav2Lip 產生 96×96 嘴部 → `compositor/mouth_blend.py` 羽化貼回 → 保留 static 為 fallback。
4. **沒有 TTS**（`TTS_PROVIDER=none`）：嘴巴目前靠 `POST /sessions/{id}/speak` 用文字長度合成音節包絡，**不是真 lip sync**，程式碼有註明。接 TTS 後走 `/audio`。
5. **未知 session id 整頁空白**：`hasBackend=true` 時打 API 404 → 前端無錯誤狀態。應顯示「找不到 session」。
6. **邊緣折射未做**（需 SVG `feDisplacementMap` + `backdrop-filter: url()`，Chrome 可、Safari 不可，建議限邊緣 12–16px）。
7. FastAPI `ORJSONResponse` deprecation warnings（`app/core/errors.py`），無功能影響。
8. 使用者原檔 `ChatGPT Image 2026年9月5日 07_51_02.png` 留在 repo 根目錄未追蹤（已複製到 `avatars/customer_001/source/portrait.png`），可刪。
9. **人物舞台頂部文字對比不足（實測）**：`--text-on-media`（#f8faff）疊在真實肖像頂部 0–22% 區域，用像素實測 ratio 只有 **1.8–3.4**（eyebrow 行 2.24、姓名行 3.43、副標 2.89），因為照片頂部是淺灰藍背景；底部 chips 疊在深色襯衫上是 12:1 沒問題。**修法不是改字色**（token 刻意兩主題都亮，深色肖像才對），而是在 `features/simulation/components/persona-stage.tsx` 的文字區塊後方加一層 scrim：
   ```css
   background: linear-gradient(180deg, rgba(9,20,44,.55) 0%, rgba(9,20,44,.30) 18%, transparent 34%);
   ```
   0.55 alpha 的 #09142c 疊在 lum 0.48 的背景上會把底色壓到約 lum 0.19，白字 ratio 約 5.2。加完用 `scripts/browser/contrast-audit.js` 在 live 頁驗證。若 UI 審核 agent 已加，只需驗證數值。

---

## 7. 踩過的陷阱（每個都花了真實時間，別再踩）

1. **瀏覽器窗格 `visibilityState === 'hidden'`**：rAF 不觸發、CSS 動畫停在第 0 幀（`fill-mode: both` 會讓卡片看似位移 12px）、canvas 像死掉。量測前先截圖強制渲染。已寫入記憶。
2. **`localhost` vs `127.0.0.1` 是不同 cookie 網域**。頁面在 localhost:3000、API 設 127.0.0.1:8000 → 登入 cookie 存了但讀不到。全部統一 localhost。
3. **CSP `upgrade-insecure-requests` 在開發模式**：Chrome 放行 localhost 但不放行區網 IP → 所有 CSS/JS 被升級成 https 失敗 → 整頁純文字。已在 `next.config.mjs` 用 `isDev` 排除。
4. **FastAPI 0.141 延遲掛載**：`len(app.routes)` 只有 5 是假象（`_IncludedRouter`），看 `app.openapi()['paths']`（實際 75 條）。
5. **passlib 1.7.4 與 bcrypt 5 不相容**：`dummy_verify()` 直接爆，未知帳號登入必 500。已 pin `bcrypt<5`。
6. **`aurora.css` 的 `.glass-card` 幾乎是死碼**：UI kit 用 Tailwind `bg-glass-card backdrop-blur-card`。改樣式表沒用，要改 `packages/ui` 元件或掛 `.liquid-glass` class。
7. **全域 `rate_limit` 依賴掛到 WebSocket 路由**：WS 沒有 `Request` → 每條 WS 必 500。已改 `HTTPConnection`。
8. **WS 路徑**是 `/api/v1/sessions/{id}/ws`（不是 `/ws/sessions/{id}`）；Starlette 對沒匹配的 WS 回 **403 不是 404**，會誤導成權限問題。
9. **`--force` seed 刪除順序**要反序（先刪子再刪父），否則第一個 FK 就死。
10. **Router 與 Service 命名不一致**是系統性的（不同 agent 寫的兩半）：`create` vs `create_session`、缺 `list_assignments` 等。已用 adapter 綁定，`session_service.py` / `scenario_service.py` 尾端有整區說明。

---

## 8. 規格與文件索引

- `docs/spec/AI_Coach_Spec_v3.md` — 平台總規格（5425 行）
- `docs/spec/LivePortrait_MuseTalk_Spec_v1.md` — 虛擬人物規格
- `docs/PROJECT_STRUCTURE.md` — 檔案歸屬（多 agent 平行改時必看）
- `docs/architecture.md`、`docs/development.md`、`docs/troubleshooting.md`、`docs/roadmap.md`
- `docs/adr/` — 0001–0010；0009 是 Docker→systemd、0010 是虛擬人物決策
- `services/avatar-runtime/BENCHMARK.md` — 效能凍結數據

---

## 9. 本次 UI 全站審核結果

四個 agent 分區平行（token+UI kit / simulation+avatar / app shell / 其餘 features）。方法一致：alpha 表面先合成到畫布再算 WCAG。

### 9.1 App shell（`apps/web/src/{components,app,styles}`）— 完成，15 檔
- **深色模式全數通過；所有失敗都在淺色**，且全是 accent/state token 被當文字或圖示用（它們是為填色調的）。
- 修法模式：`color-mix(accent N%, var(--text-primary))`，N 取在 shell 與 card 玻璃上都過 4.5 的最大值；新增 `globals.css` 的 `.ink-indigo/-blue/-danger/-warning/-success/-info`（80/54/62/44/46/52%）。
- 代表性修正：側欄 active 項目由漸層+陰影改為 12% indigo 平鋪；「登出」danger 2.65→4.92；document-pipeline 的 success 勾 1.74→4.92；runtime badge 白字疊漸層 2.0→改 accent tone；error 頁警告圖示 1.66→4.32；通知面板、transcript 內多層 `glass-strong` 疊 `glass-strong` 全改 `glass-card`；scrollbar 硬編 rgba 改 token；`layout.tsx` 的 `themeColor` 同步為 `#d9e3f3`（**畫布再改就要再同步**）。
- **跨區標記（交給對應 owner）**：`packages/ui` Pill tint 82% 混色淺色僅 2.3–3.6 → 需 46/44/52/62；`Button primary` 白字在深色 3.33 不過；`gradient-pill` 白字約 2:1；Drawer/CommandPalette/Modal/Tooltip 的 overlay 用 `glass-card-strong` 可降為 card 玻璃+blur+floating shadow；`features/**` 有 25+ 處 `glass-strong` 列與 `shadow-soft` active tab 同樣的巢狀不透明模式。

### 9.2 Token + UI kit — 進行中
### 9.3 Simulation + Avatar — 進行中（含 AbortError 修復）
### 9.4 其餘 features（auth/dashboard/knowledge/personas/questions/reports/scenarios/security/settings/simulations/team/training）— 完成，29 檔
- 同樣模式：深色 ≥4.7 全過；淺色失敗全是 accent/state token 當文字或狀態圖示。修成 `color-mix(token p%, var(--text-primary))`：indigo 70%（3.39→4.96）、success 40%（1.57→5.07）、warning 40%（1.43→4.89）、danger 55%（2.39→5.01）、blue 45%（1.99→5.18）。
- 透明/陰影：`tone="strong"` 卡片與 `bg-glass-strong` 列（約 25+ 處）降為 card 玻璃；list row 的 `hover:shadow-soft`、settings 側欄與 chunk viewer 的 `bg-glass-strong shadow-soft` active 態改為平鋪 tint / 1px inset ring；`tone="floating"` 卡片巢狀在卡片內移除。保留：retrieval-settings 卡（slider/switch 表單）維持 strong；`aria-hidden` 裝飾圖示維持 accent。
- **交給 kit/token owner**：`pill.tsx tint()` 82% → 建議 45%（warning 用 40% 或把 `--warning #f1b44a` 調深，它是最弱 token）；`gradient-pill` warning/danger 原色文字 1.6/2.7；`empty-state` 根為 glass-strong；`stat-tile surface="card"` 疊 shadow-soft+border；`tabs` inset list glass-strong；`button primary disabled:opacity-50` 白字疊 50% indigo ≈2.4。

### 9.5 背景純黑 + 預設深色（產品負責人要求，覆蓋規格 §5/§99）— 已套用
- 「不要管深色淺色模式了，背景改成純黑」→ 直接把 app 預設鎖成深色，畫布純黑。
- `theme-script.ts` / `theme-provider.tsx`：未儲存偏好時 fallback 由 `system` 改 `dark`（catch 亦改 dark）。淺色仍在 Settings 可切。
- `tokens.css` `[data-theme='dark']`：`--bg-canvas #000000`、`--bg-canvas-soft #060606`；玻璃改中性白透明（純黑上藍玻璃會變藍板）：shell 0.05 / card 0.07 / strong 0.12 white-alpha。
- `aurora.css` 深色基底：底色改 `#000000`，四角色斑保留但降到 0.08–0.12。
- `layout.tsx` themeColor 深色 → `#000000`。
- 驗證：`node scripts/audit-contrast.mjs` 深色全 AA（primary 19.24、tertiary 5.13–6.51、tone chip 6–8.5）；唯一 FAIL 是 `text-on-media` 疊淺色人像中間調（1.84）＝既有 media scrim 項（§6-9），與畫布無關。`tsc --noEmit` exit 0；瀏覽器 dashboard/login 深色渲染乾淨。

### 9.6 順手修掉 audit agent 留下的 build 破壞
- `packages/ui/field.tsx:83`：JSX 三元分支裡放 `{/* */}` 註解會炸 build → 改成 `//` 行註解。
- `simulation-styles.tsx:95,101`：CSS 字串（template literal）註解裡有反引號 `` `--text-primary` `` / `` `bg-black/5` `` 提前關閉樣板字串 → 去掉反引號。
- （token agent 已把 `-ink` 可讀變體寫入 `tokens.css` 光/暗兩區 + tailwind preset，`text-state-*-ink` 可解析。）

---

## 10. 給接手者的一句建議

先跑 §1 把整套起來、在瀏覽器實際點一次 live simulation，**看到陳先生真的回話、右側人物真的在動**，再開始改。這個專案很多問題都是「靜態看起來對、實際跑起來不對」，量測勝過推理。

## 10. 「對話是假的」根因與修復（重要）

使用者質疑一段對話不真實：他打「測試」「幹」，客戶卻照著固定異議劇本走。**確認是 mock**——台詞逐字存在於 `apps/web/src/features/simulation/mock/mock-event-stream.ts`（155 / 105 / 213 / 273 / 314 行）。

### 10.1 根因：同一個概念寫了三份，預設值不一致
| 檔案 | 定義 | 預設 |
|---|---|---|
| `lib/api-client.ts` | `API_BASE_URL` | `?? 'http://localhost:8000'`（**有** fallback） |
| `lib/ws-client.ts` | `WS_BASE_URL` | `?? 'ws://localhost:8000'`（**有**） |
| `features/simulation/lib/env.ts` | 自己再讀一次 | `''`，且 `hasBackend = len>0` → **判定沒有後端** |

`NEXT_PUBLIC_API_BASE_URL` 只寫在 monorepo 根 `.env`，而 **Next.js 只讀 `apps/web/` 底下的 env 檔**，所以前端拿到 undefined：REST 靠自己的 fallback 打到真 API（401/404 都是真的），對話卻因為 `hasBackend=false` 靜默改放腳本。兩邊對「後端在哪」答案不同 = 假對話看起來像真的。

### 10.2 修法：一份 env 檔 + 一個 env 模組（不分家）
- `next.config.mjs` 新增 `loadRootEnv()`：直接讀 monorepo 根 `.env`（真環境變數優先，處理行內註解與引號）。**不新增 `apps/web/.env.local`**，避免第二份會漂移的設定。
- 新增 `apps/web/src/lib/runtime-env.ts` 為唯一真相：`API_BASE_URL` / `WS_BASE_URL` / `AVATAR_BASE_URL` / `AVATAR_WS_BASE_URL` / `hasBackend` / `shouldUseMockStream`。
- `api-client.ts`、`ws-client.ts`、`features/simulation/lib/env.ts`、`features/avatar/lib/env.ts` 全改為引用它（avatar 只保留自己的 `AVATAR_ID`/fps/timeout 等專屬常數）。
- **mock 改為明確 opt-in**：`NEXT_PUBLIC_USE_MOCK=1` 才播腳本。後端連不上時要報錯，不准再自己編一段對話——這才是當初讓假對話難以察覺的原因。

### 10.3 第二個 bug：真的接上了也會「講不出話」
`MiniMaxClient._body` 原本是 `max_tokens or 16384` —— 只有**沒給值**時才用 16384。但 M2.7 是推理模型，`thinking` 區塊與答案共用同一份預算，而 `_text_from_content` 會把 thinking 丟掉。實測一句兩句話的 persona 回覆要花 **497–767 tokens**，而 `CustomerAgent.default_max_tokens = 500` → 回**空字串**。
改成下限：`max(max_tokens or 0, 16384)`。cap 只是上限，模型仍自行 `end_turn`，不會多花錢。

### 10.4 驗證（實打 MiniMax）
provider `minimax` / model `MiniMax-M2.7-highspeed`：
- 問「養貓還是養狗」→「我養了一隻狗。」（腳本不可能答出離題問題）
- 打「幹」→「我已經有一張壽險，想再加保可是保費負擔有點重…」（回到角色）
- 用 CustomerAgent 原本的 500 預算 →「我家有隻貓，已經養了好幾年了。」（745 tokens、`end_turn`；修改前為空）
`pytest` 242 passed；`tsc --noEmit` exit 0。

### 10.5 仍未解（下一棒）
1. **setup 頁連到 fixture session id**：`/simulations/scn_.../setup` 的「Start session」指向 `ses_1207`，真後端沒有這個 id → live 路由顯示「This session could not be loaded / Not Found」。要改成先 `POST /api/v1/sessions` 建立真 session 再導向。
2. REST `POST /sessions/{id}/message` 對 `connecting` 狀態的 session 會 500（`StateTransitionError: cannot move from 'connecting' to 'processing'`）——瀏覽器是先接 WS 才送訊息，但這個錯應回 409 而非 500。
3. API 的 structlog formatter 在記錄例外時自己爆掉（`dev.py:958 can only concatenate str (not "list")`），會把真正的 traceback 蓋掉，非常難除錯。

## 11. 讓「真對話」真的跑起來：一律走 API

產品決定：**這台機器一部署就一定有 API，所有操作一律經過 API**，不准有 fixture 假裝。以下是為此拆掉的每一顆地雷（依發現順序）。

### 11.1 前端有 21 條 API 路徑少了 `/v1`
後端 73 條全在 `/api/v1/*`，但 `api-client.ts` 有一半寫成 `/api/*` → 全部 404 → 每頁靜默退回 fixtures。已全數補上並逐條對照 openapi 驗證（35/36 通過）。順帶修正名稱不符者：`knowledge`→`knowledge-bases`、巢狀 chunks/documents 改為後端的頂層資源、`reports/team`→`reports/team-analytics`、`reports/users/{id}/skills`→`reports/skill-profile/{id}`、`audit`→`audit/events`、`reports/compliance`→`security/findings`。
**仍缺**：`GET /sessions/{id}/review` 後端沒有這條（只有 `/evaluation` 與 `/transcript`），review 頁需要另外組合。

### 11.2 身分不再有 fixture fallback
`auth-context` 原本在 `me()` 失敗時套用 `MOCK_CURRENT_USER`（還帶四種角色），所以**沒有 cookie 的瀏覽器照樣渲染出完整工作區**，底下每個請求 401，模擬則換成腳本。已移除；identity 只來自 API。
連帶：登入頁原本是 `router.push('/workspace-select')`，註解直接寫著 `MOCK: skip straight to workspace selection` — **從來沒呼叫過 API**。已接上 `POST /api/v1/auth/login` 並顯示錯誤。
新增 `components/auth/require-session.tsx`：未登入導向 `/login`，不再出現「有畫面但沒有選項」的死路（`(app)` 群組、`role-select`、`workspace-select` 都包了；`login` 不能包，否則無限跳轉）。

### 11.3 進入零阻力（仍然全程走 API）
`.env` 加 `NEXT_PUBLIC_DEV_LOGIN_EMAIL/PASSWORD`（seed 的 demo 帳號）。瀏覽器一載入就發**真的** login 請求、拿**真的** HttpOnly cookie，只是省去打字。
**NEXT_PUBLIC_* 會被 inline 進前端 bundle，正式部署必須拿掉這兩個變數。**
demo 帳號在 DB 真的被授予 trainee/coach/manager/admin 四種角色，所以身份選單和原本一樣有四個選項，而且是真 RBAC。

### 11.4 後端五個會讓對話永遠跑不起來的 bug
| # | 症狀 | 根因 | 修法 |
|---|---|---|---|
| 1 | `GET /sessions/{id}` 500，前端只說「Could not reach the AI service」 | `get_session` 綁到回裸 `SessionView` 的 `get`，但 router 宣告信封 `SessionResponse` → `ResponseValidationError: 5 validation errors` | 新增 `_get_session` 轉接，與 create 走同一個 `_session_response` |
| 2 | 學員開場就 403 `missing: scenario.read` | bootstrap 另外打 `getScenario`/`getPersona`，而 §9.1 學員無此權限 | 信封本來就含 scenario/persona，改成**一次請求**取用（`SessionEnvelope` 型別） |
| 3 | WS 一直重連 403 | 前端寫死 `/ws/sessions/{id}`，後端是 `/api/v1/sessions/{id}/ws` | 對齊後端路由（也等於信封的 `websocket_url`） |
| 4 | WS 接上了卻零個 frame，永遠「正在連線…」 | `session.started` 在 `_write_loop` 訂閱**之前**發出（即時推播錯過），而 `_replay` 又在 `after_seq <= 0` 直接 return（新客戶端不重播）→ 兩頭落空 | `_replay` 改為 `after_seq < 0` 才略過；並在 WS 接上時一律同步狀態（`connecting/reconnecting` → `mark_ready`；已 `ready` → 直接補發 `session.started`），否則 API 重啟後緩衝清空就再也解不開 |
| 5 | 送出訊息後客戶永遠「思考中」 | `TrainingSession` **根本沒有 `pinned_snapshot` 欄位**，`create` 寫的那個 key 被 repository 靜默丟棄，讀回來永遠是 `{}` → `PinnedSnapshot` 4 個必填欄位驗證失敗 → `ws.turn_failed` | 新增 `_pinned_for_row()`：用 row 上真實存在的 `scenario_id/version`、`persona_id/version` 重新載入內容重建快照（版本不可變，同版本內容相同），不需要 migration |

其他：`_list_events` 少了 `await`（`AttributeError: 'coroutine' object has no attribute 'replay_since'` → 每次 gap recovery 500）。

### 11.5 structlog 會吃掉例外（除錯地雷）
`dict_tracebacks` 把例外轉成 **list**，`ConsoleRenderer` 卻做 `"\n" + exc` → `TypeError: can only concatenate str (not "list")`，然後 formatter 記錄自己的失敗、蓋掉真正的 traceback。本次有三次除錯被它擋住。已改為只在 JSON 模式套用（`ConsoleRenderer` 自己會處理 `exc_info`）。

### 11.6 驗證（瀏覽器實測）
輸入一句劇本絕對接不住的話：
> 我：陳先生您好，先問個完全無關的：您家裡養貓還是養狗？
> **陳先生（客戶）：養狗，但那跟我今天來沒有關係吧。我們可以開始了嗎？大概有多少時間可以談？**

答了離題問題、又用角色語氣把話題拉回，腳本做不到。`pytest` 242 passed、`tsc --noEmit` exit 0。

### 11.7 下一棒
1. **setup 頁仍寫死 `DEMO_SESSION_ID = 'ses_1207'`**（fixture id），Start 按鈕不會建立真 session。要改成 `POST /api/v1/sessions` 後導向回傳的 id。
2. **assignments 表是空的**：§9.1 學員只能跑「被指派」的訓練，seed 沒建立任何 assignment，所以學員自助進入的正規路徑仍不通（目前是直接給 session URL）。
3. 各 feature 頁（dashboard、simulations 列表、knowledge…）仍直接 import fixtures，尚未改讀 API。
4. `POST /sessions/{id}/message` 對 `connecting` 狀態應回 409 而非 500。

## 12. 沒有登入頁：進入即已登入（產品決定）

「根本不該有 login 頁面，直接刪掉」。API 是部署的一部分，身分一律由它給，所以：

- **刪除** `app/(auth)/login/` 與 `features/auth/login-page.tsx`。`/login` 現在是一般 404。
- `AuthProvider` 在載入時就用 `.env` 的 `NEXT_PUBLIC_DEV_LOGIN_*` 對 API 發**真的** `POST /auth/login`，拿到真的 HttpOnly cookie。
- `RequireSession` 不再導向 `/login`（那對自動登入毫無意義，而且會把「後端沒開」變成一個永遠登不進去的表單）。只剩兩種狀態：已登入，或「**無法連線到 API**」＋重試按鈕。
- `workspace-select` 的「使用其他帳號登入」改為 `signOut()`。

### 12.1 CORS：本機改用私網 regex，不再列固定 IP
`CORS_ALLOW_ORIGINS` 原本只有 `http://localhost:3000`。實際上同一台機器會從 `localhost`、`127.0.0.1`、以及**會變動的區網 IP** 進來（本次就從 `192.168.130.32` 變成 `172.20.10.2`），每個都是不同 Origin，漏一個就只會看到一句 `Failed to fetch` — 然後因為 `/auth/me` 被擋，畫面表現成「被登出」。
`main.py` 在 `is_local` 時改用 `allow_origin_regex` 接受所有 loopback 與私網位址（10/172.16-31/192.168）；其他環境維持明確白名單（`allow_credentials` 不允許萬用字元）。API 也改綁 `0.0.0.0`。

### 12.2 又兩個 router↔service 名稱不符
`ScenarioService` 沒有 `list_scenarios` / `get_scenario`（router 用 `<verb>_<noun>`，服務層是純動詞）→ 整個情境庫 500，UI 卻只顯示「找不到符合條件的情境」，跟「還沒有情境」無法區分。已補 `_list_scenarios` 轉接（分頁＋industry/query 過濾）並綁 `get/create/update_scenario`。
**這類不符可能還有**：本次是踩到才發現的第三、第四個（前面是 `get_session`、`_list_events`）。建議寫一支測試遍歷所有 router 的 `service.X()` 呼叫並 `hasattr` 驗證。

### 12.3 自助流程已通
情境庫（真 API）→ setup（真 scenario）→「開始練習」呼叫 `POST /api/v1/sessions` → 導向回傳的真 session id → WS 連上 → 可輸入。`simulation-library-page` 與 `simulation-setup-page` 都已改讀 API，不再用 `MOCK_SCENARIOS` / `DEMO_SESSION_ID`。

## 13. 對話速度與排版

### 13.1 模型換成 MiniMax-M3
`GET {base}/models` 可列出可用模型。同一 prompt 各跑兩次實測：

| 模型 | 平均延遲 | 備註 |
|---|---|---|
| MiniMax-M2.7-highspeed（原設定） | 35.3s | 最慢 |
| MiniMax-M2.5-highspeed | 11.6s | |
| MiniMax-M2.1 | 4.6s | |
| **MiniMax-M3** | **3.3s** | 已採用，且 thinking 開銷最小 |

`thinking` **無法關閉**：`{"type":"disabled"}` 與 `budget_tokens:0` 都仍回傳 thinking block（只從 5.4s 降到 ~4s）。所以速度只能靠換模型，不是靠請求參數。`.env` 與 `config.py` 預設都已改為 `MiniMax-M3`。

### 13.2 「客戶回話被推到最下面」
排序本身是對的（依 timestamp）。真正原因是**舊模型 35 秒**：使用者在等待期間又送了一則，回覆完成時自然排在後面。換 M3 後實測回覆與提問同一個時間戳，緊鄰顯示。
同時修掉一個真的 bug：`buildTranscriptItems` 的 `lastAt` 取 `turns` 陣列最後一個元素，但 `turns` 之後才排序、順序不保證，會把串流中的泡泡錨到錯誤位置。改成取最大值。

### 13.3 對談排版
兩位講者原本用**完全不同的排版語言**：學員是右對齊、限寬 72% 的泡泡；客戶卻是整行滿版卡片（`rounded-card border bg-glass-card shadow-soft`）。兩字回覆配滿版大卡就會散掉。而且那段程式的註解自己寫著「speech turns are deliberately not cards」，與實作矛盾。
已讓客戶側鏡像學員側：`mr-auto max-w-[72%]`、圓角統一為 `rounded-card`。coach / system 維持滿版（它們是註記，不是對話）。

### 13.4 客戶訊息底下的閃爍游標
串流文字結尾帶換行，而 `.sim-transcript-body` 是 `white-space: pre-wrap`，於是 `sim-caret` 被擠到下一行，看起來像一個游標停在客戶訊息底下閃。
修法：串流時 `body` 去除結尾空白；並移除客戶側的 caret —— 標題列已經有「客戶正在思考…」，泡泡內再放一個閃爍游標會被誤認成輸入框。

### 13.5 AbortError「signal is aborted without reason」
`avatar-client.ts` 的 `controller.abort()` 沒帶 reason，Next dev overlay 就把每次 effect cleanup（重新掛載或離開頁面）的正常取消顯示成錯誤。已改為帶具名 reason（`TimeoutError` / `AbortError`），catch 也改用 `signal.reason` 區分逾時與呼叫端取消，不再用猜的。

### 13.6 真兇：structlog 的 `event` 關鍵字衝突害每一輪都失敗

「客戶被推到最下面」其實不是排版，是**有些輪次根本沒有回覆**。

`LlmAuditRouter._audit_entry(event="llm.call", ...)` 把 `"event"` 放進 audit entry，而 `StructlogAuditSink.record` 做 `log.info("llm.audit", **dict(entry))`。structlog 的 bound logger 簽章是 `meth(event, **kw)`，於是 `event` 被同時以位置與關鍵字傳入：

```
TypeError: meth() got multiple values for argument 'event'
```

關鍵在於這行 audit 是在 **LLM 成功回應之後**才記錄，所以：MiniMax 回 200 → 記 audit → 炸 → `ws.turn_failed` → 回覆從未送到前端。使用者看到的是「送了訊息但客戶沒回話」，再送一次才偶然成功，於是畫面變成「你、你、客戶」。

修法：`record()` 把 `event` 改名為 `audit_event` 再展開。

**兩個教訓**
1. 這是第二次被 structlog 咬（前一次是 §11.5 的 `dict_tracebacks` 吃掉 traceback）。任何 `log.<level>(msg, **payload)` 只要 payload 可能含 `event`，就會炸。值得加一條 lint 或在 sink 統一過濾保留字。
2. `ws.turn_failed` 原本只記 `repr(exc)`，看不到堆疊。已改為 `exc_info=exc`（在 §11.5 修好 ConsoleRenderer 之後才真的能用）。

## 14. 中文化、效能與 3D 虛擬人（本輪）

### 14.1 已中文化的畫面
模擬設定頁、對談頁（工具列、客戶狀態卡、目標進度卡、情境卡、教練卡、時間軸、標題列、對話框：逐字稿／回報問題／知識庫參考／音訊裝置／字幕／引用來源）、儀表板（含 KPI fixture 標籤與星期）。學員自己的泡泡預設名稱 `'You'` → `'你'`。
- 新增 `trainingTypeLabel()`（`features/simulation/lib/labels.ts`）：`training_type` 是自由字串不是 enum，原本把 `objection_handling` 這種 slug 直接印在 UI 上。
- 儀表板問候語原本永遠是 "Good evening"；改為依時段（早安／午安／晚安）。
- `EXPRESSION_LABEL`（avatar）與 `MARKER_LABEL`（時間軸）兩張英文對照表翻為中文。
- **其餘頁面**（knowledge／personas／questions／reports／scenarios／security／settings／team／integrations／performance／training）仍是中英夾雜，已建立獨立任務卡處理，規則與參考詞彙寫在卡片內。

### 14.2 「網頁很卡」的兩個真兇
1. `POST /api/v1/runtime/telemetry` **每一次都 422**：前端把 `RuntimeTelemetryDetail` 整個攤平送出，而後端 `RuntimeTelemetryRequest` 要的是 `{ telemetry: RuntimeTelemetry }`，且 nested model `extra="forbid"`——admin 專用欄位（`worker_status`/`fallback_count`/`inferences`/`updated_at`）一律被拒。這是每次 runtime 狀態變動都會打的熱路徑。修法在 `packages/ai-runtime/src/telemetry.ts`：只投影出契約欄位並包在 `telemetry` 底下。
2. React duplicate key：`marker()` 的 id 是 `${seq}-${kind}-${label}`，同一事件的兩個同技能分數標記會撞。`pushCapped()` 加上可選 `dedupeKey`，時間軸五處呼叫都傳 `(m) => m.id`。
驗證方式要注意：Browser pane 的 `read_console_messages` **會累積整個分頁歷史**，重載也不清。要判斷「還在發生嗎」必須開全新分頁（`tabs_create`）再看。

### 14.3 開發伺服器一直「無故消失」的真因
API 與 avatar runtime 三次在沒有任何關閉紀錄的情況下消失，log 直接斷在正常請求上。原因不是程式：用 `nohup … & disown` 在一般 Bash 呼叫裡啟動的程序，會在工具呼叫結束後被沙盒回收。**改用 Bash 工具的 `run_in_background: true` 啟動**，它會被當成正式背景任務追蹤。已寫入 memory。

### 14.4 3D 虛擬人（進行中，由 agent 實作）
素材在 `封存/`：Three.js + three-vrm 概念驗證，兩個 VRM（`avatar_a_suit` 女／`avatar_m_suit` 男）、ARKit 52 維 blendshape 契約、`arkitToVrm()`、情緒疊加層、idle（眨眼／眼球／頭部微動）、口型包絡。
設計決定：
- 模型複製到 `apps/web/public/models/avatar_{female,male}_suit.vrm`；`封存/` 保持原樣當參考。
- 新程式在 `apps/web/src/features/avatar/vrm/`（`vrm-stage.tsx` 以 `next/dynamic` ssr:false 載入、`expression-to-vrm.ts`、`idle.ts`、`lipsync.ts`）。VRM 只是 **同一份 store 狀態的另一種渲染**：訂閱 `useAvatarStore` 的 `expression`（心情）與 `speaking`（口型），不碰 runtime 狀態梯。
- **Persona 沒有性別欄位**——契約層補 `gender?: 'male'|'female'|'other'`（shared TS、Pydantic、ORM 欄位＋alembic、seed、fixtures），前端 `resolvePersonaGender()` 以名字（先生／小姐／太太）與 voice_id 當 fallback。注意 repository 會靜默丟掉 ORM 沒有的欄位（`pinned_snapshot` 的教訓）。
- 兩個鬆散 GLB（`封存/*.glb`，31MB、README 未引用）已 gitignore；`封存/public`（含 33MB 模型）有提交。

### 14.5 字級階梯整體放大（「字太小、字過多」）
全站 ~70% 的文字落在 11–14px（`tiny` 198 處、`body-sm` 310 處、`body` 360 處）。中文字形沒有升降部留白、把字框填滿，同名目字級看起來比拉丁字小且擠。整條階梯抬一級並放寬行高：display 32→36、page-title 18→22、section 16→18、card-title 14→16、body 14→15、body-sm 13→14、meta 12→13、tiny 11→12。
- 字級有**兩份來源**：`tokens.css` 的 `--text-*`（shorthand `14px/22px`，Tailwind 讀不了）與 `tailwind-preset.ts` 的 `fontSize`（寫死 px）。兩邊已同步改，並互相加註「要一起改」。專案內沒有任何 `text-[Npx]` 任意值，preset 就是唯一實際生效的來源。
- **preset 只在 dev server 啟動時載入**，改完必須重啟 `next dev`；Tailwind 不會監看 config 的依賴模組。若量到的 computed font-size 沒變，先想到這一點。

### 14.6 API 再次無故退出 → 監督迴圈
即使以 tracked 背景模式啟動，API 仍在 06:14Z 於一連串正常請求後 `exit 1`、無 traceback；同為 uvicorn 的 avatar runtime（13:25 同樣方式啟動）活著，排除整批 `pkill`。根因未定。
新增 `scripts/dev/run-api.sh`：從根 `.env` 載入設定、`while` 迴圈啟動 uvicorn、每次啟動與退出（含 exit code、UTC 時間）記到 `/tmp/ai-coach-api-exits.log`。下次死掉會留下證據，且 2 秒內自動復活。用 `run_in_background: true` 執行它。

## 15. 主題：淺紫（此決定取代先前的「純黑」）

先前 §9.5 記錄的「深色畫布改純黑 + 鎖定深色」**已作廢**。中途 agent 覆蓋 tokens 時把它換成 Soft Lavender палет（`--bg-canvas: #ccc8fe` 淺 / `#17151f` 深），主題鎖定也一併消失；把這個回歸回報給產品負責人後，裁定是 **維持紫色**。

所以現況即是正確狀態，**不要再把它「修回」純黑**：
- `tokens.css` 淺色 `--bg-canvas: #ccc8fe`、深色 `#17151f`
- `theme-script.ts` / `theme-provider.tsx` 恢復正常的 light/dark/system 解析，沒有強制 dark
- `layout.tsx` 的 `themeColor` 兩個值需與上面兩個畫布色一致

### 15.1 API segfault — 已解（降到 Python 3.12）
`scripts/dev/run-api.sh` 的退出紀錄證明 API 不是被外部砍掉，是自己崩潰：
```
exit code=134   # SIGABRT
exit code=139   # SIGSEGV  (兩次)
```
約 8–50 分鐘一次，監督迴圈 2 秒內拉回，所以只表現為前端偶發「Could not reach the AI service」。

**處置**：`apps/api/.venv` 已從 Homebrew Python **3.14** 換成 uv 管理的 **CPython 3.12.12**（`uv python install 3.12` + `uv venv --python 3.12`，不需 brew 也不需密碼）。原生擴充確認都是 3.12 的輪子（`asyncpg…cpython-312-darwin.so`、`pydantic_core…cpython-312-darwin.so`、`bcrypt`、`cryptography`），242 個測試全過。舊環境保留在 `apps/api/.venv-py314-backup/`，確認穩定數日後可刪。`apps/api/.python-version` 釘 3.12——**不要在 3.14 上重建這個 venv**。

### 15.2 兩層 supervisor（保留）
即使根因已處理，兩層自動重啟仍保留，因為它同時負責「開機自動起 API」：

| 層 | 負責 | 實測 |
|---|---|---|
| `scripts/dev/run-api.sh` | uvicorn 崩了拉回、記錄每次退出碼 | `kill -SEGV` → 3.4s 復活 |
| launchd agent `com.aicoach.api` | wrapper 本身死了拉回、登入時啟動 | `kill -KILL` wrapper → 立刻重生 |

安裝 `bash scripts/dev/install-api-service.sh`（`--status` / `--uninstall`）。三個曾經踩過的坑：wrapper 沒有 `trap` 會留下孤兒 uvicorn 佔住 8000；沒有退避時壞設定會空轉；macOS 內建 bash 3.2 在 `set -u` 下**空陣列算 unbound**，所以 `reload_flag` 必須是字串不能是陣列。

## 16. 語音（ElevenLabs）

### 16.1 現況
| 方向 | 路徑 | 狀態 |
|---|---|---|
| TTS | `speakTurn()`：伺服器有 `turn.audio_url` 就播雲端音檔，否則瀏覽器 `speechSynthesis`（macOS 系統中文語音，離線） | **會出聲**（目前實際走系統語音，因為雲端音檔傳輸尚未接） |
| STT | 麥克風 → `MediaRecorder`(Opus/WebM) → `POST /api/v1/sessions/{id}/transcribe` → ElevenLabs Scribe → 繁體轉換 → 前端以 `message.send` 送出 | **已通**，實測 1.7s |
| Voice 選角 | `apps/api/app/ws/voice_catalog.py`：依 persona `gender` + `age` 查表，persona 自訂 `voice_id` 優先 | 完成 |

### 16.2 設計決定
- **STT 走 HTTP 不走 WebSocket 二進位幀**：一句話一個請求，簡單、可重試、不需要改 gateway 的文字協定；文字回到前端後再以一般 `message.send` 送出，所以可在送出前修正誤聽。`VoiceSession`（WS 串流版）保留但未接。
- **麥克風音訊永遠不直接送 vendor**：key 只在 API 行程內；瀏覽器內建 `SpeechRecognition` 在 Chromium 會送 Google，設定畫面有揭露。
- **Scribe 回簡體**：zh-TW 一律用 OpenCC `s2twp` 轉繁體＋台灣用語，`zh-CN` 保留原樣。
- gateway 收到 `voice.push_to_talk` 而沒有伺服器端 voice session 時只記 log，不再回 `voice_unavailable` 錯誤（那會在每次放開按鍵時跳紅色橫幅）。

### 16.3 尚未完成
- ElevenLabs TTS 音檔傳輸（`audio_sink` → 瀏覽器）尚未接；目前雲端 TTS 只在 `/tmp` 實測過，產品內實際出聲的是系統語音。
- API key 權限受限（缺 `voices_read`/`user_read`），所以 voice 清單寫死在 catalog。**key 曾以純文字出現在聊天室，demo 後請 revoke。**

## 17. 三個能力展示情境（`database/seeds/seed.py` → `EXTRA_SCENARIOS`）

每個情境都設計成**在觀眾面前必然觸發**一種能力，觸發方式寫在情境 description 的【示範觸發】裡，任何主持人照做即可。

| 情境 | 人物 | 觸發機制 | 學員要輸入／做的事 |
|---|---|---|---|
| 模糊提問的釐清對談 | 林佳穎 29♀ | `intent` 判 `AMBIGUOUS/INCOMPLETE → CLARIFY`；候選意思與建議反問句進客戶 prompt（`server_intent_verdict.candidate_meanings`） | 輸入「這個划算嗎？」「那這樣呢？」「要多少？」 |
| 超綱話題的溫和收斂 | 王國棟 67♂ | `OFF_TOPIC_SIGNALS` 或情境 `restricted_topics` → `REDIRECT`；客戶 prompt 規則 6 禁止「我無法回答」；導演扣 patience；教練標記離題 | 輸入「你覺得今天天氣如何？」「總統選舉你怎麼看？」 |
| 續保費率調漲告知 | 張若瑄 45♀ | 鏡頭 `angry → 不耐煩`，`CustomerTurnRequest.trainee_face` 進客戶 prompt，`_face_directive` 要求先用一句確認再繼續 | 開鏡頭皺眉；或輸入「這太離譜了」 |

### 17.1 這輪為此補的機制
- `intent.py`：新增五組無指涉評價句型（「這個怎麼樣」「那這樣呢」「要多少」「有差嗎」「這樣夠嗎」）。
- `customer_agent.py`：`server_intent_verdict` 多帶 `candidate_meanings` / `suggested_clarifying_question`，客戶反問時才會**列出選項**而不是只問「你指什麼」；新增 `trainee_face` 與 `_face_directive()`（信心 < 0.55 或 不明確/平穩 → 不提表情）。
- `orchestrator.py`：臉部讀數在**回合開始**就傳給客戶（文字情緒要等回覆存在才算得出，所以客戶只用臉部）。

### 17.2 注意
- 三個新 persona 沒填 `voice_id`，由 `voice_catalog.py` 依性別年齡選；王伯伯 67 歲用中年男聲（ElevenLabs 沒有老年聲），系統語音 fallback 則有 Grandpa。
- seed 是**增量**的：既有列不動、新 id 插入；重跑不會覆蓋（除非 `--force`）。
