"""Add a soft contact shadow to the Blender tape renders and export WebP.

Corner pieces export 512 px wide and strips 768 px.

  python3 art/finish_tape.py art/renders/tape src/assets/tape

The warm shadow is built from the film's own alpha at render resolution, then
the sprite is filtered down; no cork or photograph pixels are baked in.
"""

import glob
import os
import sys

from PIL import Image, ImageFilter


SHADOW_COLOR = (43, 24, 11)
WIDTHS = {"corner": 512, "strip": 768}


def finish(image):
    w, h = image.size
    film = image.getchannel("A")
    shadow = Image.new("L", image.size)
    shadow.paste(film, (max(1, round(w * .002)), max(2, round(h * .017))))
    shadow = shadow.filter(ImageFilter.GaussianBlur(max(1.2, h * .010))).point(lambda a: round(a * .43))
    layer = Image.new("RGBA", image.size, SHADOW_COLOR + (0,))
    layer.putalpha(shadow)
    return Image.alpha_composite(layer, image)


def main():
    if len(sys.argv) != 3:
        raise SystemExit("Usage: finish_tape.py <render dir> <output dir>")
    source, destination = sys.argv[1:]
    os.makedirs(destination, exist_ok=True)
    files = sorted(glob.glob(os.path.join(source, "tape-*.png")))
    if not files:
        raise SystemExit("No Blender tape renders found in " + source)
    for path in files:
        result = finish(Image.open(path).convert("RGBA"))
        width = WIDTHS["strip" if "-strip-" in path else "corner"]
        result = result.resize((width, round(result.height * width / result.width)), Image.Resampling.LANCZOS)
        output = os.path.join(destination, os.path.splitext(os.path.basename(path))[0] + ".webp")
        result.save(output, "WEBP", quality=93, alpha_quality=100, method=6)
        print(f"{output}: {result.width}x{result.height}, {os.path.getsize(output)} bytes")


if __name__ == "__main__":
    main()
