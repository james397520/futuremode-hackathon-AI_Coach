#!/usr/bin/env python3
"""Estimate where the eyes and mouth sit in an avatar portrait.

The static backend places its blink and mouth overlays by proportion, so a
portrait framed differently from the default puts the mouth on the philtrum.
Rather than asking anyone to guess fractions, this measures the picture and
writes them into `avatar.json -> geometry`.

The method is deliberately simple and has no model dependency: on an evenly lit
§71 portrait the eyes and the mouth are the two darkest horizontal bands in the
middle of the face, so a row-darkness profile finds them. It is a starting
point, not a landmark detector — always check the overlay it renders.

    python scripts/calibrate_avatar.py avatars/customer_001 [--write] [--preview out.png]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np


def _load(path: Path) -> np.ndarray:
    from PIL import Image

    return np.asarray(Image.open(path).convert("RGB"), dtype=np.float32)


def _fit(img: np.ndarray, height: int, width: int) -> np.ndarray:
    """Mirror StaticPortraitBackend._fit so the fractions match what it renders."""
    sh, sw = img.shape[:2]
    target_ar, src_ar = width / height, sw / sh
    if src_ar > target_ar:
        new_w = int(round(sh * target_ar))
        x0 = (sw - new_w) // 2
        img = img[:, x0 : x0 + new_w]
    elif src_ar < target_ar:
        img = img[0 : int(round(sw / target_ar)), :]
    sh, sw = img.shape[:2]
    ys = np.linspace(0, sh - 1, height).astype(int)
    xs = np.linspace(0, sw - 1, width).astype(int)
    return img[ys][:, xs]


def _skin_mask(rgb: np.ndarray) -> np.ndarray:
    """A permissive skin-tone mask, wide enough for varied complexions.

    Bounding the search to skin is what stops the estimate landing on eyebrows
    (darker than eyes) or on a dark collar (darker than lips). Pure row darkness
    finds the darkest thing in the frame, which is rarely the feature you want.
    """
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx = rgb.max(axis=2)
    mn = rgb.min(axis=2)
    return (
        (r > 60) & (r < 255)
        & (g > 35) & (b > 20)
        & (r > g) & (g >= b - 12)          # warm, red-dominant
        & ((mx - mn) > 12)                 # not grey: excludes shirts and walls
        & ((r - b) > 12)
    )


def _face_box(skin: np.ndarray, width: int, height: int) -> tuple[int, int]:
    """Vertical extent of the face: hairline-ish top to chin.

    The neck is skin too, so the chin is taken as the point where the skin band
    narrows sharply from its widest (cheeks) — that transition is the jaw.
    """
    centre_band = skin[:, int(width * 0.25) : int(width * 0.75)]
    per_row = centre_band.sum(axis=1).astype(np.float32)
    if per_row.max() < 4:
        return int(height * 0.20), int(height * 0.72)     # nothing found: defaults

    widest = int(np.argmax(per_row))
    peak = per_row[widest]

    top = widest
    while top > 0 and per_row[top] > peak * 0.35:
        top -= 1

    # Walk down from the cheeks until the band collapses to the neck's width.
    chin = widest
    limit = int(height * 0.95)
    while chin < limit - 1 and per_row[chin] > peak * 0.55:
        chin += 1
    return top, chin


#: YuNet, from the OpenCV Zoo. Apache-2.0 and ~230 KB, so unlike InsightFace
#: (§74: non-commercial research only) it can ship in a commercial deployment.
#: OpenCV 5 dropped `CascadeClassifier` from the Python API, and YuNet is the
#: better tool anyway: it returns five landmarks rather than a bounding box.
YUNET_FILENAME = "face_detection_yunet_2023mar.onnx"
YUNET_URL = (
    "https://github.com/opencv/opencv_zoo/raw/main/models/"
    "face_detection_yunet/face_detection_yunet_2023mar.onnx"
)


def _yunet_model(root: Path) -> Path | None:
    """Return the local model, fetching it once if absent."""
    path = root / "models" / YUNET_FILENAME
    if path.is_file():
        return path
    try:
        import urllib.request

        path.parent.mkdir(parents=True, exist_ok=True)
        urllib.request.urlopen(YUNET_URL, timeout=30)  # fail fast on no network
        urllib.request.urlretrieve(YUNET_URL, path)
        return path if path.is_file() else None
    except Exception:  # noqa: BLE001 - offline is fine, we fall back
        return None


def _detect_with_opencv(
    framed: np.ndarray, width: int, height: int, *, root: Path
) -> dict[str, float] | None:
    """Locate the face landmarks with YuNet.

    Runs against the *framed* image — the same crop-and-resize the backend does —
    so the fractions come out in the coordinate space the renderer uses rather
    than the source image's.

    Returns None when OpenCV or the model is unavailable, or no face is found,
    and the caller falls back: a calibration helper must never be the reason
    nothing works.
    """
    try:
        import cv2
    except Exception:  # noqa: BLE001 - optional extra
        return None

    model = _yunet_model(root)
    if model is None:
        return None

    bgr = cv2.cvtColor(framed.astype(np.uint8), cv2.COLOR_RGB2BGR)
    try:
        detector = cv2.FaceDetectorYN.create(str(model), "", (width, height), 0.6, 0.3, 5000)
        _, faces = detector.detect(bgr)
    except Exception:  # noqa: BLE001
        return None
    if faces is None or len(faces) == 0:
        return None

    face = max(faces, key=lambda f: f[2] * f[3])
    fx, fy, fw, fh = (float(v) for v in face[:4])
    # Landmark order is fixed: right eye, left eye, nose, right mouth corner,
    # left mouth corner. "Right" is the viewer's right.
    rex, rey, lex, ley = (float(v) for v in face[4:8])
    rmx, rmy, lmx, lmy = (float(v) for v in face[10:14])

    eye_y = (rey + ley) / 2
    centre_x = (rex + lex) / 2
    eye_dx = abs(lex - rex) / 2
    mouth_y = (rmy + lmy) / 2
    mouth_half_width = abs(lmx - rmx) / 2

    return {
        "eye_y": round(float(np.clip(eye_y / height, 0.10, 0.80)), 4),
        "mouth_y": round(float(np.clip(mouth_y / height, 0.20, 0.92)), 4),
        "eye_dx": round(float(np.clip(eye_dx / width, 0.045, 0.14)), 4),
        "centre_x": round(float(np.clip(centre_x / width, 0.30, 0.70)), 4),
        # Mouth width from the corners, so a wide or narrow mouth is not forced
        # into the default ellipse. Padded slightly: the overlay should reach a
        # little past the corners, not stop short of them.
        "mouth_rx": round(float(np.clip((mouth_half_width * 1.15) / width, 0.030, 0.110)), 4),
        "_method": "yunet",
        "_face_top": round(fy / height, 4),
        "_face_chin": round((fy + fh) / height, 4),
    }


def calibrate(portrait: Path, *, width: int = 384, height: int = 512) -> dict[str, float]:
    framed = _fit(_load(portrait), height, width)

    detected = _detect_with_opencv(framed, width, height, root=Path(__file__).resolve().parent.parent)
    if detected is not None:
        return detected

    grey = framed.mean(axis=2)
    skin = _skin_mask(framed)
    top, chin = _face_box(skin, width, height)
    span = max(1, chin - top)

    # Canonical face proportions, applied to the *detected* box rather than to
    # the whole frame, so the estimate follows the framing instead of assuming it.
    eye_guess = top + int(span * 0.42)
    mouth_guess = top + int(span * 0.76)

    x0, x1 = int(width * 0.34), int(width * 0.66)
    profile = grey[:, x0:x1].mean(axis=1)
    k = max(3, span // 20)
    baseline = np.convolve(profile, np.ones(k) / k, mode="same")
    darkness = baseline - profile
    # Only rows that are mostly skin can hold a feature.
    skin_rows = skin[:, x0:x1].mean(axis=1) > 0.35

    def refine(guess: int, radius: int) -> int:
        lo, hi = max(top, guess - radius), min(chin, guess + radius + 1)
        if hi - lo < 3:
            return guess
        window = darkness[lo:hi].copy()
        window[~skin_rows[lo:hi]] = -np.inf
        if not np.isfinite(window).any():
            return guess
        return lo + int(np.argmax(window))

    # Tight radii: the proportions are already close, and a wide search is how
    # the eyebrow and the collar won last time.
    eye_y = refine(eye_guess, max(4, span // 14))
    mouth_y = refine(mouth_guess, max(4, span // 16))

    # Eye separation: darkest column either side of centre, on the eye row.
    row = grey[max(0, eye_y - 2) : eye_y + 3].mean(axis=0)
    centre = width // 2
    left_lo, right_hi = int(width * 0.24), int(width * 0.76)
    left = left_lo + int(np.argmin(row[left_lo:centre]))
    right = centre + int(np.argmin(row[centre:right_hi]))
    eye_dx = float(np.clip(((right - left) / 2) / width, 0.045, 0.12))

    return {
        "eye_y": round(eye_y / height, 4),
        "mouth_y": round(mouth_y / height, 4),
        "eye_dx": round(eye_dx, 4),
        "centre_x": round(((left + right) / 2) / width, 4),
        "_method": "heuristic",
        "_face_top": round(top / height, 4),
        "_face_chin": round(chin / height, 4),
    }


def write_preview(portrait: Path, geometry: dict[str, float], out: Path, *, width: int, height: int) -> None:
    """Draw the estimated feature positions so a human can check them."""
    from PIL import Image, ImageDraw

    framed = _fit(_load(portrait), height, width).astype(np.uint8)
    img = Image.fromarray(framed)
    d = ImageDraw.Draw(img)
    cx = geometry["centre_x"] * width
    ey = geometry["eye_y"] * height
    my = geometry["mouth_y"] * height
    dx = geometry["eye_dx"] * width
    for sign in (-1, 1):
        x = cx + sign * dx
        d.ellipse([x - width * 0.038, ey - height * 0.020, x + width * 0.038, ey + height * 0.020],
                  outline=(0, 200, 255), width=2)
    mrx = geometry.get("mouth_rx", 0.052) * width
    d.ellipse([cx - mrx, my - height * 0.017, cx + mrx, my + height * 0.017],
              outline=(255, 90, 120), width=2)
    d.line([(0, ey), (width, ey)], fill=(0, 200, 255), width=1)
    d.line([(0, my), (width, my)], fill=(255, 90, 120), width=1)
    img.save(out)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("avatar_dir", type=Path)
    ap.add_argument("--write", action="store_true", help="write into avatar.json")
    ap.add_argument("--preview", type=Path, help="save an annotated image to check the estimate")
    ap.add_argument("--width", type=int, default=384)
    ap.add_argument("--height", type=int, default=512)
    args = ap.parse_args()

    manifest_path = args.avatar_dir / "avatar.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    rel = (manifest.get("source") or {}).get("image", "source/portrait.png")
    portrait = args.avatar_dir / rel
    if not portrait.is_file():
        print(f"no portrait at {portrait}", file=sys.stderr)
        return 1

    geometry = calibrate(portrait, width=args.width, height=args.height)
    print(json.dumps(geometry, indent=2))
    for key, default in (("eye_y", 0.425), ("mouth_y", 0.605)):
        delta = geometry[key] - default
        if abs(delta) > 0.02:
            print(f"  note: {key} is {delta:+.3f} from the default framing", file=sys.stderr)

    if args.preview:
        write_preview(portrait, geometry, args.preview, width=args.width, height=args.height)
        print(f"preview: {args.preview}")

    if args.write:
        # `_`-prefixed entries are diagnostics for the preview, not contract keys.
        manifest["geometry"] = {k: v for k, v in geometry.items() if not k.startswith("_")}
        manifest_path.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        print(f"written to {manifest_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
