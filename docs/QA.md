# Release review — 25 September 2026

## TypeScript and SolidJS rewrite, 25 September 2026

- The site and the Content Room are SolidJS and TypeScript built by Vite; the CMS is TypeScript on Hono, run directly by Node.js 26. React, Express, multer, dotenv, and the AWS SDK are gone. The site ships under 70 KB of JavaScript (it was 272 KB with React).
- Both TypeScript projects pass with `noUnusedLocals` and `noUnusedParameters`, so dead code fails the type check. `npm test` runs 23 CMS tests, 3 static-build tests, and 9 board-layout tests.
- The shoot board zooms out only as far as the view that fits every print, and panning stops with the board's edge at the view's edge; a drag past it springs back. Checked with wheel, buttons, and drag at 1920×879.
- The keyboard and About panels no longer show scroll bars; on short windows only their contents scroll, and the keys dialog switches to a compact layout.
- Alt-text drafts moved to Qwen3-VL 8B with a stricter prompt, a 1280 px input, and no shoot title in the prompt. On the 17 curated photographs it stopped inventing frisbees, "fall league" games and dives, and describes poses literally. Drafts are still reviewed before saving.
- The cork tile was re-rendered from `art/cork.py`: its mean colour and spread match the previous tile exactly, 98% of pixels are within 8 levels, and the AVIF is 246 KB.
- Push pins were re-rendered with Blender's CC0 interior HDRI and a real cast shadow, and shown smaller (56 px). Prints alternate clear tape (four placements) and push pins (one, two, or four, in blue, yellow, red, and dark green) so neighbours never match. Each pin casts one shadow, and the tape is nearly clear film with glossy edges.
- Visitors can download photographs: **Select** on the shoot board (or `S`) ticks prints, and the glass bar downloads one as its full-size JPEG or several as a ZIP built in the browser (stored, not recompressed). The preview has a Download button (`D`). A test checks the ZIP with `unzip`; in Chromium, selecting all six frames of The Next Inning produced a valid 9.95 MB ZIP with six entries.
- The liquid-glass rim was re-rendered with the studio HDRI and one lamp, keeping only the shoulder's reflections. In Chromium, a Blender normal map drives an SVG displacement filter, so the backdrop refracts at the rim; Safari and Firefox keep the frosted fallback.


## Earlier passes

### Design completion pass, 25 September 2026

- The light table follows the Table Stage design: a liquid-glass header with the mark, centred wordmark, and Tables / About / Contact / ? navigation; deeper layered sheet shadows under a warmer lamp; a transport of shoot covers that opens the current shoot's title, date and frame count; idle hints after 3.5 seconds (once per session); an About panel (a bottom sheet on phones); a keys dialog; and loading, empty and unavailable states on the cork. The contact sheets stay without push pins, as decided in the earlier pass.
- All bars and panels share one material: live CSS glass plus a Blender-rendered nine-slice rim (`art/liquid_glass.py`). Motion is limited to transforms and opacity so the compositor runs it on the GPU.
- The shoot board opens fitted to the screen. Its rows are laid out to match the viewport's shape, and prints alternate between four single corner strips of tape and two photoreal Blender map pins.
- The loupe was re-rendered as a clear acrylic, black anodised, and brushed aluminium stand loupe, and its lens tint is neutral rather than blue.
- The Content Room adds the full-screen alt-text pass (⌘↵ saves and moves on, ⌥→ skips, the previous frame's text can be reused), keyboard shortcuts with a help dialog, shift-click ranges, a dark batch bar (approve, draft, write alt text, add to collection), dark contact-sheet and inline-editing ledger layouts, an upload queue with per-file progress, a three-column Collections editor with an Add photos panel, and a Publish screen with grouped counts and a publish history.
- The admin CSP blocks inline `style` attributes, so the progress bars and grid columns that relied on them were silently missing. They now use CSS and the CSSOM. Fonts are self-hosted for both the site and the Content Room, and the site no longer contacts Google Fonts.
- Checked in Chromium at 1440–1728 px desktop widths and in 390 px frames with an isolated CMS copy on port 8791 (seeded drafts, hidden shoots, missing alt text, collections, one publish). The alt-text pass, batch selection, publish history, and a two-file upload (one JPEG accepted, one text file rejected in place) worked. `npm run typecheck`, `npm run build`, `npm run test:static` (3), and `npm run test:cms` (19) passed.
- The test browser window was covered by other windows, so Chrome paused `requestAnimationFrame` and compositor repaints. Spring animations (board zoom, table easing) and fades were verified by reading state rather than by watching them. Recheck motion in a visible browser.

### Local Content Room pass

- The light table now has a dark glass header and compact glass transport. A top-down loupe was rendered in Blender with a graphite aperture and translucent blue body; the aperture shows a live magnified crop.
- The Content Room uses the latest `Content Room.dc.html` layout with real CMS counts and records. It includes overview, library, collections, uploads, an inspector, and a Publish review screen. Collection members retain their chosen order and can be rearranged by dragging or Alt + Arrow keys. The reference's generated `support.js` was examined as runtime context rather than shipped as application code.
- Image and video uploads stay private until approval and Publish. FFmpeg produces poster images plus MP4 and WebM playback files for videos. Alt text, frame order, shoot covers, shoot details, collection details, membership, and moves between shoots remain queued until Publish. Live items must be withdrawn through Publish before permanent deletion.
- `npm run typecheck`, `npm run build`, `npm run build:static`, and seventeen CMS tests passed. The tests cover private staging, publication, withdrawal, interrupted Publish retries, metadata queues, video range previews, playback URLs, sessions, and CSRF.
- Both previews are hosted locally at `http://127.0.0.1:5173/` and `/admin/`; the CMS API listens on port 8788. Production GitHub Pages remains a separate static deployment.

### Design at that time

- The light table is the homepage at `/`; `/archive` is an alias. Public shoots open newest first: 20 September, 19 September, then 9 September 2026. Photos inside each shoot keep their curated sequence.
- Contact sheets use larger frames across desktop, tablet, and phone sizes. Photo captions, per-photo numbers, and the former index title have been removed from the public interface. Alt text remains on images and controls for assistive technology.
- The header and compact floating transport now use separate desktop and mobile optical-glass reflection renders from editable Blender scenes. Their live CSS bodies keep text and controls readable over the photographs.
- The transport has previous/next buttons and a denser engraved ruler. Minor divisions stay aligned with photo markers as spacing changes with viewport width; a centered shoot/date readout replaces repeated ruler labels. The selected contact-sheet photo has a subtle outline.
- At widths through 430 px, the board header uses two rows so the full shoot title and date remain visible beside 44 px back and zoom controls. The Blender loupe follows the photograph's aspect ratio and actual `object-fit: cover` crop. Corner tape uses two Blender-rendered pieces meeting at 90 degrees.
- The Content Room follows the light editorial layout of the supplied Claude design. Its photo editing flow omits visible caption controls while retaining alt text.

### Verified locally

- `npm run typecheck`, `npm run build`, `npm run test:cms`, `python art/verify_media.py`, a syntax check of the then-vanilla Content Room script, and `git diff --check` passed after the header, transport, ruler, responsive, caption, tape, and CMS changes. CMS tests cover private staging, metadata removal, publishing, delivery, withdrawal, deletion, sessions, and CSRF behavior.
- The media verifier checked 3 shoots, 17 photographs, and 153 responsive public variants with no private metadata.
- The public site was inspected in Chromium at 320×700, 390×844, 768×1024, 1024×768, 1440×900, 1920×1080, and 844×390 without document overflow. The 768×1024 six-photo sheet uses two columns and three rows. Short landscape layout retains clearance around the sheet. The final glass header, dense ruler, selected-photo outline, and responsive transport were visually checked at 320×700, 768×1024, 1440×900, and 844×390; the two-row board header was checked at 320 px and 390 px with 44 px controls.
- Pointer hover, glass slider clicks, previous/next buttons, keyboard arrows, and End changed shoots. Enter opened the board and a print; Escape closed each layer and returned focus to its source control. The loupe appeared over photographs.
- Preview zoom buttons, wheel zoom, drag pan, Fit, next-photo reset, and the mobile thumbnail strip worked. The same flow worked with reduced motion enabled. A board-resolution image fills the preview while the full-resolution file decodes.
- Focused navigation did not shift the stage or preview. After advancing a phone preview at 320×700, its scroll position remained zero and its header stayed at the top.
- The production build was smoke tested through Vite Preview on `/` and `/archive`. Local Chromium over loopback reported roughly 983 KB transferred on first table view and first contentful paint of 156–232 ms. These are local lab observations, not field performance measurements.
- The local CMS served `/api/site`. Earlier admin checks exercised temporary shoot and collection creation, upload, publication, linking, and removal without changing production data. The earlier manifest fallback was removed after it was found to expose locally hidden curated content during a CMS outage.
- The redesigned CMS was checked at desktop, 967px, 390px, and 320px widths. Shoot and collection editing, search, caption-free forms, and selected-file filename feedback worked.
- In the isolated CMS fixture, the Library preserved a collection's chosen photo order. The overview's Live counter opened all 17 live photos after a collection search. Opening and closing photo details returned keyboard focus to a usable control at desktop and phone widths, including Escape on the phone.
- The Content Room's Preview on table opened a hidden draft shoot and its unpublished upload in an authenticated light-table view at desktop and phone widths. The preview carried a visible private badge; after sign-out, reloading it showed an access message. The public catalog still contained only the three published shoots.
- The public catalog now sends `Cache-Control: no-store` so a reload fetches the current Publish state. In an isolated CMS fixture, revoking a session while the Library was open returned the editor to sign-in on the next save with a clear session-ended message.
- A two-file browser upload in the isolated fixture accepted the valid JPEG, rejected the invalid text file, and reported "1 of 2 uploaded" with the failing filename. The valid file remained a private draft. Overview labels now use singular wording for one photograph, draft, or frame.
- The failed-withdrawal regression now checks that variants deleted before one file error are restored from staging while the photo remains live and queued for retry.
- A failed later addition leaves earlier additions out of the public catalog. Restoring the missing staged file and retrying Publish releases both frames.
- A failed later withdrawal restores earlier withdrawn frames, keeps both live, and allows Publish to finish after the failed file is repaired.
- The shoot editor now uses a date control, and the API rejects impossible dates without changing the saved shoot.
- Shoot and collection drag reordering now sends one validated sequence. The CMS test rejects incomplete or repeated IDs, checks that valid edits remain staged, and verifies their order after Publish.
- Empty and malformed JSON requests now return 400 validation responses instead of an internal server error.
- On a standalone CMS test port, the supplied Nolle Studios mark loads directly from the CMS server; unrelated public files remain outside that route.
- Content Room links now point to the local Vite site when opened directly on the CMS port, stay same-origin behind the site proxy, and support an explicit `SITE_URL` override.
- An isolated CMS on port 8791 and Vite site on port 5174 verified that **Preview on table** opens the selected shoot in a new tab with the private preview badge and authenticated photos.
- A failed public-media cleanup during upload deletion now returns an error and keeps the CMS record and private staging available for retry. After the obstruction is removed, the retry deletes both the record and staged files.
- An authenticated Content Room review on an isolated local database covered Overview, Library, Collections, Uploads, and Publish. It found an invisible collection visibility button and a cramped empty-state message; both were corrected and checked at desktop and phone widths.
- The three curated shoot descriptions now use plain, factual wording. Seed sync replaces only their former stock text and preserves descriptions edited in the Content Room; the current local catalog was synced and checked.
- Curated photos and shoots now use the CMS approval and Publish flow for local visibility, and their chosen state survives a manifest sync. Static files remain available until a separate deployment removes them. A dynamic site no longer falls back to the manifest when its CMS is unavailable, so hidden content cannot reappear during an outage.
- An isolated Vite site pointed at a stopped CMS displayed **Table unavailable** and a retry control. Starting that CMS and clicking **Try again** restored the table without a reload.
- The Publish review now submits directly and disables its button while working. In an isolated CMS, hiding **The Next Inning** queued one change; Publish cleared the queue, reported **Local site updated**, removed the shoot from `/api/site`, and the paired Vite site showed the remaining two shoots. The browser confirmation that had blocked the earlier test was removed.
- A three-frame cover regression reproduced a private cover choice displacing the live cover on Publish. The CMS now keeps the existing live cover until the replacement frame is approved and published. In an isolated browser check, choosing a replacement cover and hiding that frame queued one withdrawal; Publish cleared the queue while the public cover remained unchanged. The Content Room explains the wait in the photo inspector. All 18 CMS tests pass.
- The supplied four-color mark now appears on the site's header, the Content Room sign-in, and the browser icon. Browser screenshots confirmed that the contact sheets have no push pins and the photo board uses tape. TypeScript, the static build, and all 17 CMS tests passed after these changes.
- The About panel now uses the wording and contact details in the supplied redesign PDF, and the Guide names the keyboard and touch controls the site actually handles. Desktop browser screenshots showed the revised panels without clipping. Site metadata now describes the shoot-based table instead of referring to collections that are not on the public page. After advancing to another shoot and waiting through the hint delay, the idle hint stayed hidden.

## WSL hosting rehearsal

- Ubuntu WSL successfully rebuilt and ran the `compose.yaml` plus `compose.wsl.yaml` stack with PostgreSQL, the CMS, and Caddy after the header and transport changes. Caddy was bound to `127.0.0.1:8080` over HTTP. The site, `/admin/`, `/api/health`, and `/api/site` each returned HTTP 200 from Windows.
- The WSL homepage opened on the newest shoot. Admin sign-in worked, and a draft collection was created with one linked photo. A real image upload through the WSL CMS was staged privately, published to the public catalog and media route, withdrawn, and cleaned up. Private credentials and database files remain outside the repository.
- This rehearsal does not establish public availability or TLS. `nollestudios.com` is the intended domain; Cloudflare DNS awaits the Linux hosting destination. See [CMS and deployment](CMS.md) for the repeatable commands.

## Remaining validation

- The synthetic browser file picker did not decode the optional local upload thumbnail, so its native picker preview still needs a manual check. Image upload and publication passed against the WSL stack.
- Firefox, WebKit, and physical mobile devices were unavailable. Responsive checks used Chromium emulation. Multi-touch pinch is implemented but was not exercised on a physical device.
- No R2 or B2 credentials were supplied, so S3-compatible publishing has not been tested against a live bucket. Public DNS and TLS issuance have not been tested.
- The 17 curated images are static public assets. The CMS can hide them from its local catalog through Publish, but their files and the current GitHub Pages catalog require a manifest update and redeploy. CMS-uploaded images support publish and withdrawal through admin; previously cached public copies may remain accessible until cache expiry or purge.
