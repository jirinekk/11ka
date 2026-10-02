#!/usr/bin/env python3
"""Process penalty game keeper and ball PNG sources into transparent WebP assets."""

from __future__ import annotations

import os
from collections import deque
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ASSETS = Path(
    os.environ.get(
        "PENALTY_ASSETS_DIR",
        "/Users/macbookdan/.cursor/projects/Users-macbookdan-Documents-b8c961a5-54a0-4dea-94bf-16ad1613a516/assets",
    )
)
OUT_DIR = ROOT / "public" / "images"
TARGET_H = 320
DIVE_TARGET_H = 200
HIGH_TARGET_H = 420
KEEPER_CANVAS_W = 908
KEEPER_CANVAS_H = 320
BALL_SIZE = 256

KEEPER_FILES = {
    "penalty-keeper.webp": ("penalty-keeper-source.png", TARGET_H),
    "penalty-keeper-dive-left.webp": ("penalty-keeper-dive-left-source.png", DIVE_TARGET_H),
    "penalty-keeper-dive-right.webp": ("penalty-keeper-dive-right-source.png", DIVE_TARGET_H),
    "penalty-keeper-dive-high.webp": ("penalty-keeper-dive-high-source2.png", HIGH_TARGET_H),
}

BALL_FILE = {
    "penalty-ball.webp": "image-69e288bc-1425-4df1-992c-76795b4770a0.png",
}


def is_bg(r: int, g: int, b: int) -> bool:
    return (r + g + b) / 3 > 232 and min(r, g, b) > 210


def is_floodable_bg(r: int, g: int, b: int) -> bool:
    """Studio backdrop pixels flood-fill may traverse."""
    if is_flesh_or_glove(r, g, b) or is_green(r, g, b, 255):
        return False
    return is_bg(r, g, b)


def is_stray_white(r: int, g: int, b: int, a: int) -> bool:
    return a > 96 and r > 190 and g > 190 and b > 190


def is_green(r: int, g: int, b: int, a: int) -> bool:
    return a > 96 and g > max(r, b) + 22 and g > 65


def is_dark(r: int, g: int, b: int, a: int) -> bool:
    return a > 96 and r + g + b < 130


def is_gray_fringe(r: int, g: int, b: int, a: int) -> bool:
    return a > 96 and max(r, g, b) - min(r, g, b) < 35 and 280 < (r + g + b) < 620


def _mark_protected_glove_white(pixels, w: int, h: int, radius: int = 4) -> set[tuple[int, int]]:
    protected: set[tuple[int, int]] = set()
    for y in range(h):
        for x in range(w):
            r, g, b, a = pixels[x, y]
            if a < 128 or not (r > 176 and g > 172 and b > 168):
                continue
            for ny in range(max(0, y - radius), min(h, y + radius + 1)):
                for nx in range(max(0, x - radius), min(w, x + radius + 1)):
                    if (nx - x) ** 2 + (ny - y) ** 2 > radius * radius:
                        continue
                    nr, ng, nb, na = pixels[nx, ny]
                    if na < 128:
                        continue
                    if is_green(nr, ng, nb, na) or is_dark(nr, ng, nb, na):
                        protected.add((x, y))
                        break
                    if is_flesh_or_glove(nr, ng, nb) and not (
                        nr > 230 and ng > 225 and nb > 220
                    ):
                        protected.add((x, y))
                        break
                if (x, y) in protected:
                    break
    return protected


def _mark_glove_white_from_wristbands(pixels, w: int, h: int) -> set[tuple[int, int]]:
    """Protect glove panels reached from black cuffs attached to green sleeves."""
    protected: set[tuple[int, int]] = set()
    seeds: list[tuple[int, int]] = []
    for y in range(h):
        for x in range(w):
            r, g, b, a = pixels[x, y]
            if a < 128 or not is_dark(r, g, b, a):
                continue
            for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if 0 <= nx < w and 0 <= ny < h and is_green(*pixels[nx, ny]):
                    seeds.append((x, y))
                    break

    for sx, sy in seeds:
        dq: deque[tuple[int, int]] = deque([(sx, sy)])
        seen = {(sx, sy)}
        while dq:
            x, y = dq.popleft()
            r, g, b, a = pixels[x, y]
            if a < 128:
                continue
            protected.add((x, y))
            for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if not (0 <= nx < w and 0 <= ny < h) or (nx, ny) in seen:
                    continue
                nr, ng, nb, na = pixels[nx, ny]
                if na < 128:
                    continue
                if is_green(nr, ng, nb, na) or is_dark(nr, ng, nb, na):
                    seen.add((nx, ny))
                    dq.append((nx, ny))
                elif nr > 150 and ng > 145 and nb > 140:
                    seen.add((nx, ny))
                    protected.add((nx, ny))
                    dq.append((nx, ny))
    return protected


def _background_reachable_mask(pixels, w: int, h: int) -> list[list[bool]]:
    """Pixels connected to the image edge through studio-white areas."""
    visited = [[False] * w for _ in range(h)]
    q: deque[tuple[int, int]] = deque()

    for x in range(w):
        for y in (0, h - 1):
            if is_floodable_bg(*pixels[x, y][:3]):
                visited[y][x] = True
                q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if not visited[y][x] and is_floodable_bg(*pixels[x, y][:3]):
                visited[y][x] = True
                q.append((x, y))

    while q:
        x, y = q.popleft()
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < w and 0 <= ny < h and not visited[ny][nx]:
                r, g, b, _a = pixels[nx, ny]
                if is_floodable_bg(r, g, b):
                    visited[ny][nx] = True
                    q.append((nx, ny))
    return visited


def studio_subject_crop_box(img: Image.Image) -> tuple[int, int, int, int]:
    """Fast crop bounds for a white-studio keeper frame."""
    w, h = img.size
    pixels = img.load()
    left, top, right, bottom = w, h, 0, 0
    found = False
    for y in range(h):
        for x in range(w):
            r, g, b, a = pixels[x, y]
            if a < 128:
                continue
            if is_keeper_pixel(r, g, b, a) or (r > 165 and g > 160 and b > 155):
                left = min(left, x)
                top = min(top, y)
                right = max(right, x)
                bottom = max(bottom, y)
                found = True
    if not found:
        return (0, 0, w, h)
    pad = int(max(right - left, bottom - top) * 0.03)
    return (
        max(0, left - pad),
        max(0, top - pad),
        min(w, right + pad),
        min(h, bottom + pad),
    )


def render_keeper_from_source(backup_img: Image.Image) -> tuple[Image.Image, int]:
    """Matte the keeper from a white studio frame while keeping original colors."""
    orig_pixels = backup_img.load()
    w, h = backup_img.size
    bg_mask = _background_reachable_mask(orig_pixels, w, h)

    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    out_pixels = out.load()
    removed = 0
    for y in range(h):
        for x in range(w):
            r, g, b, a = orig_pixels[x, y]
            if a < 128:
                continue
            if bg_mask[y][x]:
                removed += 1
                continue
            if is_floodable_bg(r, g, b) and not backup_keeper_material_pixel(
                orig_pixels, x, y, w, h
            ):
                removed += 1
                continue
            out_pixels[x, y] = (r, g, b, 255)

    return out, removed


def flood_remove_background_preserve_gloves(pixels, w: int, h: int) -> int:
    """Remove studio white bg without eating goalkeeper gloves on white backdrops."""
    protected = _mark_protected_glove_white(pixels, w, h)
    visited = [[False] * w for _ in range(h)]
    q: deque[tuple[int, int]] = deque()

    for x in range(w):
        for y in (0, h - 1):
            if is_floodable_bg(*pixels[x, y][:3]):
                visited[y][x] = True
                q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if not visited[y][x] and is_floodable_bg(*pixels[x, y][:3]):
                visited[y][x] = True
                q.append((x, y))

    while q:
        x, y = q.popleft()
        if (x, y) in protected:
            continue
        pixels[x, y] = (0, 0, 0, 0)
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < w and 0 <= ny < h and not visited[ny][nx]:
                r, g, b, _a = pixels[nx, ny]
                if is_floodable_bg(r, g, b):
                    visited[ny][nx] = True
                    q.append((nx, ny))

    removed = 0
    return removed


def flood_remove_background(pixels, w: int, h: int) -> None:
    visited = [[False] * w for _ in range(h)]
    q: deque[tuple[int, int]] = deque()

    for x in range(w):
        for y in (0, h - 1):
            if is_bg(*pixels[x, y][:3]):
                visited[y][x] = True
                q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if not visited[y][x] and is_bg(*pixels[x, y][:3]):
                visited[y][x] = True
                q.append((x, y))

    while q:
        x, y = q.popleft()
        pixels[x, y] = (0, 0, 0, 0)
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < w and 0 <= ny < h and not visited[ny][nx]:
                r, g, b, _a = pixels[nx, ny]
                if is_bg(r, g, b):
                    visited[ny][nx] = True
                    q.append((nx, ny))


def remove_enclosed_white(pixels, w: int, h: int, min_size: int = 60) -> int:
    """Remove interior studio-white holes while keeping goalkeeper gloves."""
    visited: set[tuple[int, int]] = set()
    removed = 0

    for y in range(h):
        for x in range(w):
            if (x, y) in visited or not is_stray_white(*pixels[x, y]):
                continue

            comp: list[tuple[int, int]] = []
            dq: deque[tuple[int, int]] = deque([(x, y)])
            visited.add((x, y))

            while dq:
                cx, cy = dq.popleft()
                comp.append((cx, cy))
                for nx, ny in ((cx - 1, cy), (cx + 1, cy), (cx, cy - 1), (cx, cy + 1)):
                    if 0 <= nx < w and 0 <= ny < h and (nx, ny) not in visited:
                        if is_stray_white(*pixels[nx, ny]):
                            visited.add((nx, ny))
                            dq.append((nx, ny))

            if len(comp) < min_size:
                continue

            green_n = 0
            dark_n = 0
            gray_n = 0
            for cx, cy in comp:
                for nx, ny in ((cx - 1, cy), (cx + 1, cy), (cx, cy - 1), (cx, cy + 1)):
                    if (nx, ny) in comp:
                        continue
                    if not (0 <= nx < w and 0 <= ny < h):
                        continue
                    r, g, b, a = pixels[nx, ny]
                    if a < 32:
                        continue
                    if is_green(r, g, b, a):
                        green_n += 1
                    elif is_dark(r, g, b, a):
                        dark_n += 1
                    elif is_gray_fringe(r, g, b, a):
                        gray_n += 1

            size = len(comp)
            green_ratio = green_n / size
            remove = False
            # Between legs / shoes: dark surround, almost no jersey contact.
            if dark_n >= 12 and green_n < 20 and green_ratio < 0.02:
                remove = True
            # Large interior studio holes only - keep smaller white patches (ball panels, gloves).
            elif size >= 2000 and gray_n >= 200 and green_n < 20 and green_ratio < 0.02:
                remove = True
            elif size >= 2000 and gray_n >= 80 and green_n < 15 and green_ratio < 0.015:
                remove = True

            if remove:
                for cx, cy in comp:
                    pixels[cx, cy] = (0, 0, 0, 0)
                    removed += 1

    return removed


def remove_white_halos(
    pixels,
    w: int,
    h: int,
    max_passes: int = 2,
    min_rgb: tuple[int, int, int] = (225, 220, 220),
) -> int:
    """Remove only bright studio fringe pixels directly on transparency edges."""
    removed = 0
    min_r, min_g, min_b = min_rgb

    for _ in range(max_passes):
        to_clear: list[tuple[int, int]] = []

        for y in range(h):
            for x in range(w):
                r, g, b, a = pixels[x, y]
                if a < 16:
                    continue
                # Keep gloves/ball panels - remove only near-pure studio white fringe.
                if r < min_r or g < min_g or b < min_b:
                    continue
                if max(r, g, b) - min(r, g, b) > 24:
                    continue

                touches_transparent = False
                for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                    if not (0 <= nx < w and 0 <= ny < h):
                        touches_transparent = True
                        break
                    if pixels[nx, ny][3] < 16:
                        touches_transparent = True
                        break

                if touches_transparent:
                    to_clear.append((x, y))

        if not to_clear:
            break

        for x, y in to_clear:
            pixels[x, y] = (0, 0, 0, 0)
        removed += len(to_clear)

    return removed


def solidify_alpha(pixels, w: int, h: int, threshold: int = 64) -> None:
    for y in range(h):
        for x in range(w):
            r, g, b, a = pixels[x, y]
            pixels[x, y] = (r, g, b, 255) if a >= threshold else (0, 0, 0, 0)


def fill_interior_holes(
    pixels,
    w: int,
    h: int,
    min_neighbors: int = 3,
    max_passes: int = 16,
    x0: int = 0,
    y0: int = 0,
    x1: int | None = None,
    y1: int | None = None,
) -> int:
    """Fill tiny transparent gaps inside the cutout silhouette."""
    if x1 is None:
        x1 = w
    if y1 is None:
        y1 = h
    filled = 0
    for _ in range(max_passes):
        to_fill: list[tuple[int, int, tuple[int, int, int, int]]] = []
        for y in range(y0, y1):
            for x in range(x0, x1):
                if pixels[x, y][3] >= 64:
                    continue
                neighbors = [
                    pixels[nx, ny]
                    for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1))
                    if x0 <= nx < x1 and y0 <= ny < y1 and pixels[nx, ny][3] >= 128
                ]
                if len(neighbors) < min_neighbors:
                    continue
                r = sum(c[0] for c in neighbors) // len(neighbors)
                g = sum(c[1] for c in neighbors) // len(neighbors)
                b = sum(c[2] for c in neighbors) // len(neighbors)
                to_fill.append((x, y, (r, g, b, 255)))
        if not to_fill:
            break
        for x, y, color in to_fill:
            pixels[x, y] = color
        filled += len(to_fill)
    return filled


def is_flesh_or_glove(r: int, g: int, b: int) -> bool:
    if r > 120 and g > 75 and b > 55 and r > b + 10:
        return True
    if r > 200 and g > 195 and b > 175 and r >= g >= b:
        if not (r > 252 and g > 252 and b > 252):
            return True
    return False


def is_ball_remnant(r: int, g: int, b: int) -> bool:
    if r > 252 and g > 252 and b > 252:
        return True
    return (
        max(r, g, b) < 70
        and min(r, g, b) < 35
        and abs(r - g) < 18
        and abs(g - b) < 18
    )


def is_keeper_pixel(r: int, g: int, b: int, a: int) -> bool:
    if a < 128:
        return False
    if is_flesh_or_glove(r, g, b) or is_green(r, g, b, a):
        return True
    return max(r, g, b) < 55 and r + g + b < 120


def heal_silhouette_gaps(
    pixels,
    w: int,
    h: int,
    max_passes: int = 40,
    min_neighbors: int = 3,
    x0: int = 0,
    y0: int = 0,
    x1: int | None = None,
    y1: int | None = None,
) -> int:
    """Fill transparent holes inside the keeper cutout."""
    if x1 is None:
        x1 = w
    if y1 is None:
        y1 = h
    filled = 0
    for _ in range(max_passes):
        to_fill: list[tuple[int, int, tuple[int, int, int, int]]] = []
        for y in range(y0, y1):
            for x in range(x0, x1):
                if pixels[x, y][3] >= 64:
                    continue
                neighbors = [
                    pixels[nx, ny]
                    for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1))
                    if x0 <= nx < x1 and y0 <= ny < y1 and pixels[nx, ny][3] >= 128
                ]
                if len(neighbors) < min_neighbors:
                    continue
                r = sum(c[0] for c in neighbors) // len(neighbors)
                g = sum(c[1] for c in neighbors) // len(neighbors)
                b = sum(c[2] for c in neighbors) // len(neighbors)
                to_fill.append((x, y, (r, g, b, 255)))
        if not to_fill:
            break
        for x, y, color in to_fill:
            pixels[x, y] = color
        filled += len(to_fill)
    return filled


def backup_has_glove_context(backup_pixels, x: int, y: int, w: int, h: int, rad: int = 8) -> bool:
    for ny in range(max(0, y - rad), min(h, y + rad + 1)):
        for nx in range(max(0, x - rad), min(w, x + rad + 1)):
            nr, ng, nb, na = backup_pixels[nx, ny]
            if na < 128:
                continue
            if is_flesh_or_glove(nr, ng, nb) or is_green(nr, ng, nb, na):
                return True
    return False


def backup_is_ball_pixel(backup_pixels, x: int, y: int, w: int, h: int, rad: int = 6) -> bool:
    br, bg, bb, ba = backup_pixels[x, y]
    if ba < 128:
        return False
    if is_flesh_or_glove(br, bg, bb) or is_green(br, bg, bb, ba):
        return False
    if max(br, bg, bb) < 55 and br + bg + bb < 120:
        return False
    if not (is_ball_remnant(br, bg, bb) or (br > 236 and bg > 236 and bb > 236)):
        return False

    flesh_near = False
    ball_near = False
    for ny in range(max(0, y - rad), min(h, y + rad + 1)):
        for nx in range(max(0, x - rad), min(w, x + rad + 1)):
            if (nx - x) ** 2 + (ny - y) ** 2 > rad * rad:
                continue
            nr, ng, nb, na = backup_pixels[nx, ny]
            if na < 128:
                continue
            if is_flesh_or_glove(nr, ng, nb) or is_green(nr, ng, nb, na):
                flesh_near = True
            if is_ball_remnant(nr, ng, nb) or (nr > 236 and ng > 236 and nb > 236):
                ball_near = True
    return ball_near and not flesh_near


def backup_is_glove_white_pixel(backup_pixels, x: int, y: int, w: int, h: int) -> bool:
    br, bg, bb, ba = backup_pixels[x, y]
    if ba < 128 or not (br > 236 and bg > 236 and bb > 236):
        return False
    return backup_has_glove_context(backup_pixels, x, y, w, h) and not backup_is_ball_pixel(
        backup_pixels, x, y, w, h
    )


def restore_keeper_contact_zone(img: Image.Image, backup: Image.Image) -> int:
    """Put glove/arm pixels back where ball removal punched holes."""
    w, h = img.size
    pixels = img.load()
    backup_pixels = backup.load()
    restored = 0
    x0, x1 = int(w * 0.56), int(w * 0.86)
    y0, y1 = int(h * 0.6), int(h * 0.98)
    for y in range(y0, y1):
        for x in range(x0, x1):
            if pixels[x, y][3] >= 128:
                continue
            br, bg, bb, ba = backup_pixels[x, y]
            if ba < 128 or backup_is_ball_pixel(backup_pixels, x, y, w, h):
                continue
            if (
                is_keeper_pixel(br, bg, bb, ba)
                or is_flesh_or_glove(br, bg, bb)
                or backup_is_glove_white_pixel(backup_pixels, x, y, w, h)
            ):
                pixels[x, y] = (br, bg, bb, 255)
                restored += 1
    return restored


def cleanup_contact_ball_remnants(pixels, w: int, h: int) -> int:
    """Remove leftover embedded-ball pixels in the gloved-hand zone."""
    removed = 0
    x0, x1 = int(w * 0.4), int(w * 0.7)
    y0, y1 = int(h * 0.55), int(h * 0.99)
    for y in range(y0, y1):
        for x in range(x0, x1):
            if is_removable_ball_pixel(pixels, x, y, w, h):
                pixels[x, y] = (0, 0, 0, 0)
                removed += 1
    return removed


def remove_ball_chips(
    pixels,
    w: int,
    h: int,
    x0: int,
    y0: int,
    x1: int,
    y1: int,
    max_size: int = 1200,
) -> int:
    """Delete small black/white ball fragments sitting on the glove."""
    visited: set[tuple[int, int]] = set()
    removed = 0

    for y in range(y0, y1):
        for x in range(x0, x1):
            if (x, y) in visited or pixels[x, y][3] < 16:
                continue
            r, g, b, _a = pixels[x, y]
            if not is_ball_remnant(r, g, b):
                continue

            comp: list[tuple[int, int]] = []
            dq: deque[tuple[int, int]] = deque([(x, y)])
            visited.add((x, y))

            while dq:
                cx, cy = dq.popleft()
                comp.append((cx, cy))
                for nx, ny in ((cx - 1, cy), (cx + 1, cy), (cx, cy - 1), (cx, cy + 1)):
                    if not (x0 <= nx < x1 and y0 <= ny < y1) or (nx, ny) in visited:
                        continue
                    if pixels[nx, ny][3] < 16:
                        continue
                    nr, ng, nb, _na = pixels[nx, ny]
                    if is_ball_remnant(nr, ng, nb):
                        visited.add((nx, ny))
                        dq.append((nx, ny))

            if len(comp) > max_size:
                continue

            keeper_touch = 0
            for cx, cy in comp:
                for nx, ny in ((cx - 1, cy), (cx + 1, cy), (cx, cy - 1), (cx, cy + 1)):
                    if (nx, ny) in comp:
                        continue
                    if not (0 <= nx < w and 0 <= ny < h):
                        continue
                    nr, ng, nb, na = pixels[nx, ny]
                    if na < 16:
                        continue
                    if is_flesh_or_glove(nr, ng, nb) or is_green(nr, ng, nb, na):
                        keeper_touch += 1

            if keeper_touch < 6:
                continue

            for cx, cy in comp:
                pixels[cx, cy] = (0, 0, 0, 0)
                removed += 1

    return removed


def is_removable_ball_pixel(pixels, x: int, y: int, w: int, h: int) -> bool:
    r, g, b, a = pixels[x, y]
    if a < 128:
        return False
    if is_flesh_or_glove(r, g, b) or is_green(r, g, b, a):
        return False
    if max(r, g, b) < 55 and r + g + b < 120:
        return False
    if not (is_ball_remnant(r, g, b) or (r > 236 and g > 236 and b > 236)):
        return False
    return backup_is_ball_pixel(pixels, x, y, w, h)


def remove_embedded_ball(img: Image.Image) -> int:
    """Remove only ball pixels from the low-dive source, leaving the glove intact."""
    w, h = img.size
    pixels = img.load()
    removed = 0
    x0, x1 = int(w * 0.58), int(w * 0.88)
    y0, y1 = int(h * 0.64), int(h * 0.97)

    for y in range(y0, y1):
        for x in range(x0, x1):
            if is_removable_ball_pixel(pixels, x, y, w, h):
                pixels[x, y] = (0, 0, 0, 0)
                removed += 1

    return removed

def scrub_ball_zone(pixels, w: int, h: int) -> int:
    """Remove neutral ball panels left in the scaled low-dive pose."""
    cx, cy = int(w * 0.52), int(h * 0.93)
    rx, ry = int(w * 0.13), int(h * 0.24)
    removed = 0
    for y in range(h):
        for x in range(w):
            if ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 > 1.0:
                continue
            r, g, b, a = pixels[x, y]
            if a < 16:
                continue
            if is_flesh_or_glove(r, g, b) or is_green(r, g, b, a):
                continue
            if max(r, g, b) < 55 and r + g + b < 120:
                continue
            if is_ball_remnant(r, g, b) or (
                max(r, g, b) - min(r, g, b) < 18 and 150 < r + g + b < 710
            ):
                pixels[x, y] = (0, 0, 0, 0)
                removed += 1
    return removed


def cleanup_resized_ball_remnants(img: Image.Image) -> int:
    """Remove any leftover ball pixels after the low-dive pose is scaled."""
    w, h = img.size
    pixels = img.load()
    removed = 0
    best: tuple[int, int, int] | None = None

    for tcx in range(w // 2, w - 12, 4):
        for tcy in range(12, h * 2 // 3, 4):
            white_n = 0
            black_n = 0
            rad = max(18, int(min(w, h) * 0.09))
            for y in range(max(0, tcy - rad), min(h, tcy + rad), 2):
                for x in range(max(0, tcx - rad), min(w, tcx + rad), 2):
                    if (x - tcx) ** 2 + (y - tcy) ** 2 > rad * rad:
                        continue
                    r, g, b, a = pixels[x, y]
                    if a < 128:
                        continue
                    if r > 250 and g > 250 and b > 250:
                        white_n += 1
                    elif max(r, g, b) < 90:
                        black_n += 1
            if white_n < 18 or black_n < 12:
                continue
            score = white_n + black_n
            if best is None or score > best[0]:
                best = (score, tcx, tcy)

    if not best or best[0] < 50:
        return 0

    _, cx, cy = best
    rx = max(20, int(min(w, h) * 0.1))
    ry = rx
    saved: dict[tuple[int, int], tuple[int, int, int, int]] = {}
    for y in range(max(0, cy - ry - 8), min(h, cy + ry + 12)):
        for x in range(max(0, cx - rx - 8), min(w, cx + rx + 20)):
            if ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 > 1.35:
                continue
            r, g, b, a = pixels[x, y]
            if a > 0 and is_flesh_or_glove(r, g, b):
                saved[(x, y)] = (r, g, b, a)

    for y in range(h):
        for x in range(w):
            if ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1.0:
                if pixels[x, y][3] > 0:
                    pixels[x, y] = (0, 0, 0, 0)
                    removed += 1

    for (x, y), color in saved.items():
        pixels[x, y] = color

    x0, x1 = max(0, cx - rx - 8), min(w, cx + rx + 18)
    y0, y1 = max(0, cy - ry - 8), min(h, cy + ry + 12)
    for y in range(y0, y1):
        for x in range(x0, x1):
            r, g, b, a = pixels[x, y]
            if a < 16:
                continue
            if is_ball_remnant(r, g, b) and not is_flesh_or_glove(r, g, b):
                pixels[x, y] = (0, 0, 0, 0)
                removed += 1

    return removed


def normalize_keeper_canvas(img: Image.Image) -> Image.Image:
    """Place every pose on the same canvas with feet anchored bottom-center."""
    anchor = img.getbbox()
    if not anchor:
        return Image.new("RGBA", (KEEPER_CANVAS_W, KEEPER_CANVAS_H), (0, 0, 0, 0))
    return normalize_with_anchor(img, anchor)


def normalize_keeper_canvas_fit(
    img: Image.Image,
    min_top: int = 4,
) -> tuple[Image.Image, float, int, int]:
    """Anchor feet at bottom-center and shrink if raised arms/gloves would clip."""
    anchor = img.getbbox()
    if not anchor:
        return (
            Image.new("RGBA", (KEEPER_CANVAS_W, KEEPER_CANVAS_H), (0, 0, 0, 0)),
            1.0,
            0,
            0,
        )

    scale = 1.0
    _left, top, _right, bottom = anchor
    figure_h = bottom - top
    max_h = KEEPER_CANVAS_H - min_top
    if figure_h > max_h:
        scale = max_h / figure_h
        img = img.resize(
            (
                max(1, int(img.size[0] * scale)),
                max(1, int(img.size[1] * scale)),
            ),
            Image.Resampling.LANCZOS,
        )
        anchor = img.getbbox()
        if not anchor:
            return (
                Image.new("RGBA", (KEEPER_CANVAS_W, KEEPER_CANVAS_H), (0, 0, 0, 0)),
                scale,
                0,
                0,
            )

    left, _top, right, bottom = anchor
    paste_x = KEEPER_CANVAS_W // 2 - (left + right) // 2
    paste_y = KEEPER_CANVAS_H - bottom
    canvas = Image.new("RGBA", (KEEPER_CANVAS_W, KEEPER_CANVAS_H), (0, 0, 0, 0))
    canvas.paste(img, (paste_x, paste_y), img)
    return canvas, scale, paste_x, paste_y


def normalize_keeper_canvas_fit_high(
    img: Image.Image,
    min_top: int = 6,
    foot_pad: int = 2,
) -> tuple[Image.Image, float, int, int]:
    """High jump - scale up to goal height and anchor feet on the canvas baseline."""
    anchor = img.getbbox()
    if not anchor:
        return (
            Image.new("RGBA", (KEEPER_CANVAS_W, KEEPER_CANVAS_H), (0, 0, 0, 0)),
            1.0,
            0,
            0,
        )

    scale = 1.0
    left, top, right, bottom = anchor
    figure_h = bottom - top
    max_h = KEEPER_CANVAS_H - min_top - foot_pad

    if figure_h < max_h - 2:
        grow = (max_h - 2) / figure_h
        w, h = img.size
        img = img.resize(
            (max(1, int(w * grow)), max(1, int(h * grow))),
            Image.Resampling.LANCZOS,
        )
        scale *= grow
        anchor = img.getbbox() or anchor
        left, top, right, bottom = anchor
        figure_h = bottom - top

    if figure_h > max_h:
        shrink = max_h / figure_h
        img = img.resize(
            (
                max(1, int(img.size[0] * shrink)),
                max(1, int(img.size[1] * shrink)),
            ),
            Image.Resampling.LANCZOS,
        )
        scale *= shrink
        anchor = img.getbbox() or anchor
        if not anchor:
            return (
                Image.new("RGBA", (KEEPER_CANVAS_W, KEEPER_CANVAS_H), (0, 0, 0, 0)),
                scale,
                0,
                0,
            )
        left, top, right, bottom = anchor

    paste_x = KEEPER_CANVAS_W // 2 - (left + right) // 2
    paste_y = KEEPER_CANVAS_H - foot_pad - bottom
    canvas = Image.new("RGBA", (KEEPER_CANVAS_W, KEEPER_CANVAS_H), (0, 0, 0, 0))
    canvas.paste(img, (paste_x, paste_y), img)
    return canvas, scale, paste_x, paste_y


GLOVE_WHITE = (236, 236, 236)


def _keeper_material_pixel(r: int, g: int, b: int, a: int) -> bool:
    return a >= 128 and (is_keeper_pixel(r, g, b, a) or is_flesh_or_glove(r, g, b))


def is_white_glove_pixel(r: int, g: int, b: int, a: int) -> bool:
    return a >= 48 and r > 188 and g > 182 and b > 176 and max(r, g, b) - min(r, g, b) < 42


def is_glove_context_pixel(r: int, g: int, b: int, a: int) -> bool:
    if a < 48:
        return False
    if is_white_glove_pixel(r, g, b, a) or is_flesh_or_glove(r, g, b):
        return True
    if is_green(r, g, b, a):
        return True
    return max(r, g, b) < 50 and r + g + b < 110


def _raised_glove_zones(w: int, h: int) -> tuple[tuple[int, int, int, int], ...]:
    return (
        (0, 0, int(w * 0.54), int(h * 0.54)),
        (int(w * 0.46), 0, w, int(h * 0.54)),
    )


def strengthen_glove_pixels(pixels, w: int, h: int) -> int:
    """Make existing glove fragments fully opaque white."""
    changed = 0
    for x0, y0, x1, y1 in _raised_glove_zones(w, h):
        for y in range(y0, y1):
            for x in range(x0, x1):
                r, g, b, a = pixels[x, y]
                if a < 48:
                    continue
                if not is_white_glove_pixel(r, g, b, a):
                    continue
                pixels[x, y] = (*GLOVE_WHITE, 255)
                changed += 1
    return changed


def fill_glove_interior_holes(
    pixels,
    w: int,
    h: int,
    max_passes: int = 36,
) -> int:
    """Fill only enclosed gaps inside an existing glove silhouette."""
    filled = 0
    for x0, y0, x1, y1 in _raised_glove_zones(w, h):
        for _ in range(max_passes):
            to_fill: list[tuple[int, int]] = []
            for y in range(y0, y1):
                for x in range(x0, x1):
                    if pixels[x, y][3] >= 128:
                        continue

                    cardinals: list[tuple[int, int, int, int]] = []
                    white_neighbors = 0
                    for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                        if not (x0 <= nx < x1 and y0 <= ny < y1):
                            continue
                        nr, ng, nb, na = pixels[nx, ny]
                        if na < 128:
                            continue
                        cardinals.append((nr, ng, nb, na))
                        if is_white_glove_pixel(nr, ng, nb, na):
                            white_neighbors += 1

                    if len(cardinals) < 3 or white_neighbors < 1:
                        continue
                    if not all(is_glove_context_pixel(nr, ng, nb, 255) for nr, ng, nb, _na in cardinals):
                        continue

                    to_fill.append((x, y))

            if not to_fill:
                break
            for x, y in to_fill:
                pixels[x, y] = (*GLOVE_WHITE, 255)
                filled += 1
    return filled


def _cluster_bbox(
    pixels,
    w: int,
    h: int,
    zone: tuple[int, int, int, int],
    predicate,
    pad: int = 4,
) -> tuple[int, int, int, int] | None:
    x0, y0, x1, y1 = zone
    xs: list[int] = []
    ys: list[int] = []
    for y in range(y0, y1):
        for x in range(x0, x1):
            r, g, b, a = pixels[x, y]
            if predicate(r, g, b, a):
                xs.append(x)
                ys.append(y)
    if not xs:
        return None
    return (
        max(0, min(xs) - pad),
        max(0, min(ys) - pad),
        min(w, max(xs) + pad + 1),
        min(h, max(ys) + pad + 1),
    )


def _clear_zone_white(pixels, w: int, h: int, zone: tuple[int, int, int, int]) -> int:
    x0, y0, x1, y1 = zone
    cleared = 0
    for y in range(y0, y1):
        for x in range(x0, x1):
            r, g, b, a = pixels[x, y]
            if a < 48 or not is_white_glove_pixel(r, g, b, a):
                continue
            pixels[x, y] = (0, 0, 0, 0)
            cleared += 1
    return cleared


def _glove_wrist_anchor(
    pixels,
    w: int,
    h: int,
    box: tuple[int, int, int, int],
    body_side: str,
) -> tuple[int, int] | None:
    """Find the glove pixel that meets the jersey sleeve."""
    x0, y0, x1, y1 = box
    candidates: list[tuple[int, int, int]] = []
    for y in range(y0, y1):
        for x in range(x0, x1):
            r, g, b, a = pixels[x, y]
            if not is_white_glove_pixel(r, g, b, a):
                continue
            for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if not (0 <= nx < w and 0 <= ny < h):
                    continue
                nr, ng, nb, na = pixels[nx, ny]
                if na < 128 or not is_green(nr, ng, nb, na):
                    continue
                if body_side == "right" and nx > x:
                    candidates.append((x, y, nx - x))
                elif body_side == "left" and nx < x:
                    candidates.append((x, y, x - nx))
    if not candidates:
        return None
    candidates.sort(key=lambda item: (item[2], item[1]), reverse=True)
    return candidates[0][0], candidates[0][1]


def _left_sleeve_cuff(
    pixels,
    w: int,
    h: int,
    zone: tuple[int, int, int, int],
    target_y: int | None = None,
) -> tuple[int, int] | None:
    """Find where the raised left sleeve meets the glove cuff."""
    x0, y0, x1, y1 = zone
    candidates: list[tuple[int, int, int]] = []
    for y in range(y0, y1):
        for x in range(x0, x1):
            r, g, b, a = pixels[x, y]
            if a < 128 or not is_green(r, g, b, a):
                continue
            dark_touch = False
            for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if not (0 <= nx < w and 0 <= ny < h):
                    continue
                nr, ng, nb, na = pixels[nx, ny]
                if na >= 128 and max(nr, ng, nb) < 55 and nr + ng + nb < 110:
                    dark_touch = True
                    break
            if not dark_touch:
                continue
            y_dist = abs(y - target_y) if target_y is not None else 0
            candidates.append((y_dist, -x, x, y))
    if not candidates:
        return None
    candidates.sort()
    return candidates[0][2], candidates[0][3]


def _source_near_white_glove(r: int, g: int, b: int) -> bool:
    return r > 188 and g > 182 and b > 176 and max(r, g, b) - min(r, g, b) < 40


def _source_glove_flood_pixel(r: int, g: int, b: int) -> bool:
    return r > 172 and g > 168 and b > 162 and max(r, g, b) - min(r, g, b) < 48


def _has_local_glove_anchor(pixels, w: int, h: int, x: int, y: int, radius: int = 8) -> bool:
    for ny in range(max(0, y - radius), min(h, y + radius + 1)):
        for nx in range(max(0, x - radius), min(w, x + radius + 1)):
            if (nx - x) ** 2 + (ny - y) ** 2 > radius * radius:
                continue
            nr, ng, nb, na = pixels[nx, ny]
            if na < 128:
                continue
            if is_green(nr, ng, nb, na) or is_dark(nr, ng, nb, na):
                return True
            if is_flesh_or_glove(nr, ng, nb) and not _source_near_white_glove(nr, ng, nb):
                return True
    return False


def _left_arm_tip_anchor(
    pixels,
    w: int,
    h: int,
    zone: tuple[int, int, int, int],
) -> tuple[int, int] | None:
    """Top-left green pixel on the raised image-left arm."""
    x0, y0, x1, y1 = zone
    upper_y = y0 + int((y1 - y0) * 0.72)
    best: tuple[int, int] | None = None
    for y in range(y0, upper_y):
        for x in range(x0, x1):
            r, g, b, a = pixels[x, y]
            if a < 128 or not is_green(r, g, b, a):
                continue
            if best is None or (y, x) < (best[1], best[0]):
                best = (x, y)
    return best


def _glove_attach_point(
    glove_pts: list[tuple[int, int]],
    arm_tip: tuple[int, int],
) -> tuple[int, int]:
    return min(glove_pts, key=lambda p: (p[0] - arm_tip[0]) ** 2 + (p[1] - arm_tip[1]) ** 2)


def _glove_cuff_attach_point(
    pixels,
    w: int,
    h: int,
    glove_pts: list[tuple[int, int]],
    cuff: tuple[int, int],
) -> tuple[int, int]:
    """Pick the glove pixel on the wrist edge nearest the sleeve cuff."""
    candidates: list[tuple[int, int]] = []
    for x, y in glove_pts:
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if not (0 <= nx < w and 0 <= ny < h):
                continue
            nr, ng, nb, na = pixels[nx, ny]
            if na < 128:
                continue
            if is_green(nr, ng, nb, na) or (
                max(nr, ng, nb) < 55 and nr + ng + nb < 110
            ):
                candidates.append((x, y))
                break
    if candidates:
        return min(
            candidates,
            key=lambda p: (p[0] - cuff[0]) ** 2 + (p[1] - cuff[1]) ** 2,
        )
    return _glove_attach_point(glove_pts, cuff)


def _source_left_glove_search_box(
    arm_tip: tuple[int, int],
    w: int,
    h: int,
) -> tuple[int, int, int, int]:
    cx, cy = arm_tip
    return (
        max(0, cx - 130),
        max(0, cy - 70),
        min(w, cx + 190),
        min(h, cy + 260),
    )


def _extract_left_glove_from_source_wrist(
    pixels,
    w: int,
    h: int,
) -> list[tuple[int, int]]:
    """Collect glove white pixels reachable from the black wrist band on the raised arm."""
    x0, y0, x1, y1 = 0, 0, int(w * 0.52), int(h * 0.5)
    seeds: list[tuple[int, int]] = []
    for y in range(y0, y1):
        for x in range(x0, x1):
            r, g, b, a = pixels[x, y]
            if a < 128 or max(r, g, b) >= 55 or r + g + b >= 110:
                continue
            for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if not (x0 <= nx < x1 and y0 <= ny < y1):
                    continue
                nr, ng, nb, na = pixels[nx, ny]
                if na >= 128 and is_green(nr, ng, nb, na):
                    seeds.append((x, y))
                    break
    if not seeds:
        return []

    seeds.sort(key=lambda p: (p[0] + p[1]))
    tip_sum = seeds[0][0] + seeds[0][1]
    arm_seeds = [s for s in seeds if s[0] + s[1] <= tip_sum + 90][:12]
    glove: set[tuple[int, int]] = set()
    q: deque[tuple[int, int, int]] = deque((sx, sy, 0) for sx, sy in arm_seeds)
    while q:
        x, y, depth = q.popleft()
        if (x, y) in glove or depth > 72:
            continue
        if not (x0 <= x < x1 and y0 <= y < y1):
            continue
        r, g, b, a = pixels[x, y]
        if is_green(r, g, b, a):
            continue
        if depth == 0 or _source_glove_flood_pixel(r, g, b):
            glove.add((x, y))
        else:
            continue
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            q.append((nx, ny, depth + 1))

    if len(glove) < 80:
        return []
    xs = [p[0] for p in glove]
    ys = [p[1] for p in glove]
    cx = (min(xs) + max(xs)) // 2
    cy = (min(ys) + max(ys)) // 2
    max_dist = 95 * 95
    return [
        (x, y)
        for x, y in glove
        if _source_near_white_glove(*pixels[x, y][:3])
        and (x - cx) ** 2 + (y - cy) ** 2 <= max_dist
    ]


def _glove_components_in_zone(
    pixels,
    w: int,
    h: int,
    zone: tuple[int, int, int, int],
) -> list[list[tuple[int, int]]]:
    x0, y0, x1, y1 = zone
    seen: set[tuple[int, int]] = set()
    comps: list[list[tuple[int, int]]] = []
    for y in range(y0, y1):
        for x in range(x0, x1):
            if (x, y) in seen or not is_white_glove_pixel(*pixels[x, y]):
                continue
            comp: list[tuple[int, int]] = []
            stack = [(x, y)]
            seen.add((x, y))
            while stack:
                cx, cy = stack.pop()
                comp.append((cx, cy))
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if (nx, ny) in seen or not (x0 <= nx < x1 and y0 <= ny < y1):
                        continue
                    if not is_white_glove_pixel(*pixels[nx, ny]):
                        continue
                    seen.add((nx, ny))
                    stack.append((nx, ny))
            comps.append(comp)
    return comps


def _raised_left_glove_zone(
    pixels,
    w: int,
    h: int,
) -> tuple[tuple[int, int, int, int], tuple[int, int] | None, tuple[int, int] | None]:
    left_zone = (0, 0, int(w * 0.52), int(h * 0.58))
    tip = _left_arm_tip_anchor(pixels, w, h, left_zone)
    cuff = _left_sleeve_cuff(pixels, w, h, left_zone, target_y=tip[1] if tip else None)
    if not tip or not cuff:
        return left_zone, tip, cuff
    glove_zone = (
        max(0, min(tip[0], cuff[0]) - 85),
        max(0, min(tip[1], cuff[1]) - 85),
        min(w, max(tip[0], cuff[0]) + 55),
        min(h, max(tip[1], cuff[1]) + 45),
    )
    return glove_zone, tip, cuff


def prune_left_glove_strays(img: Image.Image) -> int:
    """Drop disconnected white shards around the raised left glove."""
    w, h = img.size
    pixels = img.load()
    glove_zone, _tip, cuff = _raised_left_glove_zone(pixels, w, h)
    if not cuff:
        return 0

    comps = _glove_components_in_zone(pixels, w, h, glove_zone)
    if len(comps) <= 1:
        return 0

    keeper = max(comps, key=len)
    if len(keeper) < 48:
        return 0

    keeper_set = set(keeper)
    removed = 0
    for comp in comps:
        if set(comp).issubset(keeper_set):
            continue
        for x, y in comp:
            pixels[x, y] = (0, 0, 0, 0)
            removed += 1
    return removed


def _keeper_glove_pixel_set(pixels, w: int, h: int) -> set[tuple[int, int]]:
    glove_zone, _tip, cuff = _raised_left_glove_zone(pixels, w, h)
    if not cuff:
        return set()
    comps = _glove_components_in_zone(pixels, w, h, glove_zone)
    if not comps:
        return set()
    return set(max(comps, key=len))


def remove_arm_white_fringe(
    pixels,
    w: int,
    h: int,
    zone: tuple[int, int, int, int],
    protected: set[tuple[int, int]] | None = None,
) -> int:
    """Delete white cutout residue touching the jersey without touching the glove."""
    x0, y0, x1, y1 = zone
    protected = protected or set()
    removed = 0
    for _ in range(5):
        to_clear: list[tuple[int, int]] = []
        for y in range(y0, y1):
            for x in range(x0, x1):
                if (x, y) in protected:
                    continue
                r, g, b, a = pixels[x, y]
                if a < 128 or not is_white_glove_pixel(r, g, b, a):
                    continue
                for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                    if not (0 <= nx < w and 0 <= ny < h):
                        continue
                    nr, ng, nb, na = pixels[nx, ny]
                    if na >= 128 and is_green(nr, ng, nb, na):
                        to_clear.append((x, y))
                        break
        if not to_clear:
            break
        for x, y in to_clear:
            pixels[x, y] = (0, 0, 0, 0)
            removed += 1
    return removed


def is_stand_glove_material(r: int, g: int, b: int, a: int) -> bool:
    if a < 128:
        return False
    if is_white_glove_pixel(r, g, b, a):
        return True
    if max(r, g, b) < 58 and r + g + b < 120:
        return True
    return r > 175 and g > 168 and b > 158 and max(r, g, b) - min(r, g, b) < 60


def is_stand_glove_face(r: int, g: int, b: int, a: int) -> bool:
    if a < 128 or is_green(r, g, b, a) or is_dark(r, g, b, a):
        return False
    if is_white_glove_pixel(r, g, b, a):
        return True
    return r > 175 and g > 168 and b > 158 and max(r, g, b) - min(r, g, b) < 55


def repair_stand_left_glove_from_backup(img: Image.Image, backup: Image.Image) -> int:
    """Copy shaded right-glove pixels from backup onto the left glove only."""
    if img.size != backup.size:
        return 0

    w, h = img.size
    pixels = img.load()
    backup_pixels = backup.load()
    bbox = img.getbbox()
    if not bbox:
        return 0

    figure_cx = (bbox[0] + bbox[2]) / 2
    arm_y0, arm_y1 = int(h * 0.15), int(h * 0.52)
    changed = 0
    for y in range(arm_y0, arm_y1):
        for x in range(0, int(figure_cx)):
            if not is_stand_glove_material(*backup_pixels[x, y]):
                continue
            for dy in range(-5, 6):
                sx = int(round(2 * figure_cx - x))
                sy = y + dy
                if not (0 <= sx < w and 0 <= sy < h):
                    continue
                br, bg, bb, ba = backup_pixels[sx, sy]
                if ba < 128 or not is_stand_glove_material(br, bg, bb, ba):
                    continue
                pixels[x, y] = (br, bg, bb, 255)
                changed += 1
                break
    return changed


def repair_left_glove_from_right(img: Image.Image) -> int:
    """Mirror the intact right glove onto the raised left hand on the final canvas."""
    w, h = img.size
    pixels = img.load()
    right_zone = (int(w * 0.46), 0, w, int(h * 0.58))
    glove_zone, dst_tip, _cuff = _raised_left_glove_zone(pixels, w, h)
    if not dst_tip:
        return 0

    right_box = _cluster_bbox(
        pixels,
        w,
        h,
        right_zone,
        lambda r, g, b, a: is_white_glove_pixel(r, g, b, a),
        pad=4,
    )
    if not right_box:
        return 0

    rx0, ry0, rx1, ry1 = right_box
    patch = img.crop(right_box).transpose(Image.FLIP_LEFT_RIGHT)
    pw, ph = patch.size
    patch_pixels = patch.load()
    glove_pts: list[tuple[int, int]] = []
    for py_i in range(ph):
        for px_i in range(pw):
            pr, pg, pb, pa = patch_pixels[px_i, py_i]
            if pa >= 128 and is_white_glove_pixel(pr, pg, pb, pa):
                glove_pts.append((px_i, py_i))
    if not glove_pts:
        return 0

    patch_anchor = min(glove_pts, key=lambda p: (p[1], p[0]))
    paste_x = dst_tip[0] - patch_anchor[0]
    paste_y = dst_tip[1] - patch_anchor[1]

    clear_zone = (
        max(0, glove_zone[0] - 12),
        max(0, glove_zone[1] - 12),
        min(w, max(glove_zone[2], paste_x + pw) + 12),
        min(h, max(glove_zone[3], paste_y + ph) + 12),
    )
    cleared = _clear_zone_white(pixels, w, h, clear_zone)
    painted = 0
    for py_i in range(ph):
        for px_i in range(pw):
            pr, pg, pb, pa = patch_pixels[px_i, py_i]
            if pa < 128 or not is_white_glove_pixel(pr, pg, pb, pa):
                continue
            dx = paste_x + px_i
            dy = paste_y + py_i
            if not (0 <= dx < w and 0 <= dy < h):
                continue
            pixels[dx, dy] = (*GLOVE_WHITE, 255)
            painted += 1
    return cleared + painted


def align_backup_to_canvas(working: Image.Image, backup: Image.Image) -> Image.Image:
    """Scale and place backup the same way as the high-jump working frame."""
    anchor = working.getbbox()
    if not anchor:
        return Image.new("RGBA", (KEEPER_CANVAS_W, KEEPER_CANVAS_H), (0, 0, 0, 0))

    _left, top, _right, bottom = anchor
    figure_h = bottom - top
    max_h = KEEPER_CANVAS_H - 4
    if figure_h > max_h:
        scale = max_h / figure_h
        working = working.resize(
            (
                max(1, int(working.size[0] * scale)),
                max(1, int(working.size[1] * scale)),
            ),
            Image.Resampling.LANCZOS,
        )
        backup = backup.resize(
            (
                max(1, int(backup.size[0] * scale)),
                max(1, int(backup.size[1] * scale)),
            ),
            Image.Resampling.LANCZOS,
        )
        anchor = working.getbbox() or anchor

    return normalize_with_anchor(backup, anchor)


def align_backup_to_processed(
    backup: Image.Image,
    scale: float,
    paste_x: int,
    paste_y: int,
) -> Image.Image:
    """Place the untouched source frame using the same canvas transform as the cutout."""
    if abs(scale - 1.0) > 1e-6:
        backup = backup.resize(
            (
                max(1, int(backup.size[0] * scale)),
                max(1, int(backup.size[1] * scale)),
            ),
            Image.Resampling.LANCZOS,
        )
    canvas = Image.new("RGBA", (KEEPER_CANVAS_W, KEEPER_CANVAS_H), (0, 0, 0, 0))
    canvas.paste(backup, (paste_x, paste_y), backup)
    return canvas


def backup_keeper_material_pixel(backup_pixels, x: int, y: int, w: int, h: int) -> bool:
    br, bg, bb, ba = backup_pixels[x, y]
    if ba < 128:
        return False
    if backup_is_glove_white_pixel(backup_pixels, x, y, w, h):
        return True
    if is_bg(br, bg, bb):
        return False
    return is_keeper_pixel(br, bg, bb, ba)


def is_cutout_fringe(r: int, g: int, b: int, a: int) -> bool:
    if a < 16:
        return False
    if is_gray_fringe(r, g, b, a):
        return True
    if r > 210 and g > 205 and b > 200 and max(r, g, b) - min(r, g, b) < 32:
        return True
    return r == GLOVE_WHITE[0] and g == GLOVE_WHITE[1] and b == GLOVE_WHITE[2]


def refine_keeper_from_backup(final_img: Image.Image, backup_img: Image.Image) -> int:
    """Restore body, gloves, and edge colors from the aligned source frame."""
    w, h = final_img.size
    if backup_img.size != (w, h):
        return 0

    final_pixels = final_img.load()
    backup_pixels = backup_img.load()
    changed = 0

    for y in range(h):
        for x in range(w):
            if not backup_keeper_material_pixel(backup_pixels, x, y, w, h):
                continue
            br, bg, bb, _ba = backup_pixels[x, y]
            fr, fg, fb, fa = final_pixels[x, y]
            replace = fa < 128 or is_cutout_fringe(fr, fg, fb, fa)
            if replace:
                final_pixels[x, y] = (br, bg, bb, 255)
                changed += 1

    for y in range(h):
        for x in range(w):
            fr, fg, fb, fa = final_pixels[x, y]
            if fa < 128:
                continue
            if backup_keeper_material_pixel(backup_pixels, x, y, w, h):
                continue
            br, bg, bb, ba = backup_pixels[x, y]
            if ba >= 128 and not is_bg(br, bg, bb):
                continue
            if not is_cutout_fringe(fr, fg, fb, fa) and not is_stray_white(fr, fg, fb, fa):
                continue

            touches_transparent = False
            for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if not (0 <= nx < w and 0 <= ny < h) or final_pixels[nx, ny][3] < 16:
                    touches_transparent = True
                    break
            if touches_transparent:
                final_pixels[x, y] = (0, 0, 0, 0)
                changed += 1

    return changed


def remove_disconnected_strays(pixels, w: int, h: int, max_component: int = 28) -> int:
    """Delete tiny white islands that are not attached to the keeper body."""
    visited: set[tuple[int, int]] = set()
    removed = 0

    for y in range(h):
        for x in range(w):
            if (x, y) in visited:
                continue
            r, g, b, a = pixels[x, y]
            if a < 128 or not (is_stray_white(r, g, b, a) or is_gray_fringe(r, g, b, a)):
                continue

            comp: list[tuple[int, int]] = []
            dq: deque[tuple[int, int]] = deque([(x, y)])
            visited.add((x, y))
            while dq:
                cx, cy = dq.popleft()
                comp.append((cx, cy))
                for nx, ny in ((cx - 1, cy), (cx + 1, cy), (cx, cy - 1), (cx, cy + 1)):
                    if not (0 <= nx < w and 0 <= ny < h) or (nx, ny) in visited:
                        continue
                    nr, ng, nb, na = pixels[nx, ny]
                    if na < 128 or not (
                        is_stray_white(nr, ng, nb, na) or is_gray_fringe(nr, ng, nb, na)
                    ):
                        continue
                    visited.add((nx, ny))
                    dq.append((nx, ny))

            if len(comp) > max_component:
                continue

            body_anchor = False
            for cx, cy in comp:
                for nx, ny in ((cx - 1, cy), (cx + 1, cy), (cx, cy - 1), (cx, cy + 1)):
                    if not (0 <= nx < w and 0 <= ny < h):
                        continue
                    nr, ng, nb, na = pixels[nx, ny]
                    if na < 128:
                        continue
                    if is_green(nr, ng, nb, na) or is_dark(nr, ng, nb, na):
                        body_anchor = True
                        break
                    if is_flesh_or_glove(nr, ng, nb) and not (
                        nr > 230 and ng > 225 and nb > 220
                    ):
                        body_anchor = True
                        break
                if body_anchor:
                    break

            if body_anchor:
                continue

            for cx, cy in comp:
                pixels[cx, cy] = (0, 0, 0, 0)
                removed += 1

    return removed


def sync_transparent_holes_from_backup(
    final_img: Image.Image,
    backup_img: Image.Image,
) -> int:
    """Restore missing keeper pixels from the untouched source frame."""
    w, h = final_img.size
    if backup_img.size != (w, h):
        return 0

    final_pixels = final_img.load()
    backup_pixels = backup_img.load()
    changed = 0
    for y in range(h):
        for x in range(w):
            if final_pixels[x, y][3] >= 16:
                continue
            br, bg, bb, ba = backup_pixels[x, y]
            if ba < 128 or is_bg(br, bg, bb):
                continue
            if not (
                is_keeper_pixel(br, bg, bb, ba)
                or backup_is_glove_white_pixel(backup_pixels, x, y, w, h)
            ):
                continue
            final_pixels[x, y] = (br, bg, bb, 255)
            changed += 1
    return changed


def refresh_gloves_from_backup(
    final_img: Image.Image,
    backup_img: Image.Image,
) -> int:
    """Replace flat cutout gloves with the shaded glove pixels from source."""
    w, h = final_img.size
    if backup_img.size != (w, h):
        return 0

    final_pixels = final_img.load()
    backup_pixels = backup_img.load()
    changed = 0
    for y in range(h):
        for x in range(w):
            if not backup_is_glove_white_pixel(backup_pixels, x, y, w, h):
                continue
            br, bg, bb, _ba = backup_pixels[x, y]
            fr, fg, fb, fa = final_pixels[x, y]
            if fa < 128 or is_white_glove_pixel(fr, fg, fb, fa):
                final_pixels[x, y] = (br, bg, bb, 255)
                changed += 1
    return changed


def restore_interior_keeper_pixels(
    final_img: Image.Image,
    backup_img: Image.Image,
    min_neighbors: int = 3,
) -> int:
    """Fill only interior holes, never studio fringe around the cutout edge."""
    w, h = final_img.size
    if backup_img.size != (w, h):
        return 0

    final_pixels = final_img.load()
    backup_pixels = backup_img.load()
    restored = 0
    for y in range(h):
        for x in range(w):
            if final_pixels[x, y][3] >= 16:
                continue
            br, bg, bb, ba = backup_pixels[x, y]
            if not _keeper_material_pixel(br, bg, bb, ba):
                continue

            neighbors = 0
            for nx, ny in (
                (x - 1, y),
                (x + 1, y),
                (x, y - 1),
                (x, y + 1),
                (x - 1, y - 1),
                (x + 1, y - 1),
                (x - 1, y + 1),
                (x + 1, y + 1),
            ):
                if not (0 <= nx < w and 0 <= ny < h):
                    continue
                nr, ng, nb, na = backup_pixels[nx, ny]
                if _keeper_material_pixel(nr, ng, nb, na):
                    neighbors += 1
            if neighbors < min_neighbors:
                continue

            final_pixels[x, y] = (br, bg, bb, 255)
            restored += 1
    return restored


def remove_edge_fringe(pixels, w: int, h: int, max_passes: int = 3) -> int:
    """Delete gray/white cutout residue sitting on transparency edges."""
    removed = 0
    for _ in range(max_passes):
        to_clear: list[tuple[int, int]] = []
        for y in range(h):
            for x in range(w):
                r, g, b, a = pixels[x, y]
                if a < 16:
                    continue

                touches_transparent = False
                for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                    if not (0 <= nx < w and 0 <= ny < h) or pixels[nx, ny][3] < 16:
                        touches_transparent = True
                        break
                if not touches_transparent:
                    continue

                near_white = r > 210 and g > 205 and b > 200 and max(r, g, b) - min(r, g, b) < 30
                if not (is_gray_fringe(r, g, b, a) or near_white):
                    continue

                glove_anchor = False
                for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                    if not (0 <= nx < w and 0 <= ny < h) or pixels[nx, ny][3] < 128:
                        continue
                    nr, ng, nb, na = pixels[nx, ny]
                    if is_green(nr, ng, nb, na) or is_white_glove_pixel(nr, ng, nb, na):
                        glove_anchor = True
                        break
                if glove_anchor:
                    continue

                inner = 0
                for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                    if not (0 <= nx < w and 0 <= ny < h) or pixels[nx, ny][3] < 200:
                        continue
                    nr, ng, nb, na = pixels[nx, ny]
                    if is_keeper_pixel(nr, ng, nb, na) and not is_gray_fringe(nr, ng, nb, na):
                        inner += 1
                if inner < 2:
                    to_clear.append((x, y))

        if not to_clear:
            break
        for x, y in to_clear:
            pixels[x, y] = (0, 0, 0, 0)
            removed += 1
    return removed


def normalize_with_anchor(img: Image.Image, anchor: tuple[int, int, int, int]) -> Image.Image:
    canvas = Image.new("RGBA", (KEEPER_CANVAS_W, KEEPER_CANVAS_H), (0, 0, 0, 0))
    left, top, right, bottom = anchor
    center_x = (left + right) // 2
    paste_x = KEEPER_CANVAS_W // 2 - center_x
    paste_y = KEEPER_CANVAS_H - bottom
    canvas.paste(img, (paste_x, paste_y), img)
    return canvas


def subject_crop_box(img: Image.Image) -> tuple[int, int, int, int]:
    w, h = img.size
    pixels = img.load()
    bbox = [w, h, 0, 0]
    for y in range(h):
        for x in range(w):
            if pixels[x, y][3]:
                bbox[0] = min(bbox[0], x)
                bbox[1] = min(bbox[1], y)
                bbox[2] = max(bbox[2], x)
                bbox[3] = max(bbox[3], y)
    l, t, r, b = bbox
    pad = int(max(r - l, b - t) * 0.03)
    return (max(0, l - pad), max(0, t - pad), min(w, r + pad), min(h, b + pad))


def crop_subject(img: Image.Image) -> Image.Image:
    return img.crop(subject_crop_box(img))


def strict_ball_pixel(pixels, x: int, y: int, w: int, h: int, rad: int = 5) -> bool:
    r, g, b, a = pixels[x, y]
    if a < 128:
        return False
    if is_flesh_or_glove(r, g, b) or is_green(r, g, b, a):
        return False
    if max(r, g, b) < 55 and r + g + b < 120:
        return False
    if is_ball_remnant(r, g, b):
        return True
    if r <= 248 or g <= 248 or b <= 248:
        return False

    for ny in range(max(0, y - rad), min(h, y + rad + 1)):
        for nx in range(max(0, x - rad), min(w, x + rad + 1)):
            if (nx - x) ** 2 + (ny - y) ** 2 > rad * rad:
                continue
            nr, ng, nb, na = pixels[nx, ny]
            if na < 128:
                continue
            if max(nr, ng, nb) < 70 and min(nr, ng, nb) < 35:
                return True
    return False


def is_protected_contact_pixel(r: int, g: int, b: int, a: int) -> bool:
    if a < 128:
        return False
    if is_keeper_pixel(r, g, b, a) or is_flesh_or_glove(r, g, b):
        return True
    return r > 228 and g > 222 and b > 208


def contact_zone_box(w: int, h: int) -> tuple[int, int, int, int]:
    return int(w * 0.42), int(h * 0.66), int(w * 0.66), h


def strip_ball_colors_in_contact_zone(pixels, w: int, h: int) -> int:
    """Remove only ball-colored pixels near the glove, never keeper material."""
    x0, y0, x1, y1 = contact_zone_box(w, h)
    removed = 0
    for y in range(y0, y1):
        for x in range(x0, x1):
            r, g, b, a = pixels[x, y]
            if a < 16 or is_protected_contact_pixel(r, g, b, a):
                continue
            if strict_ball_pixel(pixels, x, y, w, h) or (
                is_ball_remnant(r, g, b)
                and not is_protected_contact_pixel(r, g, b, a)
            ):
                pixels[x, y] = (0, 0, 0, 0)
                removed += 1
    return removed


def rebuild_contact_zone_from_backup(final_img: Image.Image, backup_img: Image.Image) -> int:
    """Rebuild the glove over the removed ball using nearby keeper pixels."""
    w, h = final_img.size
    if backup_img.size != (w, h):
        return 0

    final_pixels = final_img.load()
    backup_pixels = backup_img.load()
    x0, y0, x1, y1 = contact_zone_box(w, h)
    keeper_sources: list[tuple[int, int, tuple[int, int, int]]] = []

    for y in range(y0, y1):
        for x in range(x0, x1):
            br, bg, bb, ba = backup_pixels[x, y]
            if ba < 128:
                continue
            if strict_ball_pixel(backup_pixels, x, y, w, h):
                continue
            if is_protected_contact_pixel(br, bg, bb, ba) or is_keeper_pixel(br, bg, bb, ba):
                keeper_sources.append((x, y, (br, bg, bb)))

    if not keeper_sources:
        return 0

    changed = 0
    for y in range(y0, y1):
        for x in range(x0, x1):
            br, bg, bb, ba = backup_pixels[x, y]
            fr, fg, fb, fa = final_pixels[x, y]
            if fa >= 128 and is_protected_contact_pixel(fr, fg, fb, fa):
                continue
            if fa < 128 and ba >= 128 and (
                is_keeper_pixel(br, bg, bb, ba)
                or backup_is_glove_white_pixel(backup_pixels, x, y, w, h)
            ):
                final_pixels[x, y] = (br, bg, bb, 255)
                changed += 1
                continue
            if fa >= 128 and (
                strict_ball_pixel(final_pixels, x, y, w, h)
                or (is_ball_remnant(fr, fg, fb) and not is_protected_contact_pixel(fr, fg, fb, fa))
            ):
                final_pixels[x, y] = (0, 0, 0, 0)
                changed += 1
    return changed


def heal_glove_surface(pixels, w: int, h: int, max_passes: int = 36) -> int:
    """Fill holes in the glove using nearby glove and skin pixels."""
    x0, y0, x1, y1 = contact_zone_box(w, h)
    filled = 0
    for _ in range(max_passes):
        to_fill: list[tuple[int, int, tuple[int, int, int, int]]] = []
        for y in range(y0, y1):
            for x in range(x0, x1):
                if pixels[x, y][3] >= 64:
                    continue
                samples = [
                    pixels[nx, ny]
                    for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1))
                    if x0 <= nx < x1 and y0 <= ny < y1 and pixels[nx, ny][3] >= 128
                    and is_protected_contact_pixel(*pixels[nx, ny])
                ]
                if len(samples) < 2:
                    continue
                r = sum(c[0] for c in samples) // len(samples)
                g = sum(c[1] for c in samples) // len(samples)
                b = sum(c[2] for c in samples) // len(samples)
                to_fill.append((x, y, (r, g, b, 255)))
        if not to_fill:
            break
        for x, y, color in to_fill:
            pixels[x, y] = color
        filled += len(to_fill)
    return filled


def apply_aligned_backup_sync(final_img: Image.Image, backup_img: Image.Image) -> int:
    """Use the pre-ball-removal frame to heal glove holes and strip the ball."""
    w, h = final_img.size
    if backup_img.size != (w, h):
        return 0

    final_pixels = final_img.load()
    backup_pixels = backup_img.load()
    changed = 0
    x0, y0, x1, y1 = contact_zone_box(w, h)

    for y in range(y0, y1):
        for x in range(x0, x1):
            br, bg, bb, ba = backup_pixels[x, y]
            if ba < 128:
                continue
            fr, fg, fb, fa = final_pixels[x, y]
            if fa >= 128:
                continue
            if strict_ball_pixel(backup_pixels, x, y, w, h):
                continue
            if is_keeper_pixel(br, bg, bb, ba) or backup_is_glove_white_pixel(
                backup_pixels, x, y, w, h
            ):
                final_pixels[x, y] = (br, bg, bb, 255)
                changed += 1
    return changed


def process_dive_low(src: Path, dst: Path, target_h: int = TARGET_H) -> tuple[int, int, int]:
    """Low-dive pose includes an embedded ball in the source - remove it before export."""
    img = Image.open(src).convert("RGBA")
    w, h = img.size
    pixels = img.load()

    flood_remove_background(pixels, w, h)
    removed = remove_enclosed_white(pixels, w, h, min_size=60)
    solidify_alpha(pixels, w, h)
    removed += fill_interior_holes(pixels, w, h, max_passes=16)
    backup = img.copy()
    removed += remove_embedded_ball(img)
    removed += restore_keeper_contact_zone(img, backup)
    removed += heal_silhouette_gaps(
        pixels,
        w,
        h,
        max_passes=20,
        min_neighbors=3,
        x0=int(w * 0.56),
        y0=int(h * 0.6),
        x1=int(w * 0.86),
        y1=int(h * 0.98),
    )

    crop_box = subject_crop_box(backup)
    img = img.crop(crop_box)
    backup = backup.crop(crop_box)
    ratio = target_h / img.size[1]
    resized = (max(1, int(img.size[0] * ratio)), target_h)
    img = img.resize(resized, Image.Resampling.LANCZOS)
    backup = backup.resize(resized, Image.Resampling.LANCZOS)

    anchor = backup.getbbox() or img.getbbox()
    if not anchor:
        dst.parent.mkdir(parents=True, exist_ok=True)
        Image.new("RGBA", (KEEPER_CANVAS_W, KEEPER_CANVAS_H), (0, 0, 0, 0)).save(
            dst, "WEBP", lossless=True
        )
        return KEEPER_CANVAS_W, KEEPER_CANVAS_H, removed

    img = normalize_with_anchor(img, anchor)
    backup = normalize_with_anchor(backup, anchor)
    solidify_alpha(img.load(), img.size[0], img.size[1])
    removed += apply_aligned_backup_sync(img, backup)
    w, h = img.size
    pixels = img.load()
    removed += rebuild_contact_zone_from_backup(img, backup)
    removed += strip_ball_colors_in_contact_zone(pixels, w, h)
    x0, y0, x1, y1 = contact_zone_box(w, h)
    removed += fill_interior_holes(
        pixels, w, h, min_neighbors=2, max_passes=40, x0=x0, y0=y0, x1=x1, y1=y1
    )
    removed += heal_glove_surface(pixels, w, h, max_passes=16)
    solidify_alpha(pixels, w, h)
    dst.parent.mkdir(parents=True, exist_ok=True)
    img.save(dst, "WEBP", lossless=True)
    return img.size[0], img.size[1], removed


def process_keeper_high(src: Path, dst: Path, target_h: int = HIGH_TARGET_H) -> tuple[int, int, int]:
    """High jump pose - matte directly from the white studio source."""
    raw = Image.open(src).convert("RGBA")
    raw = raw.crop(studio_subject_crop_box(raw))

    ratio = target_h / raw.size[1]
    raw = raw.resize(
        (max(1, int(raw.size[0] * ratio)), target_h),
        Image.Resampling.LANCZOS,
    )

    img, removed = render_keeper_from_source(raw)

    w, h = img.size
    pixels = img.load()
    removed += remove_white_halos(pixels, w, h, max_passes=2, min_rgb=(240, 236, 236))
    removed += fill_interior_holes(pixels, w, h, max_passes=12)
    solidify_alpha(pixels, w, h)

    img, _canvas_scale, _canvas_paste_x, _canvas_paste_y = normalize_keeper_canvas_fit_high(img)

    w, h = img.size
    pixels = img.load()
    removed += remove_disconnected_strays(pixels, w, h)
    removed += remove_edge_fringe(pixels, w, h, max_passes=2)
    solidify_alpha(pixels, w, h)

    dst.parent.mkdir(parents=True, exist_ok=True)
    img.save(dst, "WEBP", lossless=True)
    return img.size[0], img.size[1], removed


def process_keeper(src: Path, dst: Path, target_h: int = TARGET_H) -> tuple[int, int, int]:
    """Standing pose - matte from source to preserve white gloves."""
    raw = Image.open(src).convert("RGBA")
    raw = raw.crop(studio_subject_crop_box(raw))

    ratio = target_h / raw.size[1]
    raw = raw.resize(
        (max(1, int(raw.size[0] * ratio)), target_h),
        Image.Resampling.LANCZOS,
    )

    img, removed = render_keeper_from_source(raw)

    w, h = img.size
    pixels = img.load()
    removed += remove_white_halos(pixels, w, h, max_passes=2, min_rgb=(240, 236, 236))
    removed += fill_interior_holes(pixels, w, h, max_passes=12)
    solidify_alpha(pixels, w, h)

    img = normalize_keeper_canvas(img)

    w, h = img.size
    pixels = img.load()
    solidify_alpha(pixels, w, h)

    dst.parent.mkdir(parents=True, exist_ok=True)
    img.save(dst, "WEBP", lossless=True)
    return img.size[0], img.size[1], removed


def process_ball(src: Path, dst: Path, target_size: int = BALL_SIZE) -> tuple[int, int, int]:
    img = Image.open(src).convert("RGBA")
    w, h = img.size
    pixels = img.load()

    flood_remove_background(pixels, w, h)
    removed = remove_white_halos(pixels, w, h, max_passes=2)
    solidify_alpha(pixels, w, h)

    img = crop_subject(img)
    size = max(img.size)
    pad = int(size * 0.04)
    padded = Image.new("RGBA", (size + pad * 2, size + pad * 2), (0, 0, 0, 0))
    ox = (padded.size[0] - img.size[0]) // 2
    oy = (padded.size[1] - img.size[1]) // 2
    padded.paste(img, (ox, oy), img)
    img = padded.resize((target_size, target_size), Image.Resampling.LANCZOS)

    w, h = img.size
    pixels = img.load()
    removed += remove_white_halos(pixels, w, h, max_passes=4, min_rgb=(212, 208, 208))
    solidify_alpha(pixels, w, h)

    dst.parent.mkdir(parents=True, exist_ok=True)
    img.save(dst, "WEBP", lossless=True)
    return img.size[0], img.size[1], removed


def main() -> None:
    for out_name, keeper_spec in KEEPER_FILES.items():
        src_name, target_h = keeper_spec
        src = ASSETS / src_name
        dst = OUT_DIR / out_name
        if not src.exists():
            print(f"SKIP missing source: {src}")
            continue
        if out_name == "penalty-keeper-dive-high.webp":
            w, h, removed = process_keeper_high(src, dst, target_h=target_h)
        else:
            w, h, removed = process_keeper(src, dst, target_h=target_h)
        print(f"{out_name}: {w}x{h}, removed {removed} stray px")

    for out_name, src_name in BALL_FILE.items():
        src = ASSETS / src_name
        dst = OUT_DIR / out_name
        if not src.exists():
            print(f"SKIP missing source: {src}")
            continue
        w, h, removed = process_ball(src, dst)
        print(f"{out_name}: {w}x{h}, removed {removed} halo px")


if __name__ == "__main__":
    main()
