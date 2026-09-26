import fs from 'node:fs/promises';
import path from 'node:path';
import { now, openDatabase, uniqueSlug } from './db.ts';
import type { Db } from './db.ts';

// Replace only the original stock descriptions. Later edits in the Content Room
// are independent of the curated manifest and must remain untouched.
const formerShootDescriptions = new Map([
  ['first-frames', 'A first evening with the camera: home, a familiar face, and one last swing before dark.'],
  ['september-19', 'A day of baseball, from small moments before play to the team gathering on the field.'],
  ['september-20', 'Sunday baseball: sharp color, quick reactions, and the rhythm of a team in motion.'],
]);

interface ManifestSizes { thumb?: unknown; mid?: unknown; full?: unknown }
interface ManifestPhoto extends ManifestSizes {
  id?: unknown; title?: unknown; alt?: unknown; caption?: unknown; width?: unknown; height?: unknown;
  published?: unknown; formats?: Record<string, ManifestSizes>;
}
interface ManifestShoot {
  id?: unknown; title?: unknown; description?: unknown; date?: unknown; location?: unknown;
  published?: unknown; coverUrl?: unknown; photos?: ManifestPhoto[];
}

function publicPath(value: unknown) {
  if (typeof value !== 'string' || !/^\/media\/[A-Za-z0-9/_-]+\.(?:avif|webp|jpe?g)$/i.test(value) || value.includes('..')) {
    throw new Error('Seed manifest contains a non-public or invalid media path');
  }
  return value;
}

function checkedId(value: unknown) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{2,100}$/.test(value)) throw new Error('Seed manifest contains an invalid ID');
  return value;
}

export async function seedFromManifest(db: Db, manifestPath: string) {
  let manifest: { shoots?: ManifestShoot[] };
  try { manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { shoots: 0, photos: 0, removed: 0, absent: true };
    throw error;
  }
  if (!Array.isArray(manifest.shoots)) throw new Error('Seed manifest needs a shoots array');
  let shoots = 0, photos = 0, removed = 0;
  const selectedShootIds = new Set<string>();
  const selectedPhotoIds = new Set<string>();
  const timestamp = now();
  for (const [shootIndex, shoot] of manifest.shoots.entries()) {
    // Only media deliberately marked as published in the curated manifest enters the public catalog.
    if (shoot.published !== true) continue;
    const shootId = checkedId(shoot.id);
    selectedShootIds.add(shootId);
    const title = String(shoot.title || '').trim().slice(0, 140);
    if (!title) throw new Error(`Seed shoot ${shootId} needs a title`);
    const slug = await uniqueSlug(db, 'shoots', title, shootId);
    const description = String(shoot.description || '').slice(0, 3000);
    const shotDate = String(shoot.date || '').slice(0, 80);
    const location = String(shoot.location || '').slice(0, 180);
    // New manifest shoots start published; existing shoots keep CMS visibility.
    await db.query(`INSERT INTO shoots
      (id, title, slug, description, shot_date, location, sort_order,
       live_title, live_slug, live_description, live_shot_date, live_location, live_sort_order,
       published, approved, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
    [shootId, title, slug, description, shotDate, location, shootIndex,
      title, slug, description, shotDate, location, shootIndex, 1, 1, timestamp, timestamp]);
    const formerDescription = formerShootDescriptions.get(shootId);
    if (formerDescription) {
      await db.query(`UPDATE shoots SET
        description = CASE WHEN description = ? THEN ? ELSE description END,
        live_description = CASE WHEN live_description = ? THEN ? ELSE live_description END
        WHERE id = ?`, [formerDescription, description, formerDescription, description, shootId]);
    }
    await db.query('INSERT INTO manifest_shoots (shoot_id) VALUES (?) ON CONFLICT (shoot_id) DO NOTHING', [shootId]);
    shoots++;
    for (const [photoIndex, photo] of (shoot.photos || []).entries()) {
      if (photo.published === false) continue;
      const photoId = checkedId(photo.id);
      if (selectedPhotoIds.has(photoId)) throw new Error(`Seed manifest repeats photo ID ${photoId}`);
      selectedPhotoIds.add(photoId);
      const assets = {
        thumb: publicPath(photo.thumb), mid: publicPath(photo.mid), full: publicPath(photo.full),
        formats: {} as Record<string, { thumb: string; mid: string; full: string }>,
      };
      for (const [format, variant] of Object.entries(photo.formats || {})) {
        if (!['avif', 'webp', 'jpeg'].includes(format)) continue;
        assets.formats[format] = { thumb: publicPath(variant.thumb), mid: publicPath(variant.mid), full: publicPath(variant.full) };
      }
      const width = Number(photo.width);
      const height = Number(photo.height);
      if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
        throw new Error(`Seed photo ${photoId} needs width and height`);
      }
      const isCover = shoot.coverUrl === photo.mid || shoot.coverUrl === photo.thumb || shoot.coverUrl === photo.full ? 1 : 0;
      const existing = (await db.query<{ shoot_id: string | null; storage_prefix: string }>('SELECT shoot_id, storage_prefix FROM photos WHERE id = ?', [photoId]))[0];
      if (existing?.storage_prefix) throw new Error(`Seed photo ${photoId} conflicts with a CMS upload`);
      const alt = String(photo.alt || '').slice(0, 400);
      await db.query(`INSERT INTO photos
        (id, shoot_id, live_shoot_id, title, alt, live_alt, caption, width, height, sort_order, live_sort_order, published, approved,
         is_cover, live_is_cover, assets_json, storage_prefix, file_name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
      [photoId, shootId, shootId, String(photo.title || '').slice(0, 180), alt, alt,
        String(photo.caption || '').slice(0, 1500), width, height, photoIndex, photoIndex, 1, 1,
        isCover, isCover, JSON.stringify(assets), '', path.basename(assets.full), timestamp, timestamp]);
      // Keep CMS-written descriptions, order, cover, and publication state.
      // The manifest remains authoritative for the photo's shoot and files.
      await db.query(`UPDATE photos SET shoot_id = ?, live_shoot_id = ?, width = ?, height = ?, assets_json = ?,
        updated_at = ? WHERE id = ? AND storage_prefix = ''`,
      [shootId, shootId, width, height, JSON.stringify(assets), timestamp, photoId]);
      if (existing && existing.shoot_id !== shootId) {
        await db.query('UPDATE photos SET sort_order = ?, live_sort_order = ?, is_cover = ?, live_is_cover = ? WHERE id = ?',
          [photoIndex, photoIndex, isCover, isCover, photoId]);
      }
      photos++;
    }
  }
  // A newer curated manifest can withdraw frames. Remove only entries imported from
  // public/media; CMS uploads have a non-empty storage_prefix and are untouched.
  const imported = await db.query<{ id: string; shoot_id: string }>("SELECT id, shoot_id FROM photos WHERE storage_prefix = ''");
  const withdrawnShoots = new Set<string>();
  for (const row of imported) {
    if (selectedPhotoIds.has(row.id)) continue;
    await db.query('DELETE FROM photos WHERE id = ?', [row.id]);
    withdrawnShoots.add(row.shoot_id);
    removed++;
  }
  for (const shootId of withdrawnShoots) {
    if (!selectedShootIds.has(shootId)) await db.query('UPDATE shoots SET published = 0, approved = 0, updated_at = ? WHERE id = ?', [now(), shootId]);
  }
  // Empty curated shoots have no photo row to identify their origin. Track
  // manifest ownership so removing one does not leave it published, while
  // CMS-created shoots retain their own visibility setting.
  for (const { shoot_id: shootId } of await db.query<{ shoot_id: string }>('SELECT shoot_id FROM manifest_shoots')) {
    if (selectedShootIds.has(shootId)) continue;
    await db.query('UPDATE shoots SET published = 0, approved = 0, updated_at = ? WHERE id = ?', [timestamp, shootId]);
    await db.query('DELETE FROM manifest_shoots WHERE shoot_id = ?', [shootId]);
  }
  return { shoots, photos, removed, absent: false };
}

if (import.meta.main) {
  const { config } = await import('./config.ts');
  const db = await openDatabase(config);
  try {
    const result = await seedFromManifest(db, path.join(config.root, 'public/media/archive.json'));
    console.log(result.absent ? 'No public/media/archive.json found' : `Synced ${result.shoots} shoots and ${result.photos} photos; withdrew ${result.removed} removed frames (remaining CMS edits preserved)`);
  } finally { await db.close(); }
}
