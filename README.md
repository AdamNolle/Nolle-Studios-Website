# Nolle Studios

An interactive photographic light table built with React, TypeScript, and Vite. The light table is the homepage at `/`; `/archive` remains an alias. Visitors browse shoots from newest to oldest, inspect contact sheets, open pinned prints, and zoom into individual photographs. Photographs carry no visible captions or frame numbers. Accessible image descriptions remain available to assistive technology.

The private CMS at `/admin/` manages image uploads, shoots, collections, order, cover images, alt text, and publishing. Camera RAWs, master edits, original videos, and project files stay on private storage. Only selected, processed images are published.

## Run locally

Requires Node.js 26. Python 3 with Pillow is needed only for the optional media workshop.

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

Open the Vite URL for the site and its `/admin/` path for the CMS. Local development uses SQLite and filesystem media storage. When the CMS API is unavailable, the public site falls back to `public/media/archive.json`; uploads require the CMS server. Keep `.env` private.

## Rehearse the Linux deployment in WSL

The included `compose.wsl.yaml` override runs PostgreSQL, the CMS, and Caddy through Docker Compose. It binds the site to `http://127.0.0.1:8080/` on this machine. This rehearsal has been run and the site, CMS, and API health endpoint were checked locally.

From an Ubuntu WSL shell with Docker Compose available, create a private environment file **outside this repository** containing `POSTGRES_PASSWORD`, `CMS_ADMIN_PASSWORD_HASH`, `CMS_SESSION_SECRET`, `SITE_DOMAIN=:80`, and `STORAGE_DRIVER=local`. Generate a password hash with `npm run cms:hash` and random secrets with `openssl rand -hex 32`. Then run:

```bash
cd /mnt/c/Users/adamm/Desktop/Code/Nolle-Studios-Website
docker compose --env-file /path/to/private/compose.env \
  -f compose.yaml -f compose.wsl.yaml -p nolle-wsl up -d --build
docker compose --env-file /path/to/private/compose.env \
  -f compose.yaml -f compose.wsl.yaml -p nolle-wsl ps
```

Open `http://127.0.0.1:8080/`, `http://127.0.0.1:8080/admin/`, and `http://127.0.0.1:8080/api/health`. Replace the example environment path with your actual private file. See [CMS and deployment](docs/CMS.md) for setup details and the distinction between this HTTP rehearsal and a public TLS deployment.

## Check and build

```powershell
npm run typecheck
npm run build
npm run test:cms
python art/verify_media.py
```

The public gallery is a static GitHub Pages deployment from `gh-pages` at `nollestudios.com`. The source of truth is `main`; `gh-pages` holds only the generated public site. GitHub Pages has approved its certificate, and **Enforce HTTPS** redirects HTTP traffic to `https://nollestudios.com/`. The CMS remains local in WSL; its uploads require a new static build and publication to appear on the public gallery. See [publishing](docs/PUBLISH.md) for the update process and [CMS and deployment](docs/CMS.md) for the later Linux server, PostgreSQL, and optional R2 or B2 setup.

## Publishing photographs

`public/media` contains selected public derivatives with private metadata removed. Follow [the media workshop](art/README.md) to curate another camera export. The CMS accepts edited JPEG, PNG, TIFF, WebP, AVIF, or HEIF files, stages generated 640–3200 px AVIF, WebP, and JPEG variants privately, and publishes only the photos you select. CMS uploads can be published or withdrawn in the admin UI. Static curated photographs are managed through the manifest and require a redeploy to withdraw.

The loupe, push pins, tape, cork, badge, and glass transport reflections have editable Blender sources in `art/`.

## Light table controls

| View | Controls |
| --- | --- |
| Table | Scroll, swipe, or click the tabletop to move between shoots. The glass ticker and its arrows select tables by date; ← / → and Home / End work from the keyboard. Click a photograph to open its shoot board. A loupe appears on fine pointer hover. |
| Shoot board | Drag to pan; scroll or pinch to zoom; use arrows to pan and + / − to adjust; Esc returns. |
| Print preview | Use zoom controls, wheel, pinch, or double click to zoom; drag a zoomed print to pan. Previous/next buttons or ← / → change photos; Esc closes. |

The table supports reduced motion. See [release checks](docs/QA.md) for tested layouts and current limits.
