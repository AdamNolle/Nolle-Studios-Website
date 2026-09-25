"""Export selected camera JPEGs as privacy-clean, responsive web media.

Create art/media_selection.local.json (ignored by Git), then run:
    python art/export_media.py

The local selection file records camera source paths. Only generated pixels and
public-facing descriptions appear in public/media/archive.json.
"""

from __future__ import annotations

import argparse
import io
import json
import re
from datetime import date
from pathlib import Path

from PIL import Image, ImageCms, ImageEnhance, ImageOps


SIZES = {"thumb": 640, "mid": 1440, "full": 3200}
FORMATS = {"avif": ".avif", "webp": ".webp", "jpeg": ".jpg"}
ID_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def clean_rgb(source: Path, crop: list[float] | None, saturation: float) -> Image.Image:
    with Image.open(source) as original:
        # Apply the camera orientation before any crop, then discard every source
        # metadata container (EXIF, GPS, XMP, IPTC, Photoshop, comments, ICC).
        oriented = ImageOps.exif_transpose(original)
        profile = original.info.get("icc_profile")
        if profile:
            oriented = ImageCms.profileToProfile(
                oriented,
                ImageCms.ImageCmsProfile(io.BytesIO(profile)),
                ImageCms.createProfile("sRGB"), outputMode="RGB"
            )
        else:
            oriented = oriented.convert("RGB")
        if crop:
            if len(crop) != 4 or not all(0 <= value <= 1 for value in crop):
                raise ValueError(f"Invalid normalized crop: {crop}")
            left, top, right, bottom = crop
            if left >= right or top >= bottom:
                raise ValueError(f"Empty crop: {crop}")
            oriented = oriented.crop((
                round(left * oriented.width), round(top * oriented.height),
                round(right * oriented.width), round(bottom * oriented.height)
            ))
        if saturation != 1:
            oriented = ImageEnhance.Color(oriented).enhance(saturation)
        clean = Image.new("RGB", oriented.size)
        clean.paste(oriented)
        return clean


def write_variants(photo: Image.Image, folder: Path, photo_id: str) -> tuple[dict, int, int]:
    urls = {format_name: {} for format_name in FORMATS}
    full_size = (0, 0)
    for label, max_side in SIZES.items():
        ratio = min(1, max_side / max(photo.size))
        size = (max(1, round(photo.width * ratio)), max(1, round(photo.height * ratio)))
        resized = photo.resize(size, Image.Resampling.LANCZOS)
        if label == "full":
            full_size = size
        for format_name, suffix in FORMATS.items():
            filename = f"{photo_id}-{max_side}{suffix}"
            target = folder / filename
            if format_name == "avif":
                resized.save(target, format="AVIF", quality=54, speed=8)
            elif format_name == "webp":
                resized.save(target, format="WEBP", quality=82, method=6)
            else:
                resized.save(target, format="JPEG", quality=88, optimize=True, progressive=True,
                             subsampling=0)
            urls[format_name][label] = f"/media/{folder.name}/{filename}"
        print(f"  {photo_id}: {label} {size[0]}x{size[1]}", flush=True)
    return urls, *full_size


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--selection", type=Path,
                        default=Path(__file__).with_name("media_selection.local.json"))
    parser.add_argument("--output", type=Path,
                        default=Path(__file__).resolve().parent.parent / "public" / "media")
    args = parser.parse_args()
    config = json.loads(args.selection.read_text(encoding="utf-8"))
    camera_root = Path(config["cameraRoot"]).resolve()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    if config.get("version") != 1:
        raise ValueError("Selection version must be 1")
    archive = {"shoots": []}
    used_shoots = set()
    for shoot in config["shoots"]:
        shoot_id = shoot["id"]
        if not ID_RE.fullmatch(shoot_id) or shoot_id in used_shoots:
            raise ValueError(f"Invalid or duplicate shoot id: {shoot_id}")
        used_shoots.add(shoot_id)
        date.fromisoformat(shoot["date"])
        folder = output / shoot_id
        folder.mkdir(parents=True, exist_ok=True)
        public_shoot = {
            "id": shoot_id, "title": shoot["title"], "date": shoot["date"],
            "description": shoot["description"], "published": True,
            "coverUrl": "", "photos": []
        }
        used_photos = set()
        for item in shoot["photos"]:
            photo_id = item["id"]
            if not ID_RE.fullmatch(photo_id) or photo_id in used_photos:
                raise ValueError(f"Invalid or duplicate photo id: {photo_id}")
            used_photos.add(photo_id)
            source_dir = item.get("sourceDir", shoot["sourceDir"])
            source = (camera_root / source_dir / item["source"]).resolve()
            if not source.is_relative_to(camera_root) or source.suffix.lower() not in {".jpg", ".jpeg"}:
                raise ValueError(f"Source must be a camera JPEG inside {camera_root}: {source}")
            if not source.is_file():
                raise FileNotFoundError(source)
            print(f"Exporting {shoot_id}/{photo_id}", flush=True)
            image = clean_rgb(source, item.get("crop"), shoot.get("saturation", 1))
            variants, width, height = write_variants(image, folder, photo_id)
            public_shoot["photos"].append({
                "id": photo_id, "alt": item["alt"], "caption": item["caption"],
                "thumb": variants["webp"]["thumb"],
                "mid": variants["webp"]["mid"],
                "full": variants["webp"]["full"],
                "width": width, "height": height, "formats": variants
            })
        cover = next((p for p in public_shoot["photos"] if p["id"] == shoot["cover"]), None)
        if cover is None:
            raise ValueError(f"Unknown cover id in {shoot_id}: {shoot['cover']}")
        public_shoot["coverUrl"] = cover["full"]
        archive["shoots"].append(public_shoot)
    target = output / "archive.json"
    target.write_text(json.dumps(archive, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {target} with {sum(len(s['photos']) for s in archive['shoots'])} photos")


if __name__ == "__main__":
    main()
