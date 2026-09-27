# Publishing Nolle Studios

## Current public deployment

The dynamic gallery and Content Room run as Docker Compose services on Adlon's SSD. Cloudflare Tunnel sends `nollestudios.com` and `admin.nollestudios.com` to the private Caddy origin at `http://127.0.0.1:18081`; no inbound router port is required. The public hostname serves the gallery and its live `/api/site` catalog. The admin hostname redirects `/` to `/admin/`.

The database, private staging variants, and public media variants persist in Docker volumes. Publishing in the Content Room updates the production catalog immediately; a photograph appears only after it has alt text, is approved, belongs to a visible shoot, and **Publish** is pressed.

## Deploying the dynamic gallery

1. Commit and push `main`.
2. On Adlon, pull and rebuild the stack:

   ```bash
   git pull --ff-only
   docker compose -f compose.yaml -f compose.tunnel.yaml up -d --build --remove-orphans
   ```

3. Wait for the CMS health check, then verify `/api/health`, `/api/site`, `/admin/`, and a published image through both hostnames.

Back up PostgreSQL plus the `media_data` and `staging_data` volumes before migrations or host maintenance. Keep `.env`, camera originals, private staging, and credentials out of Git.

## Static fallback

The `gh-pages` branch remains a static fallback and historical artifact. `npm run publish:pages` builds from `public/media/archive.json`; it does not contain the CMS database or newly uploaded photographs. It must not be used as the production DNS target while the Content Room is the source of truth.

Cloudflare R2 or Backblaze B2 can later store published variants through `STORAGE_DRIVER=s3`, S3 credentials, and an HTTPS `MEDIA_BASE_URL`; PostgreSQL and private staging still require persistent storage.
