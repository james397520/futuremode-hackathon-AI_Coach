"""從 52 個 blendshape 分數推導表情。

分三層，由粗到細：

1. :data:`EMOTION_RULES` — 8 種通用情緒（開心、難過、生氣、驚訝…）。
2. :data:`PERSONA_RULES` — 12 種對應 ``services/avatar-runtime`` 的客戶人設表情，
   名稱與 ``app/expression/presets.py`` 的 ``ExpressionName`` 一致，方便直接把
   攝影機讀到的學員情緒餵進虛擬人流程。
3. :data:`ACTION_RULES` — 30+ 個單一臉部動作（眨眼、挑眉、嘟嘴…），
   用來除錯與當作 blendshape 的可視化參考。

這個模組是純 Python，不 import mediapipe，因此可以離線測試（見 ``selftest.py``）。
所有輸入分數與輸出分數都在 0.0–1.0 之間。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Final, Mapping

Blendshapes = Mapping[str, float]


def _clamp(value: float) -> float:
    return 0.0 if value < 0.0 else 1.0 if value > 1.0 else value


@dataclass(frozen=True)
class Features:
    """把 52 個原始分數整理成左右對稱、語意清楚的特徵。

    規則寫在特徵之上而不是原始名稱之上，可讀性高很多：
    ``f.smile - f.brow_down`` 比 ``(mouthSmileLeft+mouthSmileRight)/2 - ...`` 好懂。
    """

    # 眉毛
    brow_down: float
    brow_inner_up: float
    brow_outer_up: float
    # 眼睛
    blink: float
    blink_left: float
    blink_right: float
    squint: float
    wide: float
    # 視線
    look_up: float
    look_down: float
    look_left: float
    look_right: float
    # 嘴巴：正向
    smile: float
    smile_left: float
    smile_right: float
    dimple: float
    cheek_squint: float
    # 嘴巴：負向
    frown: float
    mouth_press: float
    mouth_shrug_lower: float
    mouth_stretch: float
    lower_down: float
    upper_up: float
    # 嘴型
    jaw_open: float
    mouth_pucker: float
    mouth_funnel: float
    mouth_close: float
    mouth_roll: float
    # 其他
    cheek_puff: float
    nose_sneer: float
    jaw_sideways: float
    jaw_forward: float
    mouth_sideways: float

    @property
    def smile_asymmetry(self) -> float:
        """單邊嘴角上揚的程度——冷笑／不以為然的關鍵訊號。"""
        return abs(self.smile_left - self.smile_right)

    @property
    def activation(self) -> float:
        """臉上「有在動」的整體程度。

        取所有表情肌群的最大值。眨眼與視線方向不算，因為閉眼或看別處
        並不代表臉上有表情——這兩個訊號另外由 disengaged / thinking 處理。
        neutral 與 listening 都以這個值的反向來計分，否則只要沒特別檢查的
        肌群一動（例如皺鼻），neutral 仍然會拿滿分而蓋過真正的表情。
        """
        return max(
            self.smile,
            self.smile_asymmetry,
            self.frown,
            self.brow_down,
            self.brow_inner_up,
            self.brow_outer_up,
            self.jaw_open,
            self.wide,
            self.squint,
            self.nose_sneer,
            self.mouth_pucker,
            self.mouth_funnel,
            self.mouth_press,
            self.mouth_stretch,
            self.mouth_shrug_lower,
            self.mouth_sideways,
            self.upper_up,
            self.lower_down,
            self.cheek_puff,
            self.cheek_squint,
            self.dimple,
        )


def _pair(bs: Blendshapes, left: str, right: str) -> float:
    return (bs.get(left, 0.0) + bs.get(right, 0.0)) / 2.0


def extract_features(bs: Blendshapes) -> Features:
    """把原始 blendshape 分數轉成 :class:`Features`。"""
    return Features(
        brow_down=_pair(bs, "browDownLeft", "browDownRight"),
        brow_inner_up=bs.get("browInnerUp", 0.0),
        brow_outer_up=_pair(bs, "browOuterUpLeft", "browOuterUpRight"),
        blink=_pair(bs, "eyeBlinkLeft", "eyeBlinkRight"),
        blink_left=bs.get("eyeBlinkLeft", 0.0),
        blink_right=bs.get("eyeBlinkRight", 0.0),
        squint=_pair(bs, "eyeSquintLeft", "eyeSquintRight"),
        wide=_pair(bs, "eyeWideLeft", "eyeWideRight"),
        look_up=_pair(bs, "eyeLookUpLeft", "eyeLookUpRight"),
        look_down=_pair(bs, "eyeLookDownLeft", "eyeLookDownRight"),
        # 受測者的左邊＝畫面的右邊，這裡以受測者視角命名。
        look_left=(bs.get("eyeLookOutLeft", 0.0) + bs.get("eyeLookInRight", 0.0)) / 2.0,
        look_right=(bs.get("eyeLookInLeft", 0.0) + bs.get("eyeLookOutRight", 0.0)) / 2.0,
        smile=_pair(bs, "mouthSmileLeft", "mouthSmileRight"),
        smile_left=bs.get("mouthSmileLeft", 0.0),
        smile_right=bs.get("mouthSmileRight", 0.0),
        dimple=_pair(bs, "mouthDimpleLeft", "mouthDimpleRight"),
        cheek_squint=_pair(bs, "cheekSquintLeft", "cheekSquintRight"),
        frown=_pair(bs, "mouthFrownLeft", "mouthFrownRight"),
        mouth_press=_pair(bs, "mouthPressLeft", "mouthPressRight"),
        mouth_shrug_lower=bs.get("mouthShrugLower", 0.0),
        mouth_stretch=_pair(bs, "mouthStretchLeft", "mouthStretchRight"),
        lower_down=_pair(bs, "mouthLowerDownLeft", "mouthLowerDownRight"),
        upper_up=_pair(bs, "mouthUpperUpLeft", "mouthUpperUpRight"),
        jaw_open=bs.get("jawOpen", 0.0),
        mouth_pucker=bs.get("mouthPucker", 0.0),
        mouth_funnel=bs.get("mouthFunnel", 0.0),
        mouth_close=bs.get("mouthClose", 0.0),
        mouth_roll=(bs.get("mouthRollUpper", 0.0) + bs.get("mouthRollLower", 0.0)) / 2.0,
        cheek_puff=bs.get("cheekPuff", 0.0),
        nose_sneer=_pair(bs, "noseSneerLeft", "noseSneerRight"),
        jaw_sideways=max(bs.get("jawLeft", 0.0), bs.get("jawRight", 0.0)),
        jaw_forward=bs.get("jawForward", 0.0),
        mouth_sideways=max(bs.get("mouthLeft", 0.0), bs.get("mouthRight", 0.0)),
    )


@dataclass(frozen=True)
class Rule:
    """一條表情規則。"""

    key: str
    label_zh: str
    label_en: str
    score_fn: Callable[[Features], float]
    #: 低於這個分數就不顯示，避免整排規則同時微亮。
    threshold: float = 0.25
    #: 這條規則主要看哪幾個 blendshape，顯示在 UI 上當作教學用途。
    cues: tuple[str, ...] = ()

    def score(self, features: Features) -> float:
        return _clamp(self.score_fn(features))


# --------------------------------------------------------------------------
# 第一層：8 種通用情緒
# --------------------------------------------------------------------------

EMOTION_RULES: Final[tuple[Rule, ...]] = (
    Rule(
        key="happy",
        label_zh="開心",
        label_en="Happy",
        # 真笑會同時帶動眼下的 cheekSquint（Duchenne marker），
        # 只有嘴角動的假笑分數會低一些。
        score_fn=lambda f: 0.75 * f.smile + 0.35 * f.cheek_squint + 0.15 * f.dimple - 0.5 * f.frown,
        cues=("mouthSmileLeft/Right", "cheekSquintLeft/Right", "mouthDimpleLeft/Right"),
    ),
    Rule(
        key="sad",
        label_zh="難過",
        label_en="Sad",
        score_fn=lambda f: 0.6 * f.frown + 0.5 * f.brow_inner_up + 0.2 * f.look_down - 0.8 * f.smile,
        cues=("mouthFrownLeft/Right", "browInnerUp", "eyeLookDown*"),
    ),
    Rule(
        key="angry",
        label_zh="生氣",
        label_en="Angry",
        score_fn=lambda f: 0.65 * f.brow_down
        + 0.35 * f.squint
        + 0.25 * f.mouth_press
        + 0.2 * f.nose_sneer
        - 0.7 * f.smile
        - 0.4 * f.brow_inner_up,
        cues=("browDownLeft/Right", "eyeSquintLeft/Right", "mouthPressLeft/Right"),
    ),
    Rule(
        key="surprised",
        label_zh="驚訝",
        label_en="Surprised",
        score_fn=lambda f: 0.45 * f.brow_inner_up
        + 0.35 * f.brow_outer_up
        + 0.4 * f.wide
        + 0.35 * f.jaw_open
        - 0.6 * f.brow_down,
        cues=("browInnerUp", "browOuterUp*", "eyeWide*", "jawOpen"),
    ),
    Rule(
        key="fearful",
        label_zh="害怕",
        label_en="Fearful",
        # 與驚訝的差別：害怕的嘴角是橫向拉開而不是單純張開。
        score_fn=lambda f: 0.4 * f.brow_inner_up
        + 0.35 * f.wide
        + 0.45 * f.mouth_stretch
        + 0.2 * f.jaw_open
        - 0.6 * f.smile,
        cues=("browInnerUp", "eyeWide*", "mouthStretch*"),
    ),
    Rule(
        key="disgusted",
        label_zh="嫌惡",
        label_en="Disgusted",
        score_fn=lambda f: 0.7 * f.nose_sneer
        + 0.4 * f.upper_up
        + 0.25 * f.brow_down
        - 0.5 * f.smile,
        cues=("noseSneerLeft/Right", "mouthUpperUpLeft/Right"),
    ),
    Rule(
        key="contempt",
        label_zh="不屑",
        label_en="Contempt",
        # 單邊嘴角上揚是不屑的經典訊號，兩邊一起揚就是笑了。
        score_fn=lambda f: 1.2 * f.smile_asymmetry + 0.25 * f.dimple - 0.4 * min(f.smile_left, f.smile_right),
        cues=("mouthSmileLeft vs mouthSmileRight（單邊）", "mouthDimple*"),
    ),
    Rule(
        key="neutral",
        label_zh="無表情",
        label_en="Neutral",
        # 所有表情肌群都安靜時才算 neutral。
        score_fn=lambda f: 1.0 - _clamp(1.6 * f.activation),
        threshold=0.45,
        cues=("所有表情肌群皆低於門檻",),
    ),
)


# --------------------------------------------------------------------------
# 第二層：12 種客戶人設表情（對齊 avatar-runtime 的 ExpressionName）
# --------------------------------------------------------------------------

PERSONA_RULES: Final[tuple[Rule, ...]] = (
    Rule(
        key="neutral",
        label_zh="中性",
        label_en="Neutral",
        score_fn=lambda f: 1.0 - _clamp(1.6 * f.activation),
        threshold=0.45,
        cues=("所有表情肌群皆低於門檻",),
    ),
    Rule(
        key="listening",
        label_zh="聆聽中",
        label_en="Listening",
        # 臉部放鬆、眼睛張開。純靠臉部很難把「正在聆聽」和「面無表情」分開，
        # 因此這條刻意壓在 neutral 之下：只有搭配對話狀態時才該當成主判斷。
        score_fn=lambda f: (1.0 - _clamp(1.8 * f.activation)) * (1.0 - 0.6 * f.blink) * 0.75,
        threshold=0.5,
        cues=("低 activation / 眼睛張開（需搭配對話狀態才可靠）",),
    ),
    Rule(
        key="interested",
        label_zh="有興趣",
        label_en="Interested",
        score_fn=lambda f: 0.5 * f.brow_outer_up + 0.35 * f.wide + 0.3 * f.smile - 0.5 * f.brow_down,
        cues=("browOuterUp*", "eyeWide*", "輕微 mouthSmile*"),
    ),
    Rule(
        key="skeptical",
        label_zh="懷疑",
        label_en="Skeptical",
        # 挑單邊眉 + 瞇眼 + 單邊嘴角，是懷疑最典型的組合。
        score_fn=lambda f: 0.5 * f.smile_asymmetry + 0.4 * f.squint + 0.35 * f.brow_outer_up + 0.2 * f.mouth_press,
        cues=("單邊 browOuterUp", "eyeSquint*", "單邊 mouthSmile"),
    ),
    Rule(
        key="concerned",
        label_zh="擔憂",
        label_en="Concerned",
        score_fn=lambda f: 0.6 * f.brow_inner_up + 0.3 * f.frown + 0.25 * f.mouth_press - 0.5 * f.smile,
        cues=("browInnerUp", "mouthFrown*", "mouthPress*"),
    ),
    Rule(
        key="frustrated",
        label_zh="不耐煩",
        label_en="Frustrated",
        score_fn=lambda f: 0.5 * f.brow_down
        + 0.35 * f.mouth_press
        + 0.3 * f.mouth_shrug_lower
        + 0.2 * f.look_up
        - 0.6 * f.smile,
        cues=("browDown*", "mouthPress*", "mouthShrugLower", "翻白眼 eyeLookUp*"),
    ),
    Rule(
        key="angry",
        label_zh="生氣",
        label_en="Angry",
        # 人設表情沒有獨立的「嫌惡」，所以皺鼻／上唇上提也歸到 angry。
        score_fn=lambda f: 0.65 * f.brow_down
        + 0.35 * f.squint
        + 0.55 * f.nose_sneer
        + 0.25 * f.upper_up
        + 0.25 * f.mouth_press
        - 0.8 * f.smile,
        cues=("browDown*", "eyeSquint*", "noseSneer*", "mouthUpperUp*"),
    ),
    Rule(
        key="thinking",
        label_zh="思考中",
        label_en="Thinking",
        # 眼睛飄向一側或往上、嘴巴微抿，是思考的常見樣態。
        score_fn=lambda f: 0.45 * max(f.look_left, f.look_right, f.look_up)
        + 0.3 * f.mouth_press
        + 0.25 * f.mouth_sideways
        + 0.2 * f.brow_down,
        cues=("eyeLook* 偏移", "mouthPress*", "mouthLeft/Right"),
    ),
    Rule(
        key="confused",
        label_zh="困惑",
        label_en="Confused",
        # 一邊眉毛上揚一邊下壓，加上嘴角歪一邊。
        score_fn=lambda f: 0.45 * f.brow_inner_up + 0.35 * f.brow_down + 0.4 * f.mouth_sideways + 0.2 * f.squint,
        cues=("browInnerUp + browDown 同時", "mouthLeft/Right"),
    ),
    Rule(
        key="satisfied",
        label_zh="滿意",
        label_en="Satisfied",
        # 帶著眼下肌的微笑（真笑），但幅度比 happy 收斂。
        score_fn=lambda f: 0.6 * f.smile + 0.45 * f.cheek_squint + 0.2 * f.squint - 0.5 * f.jaw_open,
        cues=("mouthSmile* 中等", "cheekSquint*"),
    ),
    Rule(
        key="ready",
        label_zh="準備好了",
        label_en="Ready",
        # 「眼睛張開」只當成倍率，不當成加分項——否則任何一張眼睛沒閉的臉
        # 都會先拿到一筆保底分數，把其他更明確的表情壓下去。
        score_fn=lambda f: (0.7 * f.smile + 0.5 * f.brow_outer_up - 0.6 * f.brow_down)
        * (1.0 - 0.5 * f.blink),
        threshold=0.35,
        cues=("輕微 mouthSmile*", "browOuterUp*", "眼睛張開（倍率）"),
    ),
    Rule(
        key="disengaged",
        label_zh="失去興趣",
        label_en="Disengaged",
        # 眼皮下垂、視線往下、臉部肌群幾乎不動。
        score_fn=lambda f: 0.45 * f.look_down
        + 0.35 * f.blink
        + 0.3 * (1.0 - _clamp(3.0 * f.activation))
        - 0.5 * f.smile,
        cues=("eyeLookDown*", "眼皮下垂 eyeBlink*", "其他肌群靜止"),
    ),
)


# --------------------------------------------------------------------------
# 第三層：單一臉部動作（除錯與教學用的完整參考）
# --------------------------------------------------------------------------

def _action(key: str, zh: str, en: str, fn: Callable[[Features], float], cues: tuple[str, ...], threshold: float = 0.35) -> Rule:
    return Rule(key=key, label_zh=zh, label_en=en, score_fn=fn, threshold=threshold, cues=cues)


ACTION_RULES: Final[tuple[Rule, ...]] = (
    # 眉毛
    _action("brow_furrow", "皺眉", "Brow furrow", lambda f: f.brow_down, ("browDownLeft/Right",)),
    _action("brow_inner_raise", "眉心上揚", "Inner brow raise", lambda f: f.brow_inner_up, ("browInnerUp",)),
    _action("brow_outer_raise", "眉尾上揚", "Outer brow raise", lambda f: f.brow_outer_up, ("browOuterUpLeft/Right",)),
    # 眼睛
    _action("blink", "雙眼閉合", "Blink", lambda f: min(f.blink_left, f.blink_right), ("eyeBlinkLeft+Right",), 0.5),
    _action("wink_left", "左眼眨眼", "Wink (left)", lambda f: f.blink_left - f.blink_right, ("eyeBlinkLeft 單獨",), 0.4),
    _action("wink_right", "右眼眨眼", "Wink (right)", lambda f: f.blink_right - f.blink_left, ("eyeBlinkRight 單獨",), 0.4),
    _action("squint", "瞇眼", "Squint", lambda f: f.squint, ("eyeSquintLeft/Right",)),
    _action("eyes_wide", "睜大眼", "Eyes wide", lambda f: f.wide, ("eyeWideLeft/Right",)),
    # 視線
    _action("look_up", "視線向上", "Look up", lambda f: f.look_up, ("eyeLookUpLeft/Right",)),
    _action("look_down", "視線向下", "Look down", lambda f: f.look_down, ("eyeLookDownLeft/Right",)),
    _action("look_left", "視線向左", "Look left", lambda f: f.look_left, ("eyeLookOutLeft + eyeLookInRight",)),
    _action("look_right", "視線向右", "Look right", lambda f: f.look_right, ("eyeLookInLeft + eyeLookOutRight",)),
    # 嘴巴
    _action("smile", "微笑", "Smile", lambda f: f.smile, ("mouthSmileLeft/Right",)),
    _action("smirk", "單邊冷笑", "Smirk", lambda f: f.smile_asymmetry, ("mouthSmile 左右差",), 0.25),
    _action("frown", "嘴角下垂", "Frown", lambda f: f.frown, ("mouthFrownLeft/Right",)),
    _action("jaw_open", "張嘴", "Jaw open", lambda f: f.jaw_open, ("jawOpen",)),
    _action("mouth_close", "抿唇", "Mouth close", lambda f: f.mouth_close, ("mouthClose",)),
    _action("lip_press", "唇緊壓", "Lip press", lambda f: f.mouth_press, ("mouthPressLeft/Right",)),
    _action("lip_roll", "唇內捲", "Lip roll", lambda f: f.mouth_roll, ("mouthRollUpper/Lower",)),
    _action("pucker", "嘟嘴", "Pucker", lambda f: f.mouth_pucker, ("mouthPucker",)),
    _action("funnel", "嘴呈漏斗（喔）", "Funnel", lambda f: f.mouth_funnel, ("mouthFunnel",)),
    _action("mouth_stretch", "咧嘴橫拉", "Mouth stretch", lambda f: f.mouth_stretch, ("mouthStretchLeft/Right",)),
    _action("mouth_shrug", "撇嘴", "Mouth shrug", lambda f: f.mouth_shrug_lower, ("mouthShrugLower",)),
    _action("upper_lip_raise", "上唇上提", "Upper lip raise", lambda f: f.upper_up, ("mouthUpperUpLeft/Right",)),
    _action("lower_lip_drop", "下唇下拉", "Lower lip drop", lambda f: f.lower_down, ("mouthLowerDownLeft/Right",)),
    _action("dimple", "酒窩", "Dimple", lambda f: f.dimple, ("mouthDimpleLeft/Right",)),
    _action("mouth_sideways", "嘴歪一邊", "Mouth sideways", lambda f: f.mouth_sideways, ("mouthLeft / mouthRight",)),
    # 臉頰、鼻子、下顎
    _action("cheek_puff", "鼓頰", "Cheek puff", lambda f: f.cheek_puff, ("cheekPuff",)),
    _action("cheek_squint", "眼下肌上擠", "Cheek squint", lambda f: f.cheek_squint, ("cheekSquintLeft/Right",)),
    _action("nose_sneer", "皺鼻", "Nose sneer", lambda f: f.nose_sneer, ("noseSneerLeft/Right",)),
    _action("jaw_sideways", "下顎左右移", "Jaw sideways", lambda f: f.jaw_sideways, ("jawLeft / jawRight",)),
    _action("jaw_forward", "下顎前推", "Jaw forward", lambda f: f.jaw_forward, ("jawForward",)),
)


ALL_RULE_SETS: Final[dict[str, tuple[Rule, ...]]] = {
    "emotion": EMOTION_RULES,
    "persona": PERSONA_RULES,
    "action": ACTION_RULES,
}


@dataclass(frozen=True)
class Scored:
    """一條規則的計分結果。"""

    rule: Rule
    score: float

    @property
    def is_active(self) -> bool:
        return self.score >= self.rule.threshold


@dataclass(frozen=True)
class Reading:
    """一幀的完整判讀結果。"""

    features: Features
    emotions: tuple[Scored, ...]
    personas: tuple[Scored, ...]
    actions: tuple[Scored, ...]

    @property
    def top_emotion(self) -> Scored:
        return self.emotions[0]

    @property
    def top_persona(self) -> Scored:
        return self.personas[0]

    @property
    def active_actions(self) -> tuple[Scored, ...]:
        return tuple(s for s in self.actions if s.is_active)


def _score_all(rules: tuple[Rule, ...], features: Features) -> tuple[Scored, ...]:
    scored = [Scored(rule=rule, score=rule.score(features)) for rule in rules]
    scored.sort(key=lambda s: s.score, reverse=True)
    return tuple(scored)


def classify(bs: Blendshapes) -> Reading:
    """把一組 blendshape 分數判讀成情緒、人設表情與臉部動作。"""
    features = extract_features(bs)
    return Reading(
        features=features,
        emotions=_score_all(EMOTION_RULES, features),
        personas=_score_all(PERSONA_RULES, features),
        actions=_score_all(ACTION_RULES, features),
    )


class Smoother:
    """指數平滑，避免逐幀跳動。

    ``alpha`` 越大越靈敏、越小越穩定。虛擬人那邊的 expression controller 用的是
    遲滯（hysteresis）機制，這裡用最簡單的一階濾波即可。
    """

    def __init__(self, alpha: float = 0.35) -> None:
        if not 0.0 < alpha <= 1.0:
            raise ValueError("alpha 必須介於 0（不含）與 1 之間")
        self._alpha = alpha
        self._state: dict[str, float] = {}

    def update(self, bs: Blendshapes) -> dict[str, float]:
        for name, value in bs.items():
            previous = self._state.get(name, value)
            self._state[name] = previous + self._alpha * (value - previous)
        return dict(self._state)
