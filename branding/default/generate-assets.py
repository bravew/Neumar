#!/usr/bin/env python3
"""
Generate all branding assets from two source brand images.

- ICON_SOURCE (logo_app.png): Gold bull on dark navy background with rounded
  corners. Used for all platform icon files (app icon in OS, installer, dock).
- LOGO_SOURCE (logo.png): Gold bull on transparent background.
  Used for the in-app logo (logo.png, app-icon.png at top level).
"""

import subprocess
import tempfile
from pathlib import Path

from PIL import Image

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).parent
BRANDING_DIR = SCRIPT_DIR.parent

# App-icon source: dark navy background with rounded corners → platform icons
ICON_SOURCE = BRANDING_DIR / "logo_app.png"
# Logo source: transparent background → in-app logo
LOGO_SOURCE = BRANDING_DIR / "logo.png"

ICONS_DIR = SCRIPT_DIR / "icons"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def resize_icon(src: Image.Image, size: int) -> Image.Image:
    """High-quality resize to square dimensions."""
    return src.resize((size, size), Image.LANCZOS)


def save_png(img: Image.Image, path: Path):
    """Save as optimized PNG."""
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(str(path), "PNG", optimize=True)
    print(f"  Created: {path.relative_to(SCRIPT_DIR)} ({img.size[0]}x{img.size[1]})")


def generate_favicon(src: Image.Image, path: Path):
    """Generate a multi-resolution .ico file with 16, 32, and 48 px sizes."""
    sizes = [(16, 16), (32, 32), (48, 48)]
    path.parent.mkdir(parents=True, exist_ok=True)
    src.save(str(path), "ICO", sizes=sizes)
    print(f"  Created: {path.relative_to(SCRIPT_DIR)} (multi-size ICO: 16, 32, 48)")


def generate_windows_ico(src: Image.Image, path: Path):
    """Generate a rich multi-resolution .ico for Windows."""
    sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    path.parent.mkdir(parents=True, exist_ok=True)
    src.save(str(path), "ICO", sizes=sizes)
    print(f"  Created: {path.relative_to(SCRIPT_DIR)} (multi-size ICO: 16-256)")


def generate_icns(src: Image.Image, path: Path):
    """Generate macOS .icns file using iconutil."""
    iconset_sizes = {
        "icon_16x16.png": 16,
        "icon_16x16@2x.png": 32,
        "icon_32x32.png": 32,
        "icon_32x32@2x.png": 64,
        "icon_128x128.png": 128,
        "icon_128x128@2x.png": 256,
        "icon_256x256.png": 256,
        "icon_256x256@2x.png": 512,
        "icon_512x512.png": 512,
        "icon_512x512@2x.png": 1024,
    }

    with tempfile.TemporaryDirectory() as tmpdir:
        iconset_dir = Path(tmpdir) / "icon.iconset"
        iconset_dir.mkdir()

        for filename, size in iconset_sizes.items():
            icon = resize_icon(src, size)
            icon.save(str(iconset_dir / filename), "PNG")

        path.parent.mkdir(parents=True, exist_ok=True)
        result = subprocess.run(
            ["iconutil", "-c", "icns", str(iconset_dir), "-o", str(path)],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            print(f"  ERROR generating .icns: {result.stderr}")
        else:
            print(f"  Created: {path.relative_to(SCRIPT_DIR)} (macOS icns bundle)")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    print(f"Loading icon source (platform icons): {ICON_SOURCE.name}")
    icon_src = Image.open(str(ICON_SOURCE)).convert("RGBA")
    print(f"  Source: {icon_src.size[0]}x{icon_src.size[1]}, mode={icon_src.mode}")

    print(f"\nLoading logo source (in-app logo): {LOGO_SOURCE.name}")
    logo_src = Image.open(str(LOGO_SOURCE)).convert("RGBA")
    print(f"  Source: {logo_src.size[0]}x{logo_src.size[1]}, mode={logo_src.mode}")

    # ------------------------------------------------------------------
    # Top-level brand assets
    # ------------------------------------------------------------------
    print("\n--- Top-level brand assets ---")
    # logo.png: transparent bull, used inside the application
    save_png(resize_icon(logo_src, 256), SCRIPT_DIR / "logo.png")
    # app-icon.png: full branded icon with background, used for OS/installer
    save_png(resize_icon(icon_src, 512), SCRIPT_DIR / "app-icon.png")
    # favicon uses the transparent logo for better rendering on light backgrounds
    generate_favicon(logo_src, SCRIPT_DIR / "favicon.ico")

    # ------------------------------------------------------------------
    # Tauri standard icons (all use the branded icon with background)
    # ------------------------------------------------------------------
    print("\n--- Tauri icons ---")
    save_png(resize_icon(icon_src, 32), ICONS_DIR / "32x32.png")
    save_png(resize_icon(icon_src, 64), ICONS_DIR / "64x64.png")
    save_png(resize_icon(icon_src, 128), ICONS_DIR / "128x128.png")
    save_png(resize_icon(icon_src, 256), ICONS_DIR / "128x128@2x.png")
    save_png(resize_icon(icon_src, 512), ICONS_DIR / "icon.png")

    # macOS .icns
    generate_icns(icon_src, ICONS_DIR / "icon.icns")

    # Windows .ico
    generate_windows_ico(icon_src, ICONS_DIR / "icon.ico")

    # ------------------------------------------------------------------
    # Windows Square logos (UWP / Store tiles)
    # ------------------------------------------------------------------
    print("\n--- Windows Square logos ---")
    windows_squares = {
        "Square30x30Logo.png": 30,
        "Square44x44Logo.png": 44,
        "Square71x71Logo.png": 71,
        "Square89x89Logo.png": 89,
        "Square107x107Logo.png": 107,
        "Square142x142Logo.png": 142,
        "Square150x150Logo.png": 150,
        "Square284x284Logo.png": 284,
        "Square310x310Logo.png": 310,
    }
    for filename, size in windows_squares.items():
        save_png(resize_icon(icon_src, size), ICONS_DIR / filename)

    save_png(resize_icon(icon_src, 50), ICONS_DIR / "StoreLogo.png")

    # ------------------------------------------------------------------
    # Android adaptive icons
    # ------------------------------------------------------------------
    print("\n--- Android icons ---")
    android_densities = {
        "mipmap-mdpi": 48,
        "mipmap-hdpi": 72,
        "mipmap-xhdpi": 96,
        "mipmap-xxhdpi": 144,
        "mipmap-xxxhdpi": 192,
    }

    android_dir = ICONS_DIR / "android"
    for density, size in android_densities.items():
        density_dir = android_dir / density
        icon = resize_icon(icon_src, size)
        save_png(icon, density_dir / "ic_launcher.png")
        save_png(icon, density_dir / "ic_launcher_foreground.png")
        save_png(icon, density_dir / "ic_launcher_round.png")

    # ------------------------------------------------------------------
    # iOS AppIcon set
    # ------------------------------------------------------------------
    print("\n--- iOS AppIcon set ---")
    ios_dir = ICONS_DIR / "ios"
    ios_icons = {
        "AppIcon-20x20@1x.png": 20,
        "AppIcon-20x20@2x.png": 40,
        "AppIcon-20x20@2x-1.png": 40,
        "AppIcon-20x20@3x.png": 60,
        "AppIcon-29x29@1x.png": 29,
        "AppIcon-29x29@2x.png": 58,
        "AppIcon-29x29@2x-1.png": 58,
        "AppIcon-29x29@3x.png": 87,
        "AppIcon-40x40@1x.png": 40,
        "AppIcon-40x40@2x.png": 80,
        "AppIcon-40x40@2x-1.png": 80,
        "AppIcon-40x40@3x.png": 120,
        "AppIcon-60x60@2x.png": 120,
        "AppIcon-60x60@3x.png": 180,
        "AppIcon-76x76@1x.png": 76,
        "AppIcon-76x76@2x.png": 152,
        "AppIcon-83.5x83.5@2x.png": 167,
        "AppIcon-512@2x.png": 1024,
    }
    for filename, size in ios_icons.items():
        save_png(resize_icon(icon_src, size), ios_dir / filename)

    # ------------------------------------------------------------------
    # Summary
    # ------------------------------------------------------------------
    print("\n✅ All branding assets generated successfully!")
    print(f"   Icon source:  {ICON_SOURCE.name} (platform icons)")
    print(f"   Logo source:  {LOGO_SOURCE.name} (in-app logo)")
    print(f"   Output: {SCRIPT_DIR.relative_to(SCRIPT_DIR.parent)}/")


if __name__ == "__main__":
    main()
