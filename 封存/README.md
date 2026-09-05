# ARKit 52 Avatar — V0 概念驗證

「模型輸出 animation parameters,Web 負責 3D rendering」路線的第一步:
**52 維 ARKit blendshape 係數 → Three.js morphTargetInfluences → 3D 頭像**。

## 快速開始

```bash
./serve.sh          # 或:python3 -m http.server 8000 --directory public
```

打開 http://localhost:8000

## 目前內容

```
public/
  index.html              Three.js viewer(離線可跑,無 CDN 依賴)
  models/avatar_a_suit.vrm  動漫女性・西裝(VRM 0.x)
  models/avatar_m_suit.vrm  動漫男性・西裝(VRM 0.x)
  sample_a2e.json         模擬 LAM-A2E 輸出的動畫資料(fps=30, names[52], frames[N][52])
  vendor/                 three.js r170 + @pixiv/three-vrm v3 本地副本(含 KTX2/basis、meshopt decoder)
serve.sh
```

## Viewer 功能

- **▶ 播放 A2E 範例(JSON)** — 以 LAM-A2E 的介面格式(30 FPS × 52 維)驅動臉部,
  幀間線性插值,連續平滑包絡(嘴巴永不完全闔上,避免逐音節抽搐感)。
  之後接真的 LAM-A2E ONNX 推論,只要把資料來源換掉,介面完全相同。
- **▶ 內建臉捕 Take** — 模型內附的動畫 clip(若有)。
- **情緒 Preset** — 疊加式情緒層(微笑/懷疑/驚訝/生氣/難過)。說話時嘴部/顎/舌通道
  以 lipsync 為主、情緒保留 35% 權重疊加(而非完全歸零),讓情緒的嘴角形狀在講話時仍可辨識
  (`B = M_speech⊙B_speech + M_emotion⊙B_emotion + …`)。
- **Idle 行為** — procedural 眨眼、眼球節點 saccade、頭部微動;若模型內建骨骼待機姿勢
  (例如修正 A/T-pose 的手臂軌跡),會自動抽出軀幹/四肢骨骼軌跡一律播放,
  與 compose/take 模式無關。
- **52 條手動 slider** — 逐一檢查每個 morph target。
- **拖放 .glb / .vrm** — 把任何含 ARKit morph targets 的 GLB,或任意 VRM,拖進畫面即可替換模型。

## VRM 表情映射

VRM 的表情系統(aa/ih/ou/ee/oh 口型 + happy/angry/sad 等)與 ARKit 52 不同,viewer 內建
`arkitToVrm()` 映射層,上游一律用 **ARKit 標準 52 名**當 interface contract,兩個模型
(女性/男性)都吃同一份 A2E 資料。

## 模型來源與授權

- `avatar_a_suit.vrm` 底稿為 [VRoid Studio 官方樣板模型 AvatarSample_A](https://vroid.pixiv.help/)
  (作者 VRoid/pixiv,經 [madjin/vrm-samples](https://github.com/madjin/vrm-samples) 取得),
  服裝貼圖重新上色為深藍西裝 + 金色鈕扣。
- `avatar_m_suit.vrm` 底稿為 VRoid Hub 角色 [「Savi school」](https://hub.vroid.com/en/characters/8529093083614148674/models/7111338780558622973)
  (作者 siroihakumai,授權條款:允許商用/修改/二次散布,無需掛名),
  服裝貼圖重新上色為同色系深藍西裝 + 金色鈕扣。原始服裝是詰襟學生服(立領),
  重新上色只能改顏色、無法改變版型為西式翻領,如需真正的西式西裝版型需要換模型
  或重新建模。

以上均**僅供原型驗證**。正式產品請替換為自有美術資產或授權模型;任何含 ARKit 52
morph targets 的 GLB,或任意 VRM,都能直接拖進 viewer 使用。

## 已知限制 / 踩過的坑

- **Ready Player Me 已於 2026-01-31 停止服務**(Netflix 收購),無法再生成新 avatar。
- **Avaturn 陷阱**:角色分 T1(無臉部骨骼/blendshapes,無法做表情)與 T2(支援 ARKit
  blendshapes+visemes)兩種類型,建立角色時務必選 T2,下載匯出畫面沒有補救選項。
- **社群 VRM 樣板庫檔名不可靠**:無法從檔名準確判斷模型性別/服裝,需要實際下載
  解析材質/縮圖確認。VRoid Hub 下載需要登入帳號,無法用程式化方式繞過。

## 下一步(對應 Roadmap)

1. **V0.5** — 接 LAM-A2E ONNX(onnxruntime-web + WebGPU):
   輸入 16 kHz Float32 PCM(16000 samples/秒),輸出 `[1, 30, 52]`,
   直接餵進現在 `sampleA2E()` 同一條路徑。
2. **V1** — TTS streaming(逐秒切塊送 A2E,邊講邊動)。
3. **V2** — Listener reaction 層(現在的 emotion/idle 層就是它的接口)。
