# Publishing Nolle Studios

## Current public deployment

The dynamic gallery and Content Room run as Docker Compose services on Adlon's SSD. Cloudflare Tunnel sends `nollestudios.com` and `admin.nollestudios.com` to the private Caddy origin at `http://127.0.0.1:18081`; no inbound router port is required. The public hostname serves the gallery and its live `/api/site` catalog. The admin hostname redirects `/` to `/admin/`.

The database, private staging variants, and public media variants persist in Docker volumes. Publishing in the Content Room updates the production catalog immediately. New shoots created in the editor are queued for the site by default but remain private until **Publish**; “Keep this shoot private” opts out. **Publish** automatically includes every described, unpublished photo or video in queued shoots. Existing private shoots have an **Include & publish** action that marks the shoot for the site and publishes in one step. Photos and videos in private shoots are not copied to public storage or counted as live. Missing alt text blocks the release with a clear message instead of silently skipping media.

## Deploying the dynamic gallery

1. Commit and push `main`.
2. On Adlon, pull and rebuild the stack:

   ```bash
   git pull --ff-only
   docker compose -f compose.yaml -f compose.tunnel.yaml up -d --build --remove-orphans
   ```

3. Wait for the CMS health check, then verify `/api/health`, `/api/site`, `/admin/`, and a published image through both hostnames.

Back up PostgreSQL plus the `media_data` and `staging_data` volumes before migrations or host maintenance. Keep `.env`, camera originals, private staging, and credentials out of Git.

Adlon's user-level `nolle-studios-backup.timer` creates a verified PostgreSQL custom-format dump on the 2 TB data drive every day. Check it with `systemctl --user list-timers nolle-studios-backup.timer`; the backup files live under `/srv/data/backups/nolle-studios`. Published and staged media still need their own durable copy until object storage is enabled.

## Static fallback

The `gh-pages` branch remains a static fallback and historical artifact. `npm run publish:pages` builds from `public/media/archive.json`; it does not contain the CMS database or newly uploaded photographs. It must not be used as the production DNS target while the Content Room is the source of truth.

Cloudflare R2 or Backblaze B2 can later store published variants through `STORAGE_DRIVER=s3`, S3 credentials, and an HTTPS `MEDIA_BASE_URL`; PostgreSQL and private staging still require persistent storage.

## Contact email

Cloudflare Email Routing handles `hello@nollestudios.com`. Its routing rule invokes the `nolle-studios-email` Worker in `infra/email/`, which delivers to `adammnolle@gmail.com` and `jackn315@gmail.com`. Each destination must accept Cloudflare's verification email before it can receive messages. Check their verification status under **Email Service → Email Routing → Destination addresses**.

Cloudflare's `message.forward()` cannot modify Subject. The Worker therefore relays each message from `hello@nollestudios.com` with `[NOLLESTUDIOS EMAIL]` prepended to its original subject, using the original Reply-To (or From) for replies. It preserves the MIME body byte-for-byte, including attachments and HTML, and removes authentication signatures invalidated by the changed headers. The site's email link also prefills the subject prefix.

If Cloudflare rejects a relay (for example, an outgoing message exceeds its sending size limit), the Worker attempts ordinary forwarding to that inbox to preserve the inquiry. That fallback keeps the original subject. A failure at one inbox does not prevent delivery to the other; failure at both rejects the incoming message rather than silently dropping it. Workers logs contain only generic delivery errors, never message contents.

Run `npm run test:email` before updating the Worker, then deploy with:

```bash
npx wrangler deploy --config infra/email/wrangler.jsonc
```

This deploys the email Worker separately from the Docker website. The existing `hello@nollestudios.com` routing rule must target this Worker; catch-all remains disabled. `workers_dev` and preview URLs are disabled because the Worker only receives email events. Verify the routing rule, both destination addresses, and an incoming test message after changes. For local runtime checks, run `npx wrangler dev --config infra/email/wrangler.jsonc --port 8793`; the `/cdn-cgi/handler/email` endpoint accepts MIME test messages with `from` and `to` query parameters, without sending to actual inboxes.
