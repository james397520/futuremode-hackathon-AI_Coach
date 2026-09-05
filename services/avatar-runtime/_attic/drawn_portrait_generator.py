"""Synthetic, licence-clean portrait for the demo avatar (avatar spec §71/§73).

Drawn from scratch: no third-party asset, nobody's likeness, so §73 (self-made /
synthetic only) and §74 (InsightFace non-commercial) are both sidestepped.

Built in layers on a supersampled canvas, then downsampled — that is what keeps the
edges clean instead of the stair-stepping you get drawing straight at final size.
"""
from __future__ import annotations
from PIL import Image, ImageDraw, ImageFilter

SS = 3                      # supersample factor
S = 1024
W = S * SS

SKIN      = (231, 196, 172)
SKIN_MID  = (214, 176, 152)
SKIN_DEEP = (190, 150, 128)
BLUSH     = (214, 162, 148)
HAIR      = (52, 41, 40)
HAIR_SOFT = (72, 58, 56)
SHIRT     = (82, 100, 136)
SHIRT_DK  = (60, 75, 108)
COLLAR    = (240, 243, 250)
LIP       = (176, 116, 108)
BROW      = (60, 47, 45)


def vgrad(size, top, bot):
    g = Image.new("RGB", (1, size[1]))
    px = g.load()
    for y in range(size[1]):
        t = y / max(1, size[1] - 1)
        px[0, y] = tuple(round(top[i] + (bot[i] - top[i]) * t) for i in range(3))
    return g.resize(size, Image.BILINEAR)


def ell(d, cx, cy, rx, ry, fill):
    d.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=fill)


bg = vgrad((W, W), (233, 239, 251), (206, 218, 238))
canvas = bg.convert("RGBA")

cx = W * 0.5
hy, hrx, hry = W * 0.435, W * 0.170, W * 0.218   # head centre + radii

# ---------------------------------------------------------------- body layer
body = Image.new("RGBA", (W, W), (0, 0, 0, 0))
b = ImageDraw.Draw(body)
# torso: rounded trapezoid reads as shoulders, not a flat disc
b.rounded_rectangle([cx - W * 0.330, W * 0.815, cx + W * 0.330, W * 1.30],
                    radius=W * 0.150, fill=SHIRT)
b.rounded_rectangle([cx - W * 0.235, W * 0.790, cx + W * 0.235, W * 1.20],
                    radius=W * 0.120, fill=SHIRT)
# shoulder shading toward the light-away side
b.ellipse([cx + W * 0.11, W * 0.84, cx + W * 0.39, W * 1.30], fill=SHIRT_DK)
body = body.filter(ImageFilter.GaussianBlur(W * 0.003))
canvas = Image.alpha_composite(canvas, body)

# ---------------------------------------------------------------- neck
neck = Image.new("RGBA", (W, W), (0, 0, 0, 0))
n = ImageDraw.Draw(neck)
# tapered: narrower at the jaw, widening into the trapezius
n.polygon([(cx - W * 0.055, hy + hry * 0.74), (cx + W * 0.055, hy + hry * 0.74),
           (cx + W * 0.080, W * 0.842), (cx - W * 0.080, W * 0.842)], fill=SKIN_MID)
ell(n, cx, W * 0.838, W * 0.080, W * 0.026, SKIN_MID)
neck = neck.filter(ImageFilter.GaussianBlur(W * 0.004))
canvas = Image.alpha_composite(canvas, neck)

# jaw shadow cast onto the neck
sh = Image.new("RGBA", (W, W), (0, 0, 0, 0))
ImageDraw.Draw(sh).ellipse([cx - W * 0.092, hy + hry * 0.62, cx + W * 0.092, hy + hry * 1.00],
                           fill=SKIN_DEEP + (200,))
canvas = Image.alpha_composite(canvas, sh.filter(ImageFilter.GaussianBlur(W * 0.020)))

# ---------------------------------------------------------------- collar
col = Image.new("RGBA", (W, W), (0, 0, 0, 0))
c = ImageDraw.Draw(col)
c.polygon([(cx - W * 0.088, W * 0.826), (cx, W * 0.906), (cx + W * 0.088, W * 0.826),
           (cx + W * 0.118, W * 0.852), (cx, W * 0.958), (cx - W * 0.118, W * 0.852)],
          fill=COLLAR)
canvas = Image.alpha_composite(canvas, col.filter(ImageFilter.GaussianBlur(W * 0.002)))

# ---------------------------------------------------------------- ears
ear = Image.new("RGBA", (W, W), (0, 0, 0, 0))
e = ImageDraw.Draw(ear)
for sx in (-1, 1):
    ell(e, cx + sx * hrx * 0.955, hy + hry * 0.10, W * 0.030, W * 0.050, SKIN_MID)
    ell(e, cx + sx * hrx * 0.955, hy + hry * 0.10, W * 0.016, W * 0.028, SKIN_DEEP)
canvas = Image.alpha_composite(canvas, ear.filter(ImageFilter.GaussianBlur(W * 0.003)))

# ---------------------------------------------------------------- head
face = Image.new("RGBA", (W, W), (0, 0, 0, 0))
f = ImageDraw.Draw(face)
ell(f, cx, hy, hrx, hry * 0.96, SKIN)
# jaw: narrower than the cranium and rounded at the chin
f.polygon([(cx - hrx * 0.97, hy - hry * 0.05), (cx + hrx * 0.97, hy - hry * 0.05),
           (cx + hrx * 0.62, hy + hry * 0.86), (cx, hy + hry * 1.03),
           (cx - hrx * 0.62, hy + hry * 0.86)], fill=SKIN)
ell(f, cx, hy + hry * 0.80, hrx * 0.58, hry * 0.26, SKIN)
face = face.filter(ImageFilter.GaussianBlur(W * 0.0035))
canvas = Image.alpha_composite(canvas, face)

# form shading: light upper-left, so the right cheek and jaw fall off
shade = Image.new("RGBA", (W, W), (0, 0, 0, 0))
s_ = ImageDraw.Draw(shade)
s_.ellipse([cx + hrx * 0.24, hy - hry * 0.62, cx + hrx * 1.30, hy + hry * 0.96],
           fill=SKIN_MID + (170,))
s_.ellipse([cx - hrx * 0.55, hy + hry * 0.52, cx + hrx * 0.55, hy + hry * 1.16],
           fill=SKIN_MID + (90,))
canvas = Image.alpha_composite(canvas, shade.filter(ImageFilter.GaussianBlur(W * 0.030)))

# cheek warmth
bl = Image.new("RGBA", (W, W), (0, 0, 0, 0))
bd = ImageDraw.Draw(bl)
for sx in (-1, 1):
    ell(bd, cx + sx * hrx * 0.56, hy + hry * 0.34, hrx * 0.26, hry * 0.17, BLUSH + (70,))
canvas = Image.alpha_composite(canvas, bl.filter(ImageFilter.GaussianBlur(W * 0.026)))

# ---------------------------------------------------------------- hair
hair = Image.new("RGBA", (W, W), (0, 0, 0, 0))
h = ImageDraw.Draw(hair)
# cranium cap
h.ellipse([cx - hrx * 1.06, hy - hry * 1.18, cx + hrx * 1.06, hy - hry * 0.10], fill=HAIR)
# temple fall: hugs the outside of the head, never crosses onto the cheek
h.ellipse([cx - hrx * 1.08, hy - hry * 0.86, cx - hrx * 0.76, hy + hry * 0.10], fill=HAIR)
h.ellipse([cx + hrx * 0.76, hy - hry * 0.86, cx + hrx * 1.08, hy + hry * 0.10], fill=HAIR)
# swept fringe — every point stays above hy - hry*0.44, i.e. above the brows
h.polygon([(cx - hrx * 1.02, hy - hry * 0.52), (cx - hrx * 0.74, hy - hry * 0.94),
           (cx + hrx * 0.10, hy - hry * 1.04), (cx + hrx * 0.94, hy - hry * 0.72),
           (cx + hrx * 1.02, hy - hry * 0.46), (cx + hrx * 0.26, hy - hry * 0.80),
           (cx - hrx * 0.44, hy - hry * 0.62)], fill=HAIR)
hair = hair.filter(ImageFilter.GaussianBlur(W * 0.004))
canvas = Image.alpha_composite(canvas, hair)

# hair sheen: a broad soft band along the parting, not a disc
sheen = Image.new("RGBA", (W, W), (0, 0, 0, 0))
ImageDraw.Draw(sheen).polygon(
    [(cx - hrx * 0.74, hy - hry * 0.84), (cx - hrx * 0.20, hy - hry * 1.00),
     (cx + hrx * 0.18, hy - hry * 0.90), (cx - hrx * 0.30, hy - hry * 0.72)],
    fill=HAIR_SOFT + (150,))
canvas = Image.alpha_composite(canvas, sheen.filter(ImageFilter.GaussianBlur(W * 0.020)))

# ---------------------------------------------------------------- features
ft = Image.new("RGBA", (W, W), (0, 0, 0, 0))
g = ImageDraw.Draw(ft)
eye_y = hy - hry * 0.04
eye_dx = hrx * 0.415
GAZE = W * 0.005          # §71: a few degrees toward the page

for sx in (-1, 1):
    ex = cx + sx * eye_dx
    # socket depth
    g.ellipse([ex - hrx * 0.30, eye_y - hry * 0.20, ex + hrx * 0.30, eye_y + hry * 0.16],
              fill=SKIN_MID + (90,))
    # sclera
    ell(g, ex, eye_y, hrx * 0.212, hry * 0.104, (252, 251, 250))
    # iris + pupil
    ell(g, ex + GAZE, eye_y, hrx * 0.098, hry * 0.092, (94, 112, 132))
    ell(g, ex + GAZE, eye_y, hrx * 0.094, hry * 0.088, (74, 92, 112))
    ell(g, ex + GAZE, eye_y, hrx * 0.044, hry * 0.042, (24, 26, 32))
    ell(g, ex + GAZE - hrx * 0.032, eye_y - hry * 0.030, hrx * 0.022, hry * 0.020,
        (255, 255, 255, 235))
    # upper lash line, heavier than the lower
    g.arc([ex - hrx * 0.222, eye_y - hry * 0.135, ex + hrx * 0.222, eye_y + hry * 0.115],
          start=188, end=352, fill=(58, 46, 44), width=int(W * 0.0055))
    # brow: tapered, angled slightly down toward the nose
    g.polygon([(ex - sx * hrx * 0.30, eye_y - hry * 0.36),
               (ex + sx * hrx * 0.26, eye_y - hry * 0.30),
               (ex + sx * hrx * 0.26, eye_y - hry * 0.245),
               (ex - sx * hrx * 0.30, eye_y - hry * 0.275)], fill=BROW)

# nose: bridge shadow + a soft tip, no hard outline
g.polygon([(cx - hrx * 0.055, hy + hry * 0.30), (cx + hrx * 0.055, hy + hry * 0.30),
           (cx + hrx * 0.030, hy - hry * 0.10), (cx - hrx * 0.030, hy - hry * 0.10)],
          fill=SKIN_MID + (110,))
ell(g, cx, hy + hry * 0.32, hrx * 0.088, hry * 0.058, SKIN_MID + (150,))
for sx in (-1, 1):
    ell(g, cx + sx * hrx * 0.082, hy + hry * 0.335, hrx * 0.026, hry * 0.020,
        SKIN_DEEP + (170,))

# mouth: relaxed and closed — the runtime drives openness from audio RMS
my = hy + hry * 0.615
g.arc([cx - hrx * 0.255, my - hry * 0.115, cx + hrx * 0.255, my + hry * 0.105],
      start=12, end=168, fill=LIP, width=int(W * 0.0065))
ell(g, cx, my + hry * 0.075, hrx * 0.185, hry * 0.052, BLUSH + (85,))
# philtrum shadow
ell(g, cx, my - hry * 0.14, hrx * 0.05, hry * 0.05, SKIN_MID + (70,))

ft = ft.filter(ImageFilter.GaussianBlur(W * 0.0022))
canvas = Image.alpha_composite(canvas, ft)

out = canvas.convert("RGB").resize((S, S), Image.LANCZOS)
out.save("/private/tmp/claude-501/-Library-work-futuremode-rmrf2/0d558077-9b85-495b-ae29-9b3ec8ad5b5c/scratchpad/portrait.png")
print("saved", out.size)
