import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

export const WIDTHS = [640, 960, 1600, 2400, 3200];
const allowedFormats = new Set(['jpeg', 'png', 'tiff', 'webp', 'avif', 'heif']);
const outputFormats = [
  ['avif', 'image/avif', { quality: 52, effort: 4 }],
  ['webp', 'image/webp', { quality: 82, effort: 5 }],
  ['jpeg', 'image/jpeg', { quality: 86, progressive: true }],
];

export function createStorage(settings) {
  const s3 = settings.storageDriver === 's3' ? new S3Client({
    region: settings.s3Region,
    endpoint: settings.s3Endpoint || undefined,
    forcePathStyle: settings.s3ForcePathStyle,
    credentials: { accessKeyId: settings.s3AccessKeyId, secretAccessKey: settings.s3SecretAccessKey },
  }) : null;

  function localPath(key) {
    if (!/^photos\/[a-f0-9-]{36}\/\d+\.(avif|webp|jpg)$/.test(key)) throw new Error('Invalid media key');
    return path.join(settings.localMediaDir, ...key.split('/'));
  }

  return {
    url(key) { return `${settings.mediaBaseUrl}/${key.split('/').map(encodeURIComponent).join('/')}`; },
    async put(key, bytes, contentType) {
      if (s3) {
        await s3.send(new PutObjectCommand({
          Bucket: settings.s3Bucket, Key: key, Body: bytes,
          ContentType: contentType, CacheControl: 'public, max-age=300, must-revalidate',
        }));
      } else {
        const destination = localPath(key);
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.writeFile(destination, bytes, { flag: 'wx' });
      }
    },
    async delete(key) {
      if (s3) await s3.send(new DeleteObjectCommand({ Bucket: settings.s3Bucket, Key: key }));
      else await fs.rm(localPath(key), { force: true });
    },
  };
}

export function createStaging(settings) {
  function location(key) {
    if (!/^photos\/[a-f0-9-]{36}\/\d+\.(avif|webp|jpg)$/.test(key)) throw new Error('Invalid staging key');
    return path.join(settings.stagingDir, ...key.split('/'));
  }
  return {
    async put(key, bytes) {
      const destination = location(key);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, bytes, { flag: 'wx' });
    },
    async read(key) { return fs.readFile(location(key)); },
    async delete(key) { await fs.rm(location(key), { force: true }); },
  };
}

export function variantKeys(photoId) {
  return WIDTHS.flatMap(width => ['avif', 'webp', 'jpg'].map(ext => `photos/${photoId}/${width}.${ext}`));
}

export async function publishVariants(photoId, staging, storage) {
  const uploaded = [];
  try {
    for (const key of variantKeys(photoId)) {
      const contentType = key.endsWith('.jpg') ? 'image/jpeg' : key.endsWith('.webp') ? 'image/webp' : 'image/avif';
      await storage.put(key, await staging.read(key), contentType);
      uploaded.push(key);
    }
  } catch (error) {
    await Promise.allSettled(uploaded.map(key => storage.delete(key)));
    throw error;
  }
}

export async function unpublishVariants(photoId, storage) {
  const results = await Promise.allSettled(variantKeys(photoId).map(key => storage.delete(key)));
  const failure = results.find(result => result.status === 'rejected');
  if (failure) throw failure.reason;
}

export async function buildVariants(input, photoId, staging, storage) {
  const metadata = await sharp(input, { limitInputPixels: 80_000_000 }).metadata();
  if (!allowedFormats.has(metadata.format)) {
    throw new Error('Upload an edited JPEG, PNG, TIFF, WebP, AVIF, or HEIF image. RAWs stay private.');
  }
  const rotated = [5, 6, 7, 8].includes(metadata.orientation);
  const width = rotated ? metadata.height : metadata.width;
  const height = rotated ? metadata.width : metadata.height;
  if (!width || !height || width < 300 || height < 300) throw new Error('Image must be at least 300 pixels on each side');

  const keys = [];
  const variants = { avif: {}, webp: {}, jpeg: {} };
  try {
    for (const [format, contentType, options] of outputFormats) {
      for (const targetWidth of WIDTHS) {
        // Sharp removes EXIF, GPS, XMP and other input metadata unless explicitly asked to retain it.
        const bytes = await sharp(input, { limitInputPixels: 80_000_000 })
          .rotate().resize({ width: targetWidth, withoutEnlargement: true })
          .toFormat(format, options).toBuffer();
        const extension = format === 'jpeg' ? 'jpg' : format;
        const key = `photos/${photoId}/${targetWidth}.${extension}`;
        await staging.put(key, bytes, contentType);
        keys.push(key);
        variants[format][targetWidth] = storage.url(key);
      }
    }
  } catch (error) {
    await Promise.allSettled(keys.map(key => staging.delete(key)));
    throw error;
  }
  return {
    width, height, keys,
    assets: {
      thumb: variants.jpeg[640], mid: variants.jpeg[1600], full: variants.jpeg[3200],
      formats: Object.fromEntries(Object.entries(variants).map(([format, widths]) => [format, {
        thumb: widths[640], mid: widths[1600], full: widths[3200], widths,
      }])),
    },
  };
}
