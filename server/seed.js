import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { config } from './config.js';
import { now, openDatabase, slugify } from './db.js';

function publicPath(value) {
  if (typeof value !== 'string' || !/^\/media\/[A-Za-z0-9/_-]+\.(?:avif|webp|jpe?g)$/i.test(value) || value.includes('..')) {
    throw new Error('Seed manifest contains a non-public or invalid media path');
  }
  return value;
}

function checkedId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{2,100}$/.test(value)) throw new Error('Seed manifest contains an invalid ID');
  return value;
}

export async function seedFromManifest(db, manifestPath) {
  let manifest;
  try { manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return { shoots: 0, photos: 0, absent: true };
    throw error;
  }
  if (!Array.isArray(manifest.shoots)) throw new Error('Seed manifest needs a shoots array');
  let shoots = 0;
  let photos = 0;
  let removed = 0;
  const selectedShootIds = new Set();
  const selectedPhotoIds = new Set();
  const timestamp = now();
  for (const [shootIndex, shoot] of manifest.shoots.entries()) {
    // Only media deliberately marked as published in the curated manifest enters the public catalog.
    if (shoot.published !== true) continue;
    const shootId = checkedId(shoot.id);
    selectedShootIds.add(shootId);
    const title = String(shoot.title || '').trim().slice(0, 140);
    if (!title) throw new Error(`Seed shoot ${shootId} needs a title`);
    await db.query(`INSERT INTO shoots
      (id, title, slug, description, shot_date, location, sort_order, published, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
    [shootId, title, `${slugify(title) || 'shoot'}-${shootIndex}`,
      String(shoot.description || '').slice(0, 3000), String(shoot.date || '').slice(0, 80),
      String(shoot.location || '').slice(0, 180), shootIndex, 1, timestamp, timestamp]);
    shoots++;
    for (const [photoIndex, photo] of (shoot.photos || []).entries()) {
      if (photo.published === false) continue;
      const photoId = checkedId(photo.id);
      selectedPhotoIds.add(photoId);
      const assets = {
        thumb: publicPath(photo.thumb), mid: publicPath(photo.mid), full: publicPath(photo.full),
        formats: {},
      };
      for (const [format, variant] of Object.entries(photo.formats || {})) {
        if (!['avif', 'webp', 'jpeg'].includes(format)) continue;
        assets.formats[format] = {
          thumb: publicPath(variant.thumb), mid: publicPath(variant.mid), full: publicPath(variant.full),
        };
      }
      const width = Number(photo.width);
      const height = Number(photo.height);
      if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
        throw new Error(`Seed photo ${photoId} needs width and height`);
      }
      await db.query(`INSERT INTO photos
        (id, shoot_id, title, alt, caption, width, height, sort_order, published,
         is_cover, assets_json, storage_prefix, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
      [photoId, shootId, String(photo.title || '').slice(0, 180), String(photo.alt || '').slice(0, 400),
        String(photo.caption || '').slice(0, 1500), width, height, photoIndex, 1,
        shoot.coverUrl === photo.mid || shoot.coverUrl === photo.thumb || shoot.coverUrl === photo.full ? 1 : 0,
        JSON.stringify(assets), '', timestamp, timestamp]);
      await db.query("UPDATE photos SET published = 1 WHERE id = ? AND storage_prefix = ''", [photoId]);
      photos++;
    }
    await db.query('UPDATE shoots SET published = 1 WHERE id = ?', [shootId]);
  }
  // A newer curated manifest can withdraw frames. Remove only entries imported from
  // public/media; CMS uploads have a non-empty storage_prefix and are untouched.
  const imported = await db.query("SELECT id, shoot_id FROM photos WHERE storage_prefix = ''");
  const withdrawnShoots = new Set();
  for (const row of imported) {
    if (selectedPhotoIds.has(row.id)) continue;
    await db.query('DELETE FROM photos WHERE id = ?', [row.id]);
    withdrawnShoots.add(row.shoot_id);
    removed++;
  }
  for (const shootId of withdrawnShoots) {
    if (!selectedShootIds.has(shootId)) {
      await db.query('UPDATE shoots SET published = 0, updated_at = ? WHERE id = ?', [now(), shootId]);
    }
  }
  return { shoots, photos, removed, absent: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const db = await openDatabase(config);
  try {
    const result = await seedFromManifest(db, path.join(config.root, 'public/media/archive.json'));
    console.log(result.absent ? 'No public/media/archive.json found' : `Synced ${result.shoots} shoots and ${result.photos} photos; withdrew ${result.removed} removed frames (remaining CMS edits preserved)`);
  } finally { await db.close(); }
}
