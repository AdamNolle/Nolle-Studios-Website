import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { config, validateConfig } from './config.ts';
import { now, openDatabase } from './db.ts';
import { buildVariants, createStaging, createStorage, publishVariants } from './media.ts';

interface RestoreRow {
  id: string;
  file_name: string;
  width: number;
  height: number;
  kind: string;
  published: number;
  storage_prefix: string;
}

async function filesBelow(root: string) {
  const files: string[] = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(target));
    else if (entry.isFile() && /\.(?:jpe?g|png|tiff?|webp|avif|hei[cf])$/i.test(entry.name)) files.push(target);
  }
  return files;
}

async function orientedSize(file: string) {
  const metadata = await sharp(file, { limitInputPixels: 80_000_000 }).metadata();
  const rotated = [5, 6, 7, 8].includes(metadata.orientation ?? 1);
  return { width: rotated ? metadata.height : metadata.width, height: rotated ? metadata.width : metadata.height };
}

async function main() {
  const sourceRoot = process.argv[2];
  if (!sourceRoot) throw new Error('Usage: node server/restore-metadata.ts /read-only/source-directory');
  validateConfig();
  const sourceFiles = await filesBelow(path.resolve(sourceRoot));
  const byName = new Map(sourceFiles.map(file => [path.basename(file).toLowerCase(), file]));
  const db = await openDatabase(config);
  const staging = createStaging(config);
  const storage = createStorage(config);
  let restored = 0, missing = 0, mismatched = 0;
  try {
    const rows = await db.query<RestoreRow>("SELECT id, file_name, width, height, kind, published, storage_prefix FROM photos WHERE storage_prefix <> '' ORDER BY created_at");
    for (const row of rows) {
      if (row.kind !== 'image') continue;
      const source = byName.get(row.file_name.toLowerCase());
      if (!source) { missing++; continue; }
      const size = await orientedSize(source);
      if (size.width !== row.width || size.height !== row.height) {
        console.warn(`Skipped ${row.file_name}: source dimensions do not match the upload`);
        mismatched++;
        continue;
      }
      const built = await buildVariants(source, row.id, staging, storage, { replace: true });
      if (row.published) await publishVariants(row.id, staging, storage, row.kind);
      await db.query(`UPDATE photos SET camera_make = ?, camera_model = ?, lens_model = ?, captured_at = ?, updated_at = ? WHERE id = ?`,
        [built.camera.cameraMake, built.camera.cameraModel, built.camera.lensModel, built.camera.capturedAt, now(), row.id]);
      restored++;
      console.log(`Restored safe metadata for ${row.file_name}`);
    }
  } finally {
    await db.close();
  }
  console.log(JSON.stringify({ restored, missing, mismatched }));
}

await main();
