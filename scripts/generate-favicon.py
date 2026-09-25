"""Generate the borderless four-square favicon and touch icon."""

from pathlib import Path
import struct
import zlib


ROOT = Path(__file__).resolve().parents[1] / "public"
BLACK = (0, 0, 0)
BLUE = (42, 53, 255)
GREEN = (94, 245, 13)
RED = (255, 24, 24)


def chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))


def png(size: int) -> bytes:
    half = size // 2
    rows = []
    for y in range(size):
        left, right = (BLACK, BLUE) if y < half else (GREEN, RED)
        rows.append(b"\0" + bytes(left) * half + bytes(right) * (size - half))
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(b"".join(rows)))
        + chunk(b"IEND", b"")
    )


def main() -> None:
    images = [png(size) for size in (16, 32, 48, 64)]
    offset = 6 + 16 * len(images)
    entries = []
    for size, image in zip((16, 32, 48, 64), images):
        entries.append(struct.pack("<BBBBHHII", size, size, 0, 0, 1, 24, len(image), offset))
        offset += len(image)
    (ROOT / "favicon.ico").write_bytes(struct.pack("<HHH", 0, 1, len(images)) + b"".join(entries) + b"".join(images))
    (ROOT / "apple-touch-icon.png").write_bytes(png(180))


if __name__ == "__main__":
    main()
