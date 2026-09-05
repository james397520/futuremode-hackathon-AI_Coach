# SkillCoach

基於多模態 Agent 之企業與教育全情境模擬培訓平台

FUTUREMODE 2026 台灣未來祭 · BUILDMODE 黑客松參賽作品 · **Track 5**

- 專案網站：<https://james397520.github.io/futuremode-hackathon-AI_Coach/>
- 儲存庫：<https://github.com/james397520/futuremode-hackathon-AI_Coach>
- 應用程式原始碼與安裝說明：[PLATFORM_README.md](PLATFORM_README.md)（本檔案是黑客松提交總覽，實際的 monorepo 開發文件在該檔）

## 問題與目標

企業與教育現場的培訓，卡在四個結構性問題：

- **企業培訓困難**：角色扮演與實戰演練高度依賴資深人員陪練，成本高、排程難、難以規模化。
- **企業知識傳遞**：產品知識、SOP 與經驗散落在文件與資深員工腦中，隨人員流動而流失。
- **填鴨式學習成效不彰**：固定腳本與單向講授，學員背得起來卻用不出來，面對真實情境仍然生疏。
- **傳統 Agent 皆為一問一答**：既有 AI 助理只能被動應答，無法主導情境、引導學習，也不會評估表現。

SkillCoach 希望運用多模態導引，打造一個具有溫度的 Agent 引擎，釋放企業知識庫的價值並提供個性化教學引導，藉此降低人才培育斷層、讓知識民主化與企業化，並把專家經驗結構化保存與傳承，而不是隨人員流動而流失。

## 核心功能

- **情境擬真與動態引導智能體（Dynamic Scenario Agent）**：不是一問一答的聊天機器人，而是能主導情境、隨學員表現動態調整劇本與難度、主動引導的智能體。
- **自適應角色扮演**：AI 扮演客戶、病患或面試官，依學員回應即時調整態度、難度與情境分支，避免「背答案」式訓練。
- **即時語音與 3D 虛擬人**：串流語音辨識與合成，搭配口型同步的 3D Avatar，讓對練有真人般的語氣、停頓與表情壓力。
- **企業知識 RAG**：匯入產品手冊、SOP、FAQ 等文件，AI 對手的問題與標準答案皆引用企業知識庫，確保內容正確且可更新。
- **實證績效評估**：依可設定的評分準則（rubric）逐句分析對話，每個分數都附上原話證據與改進建議，主管與學員看到同一份事實。
- **自然的使用者體驗**：模糊意圖能自動推論並反問補齊資訊；提問超出知識庫範圍時會溫和收斂並推薦貼近企業標準的方向；能透過鏡頭／文字感受使用者情緒並據以調整引導。

使用流程：選擇情境 → 語音對練 → 知識檢索 → 逐句評估 → 追蹤成長。

## 系統架構

系統分四層，前端負責語音擷取與 3D 渲染，後端統籌對話狀態、RAG 檢索與評估流程，模型層可替換，資料層保存企業知識庫與訓練紀錄：

| 層 | 內容 |
| --- | --- |
| Frontend | Web App、3D Avatar、語音擷取、評估儀表板 |
| Backend | API Gateway、對話編排器、RAG Pipeline、評估引擎 |
| AI Models | LLM、STT / TTS、Embedding、Avatar 驅動 |
| Data | 關聯式資料庫、物件儲存、企業文件來源 |

主要資料流：Web App 與語音擷取進入 API Gateway 與對話編排器 → 對話編排器呼叫 STT/TTS 處理語音、呼叫 RAG Pipeline 檢索企業知識 → RAG Pipeline 串接 Embedding 模型與企業文件來源 → 評估引擎呼叫 LLM 進行逐句評分推理。完整架構圖見[專案網站的「系統架構」區塊](https://james397520.github.io/futuremode-hackathon-AI_Coach/#arch)。

## 核心技術功能（後端實作重點）

以下為 `apps/api`、`services/avatar-runtime`、`services/inference` 程式碼與內部文件目前可查證的實作，供評審參考實際完成度：

**對話與情境引擎**（`apps/api/app/agents`）

- Multi-agent 編排：`ConversationOrchestrator` 每輪依序執行合規預檢 → 情境導演 → 知識庫檢索 → 客戶模擬（串流回覆）→ 合規後檢 → 教練回饋 → 評分，非關鍵環節失敗時會降級而非中斷整場對話。
- 動態難度調整：由決定性規則引擎（不呼叫 LLM）依學員連續表現調整異議複雜度；訓練模式可降難度，正式評測模式禁止自動降難度，避免評分被灌水。
- 客戶人設模擬：以信任、興趣、抗拒、耐心等狀態變數驅動語氣與立場，並有程式化守門機制防止角色扮演洩漏隱藏設定。
- 逐句可追溯評分：評分前會逐字核對模型引用的證據是否真的出現在逐字稿中，核對不上的證據會被捨棄、證據不足時強制打中性分數，避免 AI 幻覺出不存在的依據。

**企業知識 RAG**（`apps/api/app/rag`）

- 完整 parse → chunk → embed → index → retrieve → rerank 流程，切塊策略依文件型態自動選用（標題、段落、固定 token、語意、表格、FAQ 等七種）。
- 向量資料庫採 Qdrant，並以租戶隔離參數強制過濾，避免跨企業知識庫互相查到彼此的資料。
- 檢索採 RRF（倒數排名融合）混合向量與關鍵字搜尋，而非單純比對向量相似度。

**虛擬人即時渲染**（`services/avatar-runtime`）

- 表情與頭部姿態由 LivePortrait 驅動、嘴型由 MuseTalk 驅動；兩者依裝置效能自動降級（MuseTalk → Wav2Lip → 純音量驅動嘴型），讓不同硬體都能即時運作而不卡格；目前僅 Mac Max/Ultra 或 RTX 等級硬體實測可達 MuseTalk 即時效能。
- 表情轉換加入遲滯（hysteresis）機制，避免情緒在臨界值附近來回抖動。
- 畫面透過 WebSocket 逐幀傳輸（JPEG / WebP / PNG），尚未採用 WebRTC。

**推論服務**（`services/inference`）

- 獨立運行開源 embedding 與 cross-encoder rerank 模型（ONNX Runtime），與對話 LLM 解耦，方便未來替換或私有化部署；對外 API 端點仍在開發中。

**目前已串通與尚未串通**

- 對話大腦目前實際串接、有測試覆蓋的是 **MiniMax**（Anthropic 相容 Messages API）；語音合成（ElevenLabs）程式碼已存在但預設關閉，尚未實際跑通；介紹網站提及的 EastRouter、GMI 目前在程式碼中查無對應實作。

## 使用技術

| 類型 | 技術／服務 | 用途 |
| --- | --- | --- |
| AI 模型 | EastRouter、ElevenLabs、GMI | 對話大腦與評測引擎、擬真語音與情緒交互、智能情緒化感知、知識向量化 |
| 前端 | React、Vite、Three.js、WebRTC | 對練介面、3D 虛擬人渲染與口型同步、低延遲語音串流 |
| 後端 | Python、FastAPI、WebSocket | 對話編排、RAG 檢索、評估引擎、API 與即時通道 |
| 資料 | PostgreSQL | 使用者、對練紀錄與評分、文件與錄音物件儲存 |
| Sponsor 技術 | GMI、ElevenLabs、EastRouter、CertiK、國泰金控 Cathay Financial Holdings | 情緒感知、語音交互、對話與評測引擎、合規審計、企業知識庫導入（RAG） |

## 安裝與執行

本儲存庫包含兩部分：黑客松專案介紹網站（`docs/`）與 SkillCoach 應用程式本體（monorepo：`apps/`、`services/`、`packages/`、`database/`、`infra/`）。

**應用程式本體**的完整安裝與執行步驟，請見 [PLATFORM_README.md](PLATFORM_README.md)。

**介紹網站**本機預覽：

```bash
python -m http.server 8765 --directory docs
# 開啟 http://localhost:8765/
```

推送到 `main` 分支的 `docs/` 變更，會由 [`.github/workflows/pages.yml`](.github/workflows/pages.yml) 自動部署到上方的專案網站。

## 作品展示

- 線上網站：<https://james397520.github.io/futuremode-hackathon-AI_Coach/>
- 評選影片：待補

## 限制與未來工作

> 應用程式本體的已知限制與後續規劃，請見 [PLATFORM_README.md](PLATFORM_README.md) 與 [docs/roadmap.md](docs/roadmap.md)。

**與本介紹網站相關的已知落差**

- 介紹網站（`docs/`）上列出的前端技術（React、Vite、Three.js）與 `PLATFORM_README.md` 的實際技術棧（Next.js）不同，尚待團隊統一對外說法。
- 介紹網站提及的 AI 供應商 EastRouter、GMI，在 `apps/api`、`services/avatar-runtime`、`services/inference` 程式碼與 `.env.example` 中查無對應實作；實際串接並有測試覆蓋的對話模型是 MiniMax，ElevenLabs 語音合成程式碼已存在但預設關閉、尚未實際跑通（詳見上方「核心技術功能」）。
- `docs/roadmap.md` 內容已明顯過時（例如聲稱 `main.py` 不存在、router 只完成 1 個），與目前程式碼實況（`app/main.py` 與全部 18 個 router 皆已存在）不符，請以 `docs/HANDOFF.md` 的最新進度為準，`roadmap.md` 待團隊更新。

## 第三方服務、資料與素材

| 名稱 | 用途 | 連結 |
| --- | --- | --- |
| EastRouter | 對話大腦與評測引擎 | <https://eastrouter.com> |
| ElevenLabs | 擬真語音與情緒交互 | <https://elevenlabs.io> |
| GMI | 智能情緒化感知 | <https://www.gmicloud.ai> |
| CertiK | 合規審計 | <https://www.certik.com> |
| 國泰金控 Cathay Financial Holdings | 企業知識庫導入（RAG） | <https://www.cathayholdings.com> |

各服務之授權條款以其官方網站公告為準；本儲存庫未包含任何 API Key、Token 或個人資料。

## 團隊成員

| 姓名 | 分工 | 重點經歷 |
| --- | --- | --- |
| Bryan | Leader | 逢甲大學前瞻智慧研究社社長（第三屆）；上銀機械手臂大賽 2024 冠軍；上銀黑客松 2024 / 2025 |
| Jease | LLM | GTA Robotics 共同創辦人暨技術長；European Innovation Academy 2024；FAST PROCESSING DATA TECH INC. 與 Dirui Energy 資訊顧問 |
| Gino | Vision |  |
| Jessie | UI/UX | 紐約 ADC 年度獎銅獎；德國紅點設計獎 Best of Best；Yodex 新世代設計產學合作獎銅獎 |
| James | Repo Owner | 待補充 |

## License

尚未加入 `LICENSE` 檔案，待團隊決定授權方式後補上。
