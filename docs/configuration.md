# 設定參考

設定由根目錄 `.env` 提供給 API 與 worker。`.env` 不得提交；以 `.env.example` 作為欄位清單。`NEXT_PUBLIC_*` 只供 Next.js build 使用，絕不可放密鑰。

## 必要設定

| 變數 | 本機預設 | 說明 |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql+asyncpg://localhost:5432/aicoach` | PostgreSQL asyncpg URL |
| `REDIS_URL` | `redis://localhost:6379/0` | Redis URL |
| `LLM_PROVIDER` | `minimax` | 對談模型供應者 |
| `MINIMAX_API_KEY` | 空 | 僅 API/worker 可讀 |
| `MINIMAX_MODEL` | `MiniMax-M2.7-highspeed` | 可設為可用的 MiniMax 模型 |
| `GMI_API_KEY` | 空 | 設定後，`LLM_PROVIDER=minimax` 時 GMI Cloud 成為第一備援；僅 API/worker 可讀 |
| `GMI_BASE_URL` | `https://api.gmi-serving.com/v1` | GMI Cloud OpenAI 相容端點 |
| `GMI_MODEL` | `MiniMaxAI/MiniMax-M3` | 請以 GMI 的 `GET /v1/models` 確認帳號可用的模型 ID |
| `JWT_SECRET` | `change-me` | production 必須為 32+ 字元隨機值 |

## 本機最小模式

```env
VECTOR_BACKEND=memory
OBJECT_STORAGE_ENABLED=false
TTS_PROVIDER=none
```

這種模式適合即時對談與 UI 開發。向量資料不持久化，無法上傳或保存原始文件。

## 正式 RAG 與儲存

```env
VECTOR_BACKEND=qdrant
QDRANT_URL=https://qdrant.example.com
QDRANT_API_KEY=...
OBJECT_STORAGE_ENABLED=true
S3_ENDPOINT=https://s3.example.com
S3_ACCESS_KEY=...
S3_SECRET_KEY=...
S3_BUCKET=ai-coach-prod
```

`/readyz` 僅檢查已啟用服務：永遠檢查 PostgreSQL、Redis；使用 Qdrant 時才檢查 Qdrant；開啟物件儲存時才檢查 bucket。

## 前端端點

| 變數 | 本機值 |
| --- | --- |
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:8000` |
| `NEXT_PUBLIC_WS_BASE_URL` | `ws://localhost:8000` |
| `NEXT_PUBLIC_ENABLE_WEBGPU` | `auto` |

變更 `NEXT_PUBLIC_*` 後需重新執行 `pnpm build`；它們會被編入前端產物。

## 安全規則

- 不可將 LLM、資料庫、Qdrant 或 S3 的密鑰放入 `NEXT_PUBLIC_*`。
- production 使用明確的 `CORS_ALLOW_ORIGINS`，不可為 `*`。
- API 與 worker 使用相同 server-side `.env`；web 不讀取秘密欄位。
