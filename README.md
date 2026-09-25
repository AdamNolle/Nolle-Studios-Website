# Nolle Studios

An interactive photographic light table built with React, TypeScript, and Vite. The table is the homepage at `/`; `/archive` remains an alias. Visitors move from the newest shoot to the oldest, inspect contact sheets, open a shoot's pinned prints, and zoom into individual photographs. The public work is drawn from selected, processed camera images.

A private CMS at `/admin/` manages uploads, shoots, collections, order, captions, cover images, and publishing. Camera RAWs, master edits, videos, and project files remain on private storage.

## Run locally

Requires Node.js 26 and Python 3 with Pillow for the optional media workshop.

```powershell
npm install
Copy-Item .env.example .env
# Set a unique CMS_ADMIN_PASSWORD in .env.
npm run dev:cms
```

In another terminal:

```powershell
npm run dev
```

Open the Vite URL for the light table and `/admin/` for the CMS. Local development uses SQLite and filesystem media storage. The site falls back to `public/media/archive.json` when the CMS API is unavailable; uploads require the CMS server.

## Check and build

```powershell
npm run typecheck
npm run build
npm run test:cms
python art/verify_media.py
```

`dist/` is served from the domain root. The included Caddy configuration routes the CMS API and serves the client routes. The intended public domain is `nollestudios.com`; see [the deployment guide](docs/CMS.md) for its Cloudflare DNS setup, PostgreSQL, Docker Compose, TLS, and R2 or B2 compatible object storage. No storage vendor is required for local development.

## Publishing photographs

The checked in `public/media` directory contains selected, metadata stripped public derivatives. To curate another camera export, follow [the media workshop](art/README.md). The CMS accepts edited JPEG, PNG, TIFF, WebP, AVIF, or HEIF files, stages generated 640–3200 px AVIF, WebP, and JPEG variants privately, and publishes only the photos you select. Static curated photographs are managed through the manifest and a redeploy; CMS uploaded photographs can be published and withdrawn in the admin UI.

The loupe, push pins, tape, cork, badge, and glass transport reflections have editable Blender sources in `art/`.

## Light table controls

| View | Controls |
| --- | --- |
| Table | Use the glass slider or its previous/next buttons, or press ← / → to browse; Home / End jump; hover for the loupe on fine pointers. |
| Shoot board | Drag to pan; scroll or pinch to zoom; arrows pan; + / − adjust; Esc returns. |
| Print preview | Use the zoom controls, wheel, pinch, or double click to zoom; drag a zoomed print to pan; previous/next buttons or ← / → change photos; Esc closes. |

The table stays still by default and supports reduced motion. See [release checks](docs/QA.md) for tested layouts and current limits.
