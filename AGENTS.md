# Notes for the next agent

Nolle Studios is a photography portfolio shown as a light table (SolidJS, `src/`), with a private, self-hosted CMS called the Content Room (SolidJS UI in `admin/`, Hono server in `server/`). Start with the [README](README.md); this file covers what is not obvious from the code.

## How the owner works

- Push straight to `main`. Keep no other branches, local or remote, apart from `gh-pages`, which is the live site. Commit and push as you go.
- Keep the live site current: after pushing `main`, run `npm run publish:pages` (see [publishing](docs/PUBLISH.md)). `main` does not deploy on its own.
- Every texture and sprite must be made in Blender or code (`art/`). The owner has no rights to stock or downloaded images, which is why the cork was re-rendered procedurally.
- Visual quality is judged closely, especially the realism of the pins, tape, and glass. Check changes in a browser at desktop and phone sizes before calling them done.

## Commands

```bash
npm run dev:cms        # CMS on 127.0.0.1:8788 (needs .env with CMS_ADMIN_PASSWORD)
npm run dev            # site at 127.0.0.1:5173, Content Room at /admin/
npm run alt:model      # local vision model for alt text on 127.0.0.1:8790 (~5 GB RAM)
npm run typecheck      # three projects: browser, site unit tests, server
npm test               # CMS, static build, board layout, media and download tests
npm run build          # CMS-flavoured site (dist/, reads /api/site) + Content Room (dist-admin/)
npm run build:static   # GitHub Pages site (dist/, reads media/archive.json)
npm run publish:pages  # build:static, then replace gh-pages and push
```

`npm run build` and `npm run build:static` both write `dist/` and are not interchangeable: a CMS build served statically shows "The table is unavailable". The publish script always rebuilds static.

## Traps

- **iCloud duplicates.** The repository lives in an iCloud-synced Desktop folder. iCloud creates conflict copies such as `app 2.ts` and `photo 3.jpg` during git operations. They are gitignored and the publish script strips them from `dist/`, but they have broken the Vite cache (delete `node_modules/.vite`) and TypeScript (duplicate files). Remove any with `find . -path ./node_modules -prune -o -name '* [0-9].*' -print`. Moving the repository out of iCloud is recommended.
- **Background browser tabs.** When the automated Chrome tab is not in front, Chrome pauses `requestAnimationFrame`, CSS animations, and image painting. Screenshots then show black frames or panels that never finished animating in, which looks like a bug but isn't. Confirm through DOM state (`img.complete`, class names) before chasing it.
- **Unused code fails the build.** `noUnusedLocals` and `noUnusedParameters` are on in every tsconfig.
- **The server runs TypeScript directly** (Node 26 type stripping, `erasableSyntaxOnly`). Imports need `.ts` extensions, and enums, namespaces, and constructor parameter properties are not allowed.
- **The Content Room's CSP blocks inline `style` attributes.** Solid's `style={{…}}` works because it sets styles through the CSSOM. Don't add `style="…"` strings or third-party origins.
- **Curated image sizes are measured on the long side.** The manifest's `640/1440/3200` files are that long on their longest edge, so a portrait's 1440 file is 960 wide. `src/table/media.ts` converts these to real widths for `srcset`, and `media.test.ts` covers it. CMS uploads use true widths.
- **Blender runs from the repository root** (`blender -b -P art/<script>.py`) and renders on the GPU through `use_gpu` in `art/common.py`. Scripts write straight into `src/assets/`. Intermediate PNGs go to `art/renders/`, which is gitignored.

## Where things are tuned

- **Board layout, zoom limits, and how prints hang:** `src/table/layout.ts` (`boardPrints`, `clampCamera`, `holdFor`). Prints alternate between clear tape (four placements) and push pins (1, 2, or 4, in blue, yellow, red, or dark green), and neighbours never repeat. Sprites are chosen in `src/table/art.ts` by file name.
- **Liquid glass:** the rim image and refraction normal map come from `art/liquid_glass.py`. `src/table/glass.ts` nine-slices the map and applies it through an SVG `feDisplacementMap`, in Chromium only. The bend strength is 16 on bars; higher values squeeze the cork into streaks on thin bars.
- **Header logo:** `art/glass_mark.py` renders glass tiles that emit the exact brand colours under a clear coat. Lighting coloured glass instead made the colours dull, which the owner rejected.
- **Alt-text drafting:** the prompt, input size, and model call are in `server/alt-text.ts`. Qwen3-VL 8B was chosen over 4B for accuracy. Do not send the shoot title to the model, because it describes the title as if it were visible. Drafts are suggestions and are never saved as alt text automatically.
- **Release notes and the checks behind them:** [docs/QA.md](docs/QA.md), newest first.

## Testing the Content Room without touching real data

Run a second CMS against throwaway paths:

```bash
CMS_PORT=8791 CMS_ADMIN_PASSWORD=<any 12+ chars> CMS_SESSION_SECRET=<32+ chars> \
SQLITE_FILE=/tmp/nolle-test/cms.sqlite LOCAL_MEDIA_DIR=/tmp/nolle-test/media STAGING_DIR=/tmp/nolle-test/staging \
SITE_URL=http://localhost:5173/ node server/index.ts
```

Then open `http://localhost:8791/admin/` after `npm run build:admin`. The production path, `NODE_ENV=production` with PostgreSQL, was checked against PGlite's wire server (`npx pglite-server`, installed outside the repository), since neither Docker nor PostgreSQL is installed on this machine.

## Open items

- **Confirm the contact details.** `hello@nollestudios.com` and `@nollestudios` in `src/table/Chrome.tsx` came from the design mock, and the owner has not confirmed them.
- **Not yet verified:** Safari, Firefox, physical phones (pinch zoom), building the Docker images, live R2/B2 storage, and hosting the CMS online. The CMS currently runs only locally. Photographs uploaded there reach the public site only after they are exported into `public/media/` and published.
- **Very short landscape phones** (for example 667×375): the keys and About panels scroll inside the glass, with a fade showing there is more.
- **Screenshots go stale.** `public/og-image.jpg` and `docs/images/*.webp` are browser screenshots. Retake them after visible design changes.
