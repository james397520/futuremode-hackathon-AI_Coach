# AI Coach

企業訓練平台：以角色扮演、即時教練回饋、RAG 知識庫與 MiniMax 驅動的對話，協助學員進行可評估的情境練習。

本專案**不使用 Docker 或 Docker Desktop**。開發、測試與部署皆以原生程序、systemd 或託管服務執行。

## 架構

```text
Next.js Web ── HTTPS / WSS ── FastAPI API ── MiniMax
                                  ├── PostgreSQL
                                  ├── Redis
                                  ├── Qdrant（正式 RAG；本機可使用 memory）
                                  └── S3-compatible storage（檔案與報表；本機可關閉）
```

## 快速開始（macOS）

需求：Node 20+、Python 3.11+、Homebrew、PostgreSQL 16、Redis 7。

```bash
brew install postgresql@16 redis
brew services start postgresql@16
brew services start redis
createdb aicoach

corepack enable
corepack install --global pnpm@9.12.0

cp .env.example .env
# 編輯 .env：至少填入 MINIMAX_API_KEY

scripts/bootstrap.sh
```

`.env.example` 預設 `VECTOR_BACKEND=memory` 與 `OBJECT_STORAGE_ENABLED=false`，可立即進行對談，不需要 Qdrant 或 MinIO。知識庫檢索與上傳檔案啟用前，改用原生／託管的 Qdrant 與 S3-compatible storage。

在兩個終端機啟動：

```bash
pnpm api:dev
```

```bash
pnpm dev
```

開啟 <http://localhost:3000>，並確認：

```bash
curl -fsS http://localhost:8000/healthz
curl -fsS http://localhost:8000/readyz
```

## 常用指令

```bash
pnpm bootstrap          # 安裝依賴、檢查服務、migration、seed
pnpm check:services     # 僅檢查 .env 所指向的服務
pnpm typecheck
pnpm lint
cd apps/api && .venv/bin/python -m pytest -q
scripts/check-contracts.sh
```

## 部署

生產環境請使用受管 PostgreSQL、Redis、Qdrant 與 S3；應用程序以 systemd 管理。完整的環境變數、systemd unit、更新與回復流程見 [部署指南](docs/deployment.md)。

## 文件

- [安裝與本機開發](docs/installation.md)
- [開發指南](docs/development.md) — 日常開發流程、跨語言契約怎麼改
- [設定參考](docs/configuration.md)
- [部署指南](docs/deployment.md)
- [API 契約](docs/api.md)
- [模型與推論](docs/model.md)
- [資料與隱私](docs/dataset.md)
- [疑難排解](docs/troubleshooting.md)
- [架構](docs/architecture.md)、[專案結構](docs/PROJECT_STRUCTURE.md)、[ADR](docs/adr/)
- [貢獻指南](CONTRIBUTING.md)

## 安全

`MINIMAX_API_KEY`、資料庫密碼與 S3 金鑰僅能存在於 API／worker 的環境中。絕不放入 `NEXT_PUBLIC_*`、前端 bundle、git 或日誌。
