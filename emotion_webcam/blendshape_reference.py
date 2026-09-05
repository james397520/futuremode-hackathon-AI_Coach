"""MediaPipe Face Landmarker 的 52 個 blendshape 參考表。

名稱與順序取自 MediaPipe blendshape v2 模型的輸出類別（index 0 是 ``_neutral``），
與 Apple ARKit 的 blendshape 命名一致。這個模組只有純資料，不依賴 mediapipe，
方便在沒有攝影機／沒有安裝 mediapipe 的環境查表或跑測試。
"""

from __future__ import annotations

from typing import Final

#: 模型輸出的 52 個類別，順序即為模型輸出順序。
MP_BLENDSHAPE_NAMES: Final[tuple[str, ...]] = (
    "_neutral",
    "browDownLeft",
    "browDownRight",
    "browInnerUp",
    "browOuterUpLeft",
    "browOuterUpRight",
    "cheekPuff",
    "cheekSquintLeft",
    "cheekSquintRight",
    "eyeBlinkLeft",
    "eyeBlinkRight",
    "eyeLookDownLeft",
    "eyeLookDownRight",
    "eyeLookInLeft",
    "eyeLookInRight",
    "eyeLookOutLeft",
    "eyeLookOutRight",
    "eyeLookUpLeft",
    "eyeLookUpRight",
    "eyeSquintLeft",
    "eyeSquintRight",
    "eyeWideLeft",
    "eyeWideRight",
    "jawForward",
    "jawLeft",
    "jawOpen",
    "jawRight",
    "mouthClose",
    "mouthDimpleLeft",
    "mouthDimpleRight",
    "mouthFrownLeft",
    "mouthFrownRight",
    "mouthFunnel",
    "mouthLeft",
    "mouthLowerDownLeft",
    "mouthLowerDownRight",
    "mouthPressLeft",
    "mouthPressRight",
    "mouthPucker",
    "mouthRight",
    "mouthRollLower",
    "mouthRollUpper",
    "mouthShrugLower",
    "mouthShrugUpper",
    "mouthSmileLeft",
    "mouthSmileRight",
    "mouthStretchLeft",
    "mouthStretchRight",
    "mouthUpperUpLeft",
    "mouthUpperUpRight",
    "noseSneerLeft",
    "noseSneerRight",
)

#: 每個 blendshape 的中文說明，供 UI 與文件使用。
BLENDSHAPE_ZH: Final[dict[str, str]] = {
    "_neutral": "無表情基準",
    "browDownLeft": "左眉下壓（皺眉）",
    "browDownRight": "右眉下壓（皺眉）",
    "browInnerUp": "眉心上揚（擔憂／驚訝）",
    "browOuterUpLeft": "左眉尾上揚",
    "browOuterUpRight": "右眉尾上揚",
    "cheekPuff": "雙頰鼓起",
    "cheekSquintLeft": "左頰上擠（真笑的眼下肌）",
    "cheekSquintRight": "右頰上擠（真笑的眼下肌）",
    "eyeBlinkLeft": "左眼閉合",
    "eyeBlinkRight": "右眼閉合",
    "eyeLookDownLeft": "左眼向下看",
    "eyeLookDownRight": "右眼向下看",
    "eyeLookInLeft": "左眼向內（向右）看",
    "eyeLookInRight": "右眼向內（向左）看",
    "eyeLookOutLeft": "左眼向外（向左）看",
    "eyeLookOutRight": "右眼向外（向右）看",
    "eyeLookUpLeft": "左眼向上看",
    "eyeLookUpRight": "右眼向上看",
    "eyeSquintLeft": "左眼瞇起",
    "eyeSquintRight": "右眼瞇起",
    "eyeWideLeft": "左眼睜大",
    "eyeWideRight": "右眼睜大",
    "jawForward": "下顎前推",
    "jawLeft": "下顎左移",
    "jawOpen": "張嘴（下顎張開）",
    "jawRight": "下顎右移",
    "mouthClose": "閉唇（在張嘴之上再抿住）",
    "mouthDimpleLeft": "左酒窩",
    "mouthDimpleRight": "右酒窩",
    "mouthFrownLeft": "左嘴角下垂",
    "mouthFrownRight": "右嘴角下垂",
    "mouthFunnel": "嘴呈漏斗狀（發「喔」音）",
    "mouthLeft": "嘴部左移",
    "mouthLowerDownLeft": "左下唇下拉",
    "mouthLowerDownRight": "右下唇下拉",
    "mouthPressLeft": "左唇緊壓",
    "mouthPressRight": "右唇緊壓",
    "mouthPucker": "嘟嘴（發「嗚」音）",
    "mouthRight": "嘴部右移",
    "mouthRollLower": "下唇內捲",
    "mouthRollUpper": "上唇內捲",
    "mouthShrugLower": "下唇上推（撇嘴）",
    "mouthShrugUpper": "上唇上推",
    "mouthSmileLeft": "左嘴角上揚（微笑）",
    "mouthSmileRight": "右嘴角上揚（微笑）",
    "mouthStretchLeft": "左嘴角橫向拉伸",
    "mouthStretchRight": "右嘴角橫向拉伸",
    "mouthUpperUpLeft": "左上唇上提",
    "mouthUpperUpRight": "右上唇上提",
    "noseSneerLeft": "左鼻翼皺起（嫌惡）",
    "noseSneerRight": "右鼻翼皺起（嫌惡）",
}

#: 依臉部區域分組，方便在畫面上分區顯示。
BLENDSHAPE_GROUPS: Final[dict[str, tuple[str, ...]]] = {
    "眉毛 brow": (
        "browDownLeft",
        "browDownRight",
        "browInnerUp",
        "browOuterUpLeft",
        "browOuterUpRight",
    ),
    "眼睛 eye": (
        "eyeBlinkLeft",
        "eyeBlinkRight",
        "eyeSquintLeft",
        "eyeSquintRight",
        "eyeWideLeft",
        "eyeWideRight",
    ),
    "視線 gaze": (
        "eyeLookDownLeft",
        "eyeLookDownRight",
        "eyeLookInLeft",
        "eyeLookInRight",
        "eyeLookOutLeft",
        "eyeLookOutRight",
        "eyeLookUpLeft",
        "eyeLookUpRight",
    ),
    "臉頰鼻子 cheek/nose": (
        "cheekPuff",
        "cheekSquintLeft",
        "cheekSquintRight",
        "noseSneerLeft",
        "noseSneerRight",
    ),
    "下顎 jaw": ("jawForward", "jawLeft", "jawOpen", "jawRight"),
    "嘴巴 mouth": (
        "mouthClose",
        "mouthDimpleLeft",
        "mouthDimpleRight",
        "mouthFrownLeft",
        "mouthFrownRight",
        "mouthFunnel",
        "mouthLeft",
        "mouthLowerDownLeft",
        "mouthLowerDownRight",
        "mouthPressLeft",
        "mouthPressRight",
        "mouthPucker",
        "mouthRight",
        "mouthRollLower",
        "mouthRollUpper",
        "mouthShrugLower",
        "mouthShrugUpper",
        "mouthSmileLeft",
        "mouthSmileRight",
        "mouthStretchLeft",
        "mouthStretchRight",
        "mouthUpperUpLeft",
        "mouthUpperUpRight",
    ),
}


def print_reference() -> None:
    """把 52 個 blendshape 依區域印出來，供快速查表。"""
    for group, names in BLENDSHAPE_GROUPS.items():
        print(f"\n## {group}（{len(names)}）")
        for name in names:
            idx = MP_BLENDSHAPE_NAMES.index(name)
            print(f"  [{idx:2d}] {name:<22} {BLENDSHAPE_ZH[name]}")
    print(f"\n合計 {len(MP_BLENDSHAPE_NAMES)} 個類別（含 index 0 的 _neutral）")


if __name__ == "__main__":
    print_reference()
