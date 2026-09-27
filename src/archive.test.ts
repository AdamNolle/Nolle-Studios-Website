import assert from "node:assert/strict";
import test from "node:test";
import { normalizeArchive } from "./archive.ts";

test("the public archive keeps safe camera metadata", async () => {
  const archive = normalizeArchive({ shoots: [{
    id: "shoot", title: "Metadata shoot", date: "2026-09-19", coverUrl: "/photo.jpg",
    photos: [{
      id: "photo", alt: "Baseball player", thumb: "/photo.jpg", mid: "/photo.jpg", full: "/photo.jpg",
      cameraMake: "SONY", cameraModel: "ILCE-7M5", lensModel: "FE 28-70mm F3.5-5.6 OSS II",
      capturedAt: "2026-09-19T09:10:18",
    }],
  }] });
  const photo = archive![0].photos[0] as unknown as Record<string, unknown>;
  assert.equal(photo.cameraMake, "Sony");
  assert.equal(photo.cameraModel, "a7 V");
  assert.equal(photo.lensModel, "FE 28-70mm F3.5-5.6 OSS II");
  assert.equal(photo.capturedAt, "2026-09-19T09:10:18");
});
