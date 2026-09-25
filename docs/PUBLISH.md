# Publishing Nolle Studios

## Public gallery on Cloudflare Pages

The site can be published without a server as a static gallery. Connect this repository to a Cloudflare Pages project and use:

| Setting | Value |
| --- | --- |
| Build command | `npm run build:static` |
| Build output directory | `dist` |
| Node version | `22` (Pages build image v3 default) |

The `build:static` command bundles the React site and copies the curated photographs and `public/media/archive.json` into `dist/`. The static build reads that manifest directly, so it does not wait for a CMS API. Add `nollestudios.com` as a Pages custom domain after the first successful deployment. Configure `www.nollestudios.com` separately if it should resolve or redirect. Verify the domain over HTTPS and check a photograph at full resolution before announcing the site.

This deployment serves the public gallery only. It has no `/admin/` CMS, `/api/site`, PostgreSQL, or upload endpoint. Do not expose an admin link on the static site. The CMS running in WSL remains a local editing workspace at `http://127.0.0.1:8080/admin/` while its Compose stack is running.

CMS uploads and their publication state live in the local database and media volumes; they are not copied into the Git repository or a Pages build. They will **not** appear on the public site automatically. For a static update, export selected, processed photographs into `public/media/`, update `public/media/archive.json`, then commit and redeploy. Keep originals and private staged files off the public site.

## Moving the CMS online later

When a Linux host is ready, deploy `compose.yaml` with private production secrets and persistent PostgreSQL, staging, and media storage. The bundled Caddy server serves the built site and routes `/api/`, `/admin/`, and uploaded `/media/photos/` to the CMS on the same origin. Point Cloudflare DNS at that host, configure `SITE_DOMAIN=nollestudios.com`, and use HTTPS with Cloudflare **Full (strict)** mode. Follow [CMS deployment](CMS.md) for environment variables, backups, and checks.

Local media storage works initially if its volumes are backed up. Cloudflare R2 or Backblaze B2 can later hold published image variants through `STORAGE_DRIVER=s3`, S3 credentials, and an HTTPS `MEDIA_BASE_URL`; PostgreSQL and private staging still need persistent storage. Before switching the live domain from Pages to the Linux host, migrate any CMS data and uploaded images you intend to retain, and verify the public catalog and admin sign-in on the new origin.
