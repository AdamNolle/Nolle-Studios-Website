"""Verify public variants, manifest paths, and the absence of private metadata."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

from PIL import Image


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    public = root / "public"
    media = public / "media"
    manifest = (media / "archive.json").read_text(encoding="utf-8")
    for private in ("cameraRoot", "sourceDir", "DSC0", "H:/", "H:\\"):
        if private in manifest:
            raise AssertionError(f"Private source reference in archive.json: {private}")
    archive = json.loads(manifest)
    count = 0
    expected = set()
    for shoot in archive["shoots"]:
        if not shoot.get("published"):
            raise AssertionError(f"Shoot is not published: {shoot['id']}")
        if shoot["coverUrl"] not in [item["full"] for item in shoot["photos"]]:
            raise AssertionError(f"Invalid cover: {shoot['id']}")
        for photo in shoot["photos"]:
            if not photo["alt"] or not photo["caption"]:
                raise AssertionError(f"Missing description: {shoot['id']}/{photo['id']}")
            for format_name in ("avif", "webp", "jpeg"):
                for label, max_side in (("thumb", 640), ("mid", 1440), ("full", 3200)):
                    url = photo["formats"][format_name][label]
                    if not url.startswith(f"/media/{shoot['id']}/{photo['id']}-"):
                        raise AssertionError(f"Unexpected asset path: {url}")
                    target = public / url.lstrip("/")
                    if not target.is_file():
                        raise FileNotFoundError(target)
                    with Image.open(target) as image:
                        image.load()
                        if max(image.size) > max_side or image.getexif():
                            raise AssertionError(f"Invalid dimensions or EXIF: {target}")
                        if label == "full" and image.size != (photo["width"], photo["height"]):
                            raise AssertionError(f"Manifest dimensions differ: {target}")
                    expected.add(target.resolve())
                    count += 1
            for label in ("thumb", "mid", "full"):
                if photo[label] != photo["formats"]["webp"][label]:
                    raise AssertionError(f"WebP convenience URL differs: {photo['id']}")
    actual = {path.resolve() for shoot in archive["shoots"]
              for path in (media / shoot["id"]).iterdir() if path.is_file()}
    if actual != expected:
        raise AssertionError(f"Orphan or missing files: {actual ^ expected}")

    exiftool = shutil.which("ExifTool") or shutil.which("exiftool")
    if not exiftool:
        raise RuntimeError("ExifTool is required for full EXIF/GPS/XMP/IPTC verification")
    process = subprocess.run(
        [exiftool, "-j", "-r", "-G1", "-ext", "jpg", "-ext", "webp", "-ext", "avif",
         "-EXIF:all", "-GPS:all", "-XMP:all", "-IPTC:all", "-MakerNotes:all", str(media)],
        check=True, capture_output=True, text=True, env={**os.environ, "LC_ALL": "C"}
    )
    for record in json.loads(process.stdout):
        tags = {key: value for key, value in record.items() if key != "SourceFile"}
        if tags:
            raise AssertionError(f"Private metadata remains in {record['SourceFile']}: {tags}")
    print(f"Verified {len(archive['shoots'])} shoots, {count // 9} photos, {count} variants; no private metadata")


if __name__ == "__main__":
    main()
