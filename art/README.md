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

## Blender pins and tape

`pins.py` models the coloured injection-moulded pin head, brushed steel neck, and flange. `tape.py` models thin, torn translucent film with irregular dispenser cuts, small trapped-air lifts, and a ridge where a strip crosses a print edge. Both scripts render transparent PNG masters with Blender 5.1. They use OptiX when available and fall back to CPU Cycles.

From the repository root on Windows:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.1\blender.exe' -b -P art/pins.py -- outdir=art/renders/pins size=384 samples=96
& 'C:\Program Files\Blender Foundation\Blender 5.1\blender.exe' -b -P art/tape.py -- outdir=art/renders/tape samples=128
python art/finish_sprites.py pins art/renders/pins src/assets/pins
python art/finish_sprites.py tape art/renders/tape src/assets/tape
python art/preview_sprites.py
```

`finish_sprites.py` adds warm, compact shadows without baking any photo or cork pixels into the transparent WebP. It writes nine 256×256 pin sprites, four 768×274 edge tape sprites, and two 512×256 corner tape sprites. `preview_sprites.py` writes `art/renders/proof.png`, a display-scale composite on a real site photo and cork. The PNG masters and proof in `art/renders/` are ignored by Git; the source scripts and WebP outputs are versioned.

## Glass transport reflections

`glass_transport.py` models an optical-glass capsule, bevels its edges, gives it minute surface roughness, and renders studio light reflections in Blender. Its final WebP has a clear center and a maximum opacity of about 12%, so the browser's live glass backdrop and control labels remain legible. Rebuild both responsive assets from the repository root:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.1\blender.exe' -b -P art/glass_transport.py
$env:NOLLE_GLASS_VARIANT='mobile'
& 'C:\Program Files\Blender Foundation\Blender 5.1\blender.exe' -b -P art/glass_transport.py
Remove-Item Env:NOLLE_GLASS_VARIANT
```

The editable scenes are `art/glass_transport.blend` and `art/glass_transport_mobile.blend`; the RGBA overlays are `src/assets/glass/transport-reflection.webp` (1600×220) and `src/assets/glass/transport-reflection-mobile.webp` (900×200). Place an overlay above the rail's backdrop and below interactive content. Stretch each matching variant across the rail with `background-size: 100% 100%` and `pointer-events: none`. Render masters and proofs under `art/renders/` remain local.
