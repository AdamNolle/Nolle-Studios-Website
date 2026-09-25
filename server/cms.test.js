import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import sharp from 'sharp';
import { createApp } from './app.js';
import { openDatabase } from './db.js';
import { seedFromManifest } from './seed.js';

const directories = [];
after(async () => { await Promise.all(directories.map(directory => fs.rm(directory, { recursive: true, force: true }))); });

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nolle-cms-test-'));
  directories.push(root);
  const settings = {
    root, production: false, databaseUrl: '', sqliteFile: path.join(root, 'cms.sqlite'),
    storageDriver: 'local', localMediaDir: path.join(root, 'media'), stagingDir: path.join(root, 'staging'),
    mediaBaseUrl: '/media', localAdminPassword: 'temporary-password-123', adminPasswordHash: '',
    sessionSecret: 'test-session-secret',
  };
  const db = await openDatabase(settings);
  const server = createApp({ db, settings }).listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    root, db, base,
    async close() { await new Promise(resolve => server.close(resolve)); await db.close(); },
  };
}

test('manifest import is curated, idempotent, and preserves CMS edits', async () => {
  const { root, db, base, close } = await fixture();
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
    await db.query('UPDATE photos SET published = 0 WHERE id = ?', ['frame-one']);
    await seedFromManifest(db, manifestPath);
    const site = await (await fetch(`${base}/api/site`)).json();
    assert.equal(site.shoots.length, 1);
    assert.equal(site.shoots[0].title, 'Edited title');
    assert.equal(site.shoots[0].photos[0].alt, 'A portrait');
    assert.ok(!JSON.stringify(site).includes('private-shoot'));
    const signIn = await fetch(`${base}/api/admin/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'temporary-password-123' }),
    });
    const cookie = signIn.headers.get('set-cookie').split(';')[0];
    const { csrfToken } = await signIn.json();
    const headers = { Cookie: cookie, 'X-CSRF-Token': csrfToken, 'Content-Type': 'application/json' };
    const unpublish = await fetch(`${base}/api/admin/photos/frame-one`, {
      method: 'PATCH', headers, body: JSON.stringify({ published: false }),
    });
    assert.equal(unpublish.status, 409);
    const deleteCurated = await fetch(`${base}/api/admin/photos/frame-one`, { method: 'DELETE', headers });
    assert.equal(deleteCurated.status, 409);
    const unpublishShoot = await fetch(`${base}/api/admin/shoots/public-shoot`, {
      method: 'PATCH', headers, body: JSON.stringify({ published: false }),
    });
    assert.equal(unpublishShoot.status, 409);
    await fs.writeFile(manifestPath, JSON.stringify({ shoots: [
      { id: 'public-shoot', title: 'Public shoot', date: '2026-09-24', published: true, photos: [] },
    ] }));
    const sync = await seedFromManifest(db, manifestPath);
    assert.equal(sync.removed, 1);
    const afterWithdrawal = await (await fetch(`${base}/api/site`)).json();
    assert.equal(afterWithdrawal.shoots[0].photos.length, 0);
    assert.equal(afterWithdrawal.shoots[0].title, 'Edited title');
  } finally { await close(); }
});

test('upload stays private until publish, strips EXIF, and unpublish removes public copies', async () => {
  const { root, base, close } = await fixture();
  try {
    const adminRedirect = await fetch(`${base}/admin`, { redirect: 'manual' });
    assert.equal(adminRedirect.status, 308);
    assert.equal(adminRedirect.headers.get('location'), '/admin/');
    const adminPage = await fetch(`${base}/admin/`, { redirect: 'manual' });
    assert.equal(adminPage.status, 200);
    assert.match(await adminPage.text(), /Content room/);
    const signIn = await fetch(`${base}/api/admin/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'temporary-password-123' }),
    });
    assert.equal(signIn.status, 200);
    const cookie = signIn.headers.get('set-cookie').split(';')[0];
    const { csrfToken } = await signIn.json();
    const admin = (endpoint, method = 'GET', body) => fetch(`${base}/api/admin${endpoint}`, {
      method, headers: { Cookie: cookie, 'X-CSRF-Token': csrfToken,
        ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) },
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    });

    const shootResponse = await admin('/shoots', 'POST', { title: 'Studio session', published: true });
    assert.equal(shootResponse.status, 201);
    const { id: shootId } = await shootResponse.json();

    const jpeg = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#c58d62' } })
      .jpeg().withExif({ IFD0: { Make: 'Sony', Model: 'A7 V' } }).toBuffer();
    assert.ok((await sharp(jpeg).metadata()).exif);
    const form = new FormData();
    form.append('shootId', shootId);
    form.append('alt', 'A warm studio frame');
    form.append('image', new Blob([jpeg], { type: 'image/jpeg' }), 'frame.jpg');
    const uploaded = await admin('/photos/upload', 'POST', form);
    const uploadResult = await uploaded.json();
    assert.equal(uploaded.status, 201, JSON.stringify(uploadResult));
    const { id: photoId } = uploadResult;
    assert.ok(photoId);
    const publicFile = path.join(root, 'media', 'photos', photoId, '640.jpg');
    const stagedFile = path.join(root, 'staging', 'photos', photoId, '640.jpg');
    assert.equal(await fs.stat(stagedFile).then(() => true), true);
    assert.equal(await fs.stat(publicFile).then(() => true).catch(() => false), false);
    let site = await (await fetch(`${base}/api/site`)).json();
    assert.equal(site.shoots[0].photos.length, 0);
    const rejected = await fetch(`${base}/api/admin/photos/${photoId}`, {
      method: 'PATCH', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ published: true }),
    });
    assert.equal(rejected.status, 403);

    assert.equal((await admin(`/photos/${photoId}`, 'PATCH', { published: true })).status, 200);
    const publishedBytes = await fs.readFile(publicFile);
    const publicResponse = await fetch(`${base}/media/photos/${photoId}/640.jpg`);
    assert.equal(publicResponse.status, 200);
    assert.match(publicResponse.headers.get('cache-control'), /max-age=300/);
    const publishedMeta = await sharp(publishedBytes).metadata();
    assert.equal(publishedMeta.exif, undefined);
    assert.equal(publishedMeta.xmp, undefined);
    site = await (await fetch(`${base}/api/site`)).json();
    assert.equal(site.shoots[0].photos.length, 1);
    assert.equal(site.shoots[0].photos[0].alt, 'A warm studio frame');

    assert.equal((await admin(`/photos/${photoId}`, 'PATCH', { published: false })).status, 200);
    assert.equal(await fs.stat(publicFile).then(() => true).catch(() => false), false);
    site = await (await fetch(`${base}/api/site`)).json();
    assert.equal(site.shoots[0].photos.length, 0);
    assert.equal((await admin('/logout', 'POST')).status, 200);
    assert.equal((await admin('/content')).status, 401);
  } finally { await close(); }
});
