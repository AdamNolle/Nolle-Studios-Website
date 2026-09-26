import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import { assembleStatic } from './assemble-static.ts';

test('static export includes published CMS media and excludes unused public files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nolle-static-export-'));
  try {
    const publicDir = path.join(root, 'public');
    const localMediaDir = path.join(root, 'local-media');
    const distDir = path.join(root, 'dist');
    await mkdir(path.join(publicDir, 'media', 'shoot'), { recursive: true });
    await mkdir(path.join(localMediaDir, 'photos', 'upload'), { recursive: true });
    await mkdir(path.join(distDir, 'media', 'shoot'), { recursive: true });
    await mkdir(path.join(distDir, 'photos'), { recursive: true });
    await writeFile(path.join(distDir, 'index.html'), '<html></html>');
    await writeFile(path.join(publicDir, 'media', 'shoot', 'live.jpg'), 'curated');
    await writeFile(path.join(distDir, 'media', 'shoot', 'hidden.jpg'), 'hidden');
    await writeFile(path.join(distDir, 'photos', 'old.jpg'), 'legacy');
    await writeFile(path.join(localMediaDir, 'photos', 'upload', '640.jpg'), 'uploaded');
    const catalog = { shoots: [{ id: 'shoot', coverUrl: '/media/shoot/live.jpg', photos: [
      { thumb: '/media/shoot/live.jpg', mid: '/media/shoot/live.jpg', full: '/media/shoot/live.jpg' },
      { thumb: '/media/photos/upload/640.jpg', mid: '/media/photos/upload/640.jpg', full: '/media/photos/upload/640.jpg' },
    ] }] };
    assert.equal(await assembleStatic({ catalog, publicDir, localMediaDir, distDir }), 2);
    assert.equal(await readFile(path.join(distDir, 'media', 'shoot', 'live.jpg'), 'utf8'), 'curated');
    assert.equal(await readFile(path.join(distDir, 'media', 'photos', 'upload', '640.jpg'), 'utf8'), 'uploaded');
    assert.deepEqual(JSON.parse(await readFile(path.join(distDir, 'media', 'archive.json'), 'utf8')), catalog);
    await assert.rejects(readFile(path.join(distDir, 'media', 'shoot', 'hidden.jpg')));
    await assert.rejects(readFile(path.join(distDir, 'photos', 'old.jpg')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('unsafe media URL stops export before replacing a built gallery', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nolle-static-export-'));
  try {
    const publicDir = path.join(root, 'public');
    const localMediaDir = path.join(root, 'local-media');
    const distDir = path.join(root, 'dist');
    await mkdir(path.join(distDir, 'media'), { recursive: true });
    await writeFile(path.join(distDir, 'index.html'), '<html></html>');
    await writeFile(path.join(distDir, 'media', 'archive.json'), 'previous build');
    const catalog = { shoots: [{ photos: [{ thumb: '/media/../private.jpg' }] }] };
    await assert.rejects(assembleStatic({ catalog, publicDir, localMediaDir, distDir }), /Unsafe public media URL/);
    assert.equal(await readFile(path.join(distDir, 'media', 'archive.json'), 'utf8'), 'previous build');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('static export fetches published uploads when CMS media is on another host', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nolle-static-export-'));
  const server = http.createServer((request, response) => {
    if (request.url === '/media/photos/upload/640.jpg') return response.end('remote public photo');
    response.writeHead(404).end();
  });
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const distDir = path.join(root, 'dist');
    await mkdir(distDir);
    await writeFile(path.join(distDir, 'index.html'), '<html></html>');
    const catalog = { shoots: [{ photos: [
      { thumb: '/media/photos/upload/640.jpg', mid: '/media/photos/upload/640.jpg', full: '/media/photos/upload/640.jpg' },
    ] }] };
    const count = await assembleStatic({ catalog, distDir, publicDir: path.join(root, 'public'),
      localMediaDir: path.join(root, 'local-media'), cmsUrl: new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`) });
    assert.equal(count, 1);
    assert.equal(await readFile(path.join(distDir, 'media', 'photos', 'upload', '640.jpg'), 'utf8'), 'remote public photo');
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});
