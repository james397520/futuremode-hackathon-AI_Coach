運動 / 姿勢動作放這裡
=====================

把 .fbx 或 .glb 丟進這個資料夾,重新整理頁面,「動作」區就會自動多一顆按鈕。
單一檔案含多個動作時,點一次載入後那顆按鈕會展開成「每個動作一顆」。
也可以直接把 .fbx 拖進 3D 畫面試播,不用先放進來(.glb 要按住 Shift 拖,
否則會被當成換模型)。

中文名稱與分類寫在 motions.json:
  "Waving.fbx": ["揮手", "gesture"]           一般檔案用檔名當 key
  "基本動作.glb#walk": ["走路", "move"]        單檔多動作用「檔名#clip名稱」
分類代號:idle 待機 / gesture 手勢 / move 走動 / sport 運動 / other 其他。
沒寫進 motions.json 的檔案照樣能用,只是按鈕名稱會是檔名、歸到「其他」。
"defaultMotion" 指定載入模型後自動播的待機動作(面板可關掉)。


已內附(不用下載)
------------------
基本動作.glb   7 個:走路 / 跑步 / 待機 / 點頭同意 / 搖頭 / 沮喪姿勢 / 潛行姿勢
森巴舞.fbx     1 個:當初驗證管線用的測試檔,不需要可以直接刪

兩者都來自 three.js 官方 examples(Xbot / Samba Dancing),原始素材是 Mixamo 動作。


自己去 Mixamo 抓(https://www.mixamo.com,用 Adobe 帳號登入)
-------------------------------------------------------------
1. 登入後進 Animations 分頁,左上角搜尋框打關鍵字。
2. 點左側清單的動作 → 右邊會即時預覽(角色用預設的 X Bot / Y Bot 就好,
   我們只取骨架動作,不用它的模型)。
3. 預覽區右側有動作參數滑桿,**locomotion 類動作務必勾 In Place**,
   否則角色會一路走出畫面外。Arm-Space 可調手臂張開幅度。
4. 按右上角 DOWNLOAD,對話框設定:

     Format ................ FBX Binary (.fbx)
     Skin .................. Without Skin      ← 沒選會從幾百 KB 變好幾 MB
     Frames per Second ..... 30
     Keyframe Reduction .... none

5. 下載的檔案丟進這個資料夾,改成中文檔名,重新整理頁面。

一次先抓 2-3 個確認沒問題再抓其他的。


搜尋關鍵字建議
--------------
打招呼 / 手勢   waving, salute, clapping, thumbs up, pointing, bow, talking, gesture
走路 / 移動     walking, standing walk, catwalk walk, jog, running   (記得勾 In Place)
待機 / 姿勢     idle, breathing idle, standing idle, thinking, looking around, happy idle
健身 / 運動     squat, lunge, jumping jacks, high knees, push up, warming up,
                arm stretching, neck stretching, torso stretch


授權提醒
--------
Mixamo 動作可免費商用;內附的兩個檔僅供原型驗證,正式產品請自行從 Mixamo 下載,
或改用自有動捕資產。(Ready Player Me 動作庫看似免費但授權限定只能用在 RPM 自家
avatar 上,我們的 VRM 角色不適用,已排除。)
