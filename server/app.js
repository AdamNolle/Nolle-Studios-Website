import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { login, logout, requireAdmin, requireSameOrigin, session } from './auth.js';
import { now, uniqueSlug } from './db.js';
import { buildVariants, createStaging, createStorage, publishVariants, unpublishVariants, variantKeys } from './media.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024, files: 1 } });
const string = (value, max = 500) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const flag = value => value === true || value === 1 || value === 'true' || value === '1' ? 1 : 0;
const integer = (value, fallback = 0) => Number.isSafeInteger(Number(value)) ? Number(value) : fallback;

function photoDto(row) {
  const assets = JSON.parse(row.assets_json);
  return {
    id: row.id, shootId: row.shoot_id, title: row.title, alt: row.alt, caption: row.caption,
    width: row.width, height: row.height, sortOrder: row.sort_order,
    published: !!row.published, isCover: !!row.is_cover,
    curated: !row.storage_prefix,
    thumb: assets.thumb, mid: assets.mid, full: assets.full,
    formats: assets.formats || {}, createdAt: row.created_at,
  };
}

function shootDto(row) {
  return {
    id: row.id, title: row.title, slug: row.slug, date: row.shot_date,
    description: row.description, location: row.location, sortOrder: row.sort_order,
    published: !!row.published,
  };
}

function collectionDto(row) {
  return {
    id: row.id, title: row.title, slug: row.slug, description: row.description,
    sortOrder: row.sort_order, published: !!row.published,
  };
}

async function getContent(db, publicOnly) {
  const filter = publicOnly ? 'WHERE published = 1' : '';
  const [shootRows, photoRows, collectionRows, linkRows] = await Promise.all([
    db.query(`SELECT * FROM shoots ${filter} ORDER BY sort_order ASC, created_at DESC`),
    db.query(`SELECT * FROM photos ${filter} ORDER BY sort_order ASC, created_at ASC`),
    db.query(`SELECT * FROM collections ${filter} ORDER BY sort_order ASC, created_at DESC`),
    db.query('SELECT * FROM collection_photos ORDER BY sort_order ASC'),
  ]);
  const photos = photoRows.map(photoDto);
  const shoots = shootRows.map(row => {
    const shoot = shootDto(row);
    shoot.photos = photos.filter(photo => photo.shootId === shoot.id);
    shoot.curated = shoot.photos.some(photo => photo.curated);
    const cover = shoot.photos.find(photo => photo.isCover) || shoot.photos[0];
    shoot.coverUrl = !publicOnly && cover && !cover.published
      ? `/api/admin/photos/${cover.id}/preview` : cover?.mid || '';
    return shoot;
  });
  const collections = collectionRows.map(row => {
    const collection = collectionDto(row);
    collection.photoIds = linkRows.filter(link => link.collection_id === collection.id)
      .map(link => link.photo_id).filter(id => photos.some(photo => photo.id === id));
    collection.photos = collection.photoIds.map(id => photos.find(photo => photo.id === id));
    collection.coverUrl = collection.photos[0]?.mid || '';
    return collection;
  });
  return publicOnly ? { shoots, collections } : { shoots, photos, collections };
}

function sendError(res, code, message) { return res.status(code).json({ error: message }); }

export function createApp({ db, settings }) {
  const app = express();
  const storage = createStorage(settings);
  const staging = createStaging(settings);
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (req.path.startsWith('/api/admin') || req.path.startsWith('/admin')) res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use('/media', express.static(settings.localMediaDir, { maxAge: '5m', fallthrough: true }));
  app.use('/media', express.static(path.join(settings.root, 'public/media'), { maxAge: '1h', fallthrough: true }));
  app.use('/admin', (req, res, next) => {
    if (req.path === '/' && req.originalUrl.split('?')[0] === '/admin') return res.redirect(308, '/admin/');
    next();
  });
  app.use('/admin', (_req, res, next) => {
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: https: http:; connect-src 'self'; script-src 'self'; style-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'");
    next();
  }, express.static(path.join(import.meta.dirname, 'admin'), { index: 'index.html', maxAge: 0 }));

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/site', async (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=30');
    res.json(await getContent(db, true));
  });

  app.use('/api/admin', express.json({ limit: '32kb' }));
  app.use('/api/admin', requireSameOrigin);
  app.get('/api/admin/session', async (req, res) => {
    const current = await session(req, db, settings);
    res.json(current ? { authenticated: true, csrfToken: current.csrfToken } : { authenticated: false });
  });
  app.post('/api/admin/login', (req, res) => login(req, res, db, settings));
  app.use('/api/admin', requireAdmin(db, settings));
  app.post('/api/admin/logout', (req, res) => logout(req, res, db, settings));
  app.get('/api/admin/content', async (_req, res) => res.json(await getContent(db, false)));
  app.get('/api/admin/photos/:id/preview', async (req, res) => {
    const rows = await db.query('SELECT storage_prefix, assets_json FROM photos WHERE id = ?', [req.params.id]);
    if (!rows[0]) return sendError(res, 404, 'Photo not found');
    if (rows[0].storage_prefix === `photos/${req.params.id}/`) {
      res.type('jpeg');
      return res.send(await staging.read(`photos/${req.params.id}/640.jpg`));
    }
    res.redirect(JSON.parse(rows[0].assets_json).thumb);
  });

  app.post('/api/admin/shoots', async (req, res) => {
    const title = string(req.body.title, 140);
    if (!title) return sendError(res, 400, 'Shoot title is required');
    const id = randomUUID();
    const slug = await uniqueSlug(db, 'shoots', title, id);
    const timestamp = now();
    await db.query(`INSERT INTO shoots
      (id, title, slug, description, shot_date, location, sort_order, published, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, title, slug, string(req.body.description, 3000), string(req.body.date, 80),
      string(req.body.location, 180), integer(req.body.sortOrder), flag(req.body.published), timestamp, timestamp]);
    res.status(201).json({ id });
  });

  app.patch('/api/admin/shoots/:id', async (req, res) => {
    const rows = await db.query('SELECT * FROM shoots WHERE id = ?', [req.params.id]);
    if (!rows[0]) return sendError(res, 404, 'Shoot not found');
    const original = rows[0];
    const curated = await db.query("SELECT id FROM photos WHERE shoot_id = ? AND storage_prefix = '' LIMIT 1", [original.id]);
    if (curated.length && req.body.published !== undefined && flag(req.body.published) !== original.published) {
      return sendError(res, 409, 'Curated shoots are published by the static manifest. Remove them from public/media and redeploy to withdraw them.');
    }
    const title = req.body.title === undefined ? original.title : string(req.body.title, 140);
    if (!title) return sendError(res, 400, 'Shoot title is required');
    const slug = title === original.title ? original.slug : await uniqueSlug(db, 'shoots', title, original.id);
    await db.query(`UPDATE shoots SET title = ?, slug = ?, description = ?, shot_date = ?,
      location = ?, sort_order = ?, published = ?, updated_at = ? WHERE id = ?`,
    [title, slug,
      req.body.description === undefined ? original.description : string(req.body.description, 3000),
      req.body.date === undefined ? original.shot_date : string(req.body.date, 80),
      req.body.location === undefined ? original.location : string(req.body.location, 180),
      req.body.sortOrder === undefined ? original.sort_order : integer(req.body.sortOrder),
      req.body.published === undefined ? original.published : flag(req.body.published), now(), original.id]);
    res.json({ id: original.id });
  });

  app.delete('/api/admin/shoots/:id', async (req, res) => {
    const photos = await db.query('SELECT id FROM photos WHERE shoot_id = ?', [req.params.id]);
    if (photos.length) return sendError(res, 409, 'Move or delete the shoot’s photos first');
    await db.query('DELETE FROM shoots WHERE id = ?', [req.params.id]);
    res.json({ deleted: true });
  });

  app.post('/api/admin/collections', async (req, res) => {
    const title = string(req.body.title, 140);
    if (!title) return sendError(res, 400, 'Collection title is required');
    const id = randomUUID();
    const timestamp = now();
    await db.query(`INSERT INTO collections
      (id, title, slug, description, sort_order, published, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, title, await uniqueSlug(db, 'collections', title, id),
      string(req.body.description, 3000), integer(req.body.sortOrder), flag(req.body.published), timestamp, timestamp]);
    res.status(201).json({ id });
  });

  app.patch('/api/admin/collections/:id', async (req, res) => {
    const rows = await db.query('SELECT * FROM collections WHERE id = ?', [req.params.id]);
    if (!rows[0]) return sendError(res, 404, 'Collection not found');
    const original = rows[0];
    const title = req.body.title === undefined ? original.title : string(req.body.title, 140);
    if (!title) return sendError(res, 400, 'Collection title is required');
    const slug = title === original.title ? original.slug : await uniqueSlug(db, 'collections', title, original.id);
    await db.query(`UPDATE collections SET title = ?, slug = ?, description = ?,
      sort_order = ?, published = ?, updated_at = ? WHERE id = ?`,
    [title, slug, req.body.description === undefined ? original.description : string(req.body.description, 3000),
      req.body.sortOrder === undefined ? original.sort_order : integer(req.body.sortOrder),
      req.body.published === undefined ? original.published : flag(req.body.published), now(), original.id]);
    res.json({ id: original.id });
  });

  app.delete('/api/admin/collections/:id', async (req, res) => {
    await db.query('DELETE FROM collections WHERE id = ?', [req.params.id]);
    res.json({ deleted: true });
  });

  app.put('/api/admin/collections/:id/photos/:photoId', async (req, res) => {
    const [collections, photos] = await Promise.all([
      db.query('SELECT id FROM collections WHERE id = ?', [req.params.id]),
      db.query('SELECT id FROM photos WHERE id = ?', [req.params.photoId]),
    ]);
    if (!collections.length || !photos.length) return sendError(res, 404, 'Collection or photo not found');
    await db.query(`INSERT INTO collection_photos (collection_id, photo_id, sort_order)
      VALUES (?, ?, ?) ON CONFLICT (collection_id, photo_id) DO UPDATE SET sort_order = excluded.sort_order`,
    [req.params.id, req.params.photoId, integer(req.body?.sortOrder)]);
    res.json({ added: true });
  });

  app.delete('/api/admin/collections/:id/photos/:photoId', async (req, res) => {
    await db.query('DELETE FROM collection_photos WHERE collection_id = ? AND photo_id = ?', [req.params.id, req.params.photoId]);
    res.json({ removed: true });
  });

  app.post('/api/admin/photos/upload', upload.single('image'), async (req, res) => {
    if (!req.file) return sendError(res, 400, 'Select an edited image');
    const shootId = string(req.body.shootId, 100);
    if (!(await db.query('SELECT id FROM shoots WHERE id = ?', [shootId])).length) {
      return sendError(res, 400, 'Choose a shoot before uploading');
    }
    const id = randomUUID();
    const built = await buildVariants(req.file.buffer, id, staging, storage);
    try {
      const timestamp = now();
      await db.query(`INSERT INTO photos
        (id, shoot_id, title, alt, caption, width, height, sort_order, published,
         is_cover, assets_json, storage_prefix, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, shootId, string(req.body.title, 180), string(req.body.alt, 400),
        string(req.body.caption, 1500), built.width, built.height, integer(req.body.sortOrder),
        0, 0, JSON.stringify(built.assets), `photos/${id}/`, timestamp, timestamp]);
    } catch (error) {
      await Promise.allSettled(built.keys.map(key => staging.delete(key)));
      throw error;
    }
    res.status(201).json({ id, width: built.width, height: built.height, thumb: built.assets.thumb });
  });

  app.patch('/api/admin/photos/:id', async (req, res) => {
    const rows = await db.query('SELECT * FROM photos WHERE id = ?', [req.params.id]);
    if (!rows[0]) return sendError(res, 404, 'Photo not found');
    const original = rows[0];
    const shootId = req.body.shootId === undefined ? original.shoot_id : string(req.body.shootId, 100) || null;
    const curated = !original.storage_prefix;
    if (curated && req.body.published !== undefined && flag(req.body.published) !== original.published) {
      return sendError(res, 409, 'Curated static photos cannot be unpublished in the CMS. Remove them from public/media and redeploy.');
    }
    if (curated && shootId !== original.shoot_id) {
      return sendError(res, 409, 'Curated photos stay in their manifest shoot. Update the manifest and redeploy to move them.');
    }
    if (shootId && !(await db.query('SELECT id FROM shoots WHERE id = ?', [shootId])).length) {
      return sendError(res, 400, 'Shoot not found');
    }
    const cover = req.body.isCover === undefined ? original.is_cover : flag(req.body.isCover);
    const published = req.body.published === undefined ? original.published : flag(req.body.published);
    const alt = req.body.alt === undefined ? original.alt : string(req.body.alt, 400);
    if (published && !alt) return sendError(res, 400, 'Alt text is required before publishing');
    if (original.storage_prefix === `photos/${original.id}/` && published !== original.published) {
      if (published) await publishVariants(original.id, staging, storage);
      else await unpublishVariants(original.id, storage);
    }
    if (cover && shootId) await db.query('UPDATE photos SET is_cover = 0 WHERE shoot_id = ?', [shootId]);
    await db.query(`UPDATE photos SET shoot_id = ?, title = ?, alt = ?, caption = ?,
      sort_order = ?, published = ?, is_cover = ?, updated_at = ? WHERE id = ?`,
    [shootId, req.body.title === undefined ? original.title : string(req.body.title, 180),
      alt,
      req.body.caption === undefined ? original.caption : string(req.body.caption, 1500),
      req.body.sortOrder === undefined ? original.sort_order : integer(req.body.sortOrder),
      published,
      cover, now(), original.id]);
    res.json({ id: original.id });
  });

  app.delete('/api/admin/photos/:id', async (req, res) => {
    const rows = await db.query('SELECT storage_prefix FROM photos WHERE id = ?', [req.params.id]);
    if (!rows[0]) return sendError(res, 404, 'Photo not found');
    if (!rows[0].storage_prefix) return sendError(res, 409, 'Curated static photos must be removed from public/media and redeployed.');
    await db.query('DELETE FROM photos WHERE id = ?', [req.params.id]);
    if (rows[0].storage_prefix === `photos/${req.params.id}/`) {
      const keys = variantKeys(req.params.id);
      const failures = (await Promise.allSettled([...keys.map(key => storage.delete(key)), ...keys.map(key => staging.delete(key))])).filter(result => result.status === 'rejected');
      if (failures.length) console.error(`Failed to remove ${failures.length} published objects for photo ${req.params.id}`);
    }
    res.json({ deleted: true });
  });

  app.use((error, _req, res, _next) => {
    if (error instanceof multer.MulterError) return sendError(res, 400, error.code === 'LIMIT_FILE_SIZE' ? 'Image exceeds 50 MB' : error.message);
    if (/^(Upload|Image|Input|Unsupported)/.test(error.message || '')) return sendError(res, 400, error.message);
    console.error(error);
    sendError(res, 500, 'Server error');
  });
  return app;
}
