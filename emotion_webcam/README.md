# emotion_webcam — MediaPipe blendshape 表情判斷範例

用 MediaPipe Face Landmarker 的 **52 個 blendshape 分數**即時判斷表情，
對應 SkillCoach 的「智能情緒化感知：透過鏡頭／文字感受使用者情緒」。

判讀分三層，共 **52 條規則**：

| 層 | 數量 | 內容 |
| --- | --- | --- |
| 通用情緒 | 8 | 開心、難過、生氣、驚訝、害怕、嫌惡、不屑、無表情 |
| 人設表情 | 12 | 對齊 `services/avatar-runtime/app/expression/presets.py` 的 `ExpressionName`，可直接餵給虛擬人 |
| 臉部動作 | 32 | 眨眼、單眼眨、挑眉、皺眉、瞇眼、嘟嘴、撇嘴、鼓頰、皺鼻、下顎位移⋯⋯ |

## 檔案

| 檔案 | 說明 | 需要 mediapipe？ |
| --- | --- | --- |
| `blendshape_reference.py` | 52 個 blendshape 的名稱、中文說明、分區表 | 否 |
| `expressions.py` | 規則引擎：blendshape → 特徵 → 表情分數 | 否 |
| `webcam_demo.py` | 攝影機／單張圖片的即時判讀與畫面疊圖 | 是 |
| `selftest.py` | 離線自我測試，用合成向量驗證每條規則 | 否 |

## 安裝

MediaPipe 目前**沒有 Python 3.13 的 wheel**，請用 3.9–3.12：

```bash
python3.12 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

模型檔（`face_landmarker.task`，約 3.7 MB）第一次執行會自動下載，
也可以手動抓：

```bash
curl -o face_landmarker.task \
  https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
```

## 執行

```bash
python webcam_demo.py                  # 開攝影機即時判讀
python webcam_demo.py --image face.jpg # 判讀單張圖片，另存標註圖
python webcam_demo.py --csv out.csv    # 同時把每幀 52 個分數寫成 CSV
python webcam_demo.py --list-rules     # 列出全部 52 條規則（不需攝影機、不需 mediapipe）
python blendshape_reference.py         # 印出 52 個 blendshape 查表
python selftest.py                     # 離線驗證規則（不需攝影機、不需 mediapipe）
```

畫面上：`q` 離開、`b` 切換 blendshape 長條圖、`a` 切換動作列表、`space` 暫停。
OpenCV 畫不出中文，所以畫面標籤是英文，中文判讀結果印在終端機。

## 運作方式

```text
攝影機影格
   └─ MediaPipe FaceLandmarker（output_face_blendshapes=True）
        └─ 52 個 0–1 分數（_neutral, browDownLeft, ... , noseSneerRight）
             └─ Smoother 指數平滑（預設 alpha=0.35，抑制逐幀跳動）
                  └─ extract_features()：整理成左右對稱的語意特徵
                       └─ 52 條規則計分 → 情緒 / 人設表情 / 臉部動作
```

規則寫在**特徵**之上而不是原始名稱之上，所以讀起來像人話：

```python
Rule(
    key="happy",
    # 真笑會同時帶動眼下的 cheekSquint（Duchenne marker），只有嘴角動的假笑分數會低一些
    score_fn=lambda f: 0.75 * f.smile + 0.35 * f.cheek_squint + 0.15 * f.dimple - 0.5 * f.frown,
)
```

要調整靈敏度就改 `expressions.py` 裡的權重與 `threshold`，不需要動主程式。

## 52 個 blendshape 速查

索引即模型輸出順序，`index 0` 是 `_neutral`。

**眉毛**：`browDownLeft` `browDownRight`（皺眉）、`browInnerUp`（眉心上揚，擔憂／驚訝）、
`browOuterUpLeft` `browOuterUpRight`（眉尾上揚）

**眼睛**：`eyeBlinkLeft` `eyeBlinkRight`（閉眼）、`eyeSquintLeft` `eyeSquintRight`（瞇眼）、
`eyeWideLeft` `eyeWideRight`（睜大）

**視線**：`eyeLookUpLeft/Right` `eyeLookDownLeft/Right` `eyeLookInLeft/Right` `eyeLookOutLeft/Right`

**臉頰鼻子**：`cheekPuff`（鼓頰）、`cheekSquintLeft/Right`（真笑的眼下肌）、
`noseSneerLeft/Right`（皺鼻，嫌惡）

**下顎**：`jawOpen`（張嘴）、`jawForward`、`jawLeft`、`jawRight`

**嘴巴**：`mouthSmileLeft/Right`（微笑）、`mouthFrownLeft/Right`（嘴角下垂）、
`mouthDimpleLeft/Right`（酒窩）、`mouthPressLeft/Right`（唇緊壓）、
`mouthStretchLeft/Right`（橫向拉伸）、`mouthUpperUpLeft/Right`（上唇上提）、
`mouthLowerDownLeft/Right`（下唇下拉）、`mouthPucker`（嘟嘴）、`mouthFunnel`（喔）、
`mouthClose`（抿唇）、`mouthRollUpper/Lower`（唇內捲）、
`mouthShrugUpper/Lower`（撇嘴）、`mouthLeft` `mouthRight`（嘴歪一邊）

完整含中文說明的表：`python blendshape_reference.py`

## 已知限制

- **`listening` 與 `neutral` 難以只靠臉分辨**。「正在聆聽」是對話狀態不是臉部configuration，
  這條規則刻意壓在 `neutral` 之下，實際使用時應該搭配對話回合狀態一起判斷。
- **12 種人設表情沒有「害怕」與「嫌惡」的對應**，因此害怕會落到 `concerned`、
  嫌惡會落到 `angry`。這是刻意的映射選擇，寫在 `selftest.py` 的註解裡。
- 規則權重是依 FACS（臉部動作編碼系統）的常識手調的，**尚未用標記資料做過校準**；
  不同人臉的基線差異可能需要調整 `threshold`。
- 攝影機路徑（`webcam_demo.py` 的 `run_webcam`）**尚未在真實鏡頭上跑過**——
  開發環境是 Python 3.13（裝不了 mediapipe）且無鏡頭。已驗證的部分是：
  規則引擎的 40 個離線測試全數通過、`--list-rules` 與 `blendshape_reference.py` 可執行、
  `webcam_demo.py` 通過編譯，MediaPipe API 用法對照官方 Python 範例。
  第一次在有鏡頭的機器上跑，請預期可能還要微調門檻。
