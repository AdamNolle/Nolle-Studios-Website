# Grades the cork render to the board's target tone and writes the web tile.
#
#   python3 art/finish_cork.py <cork render.png> src/assets/cork-tile.webp
#
# The target is the mean and spread of the cork texture in the original
# Light Table design, which the site's overlays were balanced against.
import sys

from PIL import Image, ImageStat

TARGET_MEAN = (198, 145, 97)
CONTRAST = 0.88  # a touch softer than the render, like the reference

src, dst = sys.argv[1], sys.argv[2]
im = Image.open(src).convert("RGB")
mean = ImageStat.Stat(im).mean
bands = [b.point(lambda v, m=m, t=t: round((v - m) * CONTRAST + t)) for b, m, t in zip(im.split(), mean, TARGET_MEAN)]
out = Image.merge("RGB", bands)
out.save(dst, quality=76, method=6)
print(dst, [round(x) for x in ImageStat.Stat(out).mean], [round(x) for x in ImageStat.Stat(out).stddev])
