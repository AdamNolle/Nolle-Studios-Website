# Turns the `full` / `bare` render pairs from pins.py and tape.py into single
# web-ready sprites: the object as rendered, over its caught shadow re-tinted
# from Cycles' neutral black to a warm brown that sits naturally on cork.
#
#   python3 art/finish_sprites.py <render dir> <out dir> <width px> [shadow strength]
import glob
import os
import sys

from PIL import Image, ImageChops

SHADOW_RGB = (38, 17, 4)


def finish(full_path, bare_path, strength):
    full = Image.open(full_path).convert("RGBA")
    bare = Image.open(bare_path).convert("RGBA")
    af, ab = full.getchannel("A"), bare.getchannel("A")
    # Share of the light the board lost to shadow, outside the object itself.
    extra = ImageChops.subtract(af, ab)
    room = ab.point(lambda v: 255 - v)
    shadow_a = Image.frombytes("L", af.size, bytes(
        min(255, int(e * 255 / r * strength)) if r else 0 for e, r in zip(extra.tobytes(), room.tobytes())))
    shadow = Image.new("RGBA", af.size, SHADOW_RGB + (0,))
    shadow.putalpha(shadow_a)
    return Image.alpha_composite(shadow, bare)


def main():
    src, dst, width = sys.argv[1], sys.argv[2], int(sys.argv[3])
    strength = float(sys.argv[4]) if len(sys.argv) > 4 else 0.9
    os.makedirs(dst, exist_ok=True)
    for full in sorted(glob.glob(os.path.join(src, "*-full.png"))):
        name = os.path.basename(full)[: -len("-full.png")]
        out = finish(full, full.replace("-full.png", "-bare.png"), strength)
        out = out.resize((width, round(out.height * width / out.width)), Image.LANCZOS)
        out.save(os.path.join(dst, name + ".webp"), quality=88, alpha_quality=90, method=6)
        print(name, out.size)


if __name__ == "__main__":
    main()
