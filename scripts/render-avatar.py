# SPDX-FileCopyrightText: 2026 tBeltty
#
# SPDX-License-Identifier: GPL-3.0-or-later

"""Renders the app icon: a 3D d20 from the dice renderer on a dark backdrop.

Usage: python3 scripts/render-avatar.py <path-to-bold-font.ttf> <variant> <output.png>
Variants: indigo, gold, ivory.

Slack app icons must be square, 512 to 2000 px. The die stays inside the central 70% so
Slack's rounded corners never clip it.
"""

import importlib.util
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image

OUT = 1024
WORK = 2048  # drawn at twice the output size, then downscaled

spec = importlib.util.spec_from_file_location("dice", Path(__file__).with_name("render-dice.py"))
dice = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dice)

# Re-scale the renderer to the icon size before any solid is built.
dice.S = int(WORK * 0.74)
dice.RADIUS = dice.S * 0.43
dice.MAX_HALF_EXTENT = dice.S * 0.46
dice.FONT_SIZE = {1: dice.S * 0.25, 2: dice.S * 0.25, 3: dice.S * 0.2}

VARIANTS = {
    "indigo": {"die": dice.PALETTES["regular"], "glow": (74, 64, 170), "edge": (14, 12, 30)},
    "gold": {"die": dice.PALETTES["crit"], "glow": (92, 70, 150), "edge": (16, 13, 34)},
    "ivory": {
        "die": {"base": (232, 226, 212), "number": (40, 34, 86), "gloss": (255, 255, 255), "spec": 0.5},
        "glow": (70, 62, 160),
        "edge": (14, 12, 30),
    },
}


def backdrop(glow, edge):
    """A radial glow behind the die, fading to a deep edge color."""
    yy, xx = np.mgrid[0:WORK, 0:WORK].astype(float)
    r = np.sqrt((xx - WORK / 2) ** 2 + (yy - WORK * 0.47) ** 2) / (WORK * 0.62)
    t = np.clip(r, 0, 1) ** 1.4
    glow, edge = np.array(glow, float), np.array(edge, float)
    rgb = glow[None, None, :] * (1 - t[:, :, None]) + edge[None, None, :] * t[:, :, None]
    return Image.fromarray(rgb.astype(np.uint8), "RGB").convert("RGBA")


def shadow(die_img):
    """A soft contact shadow under the die, from its own silhouette."""
    alpha = die_img.getchannel("A").point(lambda a: int(a * 0.45))
    blurred = Image.new("RGBA", die_img.size, (0, 0, 0, 0))
    blurred.putalpha(alpha)
    from PIL import ImageFilter

    return blurred.filter(ImageFilter.GaussianBlur(dice.S * 0.03))


def main():
    font, variant, out = sys.argv[1], sys.argv[2], sys.argv[3]
    v = VARIANTS[variant]
    solid = dice.solid(20)
    die = dice.draw_solid(solid, v["die"], {solid.front: "20"}, font)

    canvas = backdrop(v["glow"], v["edge"])
    x = (WORK - die.width) // 2
    y = (WORK - die.height) // 2 - int(WORK * 0.01)
    canvas.alpha_composite(shadow(die), (x, y + int(WORK * 0.035)))
    canvas.alpha_composite(die, (x, y))
    canvas.convert("RGB").resize((OUT, OUT), Image.LANCZOS).save(out, optimize=True)


if __name__ == "__main__":
    main()
