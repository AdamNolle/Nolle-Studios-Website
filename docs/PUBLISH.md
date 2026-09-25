# Publishing Nolle Studios

## Current public deployment

GitHub Pages serves the static gallery from the root of the `gh-pages` branch. That branch contains the built site and a `CNAME` file with `nollestudios.com`. Cloudflare has DNS-only apex and `www` CNAME records pointing to `adamnolle.github.io`. GitHub Pages has approved the certificate and enabled **Enforce HTTPS**; requests to `http://nollestudios.com/` redirect to `https://nollestudios.com/`.

Cloudflare Pages Git integration returned error `8000011`; the current publishing path is GitHub Pages, not Cloudflare Pages. The source branch does not automatically deploy to `gh-pages`.

## Updating the static gallery

1. On the source branch, put selected processed photographs in `public/media/` and update `public/media/archive.json`. Keep camera originals, private staging, and credentials out of Git.
2. Build from the repository root:

   ```powershell
   npm ci
   npm run build:static
   Set-Content -NoNewline -Path dist/CNAME -Value 'nollestudios.com'
   ```

3. Copy the **contents** of `dist/`, including `CNAME`, to the root of a checkout of `gh-pages`. Replace old generated files so withdrawn photographs and obsolete bundles are not left on the public branch. Review the file changes, then commit and push `gh-pages`.
4. Wait for the GitHub Pages deployment, then check the homepage, `/archive`, and image variants on the HTTPS custom domain. Confirm that HTTP redirects to HTTPS once **Enforce HTTPS** is enabled.

The static build reads the checked-in manifest directly and has no CMS API. It does not serve `/admin/`, PostgreSQL, or an upload endpoint. The CMS in WSL remains a local editing workspace at `http://127.0.0.1:8080/admin/` while its Compose stack runs. CMS uploads and publication state live in local database and media volumes; they are not copied into the repository or the Pages build. Selected images must be exported into `public/media/`, added to the manifest, rebuilt, and republished to appear in the public gallery.

## Moving the CMS online later

When a Linux host is ready, deploy `compose.yaml` with private production secrets and persistent PostgreSQL, staging, and media storage. Caddy serves the site and routes `/api/`, `/admin/`, and uploaded `/media/photos/` to the CMS on the same origin. Migrate CMS data and uploaded images you intend to retain, switch Cloudflare DNS to the new host, configure `SITE_DOMAIN=nollestudios.com`, and verify HTTPS, the public catalog, and admin sign-in. See [CMS deployment](CMS.md) for configuration and backups.

Local media volumes work initially if backed up. Cloudflare R2 or Backblaze B2 can later store published variants through `STORAGE_DRIVER=s3`, S3 credentials, and an HTTPS `MEDIA_BASE_URL`; PostgreSQL and private staging still require persistent storage.
