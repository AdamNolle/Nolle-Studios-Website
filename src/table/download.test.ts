import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileName, zip } from "./download.ts";
import type { ArchiveShoot } from "../archive.ts";

test("a ZIP of photographs opens with standard tools, byte for byte", async () => {
  const files = [
    { name: "the-next-inning-01.jpg", data: new TextEncoder().encode("hello") },
    { name: "the-next-inning-02.jpg", data: new Uint8Array(70_000).map((_, i) => i * 7) },
  ];
  const archive = new Uint8Array(await zip(files, new Date(2026, 8, 25, 12, 30)).arrayBuffer());
  // The CRC-32 of "hello" is 0x3610a686, stored in the first local header.
  assert.equal(new DataView(archive.buffer).getUint32(14, true), 0x3610a686);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nolle-zip-"));
  try {
    await fs.writeFile(path.join(dir, "photos.zip"), archive);
    execFileSync("unzip", ["-q", "photos.zip"], { cwd: dir });
    for (const file of files) assert.deepEqual(new Uint8Array(await fs.readFile(path.join(dir, file.name))), file.data);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test("downloads are named after the shoot and the frame", () => {
  const photo = (full: string) => ({ id: "", alt: "", caption: "", thumb: "", mid: "", full, formats: { jpeg: { full } } });
  const shoot = { id: "s", title: "The Next Inning!", date: "", displayDate: "", description: "", coverUrl: "",
    photos: [photo("/media/a-3200.jpg"), photo("/media/b-3200.jpg")] } satisfies ArchiveShoot;
  assert.equal(fileName(shoot, 1), "the-next-inning-02.jpg");
});
