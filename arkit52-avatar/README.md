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
  loadMixamoAnimation.js  Mixamo/Biped 骨架動作 → 任意 humanoid 的 retarget(取樣式+IK)
  sample_a2e.json         模擬 LAM-A2E 輸出的動畫資料(fps=30, names[52], frames[N][52])
  motions/                動作檔 .fbx/.glb + motions.json(中文名/分類)
  models/rocketbox/       4 個 Microsoft Rocketbox 角色(FBX + 轉好的貼圖 + 年齡變體)
  models/*.vrm            上述角色的 VRM 1.0 匯出(各年齡共 8 個,供 VRM 生態使用)
  vendor/                 three.js r170 + three-vrm v3 + FBXLoader/GLTFExporter 等本地副本
tools/
  rocketbox_prep.py       下載 Rocketbox 角色並把 TGA 轉成 web 貼圖
  rocketbox_age.py        產生各年齡的臉部/髮片貼圖(皺紋 GAN + 白髮遮罩)
  age_texture.py          底層:老化 GAN 重繪(單張貼圖或 GLB)
  swap_face.py            FFHQ 對齊人臉 → 臉部貼圖換臉(頻率分離)
  make_vrm.sh             Rocketbox → .vrm 一鍵匯出(驅動下面兩支)
  rocketbox_to_vrm.mjs    Node:FBX → GLB(貼圖先拿掉)
  vrm_finalize.py         內嵌貼圖 + 注入 VRMC_vrm
  vendor/fast_aging_gan/  老化 GAN 產生器 + 預訓練權重(MIT)
node_modules/three/       Node 端的裸模組名轉接墊(2 檔,指回 vendor)
serve.sh
```

## Viewer 功能

- **角色名冊** — 8 個練習對象(男女各 4,涵蓋 20/30/40/50/65 歲),按青年/中年/長者分組。
  底模四個(20 歲男/女學生、商務男、商務女),同一底模的不同年齡共用 FBX,年齡差異由
  烤好的貼圖 + 體態 + 動作速度表現。素材未備妥的角色按鈕會自動停用
  (以 `textures.json` 當就緒訊號探測,它是 `rocketbox_prep.py` 最後才寫的檔案)。
- **外觀層** — 髮色白化、膚色明暗、駝背、動作速度四條滑桿。髮色靠 canvas 重繪貼圖
  (`material.color` 只能乘算、無法把黑髮變白);駝背在 `mixer.update()` 之後以世界空間
  X 軸疊加到 spine/chest/neck,所以播動作時弧度仍然保持。點角色套一整組參數,可再微調。
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
- **動作(Mixamo)** — 掃描 `public/motions/` 自動產生按鈕,點擊後即時 retarget 到
  角色骨架播放,切換動作以 0.3 秒 crossfade 銜接。支援 `.fbx` 與 `.glb`,
  單檔含多個 clip 時按鈕會展開成每個動作一顆。中文名稱與分類(待機/手勢/走動/運動/其他)
  由 `motions/motions.json` 定義,未列入的檔案仍可直接使用。載入模型後會自動播
  `defaultMotion` 指定的待機動作,讓角色不會呆站。
  播放時自動切全身視角、暫停頭部微動讓位給動捕資料;「回到站姿」淡出回預設姿勢。
  也可把 `.fbx` 直接拖進畫面試播(`.glb` 要按住 Shift 拖才當動作檔,否則當換模型)。
- **手臂姿勢** — 角色的綁定姿勢是張開的 A-pose,viewer 內建每個模型實測確認的
  「自然垂放」角度(`ARM_PRESETS`),沒有動作播放時每幀套用;面板保留 12 條滑桿供微調。
- **視角** — 臉部特寫 / 上半身 / 全身切換(運動動作需要全身才不會切出畫面)。
- **52 條手動 slider** — 逐一檢查每個 morph target。
- **拖放 .glb / .vrm** — 把任何含 ARKit morph targets 的 GLB,或任意 VRM,拖進畫面即可替換模型。

## 角色來源:Microsoft Rocketbox

[Rocketbox](https://github.com/microsoft/Microsoft-Rocketbox) 是微軟以 **MIT 授權**釋出的
115 個綁定好的 avatar,涵蓋多種年齡、人種、職業(含商務西裝),每個都有 `_facial.fbx`
版本帶 **175 個 blendshape**。分五組:

```
AK  52 個  完整的 ARKit 52(AK_01_BrowDownLeft …)← 現有 A2E 管線直接可用
AA  15 個  visemes(Sil/PP/FF/TH/DD/KK/CH/SS/nn/RR/aa/E/I/O/U)
AU  48 個  FACS Action Units
HB  17 個  下顎、舌頭、鼻翼
SR  42 個  Vive SRanipal
```

接進來要處理三件事,都已完成:

- **貼圖是未壓縮 TGA**(每張 12MB、七張 90MB,瀏覽器也不支援)。`tools/rocketbox_prep.py`
  轉成 JPEG/PNG(90MB → 9.3MB),有 alpha 的髮絲貼圖才留 PNG,並產生 `textures.json`
  讓 viewer 知道每張的副檔名。FBX 內寫的是作者當年的 Windows 絕對路徑,由
  `LoadingManager.setURLModifier` 只取檔名再改指過去。
- **骨架是 3ds Max Biped 命名**(`Bip01_L_UpperArm`),`loadMixamoAnimation.js` 的
  `rigKey()` 加了一層對應,25 根關鍵骨骼全數命中。
- **rest 是 A-pose,不是 T-pose**。Mixamo 的動作是相對 T-pose 記錄的,直接套會讓
  「手臂從 rest 往下轉 45°」變成「已經垂 45° 再往下 45°」。retarget 因此多算一個
  **虛擬 T-pose rest**:逐骨骼求出把目標 rest 朝向轉到來源 rest 朝向的最小旋轉。
  兩邊 rest 本來就一致時這個旋轉是單位四元數,所以對舊模型無影響。

  中間一度加過一個用兩邊 hips rest 朝向算出的 `align`,想補「骨架世界朝向不同」——
  **那是錯的**。hips 的 rest 旋轉描述的是骨骼軸向慣例(Biped 骨盆的 rest 是 90°/90°),
  不是角色面向哪邊;兩套骨架其實都 Y-up、面向 +Z。硬套 align 會把身體的「上」轉到 +Z,
  **整個人躺平**,而且連帶讓所有關節誤差維持在 4-11°。拿掉之後關節誤差降到 0.000002°。

  hips 位移另有兩個坑:它是**絕對的 local 位置**(Rocketbox 的骨盆 local y 是 0,高度掛在
  父節點上,照抄會再抬高一個身高),而且座標系換算要用**父節點**的世界旋轉,用骨骼自身的
  會把垂直分量轉到水平(走路時骨盆往上飄)。

  這幾個 bug 都是「關節角度測試」抓不到的 —— 角度是內部量,整個人躺平、骨盆飄移它都無感。
  驗證要同時看:身體朝向(骨盆→頭)、腳掌朝向、關節夾角、骨盆垂直位移。

單位是公分,載入時縮 0.01。髮絲是帶 alpha 的薄片,FBX 匯出成單面 + 純 transparent,
載入後改成雙面 + `alphaTest` 鏤空,否則會缺背面且前後髮片排序錯亂。

**貼圖載入有個坑**:FBXLoader 看到 `.tga` 副檔名時會先問 `manager.getHandler('.tga')`,
沒有就直接回一張空貼圖而**完全不呼叫 loader** —— 掛在 LoadingManager 上的 URL 改寫因此
永遠不會執行,角色會整片黑。解法是註冊一個 `.tga` handler 但實際交給 `TextureLoader`。

**年齡差異靠事先烤好的貼圖**,不是執行期調色。同一個 FBX 配不同的臉部/髮片貼圖,
角色定義只要寫 `ageTex:'65'`,URL 改寫時就會把貼圖名加上後綴(`m008_head_color_65.jpg`),
`textures.json` 裡查得到才用、查不到就退回原圖 —— 所以身體、法線、高光那些沒有變體的
貼圖會自動沿用,不必逐張列出。

皺紋來自老化 GAN,白髮來自亮度遮罩(臉部橢圓之外的深色像素往灰白推);髮片貼圖另外
處理且 **alpha 原封不動保留**,動到它頭髮會變成一塊塊方形。執行期的 look 參數只留體態
與動作速度 —— 年齡最強的視覺訊號是臉和頭髮,放在貼圖裡比較可靠,也避開 FBX 貼圖
非同步載入的時序問題(FBXLoader 不像 GLTFLoader 會等貼圖,綁定當下 `image.width`
還是 0,任何要讀像素的處理都會靜默失敗)。

```bash
python3 tools/rocketbox_prep.py --avatar Business_Female_03 --category Professions
python3 tools/rocketbox_age.py  --dir public/models/rocketbox/Business_Female_03 \
    --ages 40:1.6:0.25 65:3.4:0.92          # 標籤:皺紋強度:白髮程度
```

新增角色:

```bash
python3 tools/rocketbox_prep.py --avatar Male_Adult_09 --category Adults
```

## 匯出 VRM

Rocketbox 的角色可以轉成 VRM 1.0,拿去 VSeeFace、VRoid Hub、cluster 這類 VRM 生態使用。
這個 viewer 本身直接吃 FBX,不需要 VRM —— 轉檔純粹是為了互通。

```bash
./tools/make_vrm.sh Business_Male_02 "王先生・30代・業務"
./tools/make_vrm.sh Business_Male_02 "王先生・65代・退休" 65   # 用 65 歲的貼圖
```

沒有 Blender,所以走 three.js:`FBXLoader` 讀進來 → `GLTFExporter` 匯出 GLB → 注入
`VRMC_vrm`。三個實作上的坑:

- **Node 沒有 canvas**,GLTFExporter 處理貼圖會炸(`document` 與 `OffscreenCanvas` 都沒有)。
  所以匯出前把材質上的貼圖拿掉,匯出後再用 Python 把檔案位元組塞進 GLB 當內嵌圖片。
- **Node 沒有 `FileReader`**,GLTFExporter 的 GLB 輸出要用它把 Blob 讀成 ArrayBuffer,補一個
  三行的 polyfill。裸模組名 `three` 也要在專案根目錄放一個轉接墊(`node_modules/three`,
  兩個檔不到 1KB,指回 vendor 的副本)—— 因為 Node 是從 import 者自己的位置往上找。
- **175 個 morph 會讓 GLB 爆掉**(每個 target 都是整份 22344 頂點的位移,約 47MB)。
  只保留 ARKit 52 + 15 個 viseme 共 67 個,GLB 降到 18.5MB。

產出的 VRM:humanoid 52 根骨骼(必要的 15 根全到齊、且都在 `skin.joints` 裡)、17 個表情
(口型直接用 Rocketbox 內建的 `AA_VI_*` viseme,比從 ARKit 湊準)、meta 帶 MIT 授權。

## 臉部貼圖老化(tools/age_texture.py)

Rocketbox(以及 Avaturn / MetaPerson 這類寫實角色)的 Head baseColor 是**接近正臉的
UV 展開**,所以可以直接裁臉部區域餵給老化 GAN,不需要渲染 + 反投影那一整套。
整套年齡貼圖直接用上面的 `rocketbox_age.py` 產生;`age_texture.py` 是它的底層,
也可單獨處理一張貼圖:

```bash
python3 tools/age_texture.py --image public/models/rocketbox/<角色>/<前綴>_head_color.jpg \
    --crop 0.30 0.089 0.704 0.492 --strength 2.5 --hair-gray 0.5 \
    --out <前綴>_head_color_50.jpg
```

關鍵是**只取 delta**(`aged - original`)而不是整張換掉:delta 才是老化特徵(皺紋、
斑點、膚色變化),疊回原貼圖後原本的五官與光影全部保留。另外三個處理:

- **羽化橢圓遮罩** — GAN 會把高頻紋理灑滿整張裁切區,沒有遮罩的話額頭上方的頭皮會佈滿雜訊
- **delta 輕微高斯模糊** — 皺紋是數個 pixel 寬的線條,單點雜訊才是 GAN 的副產物
- **亮度/色度分開放大** — 高強度時色度跟著放大會讓整張臉偏橘

強度大致對應:`1.5` ≈ 40 代、`2.5` ≈ 55-60、`4.0` ≈ 70+(再高會出現色塊)。

`tools/swap_face.py` 用同一套基礎設施,把 FFHQ 對齊的真人照片換到角色的臉部貼圖上:
頻率分離(取來源臉的中高頻當身分,低頻的膚色光影用原貼圖的),眼睛和嘴巴內部保留
—— 眼球和牙齒是獨立網格,貼上畫著眼白虹膜的照片會變成雙重眼睛。

## ARKit 52 介面與 VRM 表情映射

上游一律用 **ARKit 標準 52 名**當 interface contract。Rocketbox 角色的 `AK_*` morph
名稱直接對得上,A2E 資料原封驅動;拖進來的 VRM 模型(表情系統是 aa/ih/ou/ee/oh 口型 +
happy/angry/sad 等,與 ARKit 52 不同)由 viewer 內建的 `arkitToVrm()` 映射層轉換 ——
所以任何模型都吃同一份 A2E 資料。

## 模型來源與授權

角色全部來自 [Microsoft Rocketbox](https://github.com/microsoft/Microsoft-Rocketbox)
(**MIT 授權**,允許商用/修改/散布):`Business_Male_02`(亞洲男性・西裝)、
`Business_Female_03`(亞洲女性・西裝)、`Male_Adult_10` / `Female_Adult_03`(年輕便服)。
年齡變體(40/50/65)是本專案用老化 GAN([Fast-AgingGAN](https://github.com/HasnainRaz/Fast-AgingGAN),
MIT)+ 白髮遮罩烤出的貼圖,見 tools/。動作素材來自 Mixamo(可免費商用,需 Adobe 帳號下載)
與 three.js 官方範例(內附的 `基本動作.glb`/`森巴舞.fbx`,僅供原型驗證)。
前端為 three.js r170 與 @pixiv/three-vrm v3(皆 MIT)本地副本。

## 已知限制 / 選型時踩過的坑

角色來源評估過其他選項,Rocketbox 是排除下面這些之後的選擇:

- **Ready Player Me 已於 2026-01-31 停止服務**(Netflix 收購),無法再生成新 avatar;
  其動作庫授權也限定只能用在 RPM 自家 avatar 上。
- **Avaturn 陷阱**:角色分 T1(無臉部骨骼/blendshapes,無法做表情)與 T2(支援 ARKit
  blendshapes+visemes)兩種類型,建立角色時務必選 T2,下載匯出畫面沒有補救選項。
  早期曾用它的寫實模型驗證老化管線,後已整線改用 Rocketbox。
- **社群 VRM 樣板庫檔名不可靠**:無法從檔名準確判斷模型性別/服裝,需要實際下載
  解析材質/縮圖確認。VRoid Hub 下載需要登入帳號,無法用程式化方式繞過;且動漫臉是
  平塗 + 線稿,貼圖老化不適用,年齡表現受限。
- **Mixamo 需要 Adobe 帳號登入**,無免登入下載 API,動作檔必須自行下載。下載時
  Skin 要選 **Without Skin**、locomotion 類動作要勾 In Place,否則檔案暴增或角色會
  走出畫面(詳細步驟見 `public/motions/README.txt`)。

## 下一步(對應 Roadmap)

1. **V0.5** — 接 LAM-A2E ONNX(onnxruntime-web + WebGPU):
   輸入 16 kHz Float32 PCM(16000 samples/秒),輸出 `[1, 30, 52]`,
   直接餵進現在 `sampleA2E()` 同一條路徑。
2. **V1** — TTS streaming(逐秒切塊送 A2E,邊講邊動)。
3. **V2** — Listener reaction 層(現在的 emotion/idle 層就是它的接口)。
