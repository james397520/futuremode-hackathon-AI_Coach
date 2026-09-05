"""離線自我測試：不需要 mediapipe、不需要攝影機。

用合成的 blendshape 向量驗證每條規則會在該亮的時候亮。跑法：

    python selftest.py
"""

from __future__ import annotations

import sys

from blendshape_reference import MP_BLENDSHAPE_NAMES
from expressions import ALL_RULE_SETS, classify

# 每個案例：情境名稱 → (要拉高的 blendshape, 期望的 emotion key, 期望的 persona key)
CASES: tuple[tuple[str, dict[str, float], str, str], ...] = (
    (
        "大笑",
        {"mouthSmileLeft": 0.9, "mouthSmileRight": 0.9, "cheekSquintLeft": 0.6, "cheekSquintRight": 0.6},
        "happy",
        "satisfied",
    ),
    (
        "難過",
        {"mouthFrownLeft": 0.8, "mouthFrownRight": 0.8, "browInnerUp": 0.7, "eyeLookDownLeft": 0.4, "eyeLookDownRight": 0.4},
        "sad",
        "concerned",
    ),
    (
        "生氣",
        {"browDownLeft": 0.9, "browDownRight": 0.9, "eyeSquintLeft": 0.6, "eyeSquintRight": 0.6, "mouthPressLeft": 0.5, "mouthPressRight": 0.5},
        "angry",
        "angry",
    ),
    (
        "驚訝",
        {"browInnerUp": 0.8, "browOuterUpLeft": 0.8, "browOuterUpRight": 0.8, "eyeWideLeft": 0.8, "eyeWideRight": 0.8, "jawOpen": 0.7},
        "surprised",
        "interested",
    ),
    (
        # 12 種人設表情裡沒有「害怕」，語意上最接近的是 concerned（擔憂）。
        "害怕",
        {"browInnerUp": 0.7, "eyeWideLeft": 0.8, "eyeWideRight": 0.8, "mouthStretchLeft": 0.8, "mouthStretchRight": 0.8},
        "fearful",
        "concerned",
    ),
    (
        "嫌惡",
        {"noseSneerLeft": 0.9, "noseSneerRight": 0.9, "mouthUpperUpLeft": 0.7, "mouthUpperUpRight": 0.7},
        "disgusted",
        "angry",
    ),
    (
        "單邊冷笑",
        {"mouthSmileLeft": 0.85, "mouthDimpleLeft": 0.4},
        "contempt",
        "skeptical",
    ),
    (
        "面無表情",
        {},
        "neutral",
        "neutral",
    ),
)

# 動作規則：拉高某個 blendshape 後，該動作必須進入 active 名單。
ACTION_CASES: tuple[tuple[str, dict[str, float]], ...] = (
    ("blink", {"eyeBlinkLeft": 0.95, "eyeBlinkRight": 0.95}),
    ("wink_left", {"eyeBlinkLeft": 0.95}),
    ("wink_right", {"eyeBlinkRight": 0.95}),
    ("brow_furrow", {"browDownLeft": 0.8, "browDownRight": 0.8}),
    ("brow_inner_raise", {"browInnerUp": 0.8}),
    ("brow_outer_raise", {"browOuterUpLeft": 0.8, "browOuterUpRight": 0.8}),
    ("squint", {"eyeSquintLeft": 0.7, "eyeSquintRight": 0.7}),
    ("eyes_wide", {"eyeWideLeft": 0.8, "eyeWideRight": 0.8}),
    ("look_up", {"eyeLookUpLeft": 0.8, "eyeLookUpRight": 0.8}),
    ("look_down", {"eyeLookDownLeft": 0.8, "eyeLookDownRight": 0.8}),
    ("look_left", {"eyeLookOutLeft": 0.8, "eyeLookInRight": 0.8}),
    ("look_right", {"eyeLookInLeft": 0.8, "eyeLookOutRight": 0.8}),
    ("smile", {"mouthSmileLeft": 0.8, "mouthSmileRight": 0.8}),
    ("smirk", {"mouthSmileRight": 0.8}),
    ("frown", {"mouthFrownLeft": 0.7, "mouthFrownRight": 0.7}),
    ("jaw_open", {"jawOpen": 0.8}),
    ("mouth_close", {"mouthClose": 0.7}),
    ("lip_press", {"mouthPressLeft": 0.7, "mouthPressRight": 0.7}),
    ("lip_roll", {"mouthRollUpper": 0.7, "mouthRollLower": 0.7}),
    ("pucker", {"mouthPucker": 0.8}),
    ("funnel", {"mouthFunnel": 0.8}),
    ("mouth_stretch", {"mouthStretchLeft": 0.7, "mouthStretchRight": 0.7}),
    ("mouth_shrug", {"mouthShrugLower": 0.7}),
    ("upper_lip_raise", {"mouthUpperUpLeft": 0.7, "mouthUpperUpRight": 0.7}),
    ("lower_lip_drop", {"mouthLowerDownLeft": 0.7, "mouthLowerDownRight": 0.7}),
    ("dimple", {"mouthDimpleLeft": 0.7, "mouthDimpleRight": 0.7}),
    ("mouth_sideways", {"mouthLeft": 0.7}),
    ("cheek_puff", {"cheekPuff": 0.8}),
    ("cheek_squint", {"cheekSquintLeft": 0.7, "cheekSquintRight": 0.7}),
    ("nose_sneer", {"noseSneerLeft": 0.8, "noseSneerRight": 0.8}),
    ("jaw_sideways", {"jawLeft": 0.7}),
    ("jaw_forward", {"jawForward": 0.7}),
)


def _full(partial: dict[str, float]) -> dict[str, float]:
    """把稀疏的測試向量補成完整的 52 維。"""
    vector = {name: 0.0 for name in MP_BLENDSHAPE_NAMES}
    unknown = set(partial) - set(vector)
    if unknown:
        raise KeyError(f"測試案例用了不存在的 blendshape：{sorted(unknown)}")
    vector.update(partial)
    return vector


def main() -> int:
    failures: list[str] = []

    print("=== 情緒 / 人設表情 ===")
    for name, partial, want_emotion, want_persona in CASES:
        reading = classify(_full(partial))
        got_emotion = reading.top_emotion.rule.key
        got_persona = reading.top_persona.rule.key
        ok_e = got_emotion == want_emotion
        ok_p = got_persona == want_persona
        mark = "OK  " if ok_e and ok_p else "FAIL"
        print(
            f"  [{mark}] {name:<8} 情緒={got_emotion:<10}({reading.top_emotion.score:.2f}) "
            f"人設={got_persona:<11}({reading.top_persona.score:.2f})"
        )
        if not ok_e:
            failures.append(f"{name}: 情緒期望 {want_emotion}，實際 {got_emotion}")
        if not ok_p:
            failures.append(f"{name}: 人設期望 {want_persona}，實際 {got_persona}")

    print("\n=== 臉部動作 ===")
    for want_action, partial in ACTION_CASES:
        reading = classify(_full(partial))
        active = {scored.rule.key for scored in reading.active_actions}
        ok = want_action in active
        print(f"  [{'OK  ' if ok else 'FAIL'}] {want_action:<18} active={sorted(active)}")
        if not ok:
            failures.append(f"動作 {want_action} 沒有被觸發，實際亮起：{sorted(active)}")

    total_rules = sum(len(rules) for rules in ALL_RULE_SETS.values())
    print(f"\n規則總數 {total_rules}；測試案例 {len(CASES) + len(ACTION_CASES)}")

    if failures:
        print("\n失敗：")
        for line in failures:
            print(f"  - {line}")
        return 1
    print("全部通過。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
