import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

test("link previews use the dedicated Nolle Studios brand card", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const url = "https://nollestudios.com/nolle-studios-preview.png";
  assert.match(html, new RegExp(`<meta property="og:image" content="${url}">`));
  assert.match(html, new RegExp(`<meta name="twitter:image" content="${url}">`));
  assert.doesNotMatch(html, /og-image\.jpg/);

  const previewPath = fileURLToPath(new URL("../public/nolle-studios-preview.png", import.meta.url));
  const metadata = await sharp(previewPath).metadata();
  assert.equal(metadata.width, 1200);
  assert.equal(metadata.height, 630);
  assert.equal(metadata.format, "png");
});
