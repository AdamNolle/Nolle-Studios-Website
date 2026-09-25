# Release review — 24 September 2026

## Latest refinement

- Public shoots now open in descending date order: 20 September, 19 September, then 9 September 2026. Photos within each shoot retain their curated sequence.
- The contact sheets were rebalanced for desktop, phone, and portrait tablet. The 768×1024 six-photo sheet uses two columns and three rows; 844×390 landscape keeps clearance above the sheet and below it. Checked 320×700, 390×844, 768×1024, 1024×768, 1440×900, 1920×1080, and 844×390 without document overflow.
- The glass transport has previous/next buttons and Blender-rendered reflection textures. Visible frame numbers and the old index title are gone. The photo preview has reachable phone navigation buttons and descriptive thumbnail labels.
- The loupe uses the source photo's aspect ratio and the actual `object-fit: cover` crop. A portrait camera photo was checked beneath the lens at 1440×900 without visible stretching.
- Focused navigation no longer shifts the table or preview: stage, board, and preview containers use `overflow: clip` with a hidden fallback. After advancing a phone preview at 320×700, preview `scrollTop` stayed at zero and its header remained at the top.
- The local CMS preview was opened and its shoot and collection editors inspected. The isolated demo catalog contains three seeded shoots, 17 camera photos, and a draft collection. Its responsive sign-in and editor flows were checked from 320px through 1920px. No production data was modified.
- `nollestudios.com` is recorded as the intended production domain. DNS and live VPS deployment await a server address.

## Verified locally

- `npm run typecheck`, `npm run build`, and `npm run test:cms` pass. The frontend and Vite config are strict TypeScript; the CMS tests cover private upload staging, EXIF removal, publish, public delivery, withdrawal, deletion, session and CSRF behavior.
- `python art/verify_media.py` checked 3 shoots, 17 photographs, and 153 responsive public variants with no private metadata.
- The built site and Vite development site were inspected in Chromium at 320×700, 390×844, 768×1024, 1024×768, 1440×900, 1920×1080, and 844×390 CSS pixels. The table loaded at `/` and `/archive` with no document-width overflow or page errors. Contact sheets, the board, preview, loupe, corner tape, pin placement, rail, and short landscape layout were visually reviewed.
- The timeline responded to pointer hover, clicks, keyboard arrows, and End. The Blender loupe appeared over photographs. Keyboard Enter opened the board and preview; Escape closed each and returned focus to the source control.
- Preview zoom buttons, wheel zoom, drag pan, Fit, next-frame reset, and the mobile thumbnail strip worked. The same flow worked with reduced motion enabled. A board-resolution image now fills the preview while the full-resolution file decodes.
- The production build was smoke tested through Vite Preview on `/` and `/archive`. A local Chromium run over loopback reported about 983 KB transferred on the first table view and a first contentful paint of 156–232 ms. These are local lab observations, not field performance claims.
- With the CMS running, `/api/site` served the curated archive. With the CMS stopped, the site loaded the same three shoots from `public/media/archive.json`. The admin workflow was exercised in the earlier local review: temporary shoot and collection creation, upload, publication, linking, and removal.

## Deployment limits

- Docker is unavailable on this Windows host, so the PostgreSQL and Caddy Compose stack and TLS issuance were not run here.
- Firefox and WebKit Playwright binaries and physical mobile devices were unavailable. Responsive checks used Chromium emulation. Multi-touch pinch was implemented but was not exercised on a physical device.
- No R2 or B2 credentials were supplied, so S3-compatible publishing has not been tested against a live bucket.
- The 17 curated images are static public assets. Withdrawal requires changing the manifest and redeploying. CMS-uploaded images support publish and withdrawal through the admin UI; previously cached public copies may remain accessible until cache expiry or purge.
