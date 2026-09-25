# Nolle Studios content room

The private CMS at `/admin/` organizes photographs into shoots and collections, controls publication and ordering, and serves the read-only public catalog at `/api/site`. Its editor uses the same dark photographic visual language as the light table. The public site shows photographs without captions or frame numbers. The CMS keeps alt text for accessible image descriptions; this text is not a visible caption.

The admin API is same-origin, password protected, and uses revocable sessions with a CSRF token. Camera originals, master edits, original videos, and project files belong on private storage. Upload only selected image exports.

## Local development

1. Install Node.js 26 and run `npm install`.
2. Copy `.env.example` to `.env`. Set `CMS_ADMIN_PASSWORD` to a unique password of at least 12 characters. Keep `.env` private.
3. Run `npm run dev:cms` in one terminal and `npm run dev` in another.
4. Open the Vite URL and its `/admin/` path, then sign in.

The local CMS stores metadata in `.local/cms.sqlite`, private generated variants in `.local/staging`, and published variants in `.local/media`. These paths are ignored by Git. Vite proxies `/api`, `/admin`, and uploaded `/media/photos` requests to the CMS. Curated `/media/<shoot>` files and `/media/archive.json` come from Vite's static `public` directory.

The server syncs `public/media/archive.json` on startup; `npm run cms:seed` also syncs it on demand. Sync uses stable IDs, preserves CMS edits to retained items, and withdraws imported frames removed from the manifest. CMS uploads are unaffected. Each curated shoot needs `published: true` to appear in the public catalog. Manifest paths must be site paths under `/media/`; local camera and NAS paths are rejected.

Curated photos and shoots are read-only for publication in the CMS. To withdraw a curated item, remove it from `public/media`, update the manifest, rebuild, and redeploy. The CMS can publish and withdraw its own uploaded items.

## Image workflow

The CMS accepts edited JPEG, PNG, TIFF, WebP, AVIF, and HEIF files up to 50 MB and 80 megapixels. Sharp applies orientation and creates 640, 960, 1600, 2400, and 3200 pixel-wide AVIF, WebP, and JPEG variants without upscaling. It strips EXIF, GPS, XMP, and other input metadata from every generated copy.

New variants stay in private staging. Publishing a photo copies its variants to public storage; withdrawing it removes those public copies. The private staged variants remain available for later republication. A CMS-created shoot must be published for its published photos to appear in the public catalog. Collections may contain photos from multiple shoots; only published collections and photos appear through the public API.

Write useful alt text for each published photograph. The site does not show a caption below photos, and the CMS does not need a separate caption field in its editing flow. Video encoding and HLS are outside the current image CMS.

## WSL Docker Compose rehearsal

The Linux rehearsal has been run in Ubuntu WSL on this machine. `compose.yaml` starts PostgreSQL, the Node CMS, and Caddy; `compose.wsl.yaml` binds Caddy only to `127.0.0.1:8080`. The site, admin sign-in, health endpoint, public catalog, and a draft collection with a linked photo were checked through that stack. It runs over local HTTP and does not touch Cloudflare DNS or issue a public TLS certificate.

Use an environment file outside the repository containing these names and your own private values:

```dotenv
POSTGRES_PASSWORD=<unique database password>
CMS_ADMIN_PASSWORD_HASH='<output from npm run cms:hash>'
CMS_SESSION_SECRET=<at least 32 random bytes, encoded as hex>
SITE_DOMAIN=:80
STORAGE_DRIVER=local
```

Generate random values with `openssl rand -hex 32`; `npm run cms:hash` prompts for the admin password and emits its scrypt hash. Keep the single quotes around the hash so Compose treats its `$` characters literally. Keep the environment file private. From an Ubuntu WSL shell with Docker Compose available:

```bash
cd /mnt/c/Users/adamm/Desktop/Code/Nolle-Studios-Website
docker compose --env-file /path/to/private/compose.env \
  -f compose.yaml -f compose.wsl.yaml -p nolle-wsl up -d --build
docker compose --env-file /path/to/private/compose.env \
  -f compose.yaml -f compose.wsl.yaml -p nolle-wsl ps
curl -f http://127.0.0.1:8080/api/health
```

Replace the example environment path with the file you created. Open `http://127.0.0.1:8080/` and `http://127.0.0.1:8080/admin/` in a browser. To stop the rehearsal while retaining its database and media volumes:

```bash
docker compose --env-file /path/to/private/compose.env \
  -f compose.yaml -f compose.wsl.yaml -p nolle-wsl down
```

## Public Linux deployment

`nollestudios.com` is the intended domain, but the Linux host and live DNS have not been set up. Once the host exists, point a Cloudflare apex A record to its public address; add AAAA only if IPv6 works. Point `www` to the same site if desired, and allow inbound ports 80 and 443. If Cloudflare proxies the records, use **Full (strict)** SSL/TLS mode.

Set `SITE_DOMAIN=nollestudios.com` in a private production environment file so Caddy can issue and renew its certificate. Set unique `POSTGRES_PASSWORD`, `CMS_SESSION_SECRET`, and `CMS_ADMIN_PASSWORD_HASH` values. With `STORAGE_DRIVER=local`, back up the PostgreSQL database and the private `staging_data` and published `media_data` volumes. Then run `docker compose --env-file /path/to/private/compose.env up -d --build` using only `compose.yaml`. Check `https://nollestudios.com/api/health` and `/admin/` after DNS and TLS are live.

Caddy routes `/api`, `/admin`, and uploaded `/media/photos` to the CMS, serves curated media as static files, and serves `index.html` for client routes such as `/archive`. PostgreSQL stores the catalog. PostGIS is not required because the site does not publish location coordinates.

### Optional Cloudflare R2 or Backblaze B2

Set `STORAGE_DRIVER=s3` and provide `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, `S3_REGION`, and `MEDIA_BASE_URL`. The media base URL must be an HTTPS address from which anonymous visitors can read the published bucket. Grant the key access only to that bucket. Keep and back up the private staging volume because it is needed to republish without reuploading.

For R2, use the account's `https://<account-id>.r2.cloudflarestorage.com` endpoint, `S3_REGION=auto`, and a public custom domain for `MEDIA_BASE_URL`. For B2, use its regional S3 endpoint and region code with a public bucket URL or custom domain. Set `S3_FORCE_PATH_STYLE` if the provider requires it. Neither provider is required for local or WSL use.

On withdrawal, the CMS deletes the public object at its origin. Published objects use `Cache-Control: public, max-age=300, must-revalidate`, so browsers and CDNs honoring that header may serve cached copies for up to five minutes. Custom cache rules can extend that window. Already downloaded copies cannot be recalled.

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/site` | Public published shoots, photos, and collections |
| `GET /api/admin/session` | Current admin session and CSRF token |
| `POST /api/admin/login` / `logout` | Password login and session revocation |
| `GET /api/admin/content` | Full private catalog |
| `/api/admin/shoots` | Create, edit, publish, order, or delete CMS shoots |
| `/api/admin/photos/upload` and `/api/admin/photos/:id` | Upload, edit, publish, withdraw, or delete CMS photos |
| `/api/admin/collections` | Create, edit, publish, order, or delete collections |
| `/api/admin/collections/:id/photos/:photoId` | Add or remove a photo from a collection |

Admin writes require a session cookie and the `X-CSRF-Token` value from `/api/admin/session`. Uploaded photographs begin as drafts. `/api/site` never includes drafts.
