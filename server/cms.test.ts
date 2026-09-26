import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { after, test } from 'node:test';
import sharp from 'sharp';
import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { openDatabase } from './db.ts';
import { seedFromManifest } from './seed.ts';
import { buildVariants, createStaging, createStorage, publishVariants } from './media.ts';
import { cleanSuggestion } from './alt-text.ts';
import { localSettings } from './settings.ts';
import type { Settings } from './settings.ts';
import type { AdminContent, PublicCatalog } from '../shared/api.ts';

const directories: string[] = [];
const run = promisify(execFile);
after(async () => { await Promise.all(directories.map(directory => fs.rm(directory, { recursive: true, force: true }))); });

const PASSWORD = 'temporary-password-123';
type Json = Record<string, any>;

async function fixture(overrides: Partial<Settings> = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nolle-cms-test-'));
  directories.push(root);
  const adminDir = path.join(root, 'dist-admin');
  await fs.mkdir(adminDir);
  await fs.writeFile(path.join(adminDir, 'index.html'), '<!doctype html><title>Content room — Nolle Studios</title>');
  const settings = localSettings(root, {
    sqliteFile: path.join(root, 'cms.sqlite'), localMediaDir: path.join(root, 'media'), stagingDir: path.join(root, 'staging'),
    adminDir, localAdminPassword: PASSWORD, sessionSecret: 'test-session-secret', altTextUrl: '', ...overrides,
  });
  const db = await openDatabase(settings);
  const app = createApp({ db, settings });
  const server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' });
  await once(server, 'listening');
  settings.port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${settings.port}`;
  const site = async () => await (await fetch(`${base}/api/site`)).json() as PublicCatalog;

  async function signIn() {
    const response = await fetch(`${base}/api/admin/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }),
    });
    assert.equal(response.status, 200);
    const cookie = response.headers.get('set-cookie')!.split(';')[0];
    const { csrfToken } = await response.json() as { csrfToken: string };
    const headers = { Cookie: cookie, 'X-CSRF-Token': csrfToken };
    const admin = (endpoint: string, method = 'GET', body?: unknown) => fetch(`${base}/api/admin${endpoint}`, {
      method, headers: { ...headers, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const content = async () => await (await admin('/content')).json() as AdminContent;
    // Uploads send the raw file as the body; metadata travels in the query.
    const upload = (kind: 'photos' | 'videos', shootId: string, bytes: Buffer | string, options: { type?: string; name?: string; alt?: string } = {}) => {
      const query = new URLSearchParams({ shootId, name: options.name ?? (kind === 'videos' ? 'clip.mp4' : 'frame.jpg') });
      if (options.alt) query.set('alt', options.alt);
      return fetch(`${base}/api/admin/${kind}/upload?${query}`, {
        method: 'POST', headers: { ...headers, 'Content-Type': options.type ?? (kind === 'videos' ? 'video/mp4' : 'image/jpeg') },
        body: typeof bytes === 'string' ? bytes : new Uint8Array(bytes),
      });
    };
    return { cookie, csrfToken, headers, admin, content, upload };
  }

  return {
    root, db, base, app, settings, site, signIn,
    async close() { await app.idle(); server.close(); await once(server, 'close'); await db.close(); },
  };
}

const jpegOf = (background: string, width = 640, height = 400) =>
  sharp({ create: { width, height, channels: 3, background } }).jpeg().toBuffer();
const exists = (file: string) => fs.stat(file).then(() => true, () => false);

test('Content Room site links resolve to Vite directly and stay same-origin behind a proxy', async () => {
  const { base, signIn, close } = await fixture();
  try {
    const { cookie, admin } = await signIn();
    assert.equal(((await (await admin('/config')).json()) as Json).siteUrl, 'http://127.0.0.1:5173/');
    const proxied = await new Promise<Json>((resolve, reject) => {
      http.get(`${base}/api/admin/config`, { headers: { Cookie: cookie, Host: '127.0.0.1:5173' } }, response => {
        let body = '';
        response.on('data', chunk => { body += chunk; });
        response.on('end', () => resolve(JSON.parse(body)));
      }).on('error', reject);
    });
    assert.equal(proxied.siteUrl, '/');
  } finally { await close(); }
  const custom = await fixture({ siteUrl: 'https://nollestudios.com/' });
  try {
    const { admin } = await custom.signIn();
    assert.equal(((await (await admin('/config')).json()) as Json).siteUrl, 'https://nollestudios.com/');
  } finally { await custom.close(); }
});

test('standalone Content Room serves its brand marks without exposing other public files', async () => {
  const { root, base, close } = await fixture();
  try {
    await fs.mkdir(path.join(root, 'public'));
    for (const asset of ['nolle-studios-mark.svg', 'favicon.svg']) {
      await fs.writeFile(path.join(root, 'public', asset), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
      const response = await fetch(`${base}/${asset}`);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type')!, /image\/svg\+xml/);
      assert.match(await response.text(), /<svg/);
    }
    await fs.writeFile(path.join(root, 'public', 'unlisted.txt'), 'private to this route');
    assert.equal((await fetch(`${base}/unlisted.txt`)).status, 404);
    // Media paths cannot climb out of the media directories.
    assert.equal((await fetch(`${base}/media/..%2F..%2Fcms.sqlite`)).status, 404);
  } finally { await close(); }
});

test('empty and malformed CMS requests return validation errors', async () => {
  const { base, signIn, close } = await fixture();
  try {
    const { headers } = await signIn();
    const empty = await fetch(`${base}/api/admin/shoots`, { method: 'POST', headers });
    assert.equal(empty.status, 400);
    assert.match(((await empty.json()) as Json).error, /title is required/);
    const created = await fetch(`${base}/api/admin/shoots`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Order target' }),
    });
    const { id } = await created.json() as Json;
    assert.equal(created.status, 201);
    const missingOrder = await fetch(`${base}/api/admin/shoots/${id}/order`, { method: 'PUT', headers });
    assert.equal(missingOrder.status, 400);
    assert.match(((await missingOrder.json()) as Json).error, /every shoot frame/);
    const malformed = await fetch(`${base}/api/admin/shoots/${id}/order`, {
      method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{',
    });
    assert.equal(malformed.status, 400);
    assert.match(((await malformed.json()) as Json).error, /Invalid JSON/);
    const oversized = await fetch(`${base}/api/admin/shoots/${id}`, {
      method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ description: 'x'.repeat(40_000) }),
    });
    assert.equal(oversized.status, 413);
  } finally { await close(); }
});

test('failed upload deletion keeps the CMS record available for retry', async () => {
  const { root, signIn, close } = await fixture();
  try {
    const { admin, content, upload } = await signIn();
    const { id: shootId } = await (await admin('/shoots', 'POST', { title: 'Delete retry' })).json() as Json;
    const uploaded = await upload('photos', shootId, await jpegOf('#bed1c4'), { name: 'draft.jpg' });
    assert.equal(uploaded.status, 201);
    const { id } = await uploaded.json() as Json;
    const blockedFile = path.join(root, 'media', 'photos', id, '640.jpg');
    const stagedFile = path.join(root, 'staging', 'photos', id, '640.jpg');
    await fs.mkdir(blockedFile, { recursive: true });
    const failed = await admin(`/photos/${id}`, 'DELETE');
    assert.equal(failed.status, 500);
    assert.match(((await failed.json()) as Json).error, /retry deletion/i);
    assert.equal((await content()).photos.some(row => row.id === id), true);
    assert.equal(await exists(stagedFile), true);
    await fs.rmdir(blockedFile);
    assert.equal((await admin(`/photos/${id}`, 'DELETE')).status, 200);
    assert.equal((await content()).photos.some(row => row.id === id), false);
    assert.equal(await exists(stagedFile), false);
  } finally { await close(); }
});

test('shoot dates reject impossible days without changing saved details', async () => {
  const { signIn, close } = await fixture();
  try {
    const { admin, content } = await signIn();
    const rejected = await admin('/shoots', 'POST', { title: 'Invalid day', date: '2026-02-31' });
    assert.equal(rejected.status, 400);
    assert.match(((await rejected.json()) as Json).error, /real date/);
    const created = await admin('/shoots', 'POST', { title: 'Leap day', date: '2024-02-29' });
    assert.equal(created.status, 201);
    const { id } = await created.json() as Json;
    assert.equal((await admin(`/shoots/${id}`, 'PATCH', { title: 'Changed title', date: '2025-02-29' })).status, 400);
    const shoot = (await content()).shoots.find(row => row.id === id)!;
    assert.equal(shoot.title, 'Leap day');
    assert.equal(shoot.date, '2024-02-29');
    assert.equal((await admin(`/shoots/${id}`, 'PATCH', { date: '' })).status, 200);
  } finally { await close(); }
});

test('manifest import is curated, idempotent, and preserves CMS edits', async () => {
  const { root, db, site, signIn, close } = await fixture();
  try {
    const manifestPath = path.join(root, 'archive.json');
    const image = '/media/studio/frame-640.webp';
    await fs.writeFile(manifestPath, JSON.stringify({ shoots: [
      { id: 'public-shoot', title: 'Public shoot', date: '2026-09-24', published: true, photos: [
        { id: 'frame-one', alt: 'A portrait', thumb: image, mid: image, full: image, width: 640, height: 480 },
      ] },
      { id: 'private-shoot', title: 'Private shoot', published: false, photos: [] },
    ] }));
    await seedFromManifest(db, manifestPath);
    await db.query('UPDATE shoots SET title = ? WHERE id = ?', ['Edited title', 'public-shoot']);
    await db.query('UPDATE photos SET alt = ? WHERE id = ?', ['An edited portrait', 'frame-one']);
    await seedFromManifest(db, manifestPath);
    const catalog = await site();
    assert.equal(catalog.shoots.length, 1);
    assert.equal(catalog.shoots[0].title, 'Public shoot');
    assert.equal(catalog.shoots[0].photos[0].alt, 'A portrait');
    assert.equal((await db.query<{ alt: string }>('SELECT alt FROM photos WHERE id = ?', ['frame-one']))[0].alt, 'An edited portrait');
    assert.ok(!JSON.stringify(catalog).includes('private-shoot'));
    const { admin } = await signIn();
    assert.equal((await admin('/publish', 'POST')).status, 200);
    const afterEditPublish = (await site()).shoots[0];
    assert.equal(afterEditPublish.title, 'Edited title');
    assert.equal(afterEditPublish.photos[0].alt, 'An edited portrait');
    assert.equal((await admin('/photos/frame-one', 'PATCH', { published: false })).status, 409);
    assert.equal((await admin('/photos/frame-one', 'DELETE')).status, 409);
    assert.equal((await admin('/shoots/public-shoot', 'PATCH', { published: false })).status, 409);
    await fs.writeFile(manifestPath, JSON.stringify({ shoots: [
      { id: 'public-shoot', title: 'Public shoot', date: '2026-09-24', published: true, photos: [] },
    ] }));
    assert.equal((await seedFromManifest(db, manifestPath)).removed, 1);
    const afterWithdrawal = await site();
    assert.equal(afterWithdrawal.shoots[0].photos.length, 0);
    assert.equal(afterWithdrawal.shoots[0].title, 'Edited title');
  } finally { await close(); }
});

test('a private cover choice does not replace the live shoot cover until that frame is published', async () => {
  const { root, db, site, signIn, close } = await fixture();
  try {
    const manifestPath = path.join(root, 'archive.json');
    const photos = ['first', 'current', 'next'].map(id => ({
      id, alt: `${id} frame`, thumb: `/media/test/${id}.jpg`, mid: `/media/test/${id}.jpg`, full: `/media/test/${id}.jpg`, width: 640, height: 480,
    }));
    await fs.writeFile(manifestPath, JSON.stringify({ shoots: [{
      id: 'cover-shoot', title: 'Cover shoot', date: '2026-09-25', published: true, coverUrl: photos[1].mid, photos,
    }] }));
    await seedFromManifest(db, manifestPath);
    const { admin } = await signIn();
    const liveCover = async () => (await site()).shoots[0].coverUrl;
    assert.equal(await liveCover(), photos[1].mid);
    assert.equal((await admin('/photos/next', 'PATCH', { approved: false, isCover: true })).status, 200);
    assert.equal((await admin('/publish', 'POST')).status, 200);
    assert.equal(await liveCover(), photos[1].mid);
    assert.equal((await admin('/photos/next', 'PATCH', { approved: true })).status, 200);
    assert.equal((await admin('/publish', 'POST')).status, 200);
    assert.equal(await liveCover(), photos[2].mid);
  } finally { await close(); }
});

test('curated photographs and shoots can leave the local catalog through Publish and stay hidden after sync', async () => {
  const { root, db, site, signIn, close } = await fixture();
  try {
    const manifestPath = path.join(root, 'archive.json');
    const image = '/media/studio/frame-640.webp';
    await fs.writeFile(manifestPath, JSON.stringify({ shoots: [
      { id: 'public-shoot', title: 'Public shoot', published: true, photos: [
        { id: 'frame-one', alt: 'A portrait', thumb: image, mid: image, full: image, width: 640, height: 480 },
      ] },
    ] }));
    await seedFromManifest(db, manifestPath);
    const { admin } = await signIn();
    const ids = async () => (await site()).shoots[0]?.photos.map(photo => photo.id);
    assert.deepEqual(await ids(), ['frame-one']);
    assert.equal((await admin('/photos/frame-one', 'PATCH', { approved: false })).status, 200);
    assert.deepEqual(await ids(), ['frame-one']);
    assert.equal((await admin('/publish', 'POST')).status, 200);
    assert.deepEqual(await ids(), []);
    await seedFromManifest(db, manifestPath);
    assert.deepEqual(await ids(), []);
    assert.equal((await admin('/photos/frame-one', 'PATCH', { approved: true })).status, 200);
    assert.equal((await admin('/publish', 'POST')).status, 200);
    assert.deepEqual(await ids(), ['frame-one']);

    assert.equal((await admin('/shoots/public-shoot', 'PATCH', { approved: false })).status, 200);
    assert.equal((await site()).shoots.length, 1);
    assert.equal((await admin('/publish', 'POST')).status, 200);
    assert.equal((await site()).shoots.length, 0);
    await seedFromManifest(db, manifestPath);
    assert.equal((await site()).shoots.length, 0);
    assert.equal((await admin('/shoots/public-shoot', 'PATCH', { approved: true })).status, 200);
    assert.equal((await admin('/publish', 'POST')).status, 200);
    assert.deepEqual(await ids(), ['frame-one']);
  } finally { await close(); }
});

test('manifest replaces former stock descriptions without overwriting Content Room copy', async () => {
  const { root, db, close } = await fixture();
  try {
    const manifestPath = path.join(root, 'archive.json');
    const original = 'Sunday baseball: sharp color, quick reactions, and the rhythm of a team in motion.';
    const revised = 'Baseball on September 20.';
    const writeManifest = (description: string) => fs.writeFile(manifestPath, JSON.stringify({ shoots: [
      { id: 'september-20', title: 'The Next Inning', description, published: true, photos: [] },
    ] }));
    const read = async () => (await db.query<{ description: string; live_description: string }>(
      'SELECT description, live_description FROM shoots WHERE id = ?', ['september-20']))[0];
    await writeManifest(original);
    await seedFromManifest(db, manifestPath);
    await writeManifest(revised);
    await seedFromManifest(db, manifestPath);
    assert.deepEqual({ ...await read() }, { description: revised, live_description: revised });
    await db.query('UPDATE shoots SET description = ?, live_description = ? WHERE id = ?', [
      'A note written in the Content Room.', 'Published note from the Content Room.', 'september-20',
    ]);
    await seedFromManifest(db, manifestPath);
    assert.deepEqual({ ...await read() }, { description: 'A note written in the Content Room.', live_description: 'Published note from the Content Room.' });
  } finally { await close(); }
});

test('manifest sync withdraws an empty curated shoot but preserves CMS shoots', async () => {
  const { root, db, base, site, signIn, close } = await fixture();
  try {
    const manifestPath = path.join(root, 'archive.json');
    await fs.writeFile(manifestPath, JSON.stringify({ shoots: [
      { id: 'empty-curated', title: 'Empty curated shoot', published: true, photos: [] },
    ] }));
    await seedFromManifest(db, manifestPath);
    const { admin, content } = await signIn();
    assert.equal((await admin('/shoots', 'POST', { title: 'CMS shoot', published: true })).status, 201);
    assert.equal((await content()).shoots.find(shoot => shoot.id === 'empty-curated')!.curated, true);
    assert.equal((await admin('/shoots/empty-curated', 'PATCH', { published: false })).status, 409);
    assert.equal((await admin('/shoots/empty-curated', 'DELETE')).status, 409);
    const siteResponse = await fetch(`${base}/api/site`);
    assert.equal(siteResponse.headers.get('cache-control'), 'no-store');
    assert.equal(((await siteResponse.json()) as PublicCatalog).shoots.length, 2);
    await fs.writeFile(manifestPath, JSON.stringify({ shoots: [] }));
    await seedFromManifest(db, manifestPath);
    assert.deepEqual((await site()).shoots.map(shoot => shoot.title), ['CMS shoot']);
  } finally { await close(); }
});

test('manifest sync moves a curated photo and refreshes its assets without losing CMS alt text', async () => {
  const { root, db, site, signIn, close } = await fixture();
  try {
    const manifestPath = path.join(root, 'archive.json');
    const frame = (folder: string) => ({
      id: 'moving-frame', alt: 'Manifest description', width: 640, height: 480,
      thumb: `/media/${folder}/thumb.jpg`, mid: `/media/${folder}/mid.jpg`, full: `/media/${folder}/full.jpg`,
    });
    await fs.writeFile(manifestPath, JSON.stringify({ shoots: [
      { id: 'first-shoot', title: 'First shoot', published: true, photos: [frame('first')] },
      { id: 'second-shoot', title: 'Second shoot', published: true, photos: [] },
    ] }));
    await seedFromManifest(db, manifestPath);
    await db.query('UPDATE photos SET alt = ? WHERE id = ?', ['CMS description', 'moving-frame']);
    await fs.writeFile(manifestPath, JSON.stringify({ shoots: [
      { id: 'first-shoot', title: 'First shoot', published: true, photos: [] },
      { id: 'second-shoot', title: 'Second shoot', published: true, photos: [frame('second')] },
    ] }));
    await seedFromManifest(db, manifestPath);
    const catalog = await site();
    assert.deepEqual(catalog.shoots[0].photos.map(photo => photo.id), []);
    assert.deepEqual(catalog.shoots[1].photos.map(photo => photo.id), ['moving-frame']);
    assert.equal(catalog.shoots[1].photos[0].mid, '/media/second/mid.jpg');
    assert.equal(catalog.shoots[1].photos[0].alt, 'Manifest description');
    const { admin } = await signIn();
    assert.equal((await admin('/publish', 'POST')).status, 200);
    assert.equal((await site()).shoots[1].photos[0].alt, 'CMS description');
  } finally { await close(); }
});

test('upload stays private until publish, strips EXIF, and unpublish removes public copies', async () => {
  const { root, base, site, signIn, close } = await fixture();
  try {
    const adminRedirect = await fetch(`${base}/admin`, { redirect: 'manual' });
    assert.equal(adminRedirect.status, 308);
    assert.equal(adminRedirect.headers.get('location'), '/admin/');
    const adminPage = await fetch(`${base}/admin/`, { redirect: 'manual' });
    assert.equal(adminPage.status, 200);
    assert.match(adminPage.headers.get('content-security-policy')!, /script-src 'self'/);
    assert.match(await adminPage.text(), /Content room/);
    const { cookie, admin, upload } = await signIn();
    const shootResponse = await admin('/shoots', 'POST', { title: 'Studio session', published: true });
    assert.equal(shootResponse.status, 201);
    const { id: shootId } = await shootResponse.json() as Json;

    const invalidUpload = await upload('photos', shootId, 'not an image', { type: 'text/plain', name: 'notes.txt' });
    assert.equal(invalidUpload.status, 400);
    assert.match(((await invalidUpload.json()) as Json).error, /Upload an edited JPEG, PNG, TIFF, WebP, AVIF, or HEIF image/);

    const jpeg = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#c58d62' } })
      .jpeg().withExif({ IFD0: { Make: 'Sony', Model: 'A7 V' } }).toBuffer();
    assert.ok((await sharp(jpeg).metadata()).exif);
    const uploaded = await upload('photos', shootId, jpeg, { alt: 'A warm studio frame' });
    const uploadResult = await uploaded.json() as Json;
    assert.equal(uploaded.status, 201, JSON.stringify(uploadResult));
    const photoId: string = uploadResult.id;
    const publicFile = path.join(root, 'media', 'photos', photoId, '640.jpg');
    const stagedFile = path.join(root, 'staging', 'photos', photoId, '640.jpg');
    assert.equal(await exists(stagedFile), true);
    assert.equal(await exists(publicFile), false);
    assert.equal((await sharp(stagedFile).metadata()).exif, undefined);
    assert.equal((await site()).shoots[0].photos.length, 0);
    assert.equal((await fetch(`${base}/api/admin/preview`)).status, 401);
    const privatePreview = await (await admin('/preview')).json() as PublicCatalog;
    const stagedPhoto = privatePreview.shoots[0].photos.find(photo => photo.id === photoId)!;
    assert.equal(stagedPhoto.alt, 'A warm studio frame');
    assert.match(stagedPhoto.mid, new RegExp(`/api/admin/photos/${photoId}/preview\\?width=1600$`));
    assert.equal((await fetch(`${base}${stagedPhoto.mid}`)).status, 401);
    const stagedPreview = await fetch(`${base}${stagedPhoto.mid}`, { headers: { Cookie: cookie } });
    assert.equal(stagedPreview.status, 200);
    assert.match(stagedPreview.headers.get('content-type')!, /image\/jpeg/);
    assert.equal((await admin(`/photos/${photoId}/preview?width=999`)).status, 400);
    const rejected = await fetch(`${base}/api/admin/photos/${photoId}`, {
      method: 'PATCH', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ published: true }),
    });
    assert.equal(rejected.status, 403);

    assert.equal((await admin(`/photos/${photoId}`, 'PATCH', { published: true })).status, 200);
    const publishedBytes = await fs.readFile(publicFile);
    const publicResponse = await fetch(`${base}/media/photos/${photoId}/640.jpg`);
    assert.equal(publicResponse.status, 200);
    assert.match(publicResponse.headers.get('cache-control')!, /max-age=300/);
    const publishedMeta = await sharp(publishedBytes).metadata();
    assert.equal(publishedMeta.exif, undefined);
    assert.equal(publishedMeta.xmp, undefined);
    let catalog = await site();
    assert.equal(catalog.shoots[0].photos.length, 1);
    assert.equal(catalog.shoots[0].photos[0].alt, 'A warm studio frame');

    const { id: collectionId } = await (await admin('/collections', 'POST', { title: 'Selected work', published: true })).json() as Json;
    assert.equal((await admin(`/collections/${collectionId}/photos/${photoId}`, 'PUT', {})).status, 200);
    assert.equal((await admin(`/shoots/${shootId}`, 'PATCH', { published: false })).status, 200);
    catalog = await site();
    assert.equal(catalog.shoots.length, 0);
    assert.deepEqual(catalog.collections[0].photoIds, []);
    assert.ok(!JSON.stringify(catalog).includes(photoId));
    assert.equal((await admin(`/shoots/${shootId}`, 'PATCH', { published: true })).status, 200);
    assert.deepEqual((await site()).collections[0].photoIds, []);
    assert.equal((await admin('/publish', 'POST')).status, 200);
    assert.deepEqual((await site()).collections[0].photoIds, [photoId]);

    assert.equal((await admin(`/photos/${photoId}`, 'PATCH', { published: false })).status, 200);
    assert.equal(await exists(publicFile), false);
    assert.equal((await site()).shoots[0].photos.length, 0);
    assert.equal((await admin('/logout', 'POST')).status, 200);
    assert.equal((await admin('/content')).status, 401);
  } finally { await close(); }
});

test('approval queues a photograph until publish and queues withdrawal without exposing drafts', async () => {
  const { root, site, signIn, close } = await fixture();
  try {
    const { admin, content, upload } = await signIn();
    const { id: shootId } = await (await admin('/shoots', 'POST', { title: 'Queued shoot', published: true })).json() as Json;
    const { id: photoId } = await (await upload('photos', shootId, await jpegOf('#bca98a', 800, 600), { alt: 'A test photograph' })).json() as Json;
    assert.ok(photoId);
    assert.equal((await admin(`/photos/${photoId}`, 'PATCH', { approved: true })).status, 200);
    let photo = (await content()).photos[0];
    assert.equal(photo.approved, true);
    assert.equal(photo.published, false);
    assert.equal((await site()).shoots[0].photos.length, 0);
    const publicFile = path.join(root, 'media', 'photos', photoId, '640.jpg');
    assert.equal(await exists(publicFile), false);

    assert.equal((await admin('/publish', 'POST')).status, 200);
    assert.equal((await site()).shoots[0].photos.length, 1);
    assert.equal(await exists(publicFile), true);

    assert.equal((await admin(`/photos/${photoId}`, 'PATCH', { alt: 'A revised description', sortOrder: 5, isCover: true })).status, 200);
    let publicPhoto = (await site()).shoots[0].photos[0];
    assert.equal(publicPhoto.alt, 'A test photograph');
    assert.equal(publicPhoto.sortOrder, 0);
    assert.equal(publicPhoto.isCover, false);
    photo = (await content()).photos[0];
    assert.equal(photo.alt, 'A revised description');
    assert.equal(photo.liveAlt, 'A test photograph');
    assert.equal((await admin('/publish', 'POST')).status, 200);
    publicPhoto = (await site()).shoots[0].photos[0];
    assert.equal(publicPhoto.alt, 'A revised description');
    assert.equal(publicPhoto.sortOrder, 5);
    assert.equal(publicPhoto.isCover, true);

    assert.equal((await admin(`/photos/${photoId}`, 'PATCH', { approved: false })).status, 200);
    assert.equal((await site()).shoots[0].photos.length, 1);
    const liveBytes = await fs.readFile(publicFile);
    const healthyFile = path.join(root, 'media', 'photos', photoId, '960.jpg');
    const healthyBytes = await fs.readFile(healthyFile);
    await fs.rm(publicFile);
    await fs.mkdir(publicFile);
    assert.equal((await admin('/publish', 'POST')).status, 500);
    assert.equal((await site()).shoots[0].photos.length, 1);
    assert.equal((await content()).photos[0].published, true);
    assert.deepEqual(await fs.readFile(healthyFile), healthyBytes);
    await fs.rmdir(publicFile);
    await fs.writeFile(publicFile, liveBytes);
    assert.equal((await admin('/publish', 'POST')).status, 200);
    assert.equal((await site()).shoots[0].photos.length, 0);
    assert.equal(await exists(publicFile), false);
    photo = (await content()).photos[0];
    assert.equal(photo.approved, false);
    assert.equal(photo.published, false);
  } finally { await close(); }
});

test('failed later upload keeps earlier additions out of the public catalog', async () => {
  const { root, site, signIn, close } = await fixture();
  try {
    const { admin, upload } = await signIn();
    const { id: shootId } = await (await admin('/shoots', 'POST', { title: 'Two new photos', published: true })).json() as Json;
    const jpeg = await jpegOf('#aeb59b');
    const ids: string[] = [];
    for (const name of ['First', 'Second']) {
      const uploaded = await upload('photos', shootId, jpeg, { alt: `${name} new photo`, name: `${name.toLowerCase()}.jpg` });
      assert.equal(uploaded.status, 201);
      const { id } = await uploaded.json() as Json;
      ids.push(id);
      assert.equal((await admin(`/photos/${id}`, 'PATCH', { approved: true })).status, 200);
    }
    const missingFile = path.join(root, 'staging', 'photos', ids[1], '640.jpg');
    const stagedBytes = await fs.readFile(missingFile);
    await fs.rm(missingFile);
    assert.equal((await admin('/publish', 'POST')).status, 500);
    assert.equal((await site()).shoots[0].photos.length, 0);
    assert.equal(await exists(path.join(root, 'media', 'photos', ids[0], '640.jpg')), false);
    await fs.writeFile(missingFile, stagedBytes);
    assert.equal((await admin('/publish', 'POST')).status, 200);
    assert.equal((await site()).shoots[0].photos.length, 2);
  } finally { await close(); }
});

test('failed later withdrawal restores earlier live photographs', async () => {
  const { root, site, signIn, close } = await fixture();
  try {
    const { admin, upload } = await signIn();
    const { id: shootId } = await (await admin('/shoots', 'POST', { title: 'Two live photos', published: true })).json() as Json;
    const jpeg = await jpegOf('#b8b49a');
    const ids: string[] = [];
    for (const name of ['First', 'Second']) {
      const uploaded = await upload('photos', shootId, jpeg, { alt: `${name} live photo` });
      assert.equal(uploaded.status, 201);
      const { id } = await uploaded.json() as Json;
      ids.push(id);
      assert.equal((await admin(`/photos/${id}`, 'PATCH', { approved: true })).status, 200);
    }
    assert.equal((await admin('/publish', 'POST')).status, 200);
    for (const id of ids) assert.equal((await admin(`/photos/${id}`, 'PATCH', { approved: false })).status, 200);
    const firstFile = path.join(root, 'media', 'photos', ids[0], '640.jpg');
    const failedFile = path.join(root, 'media', 'photos', ids[1], '640.jpg');
    const firstBytes = await fs.readFile(firstFile);
    const secondBytes = await fs.readFile(failedFile);
    await fs.rm(failedFile);
    await fs.mkdir(failedFile);
    assert.equal((await admin('/publish', 'POST')).status, 500);
    assert.equal((await site()).shoots[0].photos.length, 2);
    assert.deepEqual(await fs.readFile(firstFile), firstBytes);
    await fs.rmdir(failedFile);
    await fs.writeFile(failedFile, secondBytes);
    assert.equal((await admin('/publish', 'POST')).status, 200);
    assert.equal((await site()).shoots[0].photos.length, 0);
  } finally { await close(); }
});

test('video upload stays private, previews with ranges, and plays after publish', async () => {
  const { root, base, site, signIn, close } = await fixture();
  try {
    const source = path.join(root, 'sample.mp4');
    await run('ffmpeg', ['-nostdin', '-y', '-v', 'error', '-f', 'lavfi',
      '-i', 'testsrc=size=640x360:rate=12', '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', source]);
    const { cookie, admin, upload } = await signIn();
    const { id: shootId } = await (await admin('/shoots', 'POST', { title: 'Moving images', published: true })).json() as Json;
    const rejected = await upload('videos', shootId, await fs.readFile(source), { name: 'clip.exe' });
    assert.equal(rejected.status, 400);
    const uploaded = await upload('videos', shootId, await fs.readFile(source), { name: 'sample.mp4', alt: 'Color bars moving across the frame' });
    const body = await uploaded.json() as Json;
    assert.equal(uploaded.status, 201, JSON.stringify(body));
    const id: string = body.id;
    assert.ok(body.duration > 0);
    assert.equal((await fetch(`${base}/media/videos/${id}/1080.mp4`)).status, 404);
    assert.equal((await fetch(`${base}/api/admin/videos/${id}/preview`)).status, 401);
    const previewCatalog = await (await admin('/preview')).json() as PublicCatalog;
    assert.equal(previewCatalog.shoots[0].photos[0].video.mp4, `/api/admin/videos/${id}/preview`);
    const preview = await fetch(`${base}/api/admin/videos/${id}/preview`, { headers: { Cookie: cookie, Range: 'bytes=0-99' } });
    assert.equal(preview.status, 206);
    assert.equal((await preview.arrayBuffer()).byteLength, 100);
    const badRange = await fetch(`${base}/api/admin/videos/${id}/preview`, { headers: { Cookie: cookie, Range: 'bytes=99999999-' } });
    assert.equal(badRange.status, 416);
    assert.equal((await admin(`/photos/${id}`, 'PATCH', { approved: true })).status, 200);
    assert.equal((await admin('/publish', 'POST')).status, 200);
    const video = (await site()).shoots[0].photos[0];
    assert.equal(video.kind, 'video');
    assert.match(video.video.mp4!, /\/videos\//);
    assert.equal((await fetch(`${base}${video.video.mp4}`)).status, 200);
    assert.equal((await fetch(`${base}${video.video.webm}`)).status, 200);
    const seek = await fetch(`${base}${video.video.mp4}`, { headers: { Range: 'bytes=10-19' } });
    assert.equal(seek.status, 206);
    assert.equal((await seek.arrayBuffer()).byteLength, 10);
    assert.equal((await admin(`/photos/${id}`, 'PATCH', { approved: false })).status, 200);
    assert.equal((await admin('/publish', 'POST')).status, 200);
    assert.equal((await fetch(`${base}${video.video.mp4}`)).status, 404);
  } finally { await close(); }
});

test('publishing can replace files left by an interrupted attempt', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nolle-publish-retry-'));
  directories.push(root);
  const settings = localSettings(root, { localMediaDir: path.join(root, 'public'), stagingDir: path.join(root, 'private') });
  const storage = createStorage(settings);
  const staging = createStaging(settings);
  const id = 'b3552c68-c09a-40de-af56-92f68e43daac';
  const built = await buildVariants(await jpegOf('#9bcefa'), id, staging, storage);
  const key = `photos/${id}/640.jpg`;
  const originalStaged = await staging.read(key);
  await assert.rejects(staging.put(key, Buffer.from('incomplete replacement')), (error: NodeJS.ErrnoException) => error.code === 'EEXIST');
  assert.deepEqual(await staging.read(key), originalStaged);
  assert.ok(!(await fs.readdir(path.join(settings.stagingDir, 'photos', id))).some(name => name.endsWith('.tmp')));
  await storage.put(key, Buffer.from('interrupted copy'), 'image/jpeg');
  await publishVariants(id, staging, storage);
  assert.deepEqual(await fs.readFile(path.join(settings.localMediaDir, key)), await staging.read(key));
  assert.equal(built.keys.length, 15);

  const videoKey = `videos/${id}/720.mp4`;
  const videoSource = path.join(root, 'video.mp4');
  await fs.writeFile(videoSource, 'complete video bytes');
  await staging.putFile(videoKey, videoSource);
  await assert.rejects(staging.putFile(videoKey, videoSource), (error: NodeJS.ErrnoException) => error.code === 'EEXIST');
  assert.equal(await fs.readFile(path.join(settings.stagingDir, videoKey), 'utf8'), 'complete video bytes');
  await storage.putFile(videoKey, videoSource, 'video/mp4');
  await fs.writeFile(videoSource, 'replacement bytes');
  await storage.putFile(videoKey, videoSource, 'video/mp4');
  assert.equal(await fs.readFile(path.join(settings.localMediaDir, videoKey), 'utf8'), 'replacement bytes');
});

test('variants are oriented, sized without enlargement, and every format decodes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nolle-variants-'));
  directories.push(root);
  const settings = localSettings(root, { localMediaDir: path.join(root, 'public'), stagingDir: path.join(root, 'private') });
  // A 1000 x 600 frame stored sideways with EXIF orientation 6 is really 600 x 1000.
  const sideways = await sharp({ create: { width: 1000, height: 600, channels: 3, background: '#7f6a55' } })
    .jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const id = '0f9f7a57-3a0d-4f59-9d6e-2f0c1f3b8e10';
  const built = await buildVariants(sideways, id, createStaging(settings), createStorage(settings));
  assert.deepEqual([built.width, built.height], [600, 1000]);
  for (const ext of ['avif', 'webp', 'jpg']) {
    const small = await sharp(path.join(settings.stagingDir, 'photos', id, `640.${ext}`)).metadata();
    assert.equal(small.width, 600, `${ext} is not enlarged past the original`);
    assert.equal(small.height, 1000);
  }
});

test('shoot and collection edits stay staged until publish', async () => {
  const { site, signIn, close } = await fixture();
  try {
    const { admin, content, upload } = await signIn();
    const { id: shootId } = await (await admin('/shoots', 'POST', { title: 'Original shoot', date: '2026-09-01', published: true })).json() as Json;
    const { id: collectionId } = await (await admin('/collections', 'POST', { title: 'Original collection', published: true })).json() as Json;
    const jpeg = await jpegOf('#a3b3a8');
    const { id: photoId } = await (await upload('photos', shootId, jpeg, { alt: 'A frame in the original shoot' })).json() as Json;
    assert.equal((await admin(`/photos/${photoId}`, 'PATCH', { published: true })).status, 200);
    assert.equal((await admin(`/photos/${photoId}`, 'PATCH', { title: 'Internal draft', caption: 'Private planning note' })).status, 200);
    assert.equal((await admin(`/shoots/${shootId}`, 'PATCH', { title: 'Revised shoot', date: '2026-09-02' })).status, 200);
    assert.equal((await admin(`/collections/${collectionId}`, 'PATCH', { title: 'Revised collection', description: 'Chosen frames' })).status, 200);
    assert.equal((await admin(`/collections/${collectionId}/photos/${photoId}`, 'PUT', {})).status, 200);
    let catalog = await site();
    assert.equal(catalog.shoots[0].photos[0].title, '');
    assert.equal(catalog.shoots[0].photos[0].caption, '');
    assert.equal(catalog.shoots[0].title, 'Original shoot');
    assert.equal(catalog.shoots[0].date, '2026-09-01');
    assert.equal(catalog.collections[0].title, 'Original collection');
    assert.deepEqual(catalog.collections[0].photoIds, []);
    const privateCatalog = await content();
    assert.equal(privateCatalog.shoots[0].title, 'Revised shoot');
    assert.equal(privateCatalog.photos[0].title, 'Internal draft');
    assert.equal(privateCatalog.photos[0].caption, 'Private planning note');
    assert.equal(privateCatalog.photos[0].fileName, 'frame.jpg');
    assert.equal(privateCatalog.shoots[0].liveTitle, 'Original shoot');
    assert.equal(privateCatalog.collections[0].title, 'Revised collection');
    assert.deepEqual(privateCatalog.collections[0].photoIds, [photoId]);
    assert.deepEqual(privateCatalog.collections[0].livePhotoIds, []);
    const stagedPreview = await (await admin('/preview')).json() as PublicCatalog;
    assert.equal(stagedPreview.shoots.find(row => row.id === shootId)!.title, 'Revised shoot');
    assert.equal(stagedPreview.shoots.find(row => row.id === shootId)!.photos[0].id, photoId);

    assert.equal((await admin('/publish', 'POST')).status, 200);
    catalog = await site();
    assert.equal(catalog.shoots[0].title, 'Revised shoot');
    assert.equal(catalog.shoots[0].date, '2026-09-02');
    assert.equal(catalog.collections[0].title, 'Revised collection');
    assert.equal(catalog.collections[0].description, 'Chosen frames');
    assert.deepEqual(catalog.collections[0].photoIds, [photoId]);

    const { id: secondShootId } = await (await admin('/shoots', 'POST', { title: 'Second shoot', published: true })).json() as Json;
    const { id: secondPhotoId } = await (await upload('photos', secondShootId, jpeg, { alt: 'A second frame', name: 'second.jpg' })).json() as Json;
    assert.equal((await admin(`/photos/${secondPhotoId}`, 'PATCH', { published: true })).status, 200);
    assert.equal((await admin(`/collections/${collectionId}/photos/${secondPhotoId}`, 'PUT', { sortOrder: 1 })).status, 200);
    assert.equal((await admin('/publish', 'POST')).status, 200);
    assert.equal((await admin(`/collections/${collectionId}/order`, 'PUT', { photoIds: [photoId] })).status, 400);
    assert.equal((await admin(`/collections/${collectionId}/order`, 'PUT', { photoIds: [secondPhotoId, photoId] })).status, 200);
    assert.deepEqual((await site()).collections[0].photoIds, [photoId, secondPhotoId]);
    assert.equal((await admin('/publish', 'POST')).status, 200);
    assert.deepEqual((await site()).collections[0].photoIds, [secondPhotoId, photoId]);
    assert.equal((await admin(`/photos/${photoId}`, 'PATCH', { shootId: secondShootId, sortOrder: 1 })).status, 200);
    const shootPhotos = async (id: string) => (await site()).shoots.find(row => row.id === id)!.photos.map(row => row.id);
    assert.deepEqual(await shootPhotos(shootId), [photoId]);
    assert.deepEqual(await shootPhotos(secondShootId), [secondPhotoId]);
    const stagedPhoto = (await content()).photos.find(row => row.id === photoId)!;
    assert.equal(stagedPhoto.shootId, secondShootId);
    assert.equal(stagedPhoto.liveShootId, shootId);
    assert.equal((await admin('/publish', 'POST')).status, 200);
    assert.deepEqual(await shootPhotos(shootId), []);
    assert.deepEqual(await shootPhotos(secondShootId), [secondPhotoId, photoId]);
    assert.equal((await admin(`/shoots/${secondShootId}/order`, 'PUT', { photoIds: [secondPhotoId, secondPhotoId] })).status, 400);
    assert.equal((await admin(`/shoots/${secondShootId}/order`, 'PUT', { photoIds: [photoId, secondPhotoId] })).status, 200);
    assert.deepEqual(await shootPhotos(secondShootId), [secondPhotoId, photoId]);
    assert.equal((await admin('/publish', 'POST')).status, 200);
    assert.deepEqual(await shootPhotos(secondShootId), [photoId, secondPhotoId]);

    assert.equal((await admin(`/photos/${photoId}`, 'DELETE')).status, 409);
    assert.equal((await admin(`/collections/${collectionId}`, 'DELETE')).status, 409);
    assert.equal((await admin(`/shoots/${shootId}`, 'DELETE')).status, 409);
    assert.equal((await admin(`/photos/${photoId}`, 'PATCH', { approved: false })).status, 200);
    assert.equal((await admin(`/collections/${collectionId}`, 'PATCH', { approved: false })).status, 200);
    assert.equal((await admin(`/shoots/${shootId}`, 'PATCH', { approved: false })).status, 200);
    assert.equal((await admin('/publish', 'POST')).status, 200);
    assert.equal((await admin(`/photos/${photoId}`, 'DELETE')).status, 200);
    assert.equal((await admin(`/collections/${collectionId}`, 'DELETE')).status, 200);
    assert.equal((await admin(`/shoots/${shootId}`, 'DELETE')).status, 200);
  } finally { await close(); }
});

test('each publish with changes is recorded in the Content Room history', async () => {
  const { site, signIn, close } = await fixture();
  try {
    const { admin, content } = await signIn();
    const { id } = await (await admin('/shoots', 'POST', { title: 'History shoot' })).json() as Json;
    assert.equal((await admin(`/shoots/${id}`, 'PATCH', { approved: true })).status, 200);
    const published = await (await admin('/publish', 'POST')).json() as Json;
    assert.equal(published.published, 1);
    assert.match(published.note, /edit/);
    // A publish with nothing queued leaves the history alone.
    await admin('/publish', 'POST');
    const { history } = await content();
    assert.equal(history.length, 1);
    assert.equal(history[0].changes, 1);
    assert.equal(history[0].note, published.note);
    // The public catalog never exposes the history.
    assert.equal((await site() as unknown as Json).history, undefined);
  } finally { await close(); }
});

// ---- Alt-text drafts from a local vision model ---------------------------

/** A stand-in for llama-server's OpenAI-compatible API. */
async function fakeModel(reply: string) {
  const requests: Json[] = [];
  const server = http.createServer((request, response) => {
    if (request.url === '/health') return response.end('{"status":"ok"}');
    if (request.url === '/v1/models') return response.end(JSON.stringify({ data: [{ id: 'unsloth/Qwen3-VL-8B-Instruct-GGUF' }] }));
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      requests.push(JSON.parse(body));
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ choices: [{ message: { content: reply } }] }));
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests, close: () => new Promise(resolve => server.close(resolve)) };
}

test('model replies are tidied into plain alt text within 125 characters', () => {
  assert.equal(cleanSuggestion('"A photo of a batter swinging at the plate."'), 'A batter swinging at the plate');
  assert.equal(cleanSuggestion('Alt text: an image showing two dogs on a porch. They look happy.'), 'Two dogs on a porch');
  assert.equal(cleanSuggestion('  Runner   sliding into second base  '), 'Runner sliding into second base');
  const long = cleanSuggestion(`Players ${'walking across a wide green field '.repeat(6)}at dusk.`);
  assert.ok(long.length <= 125, long);
  assert.ok(!/[,\s]$/.test(long));
});

test('uploads without alt text get a drafted suggestion that is never saved as alt text', async () => {
  const model = await fakeModel('A photo of a warm brown studio backdrop.');
  const { root, db, signIn, close } = await fixture({ altTextUrl: model.url });
  try {
    const { admin, content, upload } = await signIn();
    assert.deepEqual(await (await admin('/alt-text')).json(), { available: true, model: 'Qwen3-VL-8B-Instruct-GGUF' });
    const { id: shootId } = await (await admin('/shoots', 'POST', { title: 'Studio session' })).json() as Json;
    const { id } = await (await upload('photos', shootId, await jpegOf('#8a6545'))).json() as Json;
    // Drafted in the background after the upload responds.
    const deadline = Date.now() + 5000;
    while (!(await content()).photos[0].altSuggestion && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
    const photo = (await content()).photos[0];
    assert.equal(photo.altSuggestion, 'A warm brown studio backdrop');
    assert.equal(photo.alt, '');
    const [request] = model.requests;
    assert.equal(request.messages[0].role, 'system');
    // The shoot title stays out of the prompt: models describe it as if it were visible.
    assert.doesNotMatch(JSON.stringify(request.messages), /Studio session/);
    assert.match(request.messages[1].content[1].image_url.url, /^data:image\/jpeg;base64,/);
    // A second request reuses the stored draft unless a fresh one is asked for.
    assert.equal(((await (await admin(`/photos/${id}/alt-suggestion`, 'POST', {})).json()) as Json).suggestion, 'A warm brown studio backdrop');
    assert.equal(model.requests.length, 1);
    await admin(`/photos/${id}/alt-suggestion`, 'POST', { fresh: true });
    assert.equal(model.requests.length, 2);
    // Uploads that arrive with alt text are left alone.
    await upload('photos', shootId, await jpegOf('#8a6545'), { alt: 'Given by the editor' });
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(model.requests.length, 2);
    // Curated photographs are read from public/media.
    await fs.mkdir(path.join(root, 'public/media/studio'), { recursive: true });
    await fs.writeFile(path.join(root, 'public/media/studio/frame-640.jpg'), await jpegOf('#445566'));
    const manifestPath = path.join(root, 'archive.json');
    const image = '/media/studio/frame-640.jpg';
    await fs.writeFile(manifestPath, JSON.stringify({ shoots: [{ id: 'curated', title: 'Curated', published: true, photos: [
      { id: 'curated-frame', alt: '', thumb: image, mid: image, full: image, width: 640, height: 400 },
    ] }] }));
    await seedFromManifest(db, manifestPath);
    const suggestion = await (await admin('/photos/curated-frame/alt-suggestion', 'POST', {})).json() as Json;
    assert.equal(suggestion.suggestion, 'A warm brown studio backdrop');
  } finally { await close(); await model.close(); }
});

test('an unreachable model reports itself unavailable instead of failing uploads', async () => {
  const { signIn, close } = await fixture({ altTextUrl: 'http://127.0.0.1:9' });
  try {
    const { admin, upload } = await signIn();
    assert.deepEqual(await (await admin('/alt-text')).json(), { available: false, model: '' });
    const { id: shootId } = await (await admin('/shoots', 'POST', { title: 'Offline model' })).json() as Json;
    const uploaded = await upload('photos', shootId, await jpegOf('#556677'));
    assert.equal(uploaded.status, 201);
    const { id } = await uploaded.json() as Json;
    const response = await admin(`/photos/${id}/alt-suggestion`, 'POST', {});
    assert.equal(response.status, 503);
    assert.match(((await response.json()) as Json).error, /npm run alt:model/);
  } finally { await close(); }
});
