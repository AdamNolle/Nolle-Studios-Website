import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { currentSession, login, logout, requireAdmin, requireSameOrigin } from './auth.ts';
import type { AppEnv } from './auth.ts';
import { now, uniqueSlug } from './db.ts';
import type { CollectionRow, Db, PhotoRow, ShootRow } from './db.ts';
import { WIDTHS, buildVariants, createStaging, createStorage, publishVariants, unpublishVariants, variantKeys } from './media.ts';
import { buildVideoVariants } from './video.ts';
import { getContent, getPreviewContent } from './catalog.ts';
import { publish } from './publish.ts';
import { AltTextUnavailable, createAltWriter } from './alt-text.ts';
import { sendFile, within } from './files.ts';
import { HttpError, flag, integer, readJson, receiveFile, text } from './http.ts';
import type { Settings } from './settings.ts';
import type { AdminConfig } from '../shared/api.ts';

const IMAGE_LIMIT = 50 * 1024 * 1024;
const VIDEO_LIMIT = 2 * 1024 * 1024 * 1024;
const ADMIN_CSP = "default-src 'self'; img-src 'self' data: blob: https: http:; media-src 'self' blob: https: http:; " +
  "font-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'";
// Brand files the standalone CMS serves so the Content Room renders without the site.
const BRAND_FILES = ['nolle-studios-mark.svg', 'favicon.ico', 'favicon.svg'];

const validShotDate = (value: string) => !value || /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

function exactOrder(ids: unknown, available: string[]): ids is string[] {
  if (!Array.isArray(ids) || ids.length !== available.length) return false;
  const known = new Set(available);
  return new Set(ids).size === ids.length && ids.every(id => typeof id === 'string' && known.has(id));
}

async function saveOrder(db: Db, table: string, key: string, owner: string, ownerId: string, ids: string[]) {
  if (!ids.length) return;
  const cases = ids.map(() => 'WHEN ? THEN CAST(? AS INTEGER)').join(' ');
  await db.query(`UPDATE ${table} SET sort_order = CASE ${key} ${cases} END WHERE ${owner} = ?`,
    [...ids.flatMap((id, index) => [id, index]), ownerId]);
}

function publicSiteUrl(c: Context, settings: Settings) {
  if (settings.siteUrl) return new URL('/', settings.siteUrl).href;
  const url = new URL(c.req.url);
  if (!settings.production && ['localhost', '127.0.0.1'].includes(url.hostname)) {
    try {
      if (new URL(`http://${c.req.header('host')}`).port === String(settings.port)) return `http://${url.hostname}:5173/`;
    } catch { /* Fall back to the current origin. */ }
  }
  return '/';
}

export type CmsApp = Hono<AppEnv> & { idle(): Promise<void> };

export function createApp({ db, settings }: { db: Db; settings: Settings }): CmsApp {
  const app = new Hono<AppEnv>() as CmsApp;
  const storage = createStorage(settings);
  const staging = createStaging(settings);
  const alt = createAltWriter(settings);
  const incoming = path.join(settings.stagingDir, 'incoming');
  const background = new Set<Promise<unknown>>();
  app.idle = async () => { while (background.size) await Promise.allSettled([...background]); };

  // Draft alt text for a new upload without holding up the response.
  function draftLater(id: string) {
    if (!alt.configured || !settings.altTextAuto) return;
    const task = suggestFor(id, false).catch(error => {
      if (!(error instanceof AltTextUnavailable)) console.error(error);
    }).finally(() => background.delete(task));
    background.add(task);
  }

  async function suggestFor(id: string, fresh: boolean) {
    const row = (await db.query<PhotoRow>('SELECT * FROM photos WHERE id = ?', [id]))[0];
    if (!row) throw new HttpError(404, 'Photo not found');
    if (!fresh && row.alt_suggestion) return row.alt_suggestion;
    // The model reads fine detail (a bat, a glove, a base) far better from a
    // mid-size JPEG than from the 640 px thumbnail.
    let image: string | null = null;
    if (row.storage_prefix === `photos/${row.id}/`) {
      for (const width of [1600, 640]) {
        const file = staging.path(`photos/${row.id}/${width}.jpg`);
        if (await fs.stat(file).then(stat => stat.isFile(), () => false)) { image = file; break; }
      }
    } else {
      // Curated media lives under public/.
      const assets = JSON.parse(row.assets_json) as { mid?: string; thumb?: string; formats?: { jpeg?: { mid?: string; thumb?: string } } };
      const url = assets.formats?.jpeg?.mid || assets.formats?.jpeg?.thumb || assets.mid || assets.thumb || '';
      image = url.startsWith('/media/') ? within(path.join(settings.root, 'public'), url) : null;
    }
    if (!image) throw new HttpError(404, 'The photograph file is unavailable');
    const suggestion = await alt.suggest(image, { video: row.kind === 'video' });
    await db.query('UPDATE photos SET alt_suggestion = ? WHERE id = ?', [suggestion, row.id]);
    return suggestion;
  }

  app.use('*', async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (c.req.path.startsWith('/api/admin') || (c.req.path.startsWith('/admin') && !c.req.path.startsWith('/admin/assets/'))) {
      c.header('Cache-Control', 'no-store');
    }
  });

  app.onError((error, c) => {
    if (error instanceof HttpError) return c.json({ error: error.message }, error.status);
    if (error instanceof AltTextUnavailable) return c.json({ error: error.message }, 503);
    if (/^(Upload|Image|Input|Unsupported|Video)/.test(error.message || '')) return c.json({ error: error.message }, 400);
    console.error(error);
    return c.json({ error: 'Server error' }, 500);
  });

  // ---- Public media and brand files ------------------------------------
  app.get('/media/*', async c => {
    const relative = c.req.path.slice('/media/'.length);
    const uploaded = within(settings.localMediaDir, relative);
    const curated = within(path.join(settings.root, 'public/media'), relative);
    return (uploaded ? await sendFile(c, uploaded, { 'Cache-Control': 'public, max-age=300, must-revalidate' }) : null) ??
      (curated ? await sendFile(c, curated, { 'Cache-Control': 'public, max-age=3600' }) : null) ??
      c.json({ error: 'Not found' }, 404);
  });
  for (const asset of BRAND_FILES) {
    app.get(`/${asset}`, async c => await sendFile(c, path.join(settings.root, 'public', asset), { 'Cache-Control': 'public, max-age=3600' }) ?? c.notFound());
  }

  // ---- Content Room (built by `vite build --mode admin`) ---------------
  app.get('/admin', c => c.redirect('/admin/', 308));
  app.get('/admin/', async c => {
    c.header('Content-Security-Policy', ADMIN_CSP);
    return await sendFile(c, path.join(settings.adminDir, 'index.html')) ??
      c.text('The Content Room has not been built. Run npm run build:admin.', 503);
  });
  app.get('/admin/assets/*', async c => {
    const file = within(path.join(settings.adminDir, 'assets'), c.req.path.slice('/admin/assets/'.length));
    return (file ? await sendFile(c, file, { 'Cache-Control': 'public, max-age=31536000, immutable' }) : null) ?? c.notFound();
  });

  // ---- Public API ------------------------------------------------------
  app.get('/api/health', c => c.json({ ok: true }));
  app.get('/api/site', async c => {
    c.header('Cache-Control', 'no-store');
    return c.json(await getContent(db, true));
  });

  // ---- Admin API -------------------------------------------------------
  app.use('/api/admin/*', async (c, next) => {
    // Uploads stream to disk with their own limits; everything else is small JSON.
    if (c.req.path.endsWith('/upload')) return next();
    return bodyLimit({ maxSize: 32 * 1024, onError: c => c.json({ error: 'Request body is too large' }, 413) })(c, next);
  });
  app.use('/api/admin/*', requireSameOrigin);
  app.get('/api/admin/session', async c => {
    const session = await currentSession(c, db, settings);
    return c.json(session ? { authenticated: true, csrfToken: session.csrfToken } : { authenticated: false });
  });
  app.post('/api/admin/login', async c => login(c, db, settings, (await readJson(c)).password));
  app.use('/api/admin/*', requireAdmin(db, settings));
  app.post('/api/admin/logout', c => logout(c, db, settings));
  app.get('/api/admin/config', c => c.json({ siteUrl: publicSiteUrl(c, settings), altText: { configured: alt.configured, auto: alt.configured && settings.altTextAuto } } satisfies AdminConfig));
  app.get('/api/admin/content', async c => c.json(await getContent(db, false)));
  app.get('/api/admin/preview', async c => c.json(await getPreviewContent(db)));
  app.post('/api/admin/publish', async c => c.json(await publish(db, staging, storage)));

  app.get('/api/admin/alt-text', async c => c.json(await alt.status()));
  app.post('/api/admin/photos/:id/alt-suggestion', async c => {
    const body = await readJson(c);
    return c.json({ suggestion: await suggestFor(c.req.param('id'), body.fresh === true) });
  });

  app.get('/api/admin/photos/:id/preview', async c => {
    const id = c.req.param('id');
    const row = (await db.query<Pick<PhotoRow, 'storage_prefix' | 'assets_json'>>('SELECT storage_prefix, assets_json FROM photos WHERE id = ?', [id]))[0];
    if (!row) throw new HttpError(404, 'Photo not found');
    const width = c.req.query('width') === undefined ? 640 : Number(c.req.query('width'));
    if (!(WIDTHS as readonly number[]).includes(width)) throw new HttpError(400, 'Invalid preview size');
    if (row.storage_prefix === `photos/${id}/`) {
      return await sendFile(c, staging.path(`photos/${id}/${width}.jpg`), { 'Content-Type': 'image/jpeg' }) ?? c.json({ error: 'Preview unavailable' }, 404);
    }
    const assets = JSON.parse(row.assets_json) as { thumb: string; mid: string; full: string };
    return c.redirect(width >= 2400 ? assets.full : width >= 960 ? assets.mid : assets.thumb);
  });
  app.get('/api/admin/videos/:id/preview', async c => {
    const id = c.req.param('id');
    const row = (await db.query<Pick<PhotoRow, 'kind' | 'storage_prefix'>>('SELECT kind, storage_prefix FROM photos WHERE id = ?', [id]))[0];
    if (row?.kind !== 'video' || row.storage_prefix !== `photos/${id}/`) throw new HttpError(404, 'Video not found');
    return await sendFile(c, staging.path(`videos/${id}/1080.mp4`)) ?? c.json({ error: 'Video preview unavailable' }, 404);
  });

  // ---- Shoots ----------------------------------------------------------
  app.post('/api/admin/shoots', async c => {
    const body = await readJson(c);
    const title = text(body.title, 140);
    if (!title) throw new HttpError(400, 'Shoot title is required');
    const id = randomUUID();
    const slug = await uniqueSlug(db, 'shoots', title, id);
    const description = text(body.description, 3000);
    const date = text(body.date, 80);
    if (!validShotDate(date)) throw new HttpError(400, 'Shot date must be a real date in YYYY-MM-DD format');
    const location = text(body.location, 180);
    const sortOrder = integer(body.sortOrder);
    const published = flag(body.published);
    const stamp = now();
    await db.query(`INSERT INTO shoots
      (id, title, slug, description, shot_date, location, sort_order,
       live_title, live_slug, live_description, live_shot_date, live_location, live_sort_order,
       published, approved, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, title, slug, description, date, location, sortOrder,
      title, slug, description, date, location, sortOrder, published, published, stamp, stamp]);
    return c.json({ id }, 201);
  });

  app.patch('/api/admin/shoots/:id', async c => {
    const body = await readJson(c);
    const original = (await db.query<ShootRow>('SELECT * FROM shoots WHERE id = ?', [c.req.param('id')]))[0];
    if (!original) throw new HttpError(404, 'Shoot not found');
    const curated = await db.query('SELECT shoot_id FROM manifest_shoots WHERE shoot_id = ?', [original.id]);
    if (curated.length && body.published !== undefined && flag(body.published) !== original.published) {
      throw new HttpError(409, 'Change the shoot approval, then Publish to update the site');
    }
    const title = body.title === undefined ? original.title : text(body.title, 140);
    if (!title) throw new HttpError(400, 'Shoot title is required');
    const slug = title === original.title ? original.slug : await uniqueSlug(db, 'shoots', title, original.id);
    const description = body.description === undefined ? original.description : text(body.description, 3000);
    const date = body.date === undefined ? original.shot_date : text(body.date, 80);
    if (!validShotDate(date)) throw new HttpError(400, 'Shot date must be a real date in YYYY-MM-DD format');
    const location = body.location === undefined ? original.location : text(body.location, 180);
    const sortOrder = body.sortOrder === undefined ? original.sort_order : integer(body.sortOrder);
    const published = body.published === undefined ? original.published : flag(body.published);
    const approved = body.approved === undefined ? (body.published === undefined ? original.approved : published) : flag(body.approved);
    const liveNow = body.published !== undefined && published;
    await db.query(`UPDATE shoots SET title = ?, slug = ?, description = ?, shot_date = ?,
      location = ?, sort_order = ?, published = ?, approved = ?, live_title = ?, live_slug = ?,
      live_description = ?, live_shot_date = ?, live_location = ?, live_sort_order = ?, updated_at = ? WHERE id = ?`,
    [title, slug, description, date, location, sortOrder, published, approved,
      liveNow ? title : original.live_title, liveNow ? slug : original.live_slug,
      liveNow ? description : original.live_description, liveNow ? date : original.live_shot_date,
      liveNow ? location : original.live_location, liveNow ? sortOrder : original.live_sort_order,
      now(), original.id]);
    return c.json({ id: original.id });
  });

  app.put('/api/admin/shoots/:id/order', async c => {
    const body = await readJson(c);
    const id = c.req.param('id');
    if (!(await db.query('SELECT id FROM shoots WHERE id = ?', [id])).length) throw new HttpError(404, 'Shoot not found');
    const rows = await db.query<{ id: string }>('SELECT id FROM photos WHERE shoot_id = ?', [id]);
    if (!exactOrder(body.photoIds, rows.map(row => row.id))) throw new HttpError(400, 'Include every shoot frame exactly once');
    await saveOrder(db, 'photos', 'id', 'shoot_id', id, body.photoIds);
    return c.json({ ordered: body.photoIds.length });
  });

  app.delete('/api/admin/shoots/:id', async c => {
    const id = c.req.param('id');
    if ((await db.query('SELECT shoot_id FROM manifest_shoots WHERE shoot_id = ?', [id])).length) {
      throw new HttpError(409, 'Curated shoots are managed by the static manifest');
    }
    const shoot = (await db.query<{ published: number }>('SELECT published FROM shoots WHERE id = ?', [id]))[0];
    if (shoot?.published) throw new HttpError(409, 'Hide and publish the shoot before deleting it');
    if ((await db.query('SELECT id FROM photos WHERE shoot_id = ?', [id])).length) throw new HttpError(409, 'Move or delete the shoot’s photos first');
    await db.query('DELETE FROM shoots WHERE id = ?', [id]);
    return c.json({ deleted: true });
  });

  // ---- Collections -----------------------------------------------------
  app.post('/api/admin/collections', async c => {
    const body = await readJson(c);
    const title = text(body.title, 140);
    if (!title) throw new HttpError(400, 'Collection title is required');
    const id = randomUUID();
    const stamp = now();
    const slug = await uniqueSlug(db, 'collections', title, id);
    const description = text(body.description, 3000);
    const sortOrder = integer(body.sortOrder);
    const published = flag(body.published);
    await db.query(`INSERT INTO collections
      (id, title, slug, description, sort_order,
       live_title, live_slug, live_description, live_sort_order, live_photo_ids_json,
       published, approved, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, title, slug, description, sortOrder, title, slug, description, sortOrder, '[]', published, published, stamp, stamp]);
    return c.json({ id }, 201);
  });

  app.patch('/api/admin/collections/:id', async c => {
    const body = await readJson(c);
    const original = (await db.query<CollectionRow>('SELECT * FROM collections WHERE id = ?', [c.req.param('id')]))[0];
    if (!original) throw new HttpError(404, 'Collection not found');
    const title = body.title === undefined ? original.title : text(body.title, 140);
    if (!title) throw new HttpError(400, 'Collection title is required');
    const slug = title === original.title ? original.slug : await uniqueSlug(db, 'collections', title, original.id);
    const description = body.description === undefined ? original.description : text(body.description, 3000);
    const sortOrder = body.sortOrder === undefined ? original.sort_order : integer(body.sortOrder);
    const published = body.published === undefined ? original.published : flag(body.published);
    const approved = body.approved === undefined ? (body.published === undefined ? original.approved : published) : flag(body.approved);
    const liveNow = body.published !== undefined && published;
    await db.query(`UPDATE collections SET title = ?, slug = ?, description = ?,
      sort_order = ?, published = ?, approved = ?, live_title = ?, live_slug = ?,
      live_description = ?, live_sort_order = ?, updated_at = ? WHERE id = ?`,
    [title, slug, description, sortOrder, published, approved,
      liveNow ? title : original.live_title, liveNow ? slug : original.live_slug,
      liveNow ? description : original.live_description, liveNow ? sortOrder : original.live_sort_order,
      now(), original.id]);
    return c.json({ id: original.id });
  });

  app.delete('/api/admin/collections/:id', async c => {
    const id = c.req.param('id');
    const collection = (await db.query<{ published: number }>('SELECT published FROM collections WHERE id = ?', [id]))[0];
    if (collection?.published) throw new HttpError(409, 'Hide and publish the collection before deleting it');
    await db.query('DELETE FROM collections WHERE id = ?', [id]);
    return c.json({ deleted: true });
  });

  app.put('/api/admin/collections/:id/photos/:photoId', async c => {
    const body = await readJson(c);
    const { id, photoId } = c.req.param();
    const [collections, photos] = await Promise.all([
      db.query('SELECT id FROM collections WHERE id = ?', [id]),
      db.query('SELECT id FROM photos WHERE id = ?', [photoId]),
    ]);
    if (!collections.length || !photos.length) throw new HttpError(404, 'Collection or photo not found');
    await db.query(`INSERT INTO collection_photos (collection_id, photo_id, sort_order)
      VALUES (?, ?, ?) ON CONFLICT (collection_id, photo_id) DO UPDATE SET sort_order = excluded.sort_order`,
    [id, photoId, integer(body.sortOrder)]);
    return c.json({ added: true });
  });

  app.put('/api/admin/collections/:id/order', async c => {
    const body = await readJson(c);
    const id = c.req.param('id');
    if (!(await db.query('SELECT id FROM collections WHERE id = ?', [id])).length) throw new HttpError(404, 'Collection not found');
    const rows = await db.query<{ photo_id: string }>('SELECT photo_id FROM collection_photos WHERE collection_id = ?', [id]);
    if (!exactOrder(body.photoIds, rows.map(row => row.photo_id))) throw new HttpError(400, 'Include every collection frame exactly once');
    await saveOrder(db, 'collection_photos', 'photo_id', 'collection_id', id, body.photoIds);
    return c.json({ ordered: body.photoIds.length });
  });

  app.delete('/api/admin/collections/:id/photos/:photoId', async c => {
    const { id, photoId } = c.req.param();
    await db.query('DELETE FROM collection_photos WHERE collection_id = ? AND photo_id = ?', [id, photoId]);
    return c.json({ removed: true });
  });

  // ---- Uploads: the raw file is the request body -------------------------
  // POST /api/admin/photos/upload?shootId=…&name=…&alt=…  (Content-Type: the image type)
  async function uploadTarget(c: Context) {
    const shootId = text(c.req.query('shootId'), 100);
    if (!(await db.query('SELECT id FROM shoots WHERE id = ?', [shootId])).length) throw new HttpError(400, 'Choose a shoot before uploading');
    const next = (await db.query<{ next: number | null }>('SELECT MAX(sort_order) + 1 AS next FROM photos WHERE shoot_id = ?', [shootId]))[0];
    return { shootId, sortOrder: c.req.query('sortOrder') === undefined ? Number(next?.next ?? 0) : integer(c.req.query('sortOrder')) };
  }
  const fileName = (c: Context) => path.basename(text(c.req.query('name'), 180)).replace(/[\u0000-\u001f]/g, '');

  app.post('/api/admin/photos/upload', async c => {
    const { shootId, sortOrder } = await uploadTarget(c);
    const { file } = await receiveFile(c, incoming, IMAGE_LIMIT, 'Image exceeds 50 MB');
    try {
      const id = randomUUID();
      const built = await buildVariants(file, id, staging, storage);
      try {
        const stamp = now();
        await db.query(`INSERT INTO photos
          (id, shoot_id, title, alt, caption, width, height, sort_order, published, approved,
           is_cover, assets_json, storage_prefix, file_name, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, shootId, text(c.req.query('title'), 180), text(c.req.query('alt'), 400), '', built.width, built.height,
          sortOrder, 0, 0, 0, JSON.stringify(built.assets), `photos/${id}/`, fileName(c), stamp, stamp]);
      } catch (error) {
        await Promise.allSettled(built.keys.map(key => staging.delete(key)));
        throw error;
      }
      if (!text(c.req.query('alt'))) draftLater(id);
      return c.json({ id, width: built.width, height: built.height, thumb: built.assets.thumb }, 201);
    } finally { await fs.rm(file, { force: true }); }
  });

  app.post('/api/admin/videos/upload', async c => {
    const name = fileName(c);
    const type = c.req.header('content-type') ?? '';
    if (!/\.(mp4|mov|webm)$/i.test(name) || !['video/mp4', 'video/quicktime', 'video/webm', 'application/octet-stream'].includes(type)) {
      throw new HttpError(400, 'Upload an MP4, MOV, or WebM video');
    }
    const { shootId, sortOrder } = await uploadTarget(c);
    const { file } = await receiveFile(c, incoming, VIDEO_LIMIT, 'Video exceeds 2 GB');
    try {
      const id = randomUUID();
      const built = await buildVideoVariants(file, id, staging, storage);
      try {
        const stamp = now();
        await db.query(`INSERT INTO photos
          (id, shoot_id, title, alt, caption, width, height, kind, duration, video_assets_json,
           sort_order, published, approved, is_cover, assets_json, storage_prefix, file_name, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, shootId, text(c.req.query('title'), 180), text(c.req.query('alt'), 400), '', built.width, built.height,
          'video', built.duration, JSON.stringify(built.videoAssets), sortOrder, 0, 0, 0,
          JSON.stringify(built.assets), `photos/${id}/`, name, stamp, stamp]);
      } catch (error) {
        await Promise.allSettled(built.keys.map(key => staging.delete(key)));
        throw error;
      }
      if (!text(c.req.query('alt'))) draftLater(id);
      return c.json({ id, width: built.width, height: built.height, duration: built.duration }, 201);
    } finally { await fs.rm(file, { force: true }); }
  });

  // ---- Photos ----------------------------------------------------------
  app.patch('/api/admin/photos/:id', async c => {
    const body = await readJson(c);
    const original = (await db.query<PhotoRow>('SELECT * FROM photos WHERE id = ?', [c.req.param('id')]))[0];
    if (!original) throw new HttpError(404, 'Photo not found');
    const shootId = body.shootId === undefined ? original.shoot_id : text(body.shootId, 100) || null;
    const curated = !original.storage_prefix;
    if (curated && body.published !== undefined && flag(body.published) !== original.published) {
      throw new HttpError(409, 'Change the photo approval, then Publish to update the site');
    }
    if (curated && shootId !== original.shoot_id) {
      throw new HttpError(409, 'Curated photos stay in their manifest shoot. Update the manifest and redeploy to move them.');
    }
    if (shootId && !(await db.query('SELECT id FROM shoots WHERE id = ?', [shootId])).length) throw new HttpError(400, 'Shoot not found');
    const cover = body.isCover === undefined ? original.is_cover : flag(body.isCover);
    const published = body.published === undefined ? original.published : flag(body.published);
    const approved = body.approved === undefined ? (body.published === undefined ? original.approved : published) : flag(body.approved);
    const alt = body.alt === undefined ? original.alt : text(body.alt, 400);
    if ((published || approved) && !alt) throw new HttpError(400, 'Alt text is required before approval');
    if (original.storage_prefix === `photos/${original.id}/` && published !== original.published) {
      if (published) await publishVariants(original.id, staging, storage, original.kind);
      else await unpublishVariants(original.id, staging, storage, original.kind);
    }
    if (cover && shootId) {
      await db.query('UPDATE photos SET is_cover = 0 WHERE shoot_id = ?', [shootId]);
      if (body.published !== undefined && published) await db.query('UPDATE photos SET live_is_cover = 0 WHERE shoot_id = ?', [shootId]);
    }
    const sortOrder = body.sortOrder === undefined ? original.sort_order : integer(body.sortOrder);
    const liveNow = body.published !== undefined && !!published;
    await db.query(`UPDATE photos SET shoot_id = ?, title = ?, alt = ?, caption = ?,
      sort_order = ?, published = ?, approved = ?, is_cover = ?,
      live_alt = ?, live_shoot_id = ?, live_sort_order = ?, live_is_cover = ?, updated_at = ? WHERE id = ?`,
    [shootId, body.title === undefined ? original.title : text(body.title, 180), alt,
      body.caption === undefined ? original.caption : text(body.caption, 1500),
      sortOrder, published, approved, cover,
      liveNow ? alt : original.live_alt, liveNow ? shootId : original.live_shoot_id,
      liveNow ? sortOrder : original.live_sort_order, liveNow ? cover : original.live_is_cover,
      now(), original.id]);
    return c.json({ id: original.id });
  });

  app.delete('/api/admin/photos/:id', async c => {
    const id = c.req.param('id');
    const row = (await db.query<Pick<PhotoRow, 'storage_prefix' | 'kind' | 'published'>>('SELECT storage_prefix, kind, published FROM photos WHERE id = ?', [id]))[0];
    if (!row) throw new HttpError(404, 'Photo not found');
    if (!row.storage_prefix) throw new HttpError(409, 'Curated static photos must be removed from public/media and redeployed.');
    if (row.published) throw new HttpError(409, 'Move this upload to draft and publish its withdrawal before deleting it');
    if (row.storage_prefix !== `photos/${id}/`) throw new HttpError(409, 'Upload storage is not available for deletion');
    const keys = variantKeys(id, row.kind);
    if ((await Promise.allSettled(keys.map(key => storage.delete(key)))).some(result => result.status === 'rejected')) {
      throw new HttpError(500, 'Could not remove the public media. The upload was kept; retry deletion.');
    }
    if ((await Promise.allSettled(keys.map(key => staging.delete(key)))).some(result => result.status === 'rejected')) {
      throw new HttpError(500, 'Could not remove the private media. The upload was kept; retry deletion.');
    }
    await db.query('DELETE FROM photos WHERE id = ?', [id]);
    return c.json({ deleted: true });
  });

  return app;
}
