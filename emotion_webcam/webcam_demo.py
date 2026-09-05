"""用 MediaPipe Face Landmarker 的 blendshape 即時判斷表情。

用法：

    python webcam_demo.py                 # 開攝影機即時判讀
    python webcam_demo.py --image a.jpg   # 判讀單張圖片
    python webcam_demo.py --list-rules    # 印出所有支援的表情規則，不需要攝影機
    python webcam_demo.py --csv out.csv   # 同時把每幀 52 個分數寫成 CSV

鍵盤：``q`` 離開、``b`` 切換 blendshape 長條圖、``a`` 切換臉部動作列表、
``space`` 暫停。

模型檔第一次執行會自動下載到本資料夾（約 3.7 MB）。
"""

from __future__ import annotations

import argparse
import csv
import sys
import time
import urllib.request
from pathlib import Path
from typing import Optional

from blendshape_reference import BLENDSHAPE_ZH, MP_BLENDSHAPE_NAMES
from expressions import ALL_RULE_SETS, Reading, Smoother, classify

MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/"
    "face_landmarker/float16/1/face_landmarker.task"
)
MODEL_FILENAME = "face_landmarker.task"

# BGR，配合 OpenCV。
COLOR_BG = (18, 18, 18)
COLOR_TEXT = (240, 240, 240)
COLOR_DIM = (140, 140, 140)
COLOR_ACCENT = (237, 149, 100)
COLOR_BAR = (200, 160, 90)


def ensure_model(path: Path) -> Path:
    """模型不存在就下載。"""
    if path.exists():
        return path
    print(f"下載模型到 {path} ...", flush=True)
    path.parent.mkdir(parents=True, exist_ok=True)
    urllib.request.urlretrieve(MODEL_URL, path)  # noqa: S310 - 固定的 Google 官方網址
    print(f"完成（{path.stat().st_size / 1_000_000:.1f} MB）", flush=True)
    return path


def build_landmarker(model_path: Path, video_mode: bool):
    """建立 FaceLandmarker。mediapipe 只在這裡 import，方便無相依測試其他模組。"""
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision

    running_mode = vision.RunningMode.VIDEO if video_mode else vision.RunningMode.IMAGE
    options = vision.FaceLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=str(model_path)),
        running_mode=running_mode,
        output_face_blendshapes=True,
        output_facial_transformation_matrixes=False,
        num_faces=1,
    )
    return vision.FaceLandmarker.create_from_options(options)


def blendshapes_to_dict(detection_result) -> dict[str, float]:
    """把偵測結果整理成 ``{category_name: score}``；沒偵測到臉就回空 dict。"""
    if not detection_result.face_blendshapes:
        return {}
    return {
        category.category_name: float(category.score)
        for category in detection_result.face_blendshapes[0]
    }


# --------------------------------------------------------------------------
# 畫面繪製
# --------------------------------------------------------------------------

def _put(frame, text: str, org: tuple[int, int], scale: float = 0.5, color=COLOR_TEXT, thickness: int = 1) -> None:
    import cv2

    cv2.putText(frame, text, org, cv2.FONT_HERSHEY_SIMPLEX, scale, color, thickness, cv2.LINE_AA)


def draw_overlay(
    frame,
    reading: Optional[Reading],
    raw: dict[str, float],
    fps: float,
    show_bars: bool,
    show_actions: bool,
) -> None:
    """把判讀結果畫到畫面上。

    中文字型 OpenCV 畫不出來，因此畫面上一律用英文標籤，中文只出現在終端機輸出。
    """
    import cv2

    height, width = frame.shape[:2]
    panel_w = 330
    overlay = frame.copy()
    cv2.rectangle(overlay, (0, 0), (panel_w, height), COLOR_BG, -1)
    cv2.addWeighted(overlay, 0.78, frame, 0.22, 0, frame)

    y = 30
    _put(frame, f"FPS {fps:4.1f}", (14, y), 0.5, COLOR_DIM)
    y += 28

    if reading is None:
        _put(frame, "No face detected", (14, y), 0.6, COLOR_ACCENT)
        return

    top_emotion = reading.top_emotion
    _put(frame, "EMOTION", (14, y), 0.45, COLOR_DIM)
    y += 26
    _put(frame, f"{top_emotion.rule.label_en} {top_emotion.score:.2f}", (14, y), 0.85, COLOR_ACCENT, 2)
    y += 30
    for scored in reading.emotions[1:4]:
        _put(frame, f"{scored.rule.label_en:<12} {scored.score:.2f}", (14, y), 0.45, COLOR_DIM)
        y += 20

    y += 12
    top_persona = reading.top_persona
    _put(frame, "PERSONA (avatar-runtime)", (14, y), 0.45, COLOR_DIM)
    y += 26
    _put(frame, f"{top_persona.rule.label_en} {top_persona.score:.2f}", (14, y), 0.7, COLOR_TEXT, 2)
    y += 26
    for scored in reading.personas[1:3]:
        _put(frame, f"{scored.rule.label_en:<12} {scored.score:.2f}", (14, y), 0.45, COLOR_DIM)
        y += 20

    if show_actions:
        y += 12
        _put(frame, "ACTIONS", (14, y), 0.45, COLOR_DIM)
        y += 22
        active = reading.active_actions[:8]
        if not active:
            _put(frame, "(none above threshold)", (14, y), 0.42, COLOR_DIM)
            y += 18
        for scored in active:
            _put(frame, f"{scored.rule.label_en:<18} {scored.score:.2f}", (14, y), 0.42, COLOR_TEXT)
            y += 18

    if show_bars and raw:
        y += 14
        _put(frame, "TOP BLENDSHAPES", (14, y), 0.45, COLOR_DIM)
        y += 20
        ranked = sorted(raw.items(), key=lambda kv: kv[1], reverse=True)
        for name, value in ranked[:10]:
            if name == "_neutral":
                continue
            bar_w = int(value * 150)
            cv2.rectangle(frame, (150, y - 8), (150 + bar_w, y - 1), COLOR_BAR, -1)
            _put(frame, f"{name[:20]:<20}", (14, y), 0.38, COLOR_TEXT)
            _put(frame, f"{value:.2f}", (306, y), 0.38, COLOR_DIM)
            y += 16
            if y > height - 20:
                break

    _put(frame, "q quit  b bars  a actions  space pause", (14, height - 14), 0.4, COLOR_DIM)


def print_reading(reading: Reading) -> None:
    """在終端機印出中文判讀結果（畫面上因字型限制只能顯示英文）。"""
    top_e = reading.top_emotion
    top_p = reading.top_persona
    actions = "、".join(s.rule.label_zh for s in reading.active_actions[:6]) or "無"
    print(
        f"情緒 {top_e.rule.label_zh}({top_e.score:.2f})  "
        f"人設 {top_p.rule.label_zh}({top_p.score:.2f})  "
        f"動作 {actions}",
        flush=True,
    )


# --------------------------------------------------------------------------
# 進入點
# --------------------------------------------------------------------------

def list_rules() -> None:
    """印出所有規則，不需要 mediapipe 或攝影機。"""
    for set_name, rules in ALL_RULE_SETS.items():
        print(f"\n=== {set_name}（{len(rules)} 條）===")
        for rule in rules:
            cues = "；".join(rule.cues) if rule.cues else "-"
            print(f"  {rule.key:<18} {rule.label_zh:<8} {rule.label_en:<18} 門檻 {rule.threshold:.2f}  ← {cues}")
    total = sum(len(rules) for rules in ALL_RULE_SETS.values())
    print(f"\n合計 {total} 條規則，輸入為 {len(MP_BLENDSHAPE_NAMES)} 個 blendshape 分數")


def run_image(args: argparse.Namespace) -> int:
    import cv2
    import mediapipe as mp

    model_path = ensure_model(Path(args.model))
    landmarker = build_landmarker(model_path, video_mode=False)

    frame = cv2.imread(args.image)
    if frame is None:
        print(f"讀不到圖片：{args.image}", file=sys.stderr)
        return 1

    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
    result = landmarker.detect(mp_image)
    raw = blendshapes_to_dict(result)

    if not raw:
        print("這張圖片沒有偵測到臉。", file=sys.stderr)
        return 1

    reading = classify(raw)
    print_reading(reading)
    print("\n--- 52 個 blendshape 分數 ---")
    for name in MP_BLENDSHAPE_NAMES:
        value = raw.get(name, 0.0)
        bar = "█" * int(value * 30)
        print(f"{name:<22} {value:5.3f} {bar}  {BLENDSHAPE_ZH.get(name, '')}")

    draw_overlay(frame, reading, raw, fps=0.0, show_bars=True, show_actions=True)
    out_path = Path(args.image).with_suffix(".annotated.png")
    cv2.imwrite(str(out_path), frame)
    print(f"\n已輸出標註圖：{out_path}")
    return 0


def run_webcam(args: argparse.Namespace) -> int:
    import cv2
    import mediapipe as mp

    model_path = ensure_model(Path(args.model))
    landmarker = build_landmarker(model_path, video_mode=True)

    capture = cv2.VideoCapture(args.camera)
    if not capture.isOpened():
        print(f"打不開攝影機 index={args.camera}", file=sys.stderr)
        return 1

    smoother = Smoother(alpha=args.alpha)
    csv_writer = None
    csv_file = None
    if args.csv:
        csv_file = open(args.csv, "w", newline="", encoding="utf-8")
        csv_writer = csv.writer(csv_file)
        csv_writer.writerow(["timestamp_ms", "emotion", "persona", *MP_BLENDSHAPE_NAMES])

    show_bars = True
    show_actions = True
    paused = False
    fps = 0.0
    last_time = time.perf_counter()
    started = time.perf_counter()

    try:
        while True:
            if not paused:
                ok, frame = capture.read()
                if not ok:
                    print("讀不到影格，結束。", file=sys.stderr)
                    break
                frame = cv2.flip(frame, 1)  # 鏡像，比較符合使用者直覺

                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
                timestamp_ms = int((time.perf_counter() - started) * 1000)
                result = landmarker.detect_for_video(mp_image, timestamp_ms)

                raw = blendshapes_to_dict(result)
                reading = None
                if raw:
                    smoothed = smoother.update(raw)
                    reading = classify(smoothed)
                    if csv_writer is not None:
                        csv_writer.writerow(
                            [
                                timestamp_ms,
                                reading.top_emotion.rule.key,
                                reading.top_persona.rule.key,
                                *[f"{smoothed.get(n, 0.0):.4f}" for n in MP_BLENDSHAPE_NAMES],
                            ]
                        )

                now = time.perf_counter()
                fps = 0.9 * fps + 0.1 * (1.0 / max(now - last_time, 1e-6))
                last_time = now

                draw_overlay(frame, reading, raw, fps, show_bars, show_actions)
                cv2.imshow("SkillCoach - blendshape expression demo", frame)

            key = cv2.waitKey(1) & 0xFF
            if key == ord("q"):
                break
            if key == ord("b"):
                show_bars = not show_bars
            if key == ord("a"):
                show_actions = not show_actions
            if key == ord(" "):
                paused = not paused
    finally:
        capture.release()
        cv2.destroyAllWindows()
        if csv_file is not None:
            csv_file.close()
            print(f"已寫入 {args.csv}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="MediaPipe blendshape 表情判讀範例")
    parser.add_argument("--camera", type=int, default=0, help="攝影機 index（預設 0）")
    parser.add_argument("--image", help="改為判讀單張圖片")
    parser.add_argument("--model", default=MODEL_FILENAME, help="模型檔路徑")
    parser.add_argument("--csv", help="把每幀分數寫成 CSV")
    parser.add_argument("--alpha", type=float, default=0.35, help="平滑係數，越小越穩定（預設 0.35）")
    parser.add_argument("--list-rules", action="store_true", help="列出所有表情規則後結束")
    args = parser.parse_args()

    if args.list_rules:
        list_rules()
        return 0
    if args.image:
        return run_image(args)
    return run_webcam(args)


if __name__ == "__main__":
    raise SystemExit(main())
