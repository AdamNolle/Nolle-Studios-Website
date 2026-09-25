# Release review — 24 September 2026

## Current design

- The light table is the homepage at `/`; `/archive` is an alias. Public shoots open newest first: 20 September, 19 September, then 9 September 2026. Photos inside each shoot keep their curated sequence.
- Contact sheets use larger frames across desktop, tablet, and phone sizes. Photo captions, per-photo numbers, and the former index title have been removed from the public interface. Alt text remains on images and controls for assistive technology.
- The glass transport has previous/next buttons and Blender-rendered reflection textures. The Blender loupe follows the photograph's aspect ratio and actual `object-fit: cover` crop. Corner tape uses two Blender-rendered pieces meeting at 90 degrees.
- The CMS editing interface is being brought into the light table's dark photographic visual language. Its photo editing flow omits visible caption controls while retaining alt text.

## Verified locally

- `npm run typecheck`, `npm run build`, `npm run test:cms`, `python art/verify_media.py`, `node --check server/admin/admin.js`, and `git diff --check` passed after the final caption, tape, and CMS changes. CMS tests cover private staging, metadata removal, publishing, delivery, withdrawal, deletion, sessions, and CSRF behavior.
- The media verifier checked 3 shoots, 17 photographs, and 153 responsive public variants with no private metadata.
- The public site was inspected in Chromium at 320×700, 390×844, 768×1024, 1024×768, 1440×900, 1920×1080, and 844×390 without document overflow. The 768×1024 six-photo sheet uses two columns and three rows. Short landscape layout retains clearance around the sheet.
- Pointer hover, glass slider clicks, previous/next buttons, keyboard arrows, and End changed shoots. Enter opened the board and a print; Escape closed each layer and returned focus to its source control. The loupe appeared over photographs.
- Preview zoom buttons, wheel zoom, drag pan, Fit, next-photo reset, and the mobile thumbnail strip worked. The same flow worked with reduced motion enabled. A board-resolution image fills the preview while the full-resolution file decodes.
- Focused navigation did not shift the stage or preview. After advancing a phone preview at 320×700, its scroll position remained zero and its header stayed at the top.
- The production build was smoke tested through Vite Preview on `/` and `/archive`. Local Chromium over loopback reported roughly 983 KB transferred on first table view and first contentful paint of 156–232 ms. These are local lab observations, not field performance measurements.
- The local CMS served `/api/site`; with the CMS stopped, the site loaded the same three shoots from `public/media/archive.json`. Earlier admin checks exercised temporary shoot and collection creation, upload, publication, linking, and removal without changing production data.
- The redesigned CMS was checked at desktop, 967px, 390px, and 320px widths. Shoot and collection editing, search, caption-free forms, and selected-file filename feedback worked.

## WSL hosting rehearsal

- Ubuntu WSL successfully built and ran the `compose.yaml` plus `compose.wsl.yaml` stack with PostgreSQL, the CMS, and Caddy. Caddy was bound to `127.0.0.1:8080` over HTTP. The site, `/admin/`, `/api/health`, and `/api/site` returned HTTP 200 from Windows.
- The WSL homepage opened on the newest shoot. Admin sign-in worked, and a draft collection was created with one linked photo. A real image upload through the WSL CMS was staged privately, published to the public catalog and media route, withdrawn, and cleaned up. Private credentials and database files remain outside the repository.
- This rehearsal does not establish public availability or TLS. `nollestudios.com` is the intended domain; Cloudflare DNS awaits the Linux hosting destination. See [CMS and deployment](CMS.md) for the repeatable commands.

## Remaining validation

- The synthetic browser file picker did not decode the optional local upload thumbnail, so its native picker preview still needs a manual check. Image upload and publication passed against the WSL stack.
- Firefox, WebKit, and physical mobile devices were unavailable. Responsive checks used Chromium emulation. Multi-touch pinch is implemented but was not exercised on a physical device.
- No R2 or B2 credentials were supplied, so S3-compatible publishing has not been tested against a live bucket. Public DNS and TLS issuance have not been tested.
- The 17 curated images are static public assets. Withdrawing one requires changing the manifest and redeploying. CMS-uploaded images support publish and withdrawal through admin; previously cached public copies may remain accessible until cache expiry or purge.
