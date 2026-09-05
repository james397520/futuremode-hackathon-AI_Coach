# 部署與管理 RAG 知識庫

這個版本的 RAG 不需另外安裝向量資料庫服務。Python 解析文件、建立詞彙向量，SQLite 保存索引。AI 模型負責後續回答，兩者可以分開運行。

## 1. 安裝並指定資料路徑

先依 [API 部署文件](API_DEPLOYMENT.md) 安裝 Python 依賴。在 backend 目錄啟動：

```bash
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

預設會建立 `backend/data/knowledge.sqlite3`。如需另存位置，先設定**可寫入的絕對路徑**：

```bash
export COACH_DATA_DIR=/absolute/path/to/coach-data
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

請替換路徑，程式會建立資料夾和 chunks 表。`.env` 不會自動載入；不同啟動方式要使用相同環境變數才會共用資料庫。

## 2. 匯入文件

API 運行時，在另一終端機執行（以下從 repo 根目錄）：

```bash
curl -X POST http://127.0.0.1:8000/documents \
  -F 'file=@國泰人壽保險公司員工行為準則.pdf'
```

這份 PDF 需自行放在本機，程式不會從網路下載。或在 `/docs` 展開綠色 POST `/documents`，Try it out 後選擇 file。

成功回覆例如：

```json
{"filename":"國泰人壽保險公司員工行為準則.pdf","chunks":25,"duplicate":false}
```

同樣檔名與內容再匯入會回 duplicate=true。同名文件內容不同，會在新索引成功產生後原子替換舊版本。檔名不同則視為另一份文件。

## 3. 產品演練資料

員工行為準則提供行為規範；它不等於基金產品手冊，不能直接用來判定產品是否保本。
虛構產品 Demo 可另外呼叫：

```bash
curl -X POST http://127.0.0.1:8000/documents/demo
```

這會把 `samples/training_manual.md` 匯入；新 CLI 不會自動匯入。此檔也供測試使用，應保留在 Git。
目前搜尋會混合比對同一 namespace 的所有文件，尚無產品／文件篩選；多產品實務應先增加篩選機制。

## 4. 驗證資料與搜尋

```bash
curl http://127.0.0.1:8000/documents

curl -X POST http://127.0.0.1:8000/search \
  -H 'Content-Type: application/json' \
  -d '{"query":"利益衝突","top_k":3}'
```

確認 sources 中 filename、location、text 是否符合預期。top_k 是上限，未達門檻的段落不回傳，少於 3 筆是正常情況。
score 為餘弦相似度，不代表法規判定或答案可信度。`/ask` 在 mock 模式只會摘錄原文。

## 5. 儲存內容

資料庫 chunks 表保存 namespace、id、filename、location、text、vector。原始 PDF 不會複製到庫裡。
PDF 保留頁碼，DOCX 保留段落或表格位置。切段最多 700 字元、重疊 100 字元，不跨原始頁面／段落。

`data/` 已由 repo 根目錄 `.gitignore` 排除。隊友 clone 後不會取得你的資料庫，需自行匯入文件，或另行交付資料庫備份。GitHub Pages 不執行這個後端。

## 6. 備份與搬移

最簡單的方式是先停止 API 與 CLI，確認沒有程序寫入，再複製整個資料夾至備份位置。不要在持續寫入時只複製 `.sqlite3` 單檔，以免忽略交易日誌狀態。

搬到另一台電腦後：安裝同版本依賴，放回 data/ 或設定 COACH_DATA_DIR 指向備份資料夾，再啟動 API，使用 GET `/documents` 驗證。原始文件請另外保留，以便重建。

Session、逐字稿與評分目前存在記憶體，不在 knowledge.sqlite3 裡，不會隨知識庫備份搬移。

## 7. 重建與更換 Embedding

要試一個全新知識庫，設定 COACH_DATA_DIR 到新的空資料夾，重啟 API 並重新上傳；舊資料庫保留，切回原路徑即可恢復。

目前使用 LocalEmbeddingProvider：2048 維 bigram hashing，**不是語意模型**。
若接入 Hugging Face 或其他語意 Embedding，實作 `EmbeddingProvider.embed()`，在 `CoachService(embeddings=...)` 注入，並改成新的 namespace。
只換生成回答的 AI 模型不需重建；更換 Embedding 模型、維度或切段方式時則需要重新匯入，切段方式改動也應更新索引版本。

**不能拿新模型產生的查詢向量，直接比對舊模型的向量。** 更換後還需重新校準搜尋門檻，目前 0.09 只用於本機詞彙檢索。

## 限制與排錯

- 上傳最多 10 MB、30 萬字元、PDF 最多 200 頁；掃描 PDF 需先 OCR。
- 「文件無法解析」：確認使用已安裝 pypdf／python-docx 的虛擬環境，並確認文件格式。
- 搜尋不到：先 GET documents 確認路徑與 namespace，再嘗試文件中的原始詞彙。
- 刪除原始 Markdown／PDF 不會移除庫內索引；目前沒有刪除文件 API。
- SQLite 全量向量比對適合小型 Demo；目前沒有租戶隔離、語意 reranker 或多文件適用範圍判定。
