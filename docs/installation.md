# 安裝與本機開發

AI Coach 使用原生程序與託管服務；不需要、也不支援 Docker Desktop。

## 需求

| 項目 | 版本 | 用途 |
| --- | --- | --- |
| Node.js | 20+ | Next.js 網站與 pnpm |
| Python | 3.11+ | FastAPI、worker、migration |
| PostgreSQL | 16+ | 主資料庫 |
| Redis | 7+ | rate limit、工作佇列、WebSocket fan-out |

macOS：

```bash
brew install postgresql@16 redis
brew services start postgresql@16
brew services start redis
createdb aicoach
corepack enable
corepack install --global pnpm@9.12.0
```

Linux 請由發行版套件庫或受管服務提供 PostgreSQL 與 Redis。所有服務可在另一台主機，只要 `.env` 使用可連線的 URL。

## 初始設定

```bash
git clone <your-repository-url> ai-coach
cd ai-coach
cp .env.example .env
```

編輯 `.env`：

```env
DATABASE_URL=postgresql+asyncpg://localhost:5432/aicoach
REDIS_URL=redis://localhost:6379/0
LLM_PROVIDER=minimax
MINIMAX_API_KEY=你的金鑰
MINIMAX_MODEL=MiniMax-M2.7-highspeed
TTS_PROVIDER=none
VECTOR_BACKEND=memory
OBJECT_STORAGE_ENABLED=false
```

`memory` 向量庫只適用本機對談與測試，資料在 API 重啟後消失。正式 RAG 必須使用 Qdrant；檔案上傳、報表與音訊必須啟用 S3-compatible storage。

## Bootstrap

```bash
scripts/bootstrap.sh
```

此指令會安裝 pnpm/Python 專案依賴、檢查 PostgreSQL/Redis、執行 Alembic migration 並建立示範資料。不會安裝或啟動系統服務。

## 執行與驗證

```bash
# terminal 1
pnpm api:dev

# terminal 2
pnpm dev
```

```bash
curl -fsS http://localhost:8000/healthz
curl -fsS http://localhost:8000/readyz
cd apps/api && .venv/bin/python -m pytest -q tests/test_minimax_client.py
```

## 啟用完整 RAG 與檔案功能

設定原生或託管服務後改為：

```env
VECTOR_BACKEND=qdrant
QDRANT_URL=https://qdrant.example.com
QDRANT_API_KEY=...
OBJECT_STORAGE_ENABLED=true
S3_ENDPOINT=https://s3.example.com
S3_ACCESS_KEY=...
S3_SECRET_KEY=...
S3_BUCKET=ai-coach
```

重啟 API 與 worker，並以 `/readyz` 確認所有啟用相依服務皆為健康狀態。
