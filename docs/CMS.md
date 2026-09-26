# Nolle Studios content room

The private Content Room at `/admin/` organizes photographs and videos into shoots and collections, controls publication and ordering, and serves the read-only public catalog at `/api/site`. The public site shows frames without visible captions or frame numbers; the CMS keeps alt text for accessible image descriptions.

The CMS is TypeScript run directly by Node.js 26 (`node server/index.ts`, no build step) on [Hono](https://hono.dev). The Content Room is a SolidJS app in `admin/`, built by Vite into `dist-admin/`, which the CMS serves at `/admin/` under a strict Content Security Policy.

The admin API is same-origin, password protected, and uses revocable sessions with a CSRF token. Camera originals, master edits, original videos, and project files belong on private storage. Upload only selected exports.

## Local development

1. Install Node.js 26 and run `npm install`.
2. Copy `.env.example` to `.env`. Set `CMS_ADMIN_PASSWORD` to a unique password of at least 12 characters. Keep `.env` private.
3. Run `npm run dev:cms` in one terminal and `npm run dev` in another. Optionally run `npm run alt:model` in a third for alt-text drafts (see below).
4. Open the Vite URL and its `/admin/` path, then sign in. Vite serves the Content Room from `admin/` with hot reload; `npm run build:admin` builds the copy the CMS serves on its own port.

The local CMS stores metadata in `.local/cms.sqlite`, private generated variants in `.local/staging`, published variants in `.local/media`, and a persistent development session secret in `.local/cms-session-secret`. These paths are ignored by Git. Vite proxies `/api`, `/admin`, and uploaded `/media/photos` and `/media/videos` requests to the CMS. Curated `/media/<shoot>` files and `/media/archive.json` come from Vite's static `public` directory.

The CMS also serves the Nolle Studios logo files directly, so the sign-in page and header show the same marks when `/admin/` is opened on the CMS port without Vite.

The Content Room's **View site** and **Preview on table** links use the current origin behind Vite or Caddy. When opened directly on the local CMS port, they use the Vite site at port 5173. Set `SITE_URL` to a full HTTP or HTTPS site-root URL if that local site runs elsewhere. Preview links are ordinary links that can be opened or copied without a scripted popup.

The server syncs `public/media/archive.json` on startup; `npm run cms:seed` also syncs it on demand. Sync uses stable IDs, preserves CMS edits and publication choices for retained items, and withdraws imported frames and curated shoots removed from the manifest, including empty shoots. CMS-created shoots and uploads are unaffected. Each new curated shoot needs `published: true` to enter the catalog. Manifest paths must be site paths under `/media/`; local camera and NAS paths are rejected.

Curated photos and shoots can be hidden or shown through the Content Room's approval and Publish flow. This changes the local CMS catalog and persists across manifest sync. Their files remain under `public/media`, so direct asset URLs can still work; the current GitHub Pages gallery also keeps its checked-in manifest until you update it, rebuild, and redeploy. The CMS publishes and withdraws its own uploaded files through storage.

## Image workflow

The CMS accepts edited JPEG, PNG, TIFF, WebP, AVIF, and HEIF files up to 50 MB and 80 megapixels. Sharp applies orientation and creates 640, 960, 1600, 2400, and 3200 pixel-wide AVIF, WebP, and JPEG variants without upscaling. It strips EXIF, GPS, XMP, and other input metadata from every generated copy.

New variants stay in private staging. Staging writes become visible to the CMS only after each file is complete. Approval queues visibility; edits to alt text, frame order, shoot covers, shoot and collection details, collection membership, and moves between shoots also wait for **Publish**. Publish copies approved variants to public storage, releases those edits, and withdraws frames queued to leave. The private staged variants remain available for later republication. Published uploads, shoots, and collections must be withdrawn through Publish before they can be permanently deleted. Deleting an unpublished upload checks media cleanup before dropping its CMS record; if cleanup fails, the record remains for a retry. A CMS-created shoot must also be published for its published frames to appear in the public catalog. Collections may contain frames from multiple shoots; only published collections and frames appear through the public API.

The public catalog is fetched without browser caching so a page reload reflects the latest Publish. Uploaded media files may still be cached for up to five minutes. If a batch upload stops partway through, the Content Room reports how many files succeeded; those files remain private in the Library.

If a withdrawal fails while deleting public variants, the CMS restores available copies from private staging before returning an error. Earlier frames withdrawn in the same Publish request are also restored. The frames stay queued for withdrawal so Publish can be retried. If preparing a later approved frame fails, earlier frames prepared in that Publish request stay out of the public catalog.

Write useful alt text for each published frame. The site does not show a caption below frames.

## Alt text drafted by a local model

The CMS can draft alt text with a vision model running on the same machine, so photographs never leave it. `npm run alt:model` starts [llama.cpp](https://github.com/ggml-org/llama.cpp)'s `llama-server` with Qwen3-VL 8B (Q4_K_M, about 5 GB, downloaded on first run) on `127.0.0.1:8790`, its OpenAI-compatible API. Install it with `brew install llama.cpp` or a release build. Any server with the same API works; set `ALT_TEXT_URL` to its address, and `ALT_TEXT_MODEL` if it hosts several models.

- When an upload arrives without alt text, the CMS drafts a description in the background (turn this off with `ALT_TEXT_AUTO=false`). The Content Room checks back every few seconds while drafts are due.
- Drafts are stored as suggestions only. The inspector and the alt-text pass show them labelled as drafts; nothing becomes alt text until an editor accepts or corrects it, and publishing still requires alt text.
- The model reads a 1280 px copy of the photograph with a prompt tuned for literal, short descriptions. It is told to describe poses rather than guess actions, to count people only when certain, and to leave out sign text, jersey numbers, and event names. The shoot title is deliberately not sent, because models describe titles as if they were visible.
- If the model is not running, drafting reports it as offline and uploads continue normally. In production drafting is off unless `ALT_TEXT_URL` is set.

On an Apple M1 Pro the 8B model drafts a description in about 10 seconds; the smaller 4B model is about twice as fast but misreads more actions.

Within the Content Room, drag photographs in a shoot or collection to change their sequence. Collection cards also support **Alt + Left/Right Arrow** while focused. The editor sends the full sequence in one request; the API rejects missing or repeated frames instead of partially changing the order. The new order reaches visitors after Publish.

Shoot dates are optional. When set, the editor accepts real calendar dates in `YYYY-MM-DD` format, including leap days.

**Preview on table** opens an authenticated private preview of the current CMS edits, including draft shoots, unpublished photos, ordering, alt text, and videos. It is marked **Private preview · Not live**. Preview images and videos come from private staging and require an active Content Room session. The ordinary site URL continues to show only published content.

## Video workflow

The CMS accepts MP4, MOV, and WebM files up to 2 GB. FFprobe verifies a readable video track, dimensions of at least 300 pixels per side, and a duration under one hour. FFmpeg creates a JPEG poster, 720p and 1080p H.264 MP4 files, and a 720p VP9 WebM file. Metadata is stripped from the outputs. The poster also receives the image variants above. Videos stay private until approval and Publish. Editors can play the private MP4 in the Library inspector; visitors can play published videos on the light table. FFmpeg and FFprobe must be installed on the CMS host; the included CMS Docker image installs them. Encoding occurs during the upload request, so long videos may take time to finish.

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

Caddy routes `/api`, `/admin`, and uploaded `/media/photos` and `/media/videos` to the CMS, serves curated media as static files, and serves `index.html` for client routes such as `/archive`. PostgreSQL stores the catalog. PostGIS is not required because the site does not publish location coordinates.

### Optional Cloudflare R2 or Backblaze B2

Set `STORAGE_DRIVER=s3` and provide `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, `S3_REGION`, and `MEDIA_BASE_URL`. The media base URL must be an HTTPS address from which anonymous visitors can read the published bucket. Grant the key access only to that bucket. Keep and back up the private staging volume because it is needed to republish without reuploading.

For R2, use the account's `https://<account-id>.r2.cloudflarestorage.com` endpoint, `S3_REGION=auto`, and a public custom domain for `MEDIA_BASE_URL`. For B2, use its regional S3 endpoint and region code with a public bucket URL or custom domain. Set `S3_FORCE_PATH_STYLE` if the provider requires it. Neither provider is required for local or WSL use.

On withdrawal, the CMS deletes the public object at its origin. Published objects use `Cache-Control: public, max-age=300, must-revalidate`, so browsers and CDNs honoring that header may serve cached copies for up to five minutes. Custom cache rules can extend that window. Already downloaded copies cannot be recalled.

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/site` | Public published shoots, photos, and collections |
| `GET /api/admin/session` | Current admin session and CSRF token |
| `GET /api/admin/config` | Site URL for preview links, and whether alt-text drafting is configured |
| `POST /api/admin/login` / `logout` | Password login and session revocation |
| `GET /api/admin/content` | Full private catalog |
| `GET /api/admin/preview` | Private light-table preview of staged content |
| `/api/admin/shoots` | Create, edit, publish, order, or delete CMS shoots |
| `POST /api/admin/photos/upload?shootId=&name=` and `/api/admin/videos/upload` | Upload one image or video privately; the request body is the raw file, streamed to disk |
| `GET /api/admin/alt-text` | Whether the local alt-text model is running, and its name |
| `POST /api/admin/photos/:id/alt-suggestion` | Draft alt text for a photograph (`{ "fresh": true }` asks again) |
| `/api/admin/photos/:id` and `/api/admin/videos/:id/preview` | Edit a frame or preview a private video |
| `POST /api/admin/publish` | Release queued approval and withdrawal changes |
| `/api/admin/collections` | Create, edit, publish, order, or delete collections |
| `/api/admin/collections/:id/photos/:photoId` | Add or remove a photo from a collection |
| `PUT /api/admin/shoots/:id/order` / `PUT /api/admin/collections/:id/order` | Set a complete frame sequence in one request |

Admin writes require a session cookie and the `X-CSRF-Token` value from `/api/admin/session`. Empty and malformed JSON requests return validation errors. Uploaded frames begin as drafts. `/api/site` never includes drafts.
