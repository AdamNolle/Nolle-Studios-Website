import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { Metadata } from 'sharp';
import { AwsClient } from 'aws4fetch';
import type { Settings } from './settings.ts';

export const WIDTHS = [640, 960, 1600, 2400, 3200] as const;
const allowedFormats = new Set(['jpeg', 'png', 'tiff', 'webp', 'avif', 'heif']);
const outputFormats: ['avif' | 'webp' | 'jpeg', Record<string, unknown>][] = [
  ['avif', { quality: 52, effort: 4 }],
  ['webp', { quality: 82, effort: 5 }],
  ['jpeg', { quality: 86, progressive: true, mozjpeg: true }],
];
const mediaKey = /^(?:photos\/[a-f0-9-]{36}\/\d+\.(?:avif|webp|jpg)|videos\/[a-f0-9-]{36}\/(?:720|1080)\.(?:mp4|webm))$/;
const PUBLIC_CACHE = 'public, max-age=300, must-revalidate';

export interface ImageAssets {
  thumb: string; mid: string; full: string;
  formats: Record<string, { thumb: string; mid: string; full: string; widths: Record<string, string> }>;
}

export interface Storage {
  url(key: string): string;
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  putFile(key: string, source: string, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface Staging {
  put(key: string, bytes: Buffer): Promise<void>;
  putFile(key: string, source: string): Promise<void>;
  read(key: string): Promise<Buffer>;
  path(key: string): string;
  delete(key: string): Promise<void>;
}

type StorageSettings = Pick<Settings, 'storageDriver' | 'localMediaDir' | 'mediaBaseUrl' | 's3Endpoint' | 's3Region' | 's3Bucket' | 's3AccessKeyId' | 's3SecretAccessKey' | 's3ForcePathStyle'>;

/** Write through a temporary file so readers never see a partial object. */
async function atomicLocal(destination: string, write: (temporary: string) => Promise<void>, link = false) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    await write(temporary);
    // Staging links (keeping exclusive-create semantics); public storage renames over retries.
    if (link) await fs.link(temporary, destination);
    else await fs.rename(temporary, destination);
  } finally { await fs.rm(temporary, { force: true }); }
}

function s3Client(settings: StorageSettings) {
  const aws = new AwsClient({
    accessKeyId: settings.s3AccessKeyId, secretAccessKey: settings.s3SecretAccessKey,
    service: 's3', region: settings.s3Region,
  });
  const endpoint = new URL(settings.s3Endpoint || `https://s3.${settings.s3Region}.amazonaws.com`);
  const objectUrl = (key: string) => {
    const encoded = key.split('/').map(encodeURIComponent).join('/');
    return settings.s3ForcePathStyle
      ? `${endpoint.origin}/${settings.s3Bucket}/${encoded}`
      : `${endpoint.protocol}//${settings.s3Bucket}.${endpoint.host}/${encoded}`;
  };
  async function send(key: string, init: RequestInit & { duplex?: 'half' }) {
    const response = await aws.fetch(objectUrl(key), init);
    if (!response.ok && !(init.method === 'DELETE' && response.status === 404)) {
      throw new Error(`Storage ${init.method} ${key} failed: ${response.status}`);
    }
    await response.body?.cancel();
  }
  return { send };
}

export function createStorage(settings: StorageSettings): Storage {
  const s3 = settings.storageDriver === 's3' ? s3Client(settings) : null;
  const localPath = (key: string) => {
    if (!mediaKey.test(key)) throw new Error('Invalid media key');
    return path.join(settings.localMediaDir, ...key.split('/'));
  };
  return {
    url: key => `${settings.mediaBaseUrl}/${key.split('/').map(encodeURIComponent).join('/')}`,
    async put(key, bytes, contentType) {
      if (s3) {
        await s3.send(key, { method: 'PUT', body: new Uint8Array(bytes), headers: { 'Content-Type': contentType, 'Cache-Control': PUBLIC_CACHE } });
      } else {
        await atomicLocal(localPath(key), temporary => fs.writeFile(temporary, bytes, { flag: 'wx' }));
      }
    },
    async putFile(key, source, contentType) {
      if (!mediaKey.test(key)) throw new Error('Invalid media key');
      if (s3) {
        const { size } = await fs.stat(source);
        await s3.send(key, {
          method: 'PUT', duplex: 'half', body: Readable.toWeb(createReadStream(source)) as ReadableStream,
          headers: { 'Content-Type': contentType, 'Content-Length': String(size), 'Cache-Control': PUBLIC_CACHE },
        });
      } else {
        await atomicLocal(localPath(key), temporary => fs.copyFile(source, temporary, fs.constants.COPYFILE_EXCL));
      }
    },
    async delete(key) {
      if (s3) await s3.send(key, { method: 'DELETE' });
      else await fs.rm(localPath(key), { force: true });
    },
  };
}

export function createStaging(settings: Pick<Settings, 'stagingDir'>): Staging {
  const location = (key: string) => {
    if (!mediaKey.test(key)) throw new Error('Invalid staging key');
    return path.join(settings.stagingDir, ...key.split('/'));
  };
  return {
    put: (key, bytes) => atomicLocal(location(key), temporary => fs.writeFile(temporary, bytes, { flag: 'wx' }), true),
    putFile: (key, source) => atomicLocal(location(key), temporary => fs.copyFile(source, temporary, fs.constants.COPYFILE_EXCL), true),
    read: key => fs.readFile(location(key)),
    path: location,
    delete: key => fs.rm(location(key), { force: true }),
  };
}

export function variantKeys(photoId: string, kind = 'image') {
  const imageKeys = WIDTHS.flatMap(width => ['avif', 'webp', 'jpg'].map(ext => `photos/${photoId}/${width}.${ext}`));
  return kind === 'video' ? [...imageKeys, `videos/${photoId}/720.mp4`, `videos/${photoId}/1080.mp4`, `videos/${photoId}/720.webm`] : imageKeys;
}

const contentType = (key: string) =>
  key.endsWith('.jpg') ? 'image/jpeg' : key.endsWith('.webp') ? 'image/webp' :
    key.endsWith('.mp4') ? 'video/mp4' : key.endsWith('.webm') ? 'video/webm' : 'image/avif';

async function copyVariant(key: string, staging: Staging, storage: Storage) {
  if (key.startsWith('videos/')) await storage.putFile(key, staging.path(key), contentType(key));
  else await storage.put(key, await staging.read(key), contentType(key));
}

export async function publishVariants(photoId: string, staging: Staging, storage: Storage, kind = 'image') {
  const uploaded: string[] = [];
  try {
    for (const key of variantKeys(photoId, kind)) {
      await copyVariant(key, staging, storage);
      uploaded.push(key);
    }
  } catch (error) {
    await Promise.allSettled(uploaded.map(key => storage.delete(key)));
    throw error;
  }
}

export async function unpublishVariants(photoId: string, staging: Staging, storage: Storage, kind = 'image') {
  const keys = variantKeys(photoId, kind);
  const results = await Promise.allSettled(keys.map(key => storage.delete(key)));
  const failure = results.find(result => result.status === 'rejected');
  if (failure) {
    // The database still marks this photo live. Restore every variant we can
    // before returning the error, including keys whose delete outcome is uncertain.
    await Promise.allSettled(keys.map(key => copyVariant(key, staging, storage)));
    throw (failure as PromiseRejectedResult).reason;
  }
}

/** Build every responsive variant. `input` is a file path or bytes. */
export async function buildVariants(input: string | Buffer, photoId: string, staging: Staging, storage: Storage) {
  const open = () => sharp(input, { limitInputPixels: 80_000_000 });
  let metadata: Metadata;
  try { metadata = await open().metadata(); }
  catch { throw new Error('Upload an edited JPEG, PNG, TIFF, WebP, AVIF, or HEIF image.'); }
  if (!metadata.format || !allowedFormats.has(metadata.format)) {
    throw new Error('Upload an edited JPEG, PNG, TIFF, WebP, AVIF, or HEIF image. RAWs stay private.');
  }
  const rotated = [5, 6, 7, 8].includes(metadata.orientation ?? 1);
  const width = rotated ? metadata.height : metadata.width;
  const height = rotated ? metadata.width : metadata.height;
  if (!width || !height || width < 300 || height < 300) throw new Error('Image must be at least 300 pixels on each side');

  const keys: string[] = [];
  const variants: Record<string, Record<string, string>> = { avif: {}, webp: {}, jpeg: {} };
  try {
    // Decode the original once into an oriented, 8-bit sRGB master no wider
    // than the largest variant. Every encode then starts from those pixels,
    // so memory stays bounded (~20 MB) however large the upload was.
    const { data, info } = await open().rotate().toColourspace('srgb')
      .resize({ width: WIDTHS.at(-1), withoutEnlargement: true }).raw().toBuffer({ resolveWithObject: true });
    const master = () => sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } });
    for (const [format, options] of outputFormats) {
      for (const targetWidth of WIDTHS) {
        // Raw pixels carry no EXIF, GPS or XMP, so nothing private reaches the output.
        const bytes = await master().resize({ width: targetWidth, withoutEnlargement: true }).toFormat(format, options).toBuffer();
        const key = `photos/${photoId}/${targetWidth}.${format === 'jpeg' ? 'jpg' : format}`;
        await staging.put(key, bytes);
        keys.push(key);
        variants[format][targetWidth] = storage.url(key);
      }
    }
  } catch (error) {
    await Promise.allSettled(keys.map(key => staging.delete(key)));
    throw error;
  }
  const assets: ImageAssets = {
    thumb: variants.jpeg[640], mid: variants.jpeg[1600], full: variants.jpeg[3200],
    formats: Object.fromEntries(Object.entries(variants).map(([format, widths]) => [format, {
      thumb: widths[640], mid: widths[1600], full: widths[3200], widths,
    }])),
  };
  return { width, height, keys, assets };
}
