# SkillCoach AI 後端

## 文件入口

- [前端串接](FRONTEND.md)：持續對練、風險標記、背景評分與最終報告。
- [部署自己的 API](docs/API_DEPLOYMENT.md)：啟動後端、使用本機模型、接自訂模型 API。
- [部署 RAG](docs/RAG_DEPLOYMENT.md)：建庫、文件匯入、驗證、備份與重建。
- [OpenAPI 快照](openapi.json)：可交給前端產生型別；以 `python export_openapi.py` 更新。

## 持續對練流程

`建立 session → 學員發言 → 條件式 RAG → 客戶回覆＋規則式風險標記 → 背景評分 → 下一輪 → 結束與總評`。

寒暄跳過 RAG。模型評分以累積對話為依據，沒有觀察證據的面向為 `null`；mock 不產生數值分數。Compliance 目前是規則式疑似風險初篩，不是獨立 LLM 或法律判定。

Session 與報告暫存記憶體，重啟後消失，請使用單一 worker。SQLite 知識庫則保留。背景評估不在客戶回覆路徑等待，但共用本機模型算力仍可能影響速度。

Python + FastAPI 的本機 RAG 後端。目前有兩個執行入口：

- **FastAPI (`app/main.py`)**：預設使用 `MockAIProvider`，不呼叫模型。問答使用文件摘錄，對練使用腳本，評分為 `null`，AI 回覆帶有 `is_mock: true`。
- **終端機對練 (`demo.py`)**：透過 `app/local_model.py` 的 adapter 呼叫本機 `http://localhost:11434/api/chat`，模型設定為 `qwen2.5:1.5b`，需先備妥並啟動對應模型服務。FastAPI 以 `COACH_AI=local` 啟動也可使用此 adapter。

兩個入口都使用 `CoachService`，預設共用 `data/knowledge.sqlite3`。文件解析、切段、檢索與來源回傳實際運作；向量目前仍由本機詞彙特徵產生。

## 程式結構

```text
backend/
├── app/
│   ├── main.py          # FastAPI 路由、CORS、錯誤回應、依賴注入
│   ├── schemas.py       # 前後端 request / response 格式
│   ├── service.py       # 知識庫、檢索、對練、評估流程與 SQLite 儲存
│   ├── documents.py     # PDF / DOCX / TXT / Markdown 解析、切段
│   ├── providers.py     # AI / Embedding 介面、本機實作、通用 HTTP adapter
│   ├── local_model.py   # 本機模型訊息與引用轉換
│   ├── training.py      # RAG 路由、風險初篩
│   └── sessions.py      # 練習狀態與背景評估
├── samples/             # 虛構手冊：測試與空資料庫的展示備用資料
├── tests/               # RAG 與 HTTP 整合測試
├── demo.py              # 本機模型的互動對練入口與請求／回覆轉換
├── requirements.txt
├── FRONTEND.md          # 前端串接流程
├── docs/                # API 與 RAG 部署文件
├── openapi.json         # API 規格快照
├── export_openapi.py    # 規格匯出工具
└── data/                # 執行時產生 SQLite，已 gitignore
```

## 啟動

需 Python 3.11+。以下指令從儲存庫根目錄執行：

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r backend/requirements.lock.txt
cd backend
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

開啟互動 API 文件：<http://127.0.0.1:8000/docs>。前端可讀取 <http://127.0.0.1:8000/openapi.json> 產生型別。CORS 已允許本機 `3000`、`5173` 連接埠。

`requirements.lock.txt` 固定本次驗證版本；`requirements.txt` 保留直接依賴的版本範圍，供之後升級。

若已備妥本機模型服務，可從 `backend/` 執行 `python demo.py` 進入互動對練。`/score` 查看背景評分；`/finish` 或 `exit` 產生總評；Ctrl+C 直接離開。它使用既有資料庫，不會自動加入範例手冊。客戶發言以原生 user／assistant 訊息傳遞，user 為學員、assistant 為客戶。

## 既有知識庫與範例檔案

| 路徑 | 用途 | 是否需要保留 |
| --- | --- | --- |
| `data/knowledge.sqlite3` | 已匯入的原文、來源位置與向量；日常搜尋直接讀取它 | 保留，屬於本機執行資料，已排除 Git 追蹤 |
| `samples/training_manual.md` | 自行撰寫的虛構範例，供測試與 `POST /documents/demo` 使用 | 建議保留並提交，讓隊友可重現測試與展示 |
| 原始 PDF | 重新匯入或更換 Embedding 後重建索引的來源 | 自行保留備份；搜尋時不會重新讀 PDF |

**已有資料庫時，搜尋不依賴 `training_manual.md`。** 但直接刪除範例檔會使上述範例 API 與測試失效，而且不會刪除先前已寫入 SQLite 的範例段落。

本次整理時，資料庫包含 `國泰人壽保險公司員工行為準則.pdf` 的 25 段與 `training_manual.md` 的 7 段。現有搜尋會一起比對同一 namespace 下的文件；若要只使用國泰準則，需要另行移除庫內範例資料或加入文件篩選。目前尚無刪除文件的 HTTP API，本次未修改資料庫。

## API

| 方法 | 路徑 | 用途 |
| --- | --- | --- |
| POST | `/sessions` | 建立持續對練 |
| POST | `/sessions/{id}/turns` | 客戶回覆、風險初篩、排入背景評估 |
| GET | `/sessions/{id}` | 輪詢對話、歷輪評分與總評 |
| POST | `/sessions/{id}/finish` | 結束練習並產生最終報告 |
| GET | `/health` | 模式、provider 與文件數量 |
| GET | `/personas` | 客戶角色 ID 與描述 |
| GET | `/documents` | 已索引文件 |
| POST | `/documents` | multipart `file` 上傳並建立索引 |
| POST | `/documents/demo` | 匯入內建虛構手冊，可重複呼叫 |
| POST | `/search` | 檢索原始段落與來源 |
| POST | `/ask` | 知識問答；目前回傳文件摘錄 |
| POST | `/chat` | 客戶回覆；目前使用腳本 |
| POST | `/evaluate` | 五維報告；目前不產生真實評分 |

### 最短 Demo 路徑

服務啟動後，在另一個終端機執行：

```bash
curl -X POST http://127.0.0.1:8000/documents/demo

curl -X POST http://127.0.0.1:8000/search \
  -H 'Content-Type: application/json' \
  -d '{"query":"本產品保本嗎？有哪些風險？","top_k":3}'

curl -X POST http://127.0.0.1:8000/ask \
  -H 'Content-Type: application/json' \
  -d '{"question":"申購費用與贖回時間是多少？"}'

curl -X POST http://127.0.0.1:8000/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"您好，您預計何時需要這筆錢？","persona":"short_term","history":[]}'

curl -X POST http://127.0.0.1:8000/evaluate \
  -H 'Content-Type: application/json' \
  -d '{"history":[{"role":"user","content":"您好，您預計何時需要這筆錢？"},{"role":"assistant","content":"三個月後需要。"}]}'
```

上傳自己的文件：`curl -X POST http://127.0.0.1:8000/documents -F 'file=@/path/to/manual.pdf'`。

### 舊版單輪 API 約定（完整對練請用 sessions）

- `/chat` 的 `history` 只包含**之前**的對話，不重複放本次 `message`。後端不保存對話；前端持有 history，再把當次 `user` 和回傳的 `assistant` 加進去。
- `/evaluate` 傳完整對話，`user` 為學員、`assistant` 為模擬客戶。最多 24 則，每則最多 4,000 字元。更長的演練需另行設計 session 儲存。
- `sources` 每筆包含 `id`、`filename`、`location`、`text`、`score`。PDF 保留頁碼；DOCX 保留段落／表格位置，不捏造頁碼。`score` 是餘弦相似度，不是答案可信機率。
- `is_mock: true` 時顯示模擬標籤。評分 `null` 請顯示「尚未評分」，不要轉成 0 分。
- `/ask` 的 `insufficient_evidence: true` 表示缺乏可用依據，請顯示原回覆。
- `400`：文件或流程問題；`422`：request 格式錯誤；`502`：provider 失敗／生成內容未通過驗證。`detail` 為錯誤內容；422 的 detail 是驗證錯誤陣列。

```javascript
const response = await fetch('http://127.0.0.1:8000/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message: '請問您的投資目標？', persona: 'cautious', history: [] }),
});
const result = await response.json();
if (!response.ok) throw new Error(JSON.stringify(result.detail));
// result.answer / result.sources / result.is_mock
```

## AI 串接位置

只需在 `app/providers.py` 實作 adapter，業務流程與 HTTP 格式不用改：

- `AIProvider.generate(AIRequest) -> AIResponse`：處理 `answer`、`roleplay`、`evaluate`。Request 已帶有指令、來源與對話；回傳格式參考 dataclass 與 `schemas.py`。
- `HTTPAIProvider`：通用 HTTP adapter；`app/local_model.py` 的 `create_test_ai_provider()`、`build_test_request()` 與 `parse_test_response()` 提供本機模型串接範例。FastAPI 可用 `COACH_AI=local` 選擇此 provider。
- `EmbeddingProvider.embed(list[str]) -> list[list[float]]`：依輸入順序回傳相同維度向量。更換模型或向量維度必須換 `namespace`，再重新匯入文件。
- 將實作注入 `CoachService(ai=YourAIProvider(...), embeddings=YourEmbeddingProvider(...))`，再傳給 `create_app(service)`。
- 外部 adapter 要設定 timeout、有限重試，將錯誤轉為不含金鑰的 `ProviderError`；`ExternalAIProvider` / `ExternalEmbeddingProvider` 現階段只會明確報錯，不會發網路請求。
- `is_mock` 與 provider 名稱由實作宣告，不以環境變數或 API Key 自動切換模式。

## 檢索與儲存

以 700 字元切段、重疊 100 字元；不跨原始頁面／段落。本機使用字元 bigram hashing 向量與餘弦相似度，**不是語意 Embedding**。SQLite 持久保存文字、來源與向量，同名文件更新採原子替換，重複檔案不重建。

資料庫預設放在 `backend/data/`，可用 `COACH_DATA_DIR` 環境變數指定其他路徑；不自動讀取 `.env`。所有本機使用者共用此知識庫；此 Demo 沒有登入、租戶隔離或公開部署設定。

## 測試

在 `backend/` 且已啟用虛擬環境時：

```bash
python -m unittest discover -s tests -v
```

涵蓋文件格式、來源定位、重複／更新、provider 失敗保留原資料、namespace 隔離、偽造引用與逐字稿檢查，以及完整 HTTP 流程。測試不呼叫外部 AI。

## Demo 限制

- 單份文件最多 10 MB、30 萬字元，PDF 最多 200 頁；掃描 PDF 尚無 OCR。
- 檢索為小型資料集全量向量比對，門檻 0.09 僅為本機詞彙檢索啟發式；換語意模型後須重新校準。
- FastAPI 預設仍是 mock，終端機對練則已配置本機模型；mock 報告不是能力評估，來源 ID 驗證也不等於語意正確性驗證。
- 客戶使用最近 12 則歷史，Evaluator 使用累積 session 對話；長對話尚無 token 預算／摘要管理，小模型可能超出上下文或回傳不合法 JSON。失敗不產生假評分。
- 沒有語音、3D avatar、國泰／CertiK 整合或法律判定功能。
- 授權尚待團隊確認，本次未自行選定 License。
