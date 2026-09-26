import assert from "node:assert/strict";
import test from "node:test";
import { srcset } from "./media.ts";
import type { ArchivePhoto } from "../archive.ts";

const curated = (width: number, height: number): ArchivePhoto => ({
  id: "p", alt: "", caption: "", thumb: "t.webp", mid: "m.webp", full: "f.webp", width, height,
  formats: { avif: { thumb: "t.avif", mid: "m.avif", full: "f.avif" } },
});

test("curated srcsets describe each file's real width, not its long side", () => {
  // A portrait's "1440" file is 1440 tall and 960 wide.
  assert.equal(srcset(curated(2134, 3200), "avif"), "t.avif 427w, m.avif 960w, f.avif 2134w");
  assert.equal(srcset(curated(3200, 2134), "avif"), "t.avif 640w, m.avif 1440w, f.avif 3200w");
  // Small originals are never described as wider than they are.
  assert.equal(srcset(curated(1000, 800), "avif"), "t.avif 640w, m.avif 1000w");
});
