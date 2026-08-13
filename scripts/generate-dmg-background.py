#!/usr/bin/env python3
"""Generate DMG background images for macOS installer.

Creates a professional drag-to-install background with an arrow
pointing from the app icon position to the Applications folder position.

Usage: python3 scripts/generate-dmg-background.py
Output: src-tauri/dmg/background.png (1x) and src-tauri/dmg/background@2x.png (2x)
"""

import math
import os
from PIL import Image, ImageDraw, ImageFont

# DMG window dimensions (must match tauri.conf.json and appdmg config)
WINDOW_W, WINDOW_H = 660, 400

# Icon center positions (must match tauri.conf.json appPosition/applicationFolderPosition)
APP_X, APP_Y = 180, 170
APPS_X, APPS_Y = 480, 170

# Colors - warm dark theme matching Neumar branding
BG_COLOR_TOP = (30, 26, 24)       # Dark warm gray
BG_COLOR_BOTTOM = (42, 36, 32)    # Slightly lighter warm gray
ARROW_COLOR = (180, 140, 100, 140)  # Semi-transparent warm gold
TEXT_COLOR = (160, 140, 120, 180)   # Subtle warm text


def draw_arrow(draw, x1, y, x2, scale, color):
    """Draw a right-pointing arrow with arrowhead."""
    lw = int(3 * scale)
    head_len = int(16 * scale)
    head_w = int(10 * scale)

    # Shaft
    draw.line([(x1, y), (x2 - head_len, y)], fill=color, width=lw)

    # Arrowhead (filled triangle)
    draw.polygon([
        (x2, y),
        (x2 - head_len, y - head_w),
        (x2 - head_len, y + head_w),
    ], fill=color)


def draw_gradient(img, color_top, color_bottom):
    """Draw a vertical gradient background."""
    w, h = img.size
    pixels = img.load()
    for y in range(h):
        t = y / h
        r = int(color_top[0] + (color_bottom[0] - color_top[0]) * t)
        g = int(color_top[1] + (color_bottom[1] - color_top[1]) * t)
        b = int(color_top[2] + (color_bottom[2] - color_top[2]) * t)
        for x in range(w):
            pixels[x, y] = (r, g, b)


def generate_background(scale):
    """Generate DMG background at given scale (1 or 2)."""
    w = WINDOW_W * scale
    h = WINDOW_H * scale

    # Create gradient background
    img = Image.new("RGB", (w, h))
    draw_gradient(img, BG_COLOR_TOP, BG_COLOR_BOTTOM)

    # Overlay for arrow (with alpha)
    overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    # Arrow from right of app icon to left of Applications folder
    arrow_y = int(APP_Y * scale)
    arrow_x1 = int((APP_X + 55) * scale)   # Right edge of app icon area
    arrow_x2 = int((APPS_X - 55) * scale)  # Left edge of Applications area

    draw_arrow(draw, arrow_x1, arrow_y, arrow_x2, scale, ARROW_COLOR)

    # Instructional text below icons
    text_y = int(260 * scale)
    font_size = int(13 * scale)

    try:
        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", font_size)
    except (OSError, IOError):
        try:
            font = ImageFont.truetype("/System/Library/Fonts/SFNSText.ttf", font_size)
        except (OSError, IOError):
            font = ImageFont.load_default()

    text = "Drag to Applications to install"
    bbox = draw.textbbox((0, 0), text, font=font)
    text_w = bbox[2] - bbox[0]
    text_x = (w - text_w) // 2
    draw.text((text_x, text_y), text, fill=TEXT_COLOR, font=font)

    # Composite overlay onto background
    img_rgba = img.convert("RGBA")
    img_rgba = Image.alpha_composite(img_rgba, overlay)
    return img_rgba.convert("RGB")


def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir)
    output_dir = os.path.join(project_root, "src-tauri", "dmg")
    os.makedirs(output_dir, exist_ok=True)

    # Generate 1x background (660x400)
    img_1x = generate_background(1)
    path_1x = os.path.join(output_dir, "background.png")
    img_1x.save(path_1x, "PNG")
    print(f"Created {path_1x} ({img_1x.size[0]}x{img_1x.size[1]})")

    # Generate 2x background for Retina (1320x800)
    img_2x = generate_background(2)
    path_2x = os.path.join(output_dir, "background@2x.png")
    img_2x.save(path_2x, "PNG")
    print(f"Created {path_2x} ({img_2x.size[0]}x{img_2x.size[1]})")


if __name__ == "__main__":
    main()
