"""Create local review sheets from camera JPEGs; never publishes the inputs."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--prefix", default="contact")
    parser.add_argument("--step", type=int, default=1)
    parser.add_argument("--per-sheet", type=int, default=120)
    args = parser.parse_args()
    photos = sorted((p for p in args.source.iterdir() if p.suffix.lower() in {".jpg", ".jpeg"}), key=lambda p: p.name.lower())[:: args.step]
    args.output.mkdir(parents=True, exist_ok=True)
    cell_w, cell_h, cols = 170, 134, 10
    rows = (args.per_sheet + cols - 1) // cols
    font = ImageFont.load_default()
    for sheet_start in range(0, len(photos), args.per_sheet):
        canvas = Image.new("RGB", (cols * cell_w, rows * cell_h), "#e8e5dd")
        draw = ImageDraw.Draw(canvas)
        batch = photos[sheet_start : sheet_start + args.per_sheet]
        for index, path in enumerate(batch):
            x, y = (index % cols) * cell_w, (index // cols) * cell_h
            try:
                with Image.open(path) as src:
                    src.draft("RGB", (cell_w, cell_h))
                    photo = ImageOps.exif_transpose(src)
                    photo.thumbnail((cell_w - 8, cell_h - 27), Image.Resampling.LANCZOS)
                    canvas.paste(photo.convert("RGB"), (x + (cell_w - photo.width) // 2, y + (cell_h - 27 - photo.height) // 2))
            except Exception as exc:
                draw.text((x + 5, y + 20), str(exc)[:22], fill="red", font=font)
            draw.text((x + 5, y + cell_h - 22), path.name, fill="#1e2220", font=font)
        output = args.output / f"{args.prefix}-{sheet_start // args.per_sheet + 1:02}.jpg"
        canvas.save(output, quality=85)
        print(output)


if __name__ == "__main__":
    main()
