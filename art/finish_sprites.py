"""Composite and export the physical Blender sprites as transparent WebP.

  python art/finish_sprites.py pins art/renders/pins src/assets/pins
  python art/finish_sprites.py tape art/renders/tape src/assets/tape

The warm shadows are kept outside the photographed object/film. They are
constructed at the original render resolution, then filtered for clean small
sprites; no fixed cork or photograph pixels are baked into the art.
"""

import glob
import os
import sys

from PIL import Image, ImageChops, ImageDraw, ImageFilter


SHADOW_COLOR = (43, 24, 11)


def layer(image, alpha):
    out = Image.new("RGBA", image.size, SHADOW_COLOR + (0,))
    out.putalpha(alpha)
    return out


def translated_mask(mask, x, y):
    shifted = Image.new("L", mask.size)
    shifted.paste(mask, (x, y))
    return shifted


def finish_pin(image):
    # First, an open, soft shadow projected from the cap toward lower right.
    # The narrow dark edge directly beneath the flange seats it on the print.
    w, h = image.size
    body = image.getchannel("A")
    projection = translated_mask(body, round(w * .052), round(h * .071))
    projection = projection.filter(ImageFilter.GaussianBlur(w * .049))
    projection = projection.point(lambda a: round(a * .35))
    contact = Image.new("L", image.size)
    draw = ImageDraw.Draw(contact)
    draw.ellipse((round(w * .29), round(h * .39),
                  round(w * .73), round(h * .72)), fill=115)
    contact = contact.filter(ImageFilter.GaussianBlur(w * .018))
    shadow = ImageChops.lighter(projection, contact)
    return Image.alpha_composite(layer(image, shadow), image)


def finish_tape(image):
    w, h = image.size
    film = image.getchannel("A")
    shadow = translated_mask(film, max(1, round(w * .002)), max(2, round(h * .017)))
    shadow = shadow.filter(ImageFilter.GaussianBlur(max(1.2, h * .010)))
    shadow = shadow.point(lambda a: round(a * .43))
    return Image.alpha_composite(layer(image, shadow), image)


def main():
    if len(sys.argv) != 4 or sys.argv[1] not in ("pins", "tape"):
        raise SystemExit("Usage: finish_sprites.py pins|tape <render dir> <output dir>")
    kind, source, destination = sys.argv[1:]
    os.makedirs(destination, exist_ok=True)
    files = sorted(glob.glob(os.path.join(source, "*.png")))
    if not files:
        raise SystemExit("No Blender PNG renders found in " + source)
    for path in files:
        image = Image.open(path).convert("RGBA")
        name = os.path.splitext(os.path.basename(path))[0]
        if kind == "pins" and not name.startswith("pin-"):
            continue
        if kind == "tape" and not name.startswith("tape-"):
            continue
        result = finish_pin(image) if kind == "pins" else finish_tape(image)
        width = 256 if kind == "pins" else (512 if "corner" in name else 768)
        result = result.resize((width, round(result.height * width / result.width)), Image.Resampling.LANCZOS)
        output = os.path.join(destination, name + ".webp")
        result.save(output, "WEBP", quality=93, alpha_quality=100, method=6)
        print(f"{output}: {result.width}x{result.height}, {os.path.getsize(output)} bytes")


if __name__ == "__main__":
    main()
