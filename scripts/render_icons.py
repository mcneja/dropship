"""
Generate small-planet icons for the PWA manifest.

Outputs:
  public/icons/icon-512.png
  public/icons/icon-192.png

Usage:
  python scripts/render_icons.py
"""

from __future__ import annotations

import math
from pathlib import Path
from typing import Tuple

from PIL import Image, ImageDraw, ImageFilter


def _lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def _lerp_color(c1: Tuple[int, int, int], c2: Tuple[int, int, int], t: float) -> Tuple[int, int, int]:
    return (
        int(_lerp(c1[0], c2[0], t)),
        int(_lerp(c1[1], c2[1], t)),
        int(_lerp(c1[2], c2[2], t)),
    )


def render_icon(size: int, out_path: Path) -> None:
    # Canvas
    img = Image.new("RGB", (size, size), (0, 0, 0))

    # Planet parameters
    cx = cy = size * 0.52
    radius = size * 0.36

    # Planet gradient (purple)
    planet = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    pdraw = ImageDraw.Draw(planet)
    light = (170, 110, 255)
    dark = (60, 20, 120)
    steps = int(radius)
    # Gradient center
    gx = cx
    gy = cy
    for i in range(steps, 0, -1):
        t = i / steps
        # Reverse gradient: light inside, dark outside
        color = _lerp_color(light, dark, t)
        r = radius * t
        pdraw.ellipse([gx - r, gy - r, gx + r, gy + r], fill=(*color, 255))

    # Subtle rim
    rim = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    rdraw = ImageDraw.Draw(rim)
    rdraw.ellipse(
        [cx - radius * 1.01, cy - radius * 1.01, cx + radius * 1.01, cy + radius * 1.01],
        outline=(200, 170, 255, 110),
        width=max(1, int(size * 0.008)),
    )

    # Ring (light blue) with layered bands and perspective
    ring = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ring_draw = ImageDraw.Draw(ring)
    ring_rx = radius * 1.75
    ring_ry = radius * 0.42  # perspective flattening
    ring_width = max(1, int(size * 0.01))
    bands = [
        (1.00, 180),
        (0.92, 140),
        (0.84, 110),
        (0.76, 90),
    ]
    for scale, alpha in bands:
        rx = ring_rx * scale
        ry = ring_ry * scale
        ring_draw.ellipse(
            [cx - rx, cy - ry, cx + rx, cy + ry],
            outline=(140, 210, 255, alpha),
            width=ring_width,
        )

    # Mask back half of the ring behind the planet
    ring_back = ring.copy()
    ring_front = ring.copy()
    mask = Image.new("L", (size, size), 0)
    mdraw = ImageDraw.Draw(mask)
    mdraw.pieslice([cx - radius, cy - radius, cx + radius, cy + radius], 180, 360, fill=255)
    ring_back.putalpha(Image.eval(ring_back.split()[-1], lambda v: v))
    ring_back = Image.composite(ring_back, Image.new("RGBA", (size, size), (0, 0, 0, 0)), mask)
    ring_front = Image.composite(Image.new("RGBA", (size, size), (0, 0, 0, 0)), ring_front, mask)

    # Small gray fighter
    ship = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    sdraw = ImageDraw.Draw(ship)
    ship_x = cx + radius * 1.05
    ship_y = cy - radius * 0.95
    ship_w = max(5, int(size * 0.055))
    ship_h = max(4, int(size * 0.028))
    # Fuselage
    sdraw.polygon(
        [
            (ship_x - ship_w * 0.9, ship_y),
            (ship_x + ship_w * 0.8, ship_y - ship_h * 0.6),
            (ship_x + ship_w * 1.2, ship_y),
            (ship_x + ship_w * 0.8, ship_y + ship_h * 0.6),
        ],
        fill=(175, 175, 175, 255),
        outline=(120, 120, 120, 255),
    )
    # Wings
    sdraw.polygon(
        [
            (ship_x - ship_w * 0.2, ship_y),
            (ship_x - ship_w * 1.1, ship_y - ship_h * 1.2),
            (ship_x - ship_w * 0.4, ship_y - ship_h * 0.3),
        ],
        fill=(160, 160, 160, 255),
        outline=(120, 120, 120, 255),
    )
    sdraw.polygon(
        [
            (ship_x - ship_w * 0.2, ship_y),
            (ship_x - ship_w * 1.1, ship_y + ship_h * 1.2),
            (ship_x - ship_w * 0.4, ship_y + ship_h * 0.3),
        ],
        fill=(160, 160, 160, 255),
        outline=(120, 120, 120, 255),
    )
    # Cockpit
    sdraw.ellipse(
        [ship_x - ship_w * 0.1, ship_y - ship_h * 0.4, ship_x + ship_w * 0.5, ship_y + ship_h * 0.4],
        fill=(180, 200, 220, 220),
        outline=(120, 140, 160, 200),
    )
    # Flame
    sdraw.polygon(
        [
            (ship_x - ship_w * 0.9, ship_y),
            (ship_x - ship_w * 1.4, ship_y - ship_h * 0.5),
            (ship_x - ship_w * 1.4, ship_y + ship_h * 0.5),
        ],
        fill=(255, 200, 80, 220),
    )

    # Composite
    img = img.convert("RGBA")
    img.alpha_composite(ring_back)
    img.alpha_composite(planet)
    img.alpha_composite(rim)
    img.alpha_composite(ring_front)
    img.alpha_composite(ship)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.convert("RGB").save(out_path, format="PNG")


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    out_dir = root / "public" / "icons"
    render_icon(512, out_dir / "icon-512.png")
    render_icon(192, out_dir / "icon-192.png")
    print("Wrote", out_dir / "icon-512.png")
    print("Wrote", out_dir / "icon-192.png")


if __name__ == "__main__":
    main()
