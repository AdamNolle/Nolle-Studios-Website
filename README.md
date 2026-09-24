# Nolle Studios — The Archive

The studio's portfolio laid out as a light table: every shoot is a contact
sheet pinned to cork, a film-rail timeline scrubs through the rolls, and a
loupe magnifies whatever frame is under the cursor. Click a frame to open that
roll as a pannable, zoomable board of prints, then click a print to lift it
into a full-screen preview.

Implemented from the Claude Design file `06 Light Table.dc.html`.

## Running it

```sh
npm install
npm run dev       # local dev server
npm run build     # static site in dist/
npm run preview   # serve the build
```

The build uses relative asset paths, so `dist/` can be hosted from any path
(GitHub Pages, Netlify, S3, …).

## Adding shoots and photos

Everything on the table comes from `src/archive.js`:

- `EVENTS` lists one roll per shoot, newest first, as `[name, date, frames shot]`.
- `PHOTOS` is the image set that frames cycle through. Each photo has a
  thumbnail (~420px wide, used on sheets and prints) and a mid-size image
  (~1500px wide, used by the loupe, the preview and Download) in `public/photos/`.

The images in `public/photos/` now are soft-focus placeholders. Replace them
with real exports that use the same file names, or point `PHOTOS` at new files.

## Controls

| Where          | Input                                                        |
| -------------- | ------------------------------------------------------------ |
| Table          | drag, scroll, or ← → to scrub · Home / End · hover to loupe |
| Board          | drag to pan · scroll or pinch to zoom · arrows pan · + / − · Esc back |
| Preview        | ← → previous / next frame · Esc close                         |

The table drifts forward slowly after five seconds of inactivity. It stays
still when the visitor prefers reduced motion.

## Tuning

`LightTable` takes the design's adjustable props (defaults in
`LightTable.defaultProps`):

| Prop        | Default           | Notes                                   |
| ----------- | ----------------- | --------------------------------------- |
| `tableStyle`| `"Contact sheet"` | also `"Plate"` or `"Mosaic"`            |
| `loupeZoom` | `2.8`             | 1.6 – 4.5                               |
| `corkTone`  | `"#C8813F"`       | multiply tint over the cork             |
| `haptics`   | `true`            | vibration on frame detents (mobile)     |
| `tickSound` | `false`           | synthesized shutter tick while scrubbing|
| `drift`     | `true`            | idle auto-advance                       |
