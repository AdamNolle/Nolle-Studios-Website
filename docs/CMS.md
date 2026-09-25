# Nolle Studios content room

The site has a private CMS at `/admin/`. It organizes photographs into shoots and collections, controls each item's visibility, and serves a public read-only catalog at `/api/site`. The admin API is same-origin, password protected, and uses revocable sessions with a CSRF token.

## Local development without cloud services

1. Install Node.js 26 and run `npm install`.
2. Copy `.env.example` to `.env`. Set `CMS_ADMIN_PASSWORD` to a unique password of at least 12 characters. Keep `.env` private.
3. In one terminal, run `npm run dev:cms`. In another, run `npm run dev`.
4. Open the Vite URL, then open its `/admin/` path and sign in.

The local CMS stores metadata in `.local/cms.sqlite`, private generated variants in `.local/staging`, and published variants in `.local/media`. These paths are gitignored. The Vite development server proxies `/api`, `/admin`, and uploaded `/media/photos` to the CMS; curated `/media/<shoot>` files and `/media/archive.json` come from Vite's static `public` directory. The server syncs curated `public/media/archive.json` on startup; `npm run cms:seed` also syncs it on demand. Sync uses IDs, preserves CMS edits to retained items, and withdraws imported frames removed from the manifest. CMS uploads are untouched.

Each shoot in the curated manifest must have `published: true` to enter the public catalog. Manifest paths must be site paths under `/media/`; local camera or NAS paths are rejected. The manifest and its processed assets are intentionally part of the public site. Curated photos and their shoots are **read-only for publication in the CMS**: the admin UI and API do not offer unpublish or delete for them. To retract a curated file, remove it from `public/media`, update the manifest, rebuild, and redeploy. The manifest sync removes withdrawn entries from `/api/site`; removing the asset from the new build removes the public file. Old deployments and caches may retain it until replaced or expired.

## Upload and publish workflow

Export selected edited JPEG, PNG, TIFF, WebP, AVIF, or HEIF images from the private editing machine. Original RAWs, original videos, master edits, and project files stay on private storage. The CMS accepts one image per upload, up to 50 MB and 80 megapixels. It creates 640, 960, 1600, 2400, and 3200 pixel wide AVIF, WebP, and JPEG variants without upscaling. Sharp applies orientation and strips EXIF, GPS, XMP, and other input metadata from every generated copy.

New uploads and generated variants stay in the private staging volume. Publish an individual photo to copy its variants to the public media store. Unpublish it to delete its public copies. The private generated variants remain available for a later republish. Publishing a CMS-created shoot controls whether its published photos appear in the public catalog. Collections can include photos from multiple shoots; only published collections and photos appear through the public API.

Use meaningful alt text before publishing. The CMS cannot edit RAW files or alter the private NAS; it receives selected exports only. Video encoding and HLS are outside the current CMS image workflow.

## VPS deployment

The intended public domain is `nollestudios.com`. In Cloudflare DNS, point the apex A record at the VPS; add an AAAA record only if the VPS has working IPv6. Point `www` at the same site if you want that hostname. Allow inbound ports 80 and 443. If Cloudflare proxies the records, use SSL/TLS mode **Full (strict)**. Set `SITE_DOMAIN=nollestudios.com` in the VPS `.env` file so Caddy can issue and renew its certificate.

The included `compose.yaml` runs PostgreSQL, the Node CMS, and Caddy in front of the built site. Caddy routes `/api`, `/admin`, and uploaded `/media/photos` to the CMS, serves curated media as static files, falls back to `index.html` for client routes such as `/archive`, and obtains TLS certificates automatically for a public `SITE_DOMAIN`. PostgreSQL contains the catalog; PostGIS is not required because the site does not publish location coordinates.

1. Point your domain's A/AAAA records to the VPS and allow inbound ports 80 and 443.
2. Copy `.env.example` to `.env` on the VPS. Set `SITE_DOMAIN`, `POSTGRES_PASSWORD`, `CMS_SESSION_SECRET`, and `CMS_ADMIN_PASSWORD_HASH`. Generate the hash with `npm run cms:hash` on a trusted machine; it prompts without echoing the password. In the Compose `.env`, wrap the hash in single quotes so its `$` characters stay literal.
3. Choose `STORAGE_DRIVER=local` for a single VPS with persistent `media_data` and `staging_data` volumes, or configure the S3-compatible settings below.
4. Run `docker compose up -d --build`. Visit `https://<SITE_DOMAIN>/api/health`, then `/admin/`.

Do not commit `.env`. Back up the PostgreSQL database, the private `staging_data` volume, and the published `media_data` volume when using local storage. The CMS image has the curated `public/media` files from the repository. `docker compose` was not available on the original Windows development host, so this Compose deployment needs validation on the VPS before production use.

### Cloudflare R2 or Backblaze B2

Set `STORAGE_DRIVER=s3` and fill in `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, `S3_REGION`, and `MEDIA_BASE_URL`. `MEDIA_BASE_URL` must be an HTTPS URL from which anonymous visitors can read the published bucket. The API writes objects only on publish, with unique names under `photos/<photo-id>/`. Give its key access only to that bucket. Keep the private staging volume on the VPS and include it in backups; it is needed to republish without reuploading. On unpublish, the CMS deletes each object at the bucket origin. Published objects use `Cache-Control: public, max-age=300, must-revalidate`, so browsers and CDNs honoring that header may serve cached copies for up to five minutes. A provider's custom cache rules can extend this; purge its CDN cache when immediate URL revocation matters. Copies already downloaded by visitors cannot be recalled.

For R2, use the account's `https://<account-id>.r2.cloudflarestorage.com` endpoint, `S3_REGION=auto`, and a public custom domain for `MEDIA_BASE_URL`. For B2, use its region's S3 endpoint and region code, and a public bucket URL or custom domain. `S3_FORCE_PATH_STYLE` is available if the provider requires it. Neither provider is mandatory for local development.

## API summary

| Endpoint | Purpose |
| --- | --- |
| `GET /api/site` | Public published shoots, photos, and collections |
| `GET /api/admin/session` | Current admin session and CSRF token |
| `POST /api/admin/login` / `logout` | Password login and session revocation |
| `GET /api/admin/content` | Full private catalog |
| `/api/admin/shoots` | Create, edit, publish, order, or delete shoots |
| `/api/admin/photos/upload` and `/api/admin/photos/:id` | Upload, edit, publish, unpublish, or delete photos |
| `/api/admin/collections` | Create, edit, publish, order, or delete collections |
| `/api/admin/collections/:id/photos/:photoId` | Add or remove a photo from a collection |

Admin writes require the session cookie and `X-CSRF-Token` from `/api/admin/session`. Uploaded photographs begin as drafts. `/api/site` never includes drafts.
