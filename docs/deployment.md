# 部署指南

本指南採用成熟服務的基本原則：應用無狀態、資料服務可替換、密鑰不進版控、migration 獨立執行、程序由服務管理器監督。本專案不使用 Docker Desktop 或容器化部署。

## 生產拓撲

```text
Internet → TLS reverse proxy → Next.js :3000
                         └→ FastAPI :8000 → MiniMax
                                              PostgreSQL
                                              Redis
                                              Qdrant
                                              S3-compatible storage
```

建議資料服務使用受管版本；自管時，將 PostgreSQL、Redis、Qdrant、物件儲存分別部署為 OS service，並限制只允許 API/worker 網段連線。

## 佈署前條件

- Linux 主機、Node 20+、Python 3.11+、systemd、nginx 或既有 TLS proxy。
- 受管／原生 PostgreSQL、Redis、Qdrant 與 S3-compatible storage 已就緒。
- 網域、TLS 憑證與備份策略已建立。
- `.env` 由 secrets manager 或部署帳號提供，權限為 `0600`。

## 設定

在部署目錄建立 `.env`，使用完整遠端端點：

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
MINIMAX_MODEL=MiniMax-M2.7-highspeed
TTS_PROVIDER=none
JWT_SECRET=至少32字元的隨機值
CORS_ALLOW_ORIGINS=https://app.example.com
```

正式環境拒絕 `VECTOR_BACKEND=memory`、關閉物件儲存、預設 JWT secret 或缺少 MiniMax 金鑰。

## 安裝與 build

```bash
corepack enable
corepack install --global pnpm@9.12.0
pnpm install --frozen-lockfile
python3 -m venv apps/api/.venv
apps/api/.venv/bin/pip install -e 'apps/api[dev]'
pnpm build
```

每次版本更新先執行 migration，再重啟程序：

```bash
cd apps/api
.venv/bin/alembic -c app/db/alembic.ini upgrade head
cd ../..
sudo systemctl restart ai-coach-api ai-coach-worker ai-coach-web
```

## systemd

複製 repository 的 [systemd 範本](../infra/systemd) 到 `/etc/systemd/system/`，依實際使用者、工作目錄與環境檔路徑調整後：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now ai-coach-api ai-coach-worker ai-coach-web
sudo systemctl status ai-coach-api ai-coach-worker ai-coach-web
```

## 健康檢查與回復

```bash
curl -fsS https://app.example.com/api/healthz
curl -fsS https://app.example.com/api/readyz
journalctl -u ai-coach-api -f
```

回復時先切回前一個已建置的 git revision，執行與該版本相容的 migration 策略，再重啟 service。不得以刪除資料庫或向量資料作為一般回復手段。PostgreSQL 採每日備份與 point-in-time recovery；S3 啟用版本控制；Qdrant 採定期 snapshot。
