# 前端串接：持續對練

Base URL：`http://127.0.0.1:8000`。CORS 已允許 localhost／127.0.0.1 的 3000、5173 埠。
完整型別看 [openapi.json](openapi.json) 或執行中的 `/docs`。

## 操作流程

1. `POST /sessions`，傳 `{ "persona": "cautious" }`，保存回傳的 `id`。
2. `POST /sessions/{id}/turns`，傳 `{ "message": "你好" }`。後端保存 history，前端不用重傳。
3. 顯示 `answer`；`compliance` 放教練／風險區，不是客戶發言。
4. 每 1–2 秒 `GET /sessions/{id}`，顯示最新完成的評分；不必等評分完成才送下一輪。
5. `POST /sessions/{id}/finish` 結束，繼續 GET 到 `finished` 或 `final_failed`。
6. 顯示 `final_report`，停止輪詢；元件離開時也要清除計時器。

角色另有 `fee_sensitive`（質疑費用）、`short_term`（短期資金需求）。

## 最小呼叫範例

```javascript
const BASE = 'http://127.0.0.1:8000';
async function api(path, body) {
  const response = await fetch(BASE + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(data.detail));
  return data;
}
const { id } = await api('/sessions', { persona: 'cautious' });
const turn = await api(`/sessions/${id}/turns`, { message: '你好' });
// 顯示 turn.answer，並啟動輪詢。
const state = await api(`/sessions/${id}`);
// 顯示 state.latest_evaluation，注意其 turn 可能落後目前回合。
await api(`/sessions/${id}/finish`, {});
// 繼續輪詢到 finished 或 final_failed。
```

## 回傳欄位與顯示規則

| 回覆欄位 | 意義 |
| --- | --- |
| `turn` | 此次回合編號 |
| `answer` | 客戶下一句話 |
| `rag_used` | 是否走檢索流程；寒暄為 false |
| `evidence_status` | not_needed／retrieved_context／missing |
| `sources` | 文件 id、filename、location、text、score；score 是相似度 |
| `compliance` | 本輪風險候選，含 quote、reason、trigger、turn、source_ids；標示「待確認」 |
| `is_mock` | true 時需顯示「模擬模式」 |
| `evaluation_status` | 送出背景工作的回覆固定先為 pending，以 GET 為準 |

`retrieved_context` 只表示找到參考段落，不代表已核實產品事實。Compliance 目前是規則初篩，不是法律裁定。

GET session 回傳：

- `history`：完整對話，user 是學員、assistant 是客戶。
- `compliance`：累積風險標記。
- `evaluations`：各輪 `{turn, status, report, error}`，status 是 pending／completed／failed。
- `latest_evaluation`：回合號最大的已完成評估，沒有則 null；UI 必須標示評估到第幾輪。
- `final_report`、`final_error`：總評或失敗原因。

Report 的 `scores` 有專業準確度、需求探索、同理心、異議處理、風險揭露五項，每項包含 `score`、`reason`、`evidence_quote`、`citation_ids`。**null 顯示「尚未觀察／未評分」，不能轉成 0 分。** Mock 的所有分數皆為 null；真實模型重新評估累積對話，不是固定扣分或平均歷輪分數。

狀態：`active → finishing → finished`；總評失敗變成 `final_failed`，再次 POST `/finish` 可重試。

## 錯誤與邊界

| 狀態碼 | 前端處理 |
| --- | --- |
| 400 | 流程／文件問題，顯示 detail |
| 404 | Session 不存在或後端重啟，重新建立練習 |
| 409 | 客戶仍在生成，或練習已結束；生成期間停用送出按鈕 |
| 422 | 請求格式有誤，detail 為驗證錯誤陣列 |
| 502 | 客戶模型呼叫／內容驗證失敗，本輪未寫入，可重試 |

背景評估失敗由 GET 內容的 failed／final_failed 告知，GET 仍回 200。保留上一輪已完成分數及對話。
若送出後網路中斷，先 GET 確認是否已寫入；目前沒有 idempotency key，不要盲目自動重送。
Session 僅在記憶體，後端 reload／重啟會遺失，使用單一 worker。

## 其他 API

GET `/health` 查模式；GET `/personas` 查角色；GET `/documents` 列文件。
POST `/documents` 使用 multipart `file` 上傳，不要手動設定 multipart boundary。
POST `/documents/demo` 明確匯入範例手冊。
POST `/search` 傳 `{query, top_k}`，POST `/ask` 傳 `{question}`。

舊版 POST `/chat` 和 `/evaluate` 是單次、無 session 的介面；完整對練請用 `/sessions` 系列，不要同時自行呼叫 `/evaluate` 重複評分。
