# 部署自己的 API 與接入模型

這份文件分成「啟動給前端使用的 FastAPI」與「後端接你的模型 API」。GitHub Pages 不能執行 Python 後端。

## 1. 建立 Python 環境

在 Mac／Linux 的 repo 根目錄執行，需 Python 3.11+：

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r backend/requirements.lock.txt
cd backend
```

## 2. 先啟動 mock API

```bash
COACH_AI=mock python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

另開終端機驗證：

```bash
curl http://127.0.0.1:8000/health
```

預期 status 為 ok、is_mock 為 true。開啟 <http://127.0.0.1:8000/docs> 測試；前端操作看 [FRONTEND.md](../FRONTEND.md)。開發時可加 `--reload`，但存檔 reload 會清除記憶體 session。

## 3. 改用現有本機模型

本機 adapter 使用 Ollama 格式 `/api/chat`，模型 `qwen2.5:1.5b`。若已安裝 Ollama：

```bash
# 終端機 A，已由應用程式啟動服務者不必重複執行
ollama serve

# 終端機 B，確認已下載模型；缺少時才執行 pull
ollama list
ollama pull qwen2.5:1.5b
```

模型服務位址固定在 `app/local_model.py` 的 `create_test_ai_provider()`，預設 `http://localhost:11434/api/chat`。
模型名稱在 `build_test_request()` 的 payload，目前問答與角色扮演分支各有一處，修改時需同步。

關閉 mock API，再啟動：

```bash
COACH_AI=local python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

`GET /health` 此時應為 is_mock=false。它只確認設定與後端健康，**不探測模型是否可連線**；請建立 session 並送「你好」驗證實際模型回覆。
也可執行 `python demo.py`，CLI 使用同一 adapter。程式不會自動下載模型。

## 4. 接自己的模型 API

在 `app/` 新增自己的 adapter，例如 `custom_model.py`，遵守 `AIProvider.generate(AIRequest) -> AIResponse`。
若是 HTTP JSON 服務，可重用 `providers.py` 的 `HTTPAIProvider`：

```python
from .providers import HTTPAIProvider

def create_provider():
    return HTTPAIProvider(
        name="my-model",
        endpoint="https://your-model.example/api/chat",  # 替換成真正位址
        request_builder=build_request,   # 自行實作：AIRequest -> dict
        response_parser=parse_response, # 自行實作：(dict, AIRequest) -> AIResponse
        timeout=60.0,
    )
```

此段是介面範本，不能直接執行；request／response 必須按自己的模型服務格式轉換。完整可執行範例是 `app/local_model.py`。

三種 task 的要求：

| task | 輸入 payload | 回傳 AIResponse |
| --- | --- | --- |
| answer | question、sources | text、citation_ids、insufficient_evidence |
| roleplay | message、history、persona、sources | text（只扮演客戶） |
| evaluate | history、sources、compliance、phase | report（五維分數與證據） |

保留 `request.instructions`，history 中 user 是學員、assistant 是客戶。模型若使用 S1 等來源別名，回傳前需轉回真正 chunk id；現有 local adapter 已示範轉換。
評分缺少觀察用 null；有分數須附學員逐字引用，專業準確度／風險揭露數值另須附文件來源。錯誤轉為不含金鑰與原始 payload 的 `ProviderError`。

新增一個入口，例如 `backend/custom_api.py`：

```python
from app.main import create_app
from app.service import CoachService
from app.custom_model import create_provider

app = create_app(CoachService(ai=create_provider()))
```

在 backend 執行 `python -m uvicorn custom_api:app --host 127.0.0.1 --port 8000`。HTTP API 格式不必修改。
如需金鑰，從環境變數取得並放入 HTTPAIProvider 的 headers，不寫入 Git。

## 5. 提供隊友連線

同一可信區網需要別台電腦存取時，可把 host 改為 `0.0.0.0`，前端 BASE 指向後端機器的區網 IP，例如 `http://192.168.x.x:8000`；`0.0.0.0` 是監聽設定，不是前端要填的網址。
前端在別台電腦時，localhost 指向前端自己的電腦。若前端 origin 不在 main.py 的 CORS 清單，加入實際 origin（協定＋主機＋埠）。

持續運行可用你既有的程序管理工具啟動相同 uvicorn 命令，指定 backend 為工作目錄、固定資料路徑，不加 reload，維持 **1 個 worker**。目前 Session 在記憶體，多 worker 會造成不同請求找不到同一練習。

若從公開 HTTPS 網頁呼叫，後端也需可用的 HTTPS 位址，並在反向代理配置存取控制；目前範例 API 沒有登入與租戶隔離，不是直接公開共用的完成品。此文件未建立雲端服務或自動部署。

## 常見問題

- `is unreachable`：模型服務未啟動或 endpoint 錯誤。後端在其他主機時，localhost:11434 指的是後端主機。
- `HTTP error`：確認模型名稱存在，以及請求格式符合服務。
- 背景評估 failed：小模型可能回傳不合法 JSON／引用。GET session 顯示狀態，最終報告可再次 POST finish 重試。
- `not_needed`：寒暄正常跳過 RAG；不是錯誤。
- 分數全為 null：先確認 is_mock；真實模型也可因缺乏觀察而回 null。

本次交付的自動測試不呼叫模型，不能取代你的實際模型品質驗證。
