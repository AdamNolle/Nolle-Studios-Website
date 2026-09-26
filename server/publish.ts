import { randomUUID } from 'node:crypto';
import { now } from './db.ts';
import type { Db, PhotoRow } from './db.ts';
import { publishVariants, unpublishVariants, variantKeys } from './media.ts';
import type { Staging, Storage } from './media.ts';
import { HttpError } from './http.ts';

// Publish releases every queued change together: approved uploads are copied
// to public storage, withdrawn ones removed, and each live_* column catches up
// with its working copy. A failed media step leaves the rest queued for a retry.

export async function publish(db: Db, staging: Staging, storage: Storage) {
  const [photos, shoots, collections] = await Promise.all([
    db.query<PhotoRow>('SELECT * FROM photos WHERE approved <> published ORDER BY created_at ASC, id ASC'),
    db.query<{ id: string }>('SELECT id FROM shoots WHERE approved <> published'),
    db.query<{ id: string }>('SELECT id FROM collections WHERE approved <> published'),
  ]);
  if (photos.some(photo => photo.approved && !photo.alt.trim())) {
    throw new HttpError(400, 'Add alt text before publishing approved photographs');
  }
  // Publish new variants before making their rows public; withdraw rows before
  // removing their public files.
  const prepared: PhotoRow[] = [];
  const unprepare = () => Promise.allSettled(prepared.filter(photo => photo.storage_prefix)
    .flatMap(photo => variantKeys(photo.id, photo.kind)).map(key => storage.delete(key)));
  try {
    for (const photo of photos.filter(photo => photo.approved)) {
      if (photo.storage_prefix) await publishVariants(photo.id, staging, storage, photo.kind);
      prepared.push(photo);
    }
  } catch (error) {
    await unprepare();
    throw error;
  }
  const withdrawn: PhotoRow[] = [];
  try {
    for (const photo of photos.filter(photo => !photo.approved)) {
      if (photo.storage_prefix) await unpublishVariants(photo.id, staging, storage, photo.kind);
      withdrawn.push(photo);
    }
  } catch (error) {
    await Promise.allSettled(withdrawn.filter(photo => photo.storage_prefix)
      .map(photo => publishVariants(photo.id, staging, storage, photo.kind)));
    await unprepare();
    throw error;
  }
  const stamp = now();
  for (const photo of withdrawn) await db.query('UPDATE photos SET published = 0, updated_at = ? WHERE id = ?', [stamp, photo.id]);
  for (const photo of prepared) await db.query('UPDATE photos SET published = 1, updated_at = ? WHERE id = ?', [stamp, photo.id]);
  for (const shoot of shoots) await db.query('UPDATE shoots SET published = approved, updated_at = ? WHERE id = ?', [stamp, shoot.id]);
  for (const collection of collections) await db.query('UPDATE collections SET published = approved, updated_at = ? WHERE id = ?', [stamp, collection.id]);

  // A private frame can be chosen as the next cover in the editor. Keep the
  // current public cover until that replacement is approved and live.
  const coverReady = `NOT EXISTS (SELECT 1 FROM photos pending_cover
    WHERE pending_cover.shoot_id = photos.shoot_id AND pending_cover.is_cover = 1
    AND pending_cover.approved = 0)`;
  const changedPhotos = `published = 1 AND (live_alt IS NULL OR live_sort_order IS NULL OR
    live_is_cover IS NULL OR alt <> live_alt OR
    COALESCE(shoot_id, '') <> COALESCE(live_shoot_id, '') OR
    sort_order <> live_sort_order OR (is_cover <> live_is_cover AND ${coverReady}))`;
  const photoEdits = await db.query<{ id: string }>(`SELECT id FROM photos WHERE ${changedPhotos}`);
  await db.query(`UPDATE photos SET live_alt = alt, live_shoot_id = shoot_id, live_sort_order = sort_order,
    live_is_cover = CASE WHEN ${coverReady} THEN is_cover ELSE live_is_cover END WHERE ${changedPhotos}`);
  const changedShoots = `published = 1 AND (live_title IS NULL OR live_slug IS NULL OR
    live_description IS NULL OR live_shot_date IS NULL OR live_location IS NULL OR live_sort_order IS NULL OR
    title <> live_title OR slug <> live_slug OR description <> live_description OR
    shot_date <> live_shot_date OR location <> live_location OR sort_order <> live_sort_order)`;
  const shootEdits = await db.query<{ id: string }>(`SELECT id FROM shoots WHERE ${changedShoots}`);
  await db.query(`UPDATE shoots SET live_title = title, live_slug = slug,
    live_description = description, live_shot_date = shot_date,
    live_location = location, live_sort_order = sort_order WHERE ${changedShoots}`);
  const changedCollections = `published = 1 AND (live_title IS NULL OR live_slug IS NULL OR
    live_description IS NULL OR live_sort_order IS NULL OR title <> live_title OR
    slug <> live_slug OR description <> live_description OR sort_order <> live_sort_order)`;
  const collectionEdits = await db.query<{ id: string }>(`SELECT id FROM collections WHERE ${changedCollections}`);
  await db.query(`UPDATE collections SET live_title = title, live_slug = slug,
    live_description = description, live_sort_order = sort_order WHERE ${changedCollections}`);
  const liveCollections = await db.query<{ id: string; live_photo_ids_json: string | null }>('SELECT id, live_photo_ids_json FROM collections WHERE published = 1');
  const links = await db.query<{ collection_id: string; photo_id: string }>('SELECT collection_id, photo_id FROM collection_photos ORDER BY sort_order ASC');
  const membershipEdits: string[] = [];
  for (const collection of liveCollections) {
    const desired = JSON.stringify(links.filter(link => link.collection_id === collection.id).map(link => link.photo_id));
    if (desired === collection.live_photo_ids_json) continue;
    await db.query('UPDATE collections SET live_photo_ids_json = ? WHERE id = ?', [desired, collection.id]);
    membershipEdits.push(collection.id);
  }
  const changed = new Set([
    ...photos.map(row => `photo:${row.id}`), ...shoots.map(row => `shoot:${row.id}`),
    ...collections.map(row => `collection:${row.id}`),
    ...photoEdits.map(row => `photo:${row.id}`), ...shootEdits.map(row => `shoot:${row.id}`),
    ...collectionEdits.map(row => `collection:${row.id}`), ...membershipEdits.map(id => `collection:${id}`),
  ]);
  // A short, human history line for the Publish screen.
  const added = prepared.length, removed = withdrawn.length, edits = changed.size - added - removed;
  const note = [added ? `${added} photo${added === 1 ? '' : 's'} live` : '', removed ? `${removed} removed` : '',
    edits > 0 ? `${edits} edit${edits === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ') || 'No changes';
  if (changed.size) {
    await db.query('INSERT INTO publish_log (id, created_at, changes, added, removed, note) VALUES (?, ?, ?, ?, ?, ?)',
      [randomUUID(), now(), changed.size, added, removed, note]);
  }
  return { published: changed.size, note };
}
