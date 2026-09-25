"""Make a one-to-one display-scale proof of the Blender sprites on cork/photo."""

from pathlib import Path

from PIL import Image, ImageOps


ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / "src" / "assets"
OUT = ROOT / "art" / "renders" / "proof.png"


def paste_sprite(board, name, width, center, angle=0):
    sprite = Image.open(ART / name).convert("RGBA")
    sprite = sprite.resize((width, round(sprite.height * width / sprite.width)), Image.Resampling.LANCZOS)
    if angle:
        sprite = sprite.rotate(angle, expand=True, resample=Image.Resampling.BICUBIC)
    board.alpha_composite(sprite, (round(center[0] - sprite.width / 2),
                                   round(center[1] - sprite.height / 2)))


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    cork = Image.open(ART / "cork-tile.webp").convert("RGBA")
    board = cork.resize((900, 900), Image.Resampling.LANCZOS).crop((0, 0, 900, 620))
    photo = ImageOps.fit(
        Image.open(ROOT / "public" / "media" / "first-frames" / "last-swing-640.webp"),
        (450, 300), method=Image.Resampling.LANCZOS).convert("RGBA")
    board.alpha_composite(Image.new("RGBA", (465, 315), (46, 25, 10, 80)), (227, 142))
    board.alpha_composite(photo, (218, 130))
    paste_sprite(board, "tape/tape-1.webp", 145, (444, 130))
    paste_sprite(board, "tape/tape-corner-1.webp", 65, (228, 140), 45)
    paste_sprite(board, "tape/tape-corner-2.webp", 65, (656, 145), -45)
    paste_sprite(board, "tape/tape-corner-2.webp", 65, (227, 425), -45)
    paste_sprite(board, "tape/tape-corner-1.webp", 65, (657, 425), 45)
    paste_sprite(board, "pins/pin-red-1.webp", 55, (244, 155))
    paste_sprite(board, "pins/pin-ivory-2.webp", 55, (635, 155))
    paste_sprite(board, "pins/pin-graphite-3.webp", 55, (360, 390))
    board.convert("RGB").save(OUT)
    print(OUT)


if __name__ == "__main__":
    main()
