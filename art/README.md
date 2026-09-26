# Media workshop

The public portfolio is a selection of **derived images**, not a copy of the camera card. Keep RAWs, master edits, and the source mapping in private storage.

## Export from the camera library

Create `art/media_selection.local.json` on the editing machine. It is ignored by Git. The shape is:

```json
{
  "version": 1,
  "cameraRoot": "C:/path/to/private/camera-library",
  "shoots": [{
    "id": "example-shoot",
    "title": "Example Shoot",
    "date": "2026-09-20",
    "description": "A short public description.",
    "sourceDir": "Photos/JPEGs",
    "cover": "example-frame",
    "photos": [{
      "id": "example-frame",
      "source": "example.jpg",
      "alt": "A concrete description of the image",
      "caption": "A short editorial caption."
    }]
  }]
}
```

Each photo may include a normalized `crop: [left, top, right, bottom]`. Each shoot may include `saturation`, where `1` leaves the color unchanged. The script reads JPEG edits only; it refuses RAW source paths and paths outside `cameraRoot`.

```powershell
python art/export_media.py
python art/verify_media.py
```

The exporter writes 640, 1440, and 3200 pixel maximum-side AVIF, WebP, and JPEG versions to `public/media/<shoot-id>/`, plus a public `archive.json` for the site and CMS seed. It applies orientation, converts color to sRGB when a profile exists, and rebuilds each output from pixel data so EXIF, GPS, XMP, IPTC, and maker notes never enter the published files. Run the verifier before deploying. Review the actual pictures and captions as a separate editorial step.

## Blender materials for the light table

Every texture and sprite on the table is made here: nothing is a stock or downloaded image. All renders use Cycles on the GPU: Metal on Apple silicon, then OptiX, CUDA, HIP or oneAPI, falling back to the CPU (`use_gpu` in `common.py`). On an M1 Pro each asset renders in seconds to a couple of minutes. Run from the repository root with Blender 5.2:

```bash
blender -b -P art/cork.py -- out=art/renders/cork.png size=1536 samples=128
python3 art/finish_cork.py art/renders/cork.png src/assets/cork-tile.webp   # also writes the AVIF
blender -b -P art/liquid_glass.py        # src/assets/glass/liquid-glass.webp and liquid-glass-normal.png
blender -b -P art/preview_loupe.py       # src/assets/loupe/preview-loupe.webp
blender -b -P art/pins.py                # src/assets/pins/pin-<colour>-<1|2>.webp
blender -b -P art/tape.py -- outdir=art/renders/tape samples=128
python3 art/finish_tape.py art/renders/tape src/assets/tape
```

- **Cork** (`cork.py`, `finish_cork.py`): a procedural board of layered Voronoi granules with true displacement, sampled on a torus so the tile repeats seamlessly. The finishing step grades it to the table's tone and writes WebP and AVIF.
- **Liquid glass** (`liquid_glass.py`): a thick glass slab with a pillowed shoulder, lit by Blender's bundled CC0 studio HDRI and one lamp to the upper left. Only the shoulder keeps its reflections, so the rim carries a bright line along the top that rolls around the corner rather than an even outline. CSS lays it over every bar and panel as a nine-slice `border-image`. The same outline, cut from a deep block with a round shoulder, is rendered a second time as a surface-normal map; `src/table/glass.ts` nine-slices it to each bar and feeds it to an SVG `feDisplacementMap`, so in Chromium the cork and photographs bend at the rim like real glass.
- **Loupe** (`preview_loupe.py`): a stand loupe seen from overhead, with a clear acrylic light-collecting skirt, a black anodised barrel with turned machining, and a brushed aluminium bezel. The aperture stays transparent for the live magnified crop.
- **Push pins** (`pins.py`): moulded push pins (dished flare, fluted grip, thumb disc, steel needle) in red, blue, green, yellow, and white, each at two leans. Reflections come from Blender's CC0 interior HDRI, and a shadow catcher records each pin's real shadow on the print.
- **Tape** (`tape.py`, `finish_tape.py`): thin, torn, translucent film as short corner pieces and longer strips. The board hangs each print by tape in one of four placements (all corners, top corners, a diagonal pair, or one strip across the top) or by one, two, or four pins, and neighbouring prints never repeat.
