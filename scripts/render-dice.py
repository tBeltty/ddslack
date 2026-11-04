"""Renders the die images into assets/dice/ from one 3D style spec.

Usage: python3 scripts/render-dice.py <path-to-bold-font.ttf> [--sheet <contact-sheet.png>]

Each die is a real polyhedron (tetrahedron, cube, octahedron, pentagonal trapezohedron,
dodecahedron, icosahedron; an 80-face geodesic ball for the d100), turned so one face looks
at the camera and ray-marched as a solid with softly rounded edges. One point light gives each
face a gradient and a glossy highlight, and the numbers are engraved into the faces. Every
image shares the light, camera, size, palette and number style, so only the solid tells the
die types apart.

Outputs one PNG per face, a larger PNG for the natural 20 and natural 1 celebrations, one
looping GIF per die that tumbles in 3D while a roll is revealed (plus strips of two and three
dice tumbling out of step), and the "+N" badges shown when a roll has more dice than fit.
"""

import argparse
import itertools
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

SIZE = 160
SCALE = 4
S = SIZE * SCALE
RADIUS = S * 0.43  # reference circle; every silhouette covers a share of its area
MAX_HALF_EXTENT = S * 0.46  # half the width or height of the silhouette, inside the canvas
TUMBLE_FIT = 0.94  # share of the half canvas a tumbling die's sphere of turn may use
PHI = (1 + 5**0.5) / 2

# One point light for every die, up and to the left, in front (x right, y up, z to the camera).
# Positions are in canvas units so a larger render (the app icon) keeps the same look.
LIGHT_AT = np.array([-0.95, 1.25, 2.4])
AMBIENT = 0.42
DIFFUSE = 0.68
FRESNEL = 40  # brightens faces turned away from the camera, like a glossy rim
BEVEL = 0.0035  # edge softness, as a share of the canvas

PALETTES = {
    "regular": {"base": (86, 76, 196), "number": (250, 250, 255), "gloss": (255, 255, 255), "spec": 0.45},
    "crit": {"base": (226, 166, 38), "number": (60, 40, 0), "gloss": (255, 236, 180), "spec": 0.75},
    "fumble": {"base": (196, 52, 64), "number": (255, 245, 245), "gloss": (255, 222, 222), "spec": 0.5},
}
SHININESS = 90

# Numbers keep one size for one or two digits and a smaller one for three, on every die.
FONT_SIZE = {1: S * 0.25, 2: S * 0.25, 3: S * 0.2}

DICE = {4: "d4", 6: "d6", 8: "d8", 10: "d10", 12: "d12", 20: "d20", 100: "d100"}

ROLL_FRAMES = 16
ROLL_FRAME_MS = 60
ROLL_AXIS = np.array([0.62, 0.74, 0.26])


# --- geometry ---------------------------------------------------------------------------


def unit(v):
    return v / np.linalg.norm(v)


def rotation(axis, angle):
    """Rodrigues rotation matrix."""
    x, y, z = unit(np.asarray(axis, dtype=float))
    c, s = math.cos(angle), math.sin(angle)
    return np.array(
        [
            [c + x * x * (1 - c), x * y * (1 - c) - z * s, x * z * (1 - c) + y * s],
            [y * x * (1 - c) + z * s, c + y * y * (1 - c), y * z * (1 - c) - x * s],
            [z * x * (1 - c) - y * s, z * y * (1 - c) + x * s, c + z * z * (1 - c)],
        ]
    )


def align(v, target):
    """Rotation matrix turning direction v onto direction target."""
    v, target = unit(v), unit(target)
    axis = np.cross(v, target)
    if np.linalg.norm(axis) < 1e-9:
        return np.eye(3) if np.dot(v, target) > 0 else rotation([1, 0, 0], math.pi)
    return rotation(axis, math.acos(np.clip(np.dot(v, target), -1, 1)))


def hull_faces(points):
    """Faces of a convex polyhedron as vertex index lists ordered around their centroid."""
    faces, seen = [], set()
    for i, j, k in itertools.combinations(range(len(points)), 3):
        normal = np.cross(points[j] - points[i], points[k] - points[i])
        if np.linalg.norm(normal) < 1e-9:
            continue
        normal = unit(normal)
        side = points @ normal - np.dot(normal, points[i])
        if np.all(side >= -1e-6):
            normal, side = -normal, -side
        elif not np.all(side <= 1e-6):
            continue
        on = tuple(sorted(int(n) for n in np.flatnonzero(np.abs(side) < 1e-6)))
        if on in seen:
            continue
        seen.add(on)
        center = points[list(on)].mean(axis=0)
        u = unit(points[on[0]] - center)
        v = np.cross(normal, u)
        ordered = sorted(on, key=lambda n: math.atan2(np.dot(points[n] - center, v), np.dot(points[n] - center, u)))
        faces.append(ordered)
    return faces


def trapezohedron():
    """Pentagonal trapezohedron (d10) with planar kite faces."""
    z0 = 0.11
    upper = [np.array([math.cos(math.radians(72 * k)), math.sin(math.radians(72 * k)), z0]) for k in range(5)]
    lower = [np.array([math.cos(math.radians(72 * k + 36)), math.sin(math.radians(72 * k + 36)), -z0]) for k in range(5)]
    normal = np.cross(upper[1] - upper[0], lower[0] - upper[0])
    apex = z0 + normal[0] / normal[2]  # height that keeps each kite planar
    return np.array([[0, 0, apex], [0, 0, -apex], *upper, *lower])


def icosahedron():
    p = []
    for a, b in itertools.product([-1, 1], repeat=2):
        p += [[0, a, b * PHI], [a, b * PHI, 0], [a * PHI, 0, b]]
    return np.array(p, dtype=float)


def geodesic_ball():
    """Icosahedron with every edge split once and pushed onto the sphere: 42 points, 80 faces."""
    ico = icosahedron()
    ico /= np.linalg.norm(ico[0])
    edge = min(np.linalg.norm(a - b) for a, b in itertools.combinations(ico, 2))
    mids = [unit((a + b) / 2) for a, b in itertools.combinations(ico, 2) if np.linalg.norm(a - b) < edge * 1.01]
    return np.vstack([ico, mids])


def solid_points(sides):
    if sides == 100:
        return geodesic_ball()
    if sides == 4:
        return np.array([[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]], dtype=float)
    if sides == 6:
        return np.array(list(itertools.product([-1, 1], repeat=3)), dtype=float)
    if sides == 8:
        return np.array([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]], dtype=float)
    if sides == 10:
        return trapezohedron()
    if sides == 12:
        p = [list(v) for v in itertools.product([-1, 1], repeat=3)]
        for a, b in itertools.product([-1, 1], repeat=2):
            p += [[0, a / PHI, b * PHI], [a / PHI, b * PHI, 0], [a * PHI, 0, b / PHI]]
        return np.array(p, dtype=float)
    if sides == 20:
        return icosahedron()
    raise ValueError(sides)


# Extra turn after a face looks at the camera. d4 and d6 would read flat face-on, so they
# tilt to show their sides; the rest already show neighbouring faces around the front one.
TILT = {4: (-0.20, 0.62), 6: (0.42, -0.48), 8: (0.0, 0.0), 10: (-0.18, 0.0), 12: (0.0, 0.0), 20: (0.0, 0.0), 100: (0.0, 0.0)}

# Visual mass of each silhouette relative to the reference circle, tuned by eye on the contact sheet.
AREA = {4: 0.80, 6: 0.88, 8: 0.86, 10: 0.84, 12: 0.90, 20: 0.90, 100: 0.92}


def silhouette_area(points):
    """Area of the convex hull of the projected points (monotone chain + shoelace)."""
    pts = sorted(set((round(float(x), 6), round(float(y), 6)) for x, y in points[:, :2]))

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    hull = lower[:-1] + upper[:-1]
    return abs(sum(hull[i][0] * hull[i - 1][1] - hull[i - 1][0] * hull[i][1] for i in range(len(hull)))) / 2


class Solid:
    def __init__(self, sides):
        points = solid_points(sides)
        points = points - points.mean(axis=0)
        faces = hull_faces(points)
        front = faces[0]
        center = points[front].mean(axis=0)
        normal = unit(np.cross(points[front[1]] - points[front[0]], points[front[2]] - points[front[0]]))
        if np.dot(normal, center) < 0:
            normal = -normal
        points = points @ align(normal, [0, 0, 1]).T

        # Turn about the view axis so the front face stands upright: its farthest corner on top
        # (a square keeps its edges level). The d10 points its long axis up, like a real one.
        if sides == 10:
            axis = align(normal, [0, 0, 1]) @ np.array([0, 0, 1.0])
            angle = math.atan2(axis[1], axis[0])
            target = math.radians(90)
        else:
            rel = points[front] - points[front].mean(axis=0)
            far = rel[np.argmax(np.linalg.norm(rel[:, :2], axis=1))]
            angle = math.atan2(far[1], far[0])
            target = math.radians(45 if len(front) == 4 else 90)
        points = points @ rotation([0, 0, 1], target - angle).T

        tilt_x, tilt_y = TILT[sides]
        points = points @ rotation([1, 0, 0], tilt_x).T @ rotation([0, 1, 0], tilt_y).T

        # Same visual mass for every die: scale the silhouette to a share of the reference circle,
        # without letting any corner leave the canvas.
        scale = math.sqrt(AREA[sides] * math.pi * RADIUS**2 / silhouette_area(points))
        lo, hi = points[:, :2].min(axis=0), points[:, :2].max(axis=0)
        scale = min(scale, MAX_HALF_EXTENT / (np.max(hi - lo) / 2))
        points *= scale
        self.sides = sides
        self.points = points  # centered on the solid, so rotations and normals stay simple
        self.faces = faces
        self.front = 0
        # Centering the silhouette's box on screen (not the solid's center) lets a pyramid use
        # the canvas; applied only when projecting.
        self.offset = -(lo + hi) / 2 * scale

    def posed(self, matrix):
        clone = object.__new__(Solid)
        clone.__dict__ = {**self.__dict__, "points": self.points @ matrix.T}
        return clone

    def tumbling(self):
        """The same die for animation: centered on itself and small enough that no rotation
        can push a corner out of the frame (its whole sphere of turn fits with a margin)."""
        clone = object.__new__(Solid)
        reach = np.max(np.linalg.norm(self.points, axis=1)) * (1 + 4 * BEVEL)
        fit = min(1.0, TUMBLE_FIT * (S / 2) / reach)
        clone.__dict__ = {**self.__dict__, "points": self.points * fit, "offset": np.zeros(2)}
        return clone

    def normal(self, face):
        pts = self.points[self.faces[face]]
        n = unit(np.cross(pts[1] - pts[0], pts[2] - pts[0]))
        return n if np.dot(n, pts.mean(axis=0)) > 0 else -n


# --- drawing ----------------------------------------------------------------------------


def number_mask(text, size):
    """The number as a coverage mask on an S x S tile, centered on its ink."""
    key = (text, int(size), S)
    if key not in MASKS:
        tile = Image.new("L", (S, S), 0)
        draw = ImageDraw.Draw(tile)
        font = ImageFont.truetype(FONT_PATH[0], int(size))
        left, top, right, bottom = draw.textbbox((0, 0), text, font=font)
        draw.text((S / 2 - (left + right) / 2, S / 2 - (top + bottom) / 2), text, font=font, fill=255)
        mask = np.asarray(tile, float) / 255
        lip = np.asarray(tile.filter(ImageFilter.GaussianBlur(S * 0.004)), float) / 255
        MASKS[key] = (mask, lip)
    return MASKS[key]


MASKS = {}
FONT_PATH = [""]


def plane_basis(normal):
    """Two in-plane axes: right as close to screen right as possible, down pointing down."""
    e1 = np.array([1.0, 0, 0]) - normal * normal[0]
    if np.linalg.norm(e1) < 1e-6:
        e1 = np.array([0, 1.0, 0]) - normal * normal[1]
    e1 = unit(e1)
    e2 = np.cross(normal, e1)
    return e1, (-e2 if e2[1] > 0 else e2)


def march(solid):
    """Ray-marches the solid with smoothly rounded edges. Returns hit pixels, points, normals, faces."""
    normals = np.array([solid.normal(f) for f in range(len(solid.faces))])
    offsets = np.array([np.dot(normals[f], solid.points[solid.faces[f]].mean(axis=0)) for f in range(len(solid.faces))])
    k = S * BEVEL
    reach = np.max(np.linalg.norm(solid.points, axis=1)) + 4 * k

    ys, xs = np.mgrid[0:S, 0:S].astype(float)
    px = (xs + 0.5 - S / 2 - solid.offset[0]).ravel()
    py = (-(ys + 0.5 - S / 2) - solid.offset[1]).ravel()
    pixels = np.flatnonzero(px**2 + py**2 < reach**2)
    px, py = px[pixels], py[pixels]
    z = np.full(px.shape, reach)
    hit = np.zeros(px.shape, bool)
    alive = np.ones(px.shape, bool)

    def field(points):
        x = points @ normals.T - offsets
        top = x.max(axis=1, keepdims=True)
        w = np.exp((x - top) / k)
        return top[:, 0] + k * np.log(w.sum(axis=1)), w / w.sum(axis=1, keepdims=True), x

    for _ in range(120):
        idx = np.flatnonzero(alive)
        if idx.size == 0:
            break
        d, _, _ = field(np.stack([px[idx], py[idx], z[idx]], axis=1))
        z[idx] -= np.maximum(d * 0.9, S * 1e-4)
        landed = d < S * 6e-4
        hit[idx[landed]] = True
        alive[idx[landed]] = False
        alive[idx[z[idx] < -reach]] = False

    found = np.flatnonzero(hit)
    points = np.stack([px[found], py[found], z[found]], axis=1)
    _, w, planes = field(points)
    n = w @ normals
    n /= np.linalg.norm(n, axis=1, keepdims=True)
    return pixels[found], points, n, planes.argmax(axis=1)


def lit(colors, points, n):
    """Point-light Lambert plus a glossy Blinn-Phong highlight and a fresnel rim."""
    to_light = LIGHT_AT[None] * S - points
    to_light /= np.linalg.norm(to_light, axis=1, keepdims=True)
    half = to_light + np.array([0, 0, 1.0])[None]
    half /= np.linalg.norm(half, axis=1, keepdims=True)
    lambert = np.clip((n * to_light).sum(axis=1), 0, 1)
    spec = np.clip((n * half).sum(axis=1), 0, 1) ** SHININESS
    fresnel = (1 - np.clip(n[:, 2], 0, 1)) ** 3
    base, gloss = np.array(colors["base"], float), np.array(colors["gloss"], float)
    color = base[None] * (AMBIENT + DIFFUSE * lambert[:, None])
    color += gloss[None] * colors["spec"] * spec[:, None] + FRESNEL * fresnel[:, None]
    return np.clip(color, 0, 255)


def engrave(color, points, decals, ink):
    """Engraves each (center, normal, text, size, applies) decal: ink plus a thin shadow lip."""
    for center, normal, text, size, applies in decals:
        e1, e2 = plane_basis(normal)
        rel = points - center
        u = np.round(rel @ e1 + S / 2).astype(int)
        v = np.round(rel @ e2 + S / 2).astype(int)
        inside = applies & (u >= 0) & (u < S) & (v >= 0) & (v < S)
        mask, lip = number_mask(text, size)
        m = np.zeros(len(points))
        shadow = np.zeros(len(points))
        m[inside] = mask[v[inside], u[inside]]
        below = np.clip(v[inside] - int(S * 0.005), 0, S - 1)
        shadow[inside] = np.clip(lip[below, u[inside]] - m[inside], 0, 1)
        color *= 1 - 0.45 * shadow[:, None]
        color[:] = color * (1 - m[:, None]) + np.array(ink, float)[None] * m[:, None]
    return color


def to_image(pixels, color):
    img = np.zeros((S * S, 4))
    img[pixels, :3] = color
    img[pixels, 3] = 255
    return Image.fromarray(img.reshape(S, S, 4).astype(np.uint8), "RGBA")


def draw_solid(solid, colors, labels, font_path, label_scale=1.0):
    """labels maps face index -> text; numbers show only on faces turned toward the camera."""
    FONT_PATH[0] = font_path
    pixels, points, n, face_of = march(solid)
    color = lit(colors, points, n)
    decals = []
    for f, text in labels.items():
        normal = solid.normal(f)
        if normal[2] < 0.3:
            continue
        center = solid.points[solid.faces[f]].mean(axis=0)
        decals.append((center, normal, text, FONT_SIZE[len(text)] * label_scale, face_of == f))
    return to_image(pixels, engrave(color, points, decals, colors["number"]))


def draw_ball(colors, labels, font_path, matrix=None, label_scale=1.0):
    """The d100: the faceted ball with numbers engraved around the given directions.

    labels is a list of (direction, text) in the ball's own frame; matrix turns the ball.
    """
    FONT_PATH[0] = font_path
    ball = solid(100) if matrix is None else solid(100).tumbling().posed(matrix)
    pixels, points, n, _ = march(ball)
    color = lit(colors, points, n)
    radius = np.max(np.linalg.norm(ball.points, axis=1))
    toward = points / np.linalg.norm(points, axis=1, keepdims=True)
    decals = []
    for direction, text in labels:
        spot = unit(direction if matrix is None else matrix @ direction)
        if spot[2] < 0.3:
            continue
        near = toward @ spot > math.cos(math.radians(32))
        decals.append((spot * radius, spot, text, FONT_SIZE[len(text)] * label_scale, near))
    return to_image(pixels, engrave(color, points, decals, colors["number"]))


def palette_for(sides, value):
    if sides == 20 and value == 20:
        return PALETTES["crit"]
    if sides == 20 and value == 1:
        return PALETTES["fumble"]
    return PALETTES["regular"]


def finish(img, size):
    return img.resize((size, size), Image.LANCZOS).quantize(colors=128, method=Image.Quantize.FASTOCTREE)


SOLIDS = {}


def solid(sides):
    if sides not in SOLIDS:
        SOLIDS[sides] = Solid(sides)
    return SOLIDS[sides]


def render(sides, value, font_path, size=SIZE):
    colors = palette_for(sides, value)
    if sides == 100:
        return finish(draw_ball(colors, [(np.array([0, 0, 1.0]), str(value))], font_path), size)
    s = solid(sides)
    return finish(draw_solid(s, colors, {s.front: str(value)}, font_path), size)


# Each die in a multi-die strip turns about its own axis and starts at its own angle,
# so the dice never move in lockstep.
SLOT_MOTION = [
    (ROLL_AXIS, 0.0),
    (np.array([-0.35, 0.88, -0.32]), 2.1),
    (np.array([0.80, 0.30, 0.52]), 4.2),
]
MAX_VISIBLE = 3
# Strips are shown about 360 px wide, so each die gets less room and the loop fewer frames
# (same one-second turn), which keeps a three-dice GIF light.
STRIP_DIE_SIZE = 120
STRIP_FRAMES = 12
STRIP_FRAME_MS = 80


def rolling_frame(sides, font_path, axis, angle, size=SIZE):
    """One frame of a die tumbling, numbers riding on the faces that pass in front."""
    colors = PALETTES["regular"]
    m = rotation(axis, angle)
    if sides == 100:
        # Numbers spread over the ball like a real one, one per icosahedron corner.
        spots = [(unit(v), str((i * 37 + 11) % 100 + 1)) for i, v in enumerate(icosahedron())]
        img = draw_ball(colors, spots, font_path, matrix=m, label_scale=0.62)
    else:
        s = solid(sides).tumbling().posed(m)
        labels = {f: str((f * 7 + 3) % sides + 1) for f in range(len(s.faces))}
        img = draw_solid(s, colors, labels, font_path, label_scale=0.62)
    frame = img.resize((size, size), Image.LANCZOS)
    assert_not_clipped(frame, f"d{sides} at {angle:.2f} rad")
    return frame


def assert_not_clipped(img, what):
    """Fails the render if any visible pixel touches the frame's edge."""
    alpha = np.asarray(img.getchannel("A"))
    edges = np.concatenate([alpha[0], alpha[-1], alpha[:, 0], alpha[:, -1]])
    if edges.max() > 0:
        raise SystemExit(f"clipped: {what} touches the edge of its frame")


def render_rolling(sides, font_path, count=1):
    """A full turn per die, so the loop is seamless; `count` dice side by side."""
    size, total = (SIZE, ROLL_FRAMES) if count == 1 else (STRIP_DIE_SIZE, STRIP_FRAMES)
    frames = []
    for k in range(total):
        frame = Image.new("RGBA", (size * count, size), (0, 0, 0, 0))
        for slot in range(count):
            axis, phase = SLOT_MOTION[slot]
            die = rolling_frame(sides, font_path, axis, phase + 2 * math.pi * k / total, size)
            frame.alpha_composite(die, (slot * size, 0))
        # GIF has 1-bit transparency: snap the soft edge so no halo shows on light or dark themes.
        frame.putalpha(frame.getchannel("A").point(lambda a: 255 if a >= 128 else 0))
        frames.append(frame)
    return frames


BADGE_WIDTH = 96
MAX_DICE = 100


def render_badge(extra, font_path):
    """The "+N" badge after the visible dice: a flat token with a bevelled rim, same light."""
    colors = PALETTES["regular"]
    w, h = BADGE_WIDTH * SCALE, S
    r = w * 0.44
    yy, xx = np.mgrid[0:h, 0:w].astype(float)
    x, y = (xx + 0.5 - w / 2) / r, -(yy + 0.5 - h / 2) / r
    inside = (x**2 + y**2 <= 1).ravel()
    # Flat face; only the outer rim tilts outward, like a bevelled token (not a ball).
    rim = np.clip((np.sqrt(x**2 + y**2) - 0.82) / 0.18, 0, 1)
    n = np.stack([x * rim * 0.9, y * rim * 0.9, np.ones_like(x)], axis=-1).reshape(-1, 3)
    n /= np.linalg.norm(n, axis=1, keepdims=True)
    points = np.stack([(x * r).ravel(), (y * r).ravel(), np.zeros(w * h)], axis=1)
    color = lit(colors, points[inside], n[inside])
    img = np.zeros((w * h, 4))
    img[np.flatnonzero(inside), :3] = color
    img[np.flatnonzero(inside), 3] = 255
    token = Image.fromarray(img.reshape(h, w, 4).astype(np.uint8), "RGBA")
    draw = ImageDraw.Draw(token)
    text = f"+{extra}"
    font = ImageFont.truetype(font_path, int(S * (0.17 if len(text) <= 2 else 0.135)))
    left, top, right, bottom = draw.textbbox((0, 0), text, font=font)
    draw.text((w / 2 - (left + right) / 2, h / 2 - (top + bottom) / 2), text, font=font, fill=colors["number"])
    return token.resize((BADGE_WIDTH, SIZE), Image.LANCZOS).quantize(colors=64, method=Image.Quantize.FASTOCTREE)


def save_gif(frames, path, frame_ms=ROLL_FRAME_MS):
    frames[0].save(path, save_all=True, append_images=frames[1:], duration=frame_ms, loop=0, disposal=2, optimize=True)


def contact_sheet(images, path):
    rows = list(DICE)
    samples = {sides: list(range(1, min(sides, 20) + 1)) for sides in rows}
    samples[100] = [1, 7, 10, 42, 50, 77, 88, 99, 100]
    cols = max(len(values) for values in samples.values())
    cell = SIZE // 2
    sheet = Image.new("RGB", (cols * cell, len(rows) * cell * 2), "#FFFFFF")
    sheet.paste(Image.new("RGB", (cols * cell, len(rows) * cell), "#1A1D21"), (0, len(rows) * cell))
    for r, sides in enumerate(rows):
        for c, value in enumerate(samples[sides]):
            thumb = images[(sides, value)].convert("RGBA").resize((cell, cell), Image.LANCZOS)
            sheet.paste(thumb, (c * cell, r * cell), thumb)
            sheet.paste(thumb, (c * cell, (len(rows) + r) * cell), thumb)
    sheet.save(path)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("font")
    parser.add_argument("--sheet")
    args = parser.parse_args()

    out = Path(__file__).resolve().parent.parent / "assets" / "dice"
    out.mkdir(parents=True, exist_ok=True)
    images = {}
    for sides, name in DICE.items():
        for value in range(1, sides + 1):
            img = render(sides, value, args.font)
            img.save(out / f"{name}-{value}.png", optimize=True)
            images[(sides, value)] = img
        save_gif(render_rolling(sides, args.font), out / f"{name}-rolling.gif")
        for count in range(2, MAX_VISIBLE + 1):
            save_gif(render_rolling(sides, args.font, count), out / f"{name}-rolling-{count}.gif", STRIP_FRAME_MS)
    # Rolls show at most three dice; the rest are counted by a badge.
    for extra in range(1, MAX_DICE - MAX_VISIBLE + 1):
        render_badge(extra, args.font).save(out / f"more-{extra}.png", optimize=True)
    # Natural 20 and natural 1 get a larger image for the celebration message.
    for value in (20, 1):
        render(20, value, args.font, size=SIZE * 2).save(out / f"d20-{value}-large.png", optimize=True)
    if args.sheet:
        contact_sheet(images, args.sheet)


if __name__ == "__main__":
    main()
