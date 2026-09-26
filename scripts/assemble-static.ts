import { createWriteStream } from 'node:fs';
import { copyFile, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

type Sizes = Record<string, unknown>;
type CatalogPhoto = { thumb?: unknown; mid?: unknown; full?: unknown; formats?: Record<string, Sizes>; video?: Sizes };
export interface StaticCatalog {
  shoots: { coverUrl?: unknown; photos?: CatalogPhoto[] }[];
  collections?: { coverUrl?: unknown; photos?: CatalogPhoto[] }[];
}

function referencedMedia(catalog: StaticCatalog) {
  if (!catalog || !Array.isArray(catalog.shoots)) throw new Error('The public catalog has no shoots array');
  const urls = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value === 'string' && value) urls.add(value);
  };
  const photoAssets = (photo: CatalogPhoto) => {
    if (!photo || typeof photo !== 'object') return;
    add(photo.thumb); add(photo.mid); add(photo.full);
    for (const sizes of Object.values(photo.formats || {})) {
      if (sizes && typeof sizes === 'object') Object.values(sizes).forEach(add);
    }
    if (photo.video && typeof photo.video === 'object') Object.values(photo.video).forEach(add);
  };
  for (const shoot of catalog.shoots) {
    add(shoot.coverUrl);
    for (const photo of shoot.photos || []) photoAssets(photo);
  }
  for (const collection of catalog.collections || []) {
    add(collection.coverUrl);
    for (const photo of collection.photos || []) photoAssets(photo);
  }
  return urls;
}

function localMediaPath(url: string) {
  if (/^https:\/\//i.test(url)) return null;
  if (!url.startsWith('/media/') || /[?#]/.test(url)) throw new Error(`Unsupported public media URL: ${url}`);
  let decoded: string;
  try { decoded = decodeURIComponent(url.slice(1)); }
  catch { throw new Error(`Malformed public media URL: ${url}`); }
  const parts = decoded.split('/');
  if (parts[0] !== 'media' || parts.length < 3 || parts.some(part => !part || part === '.' || part === '..' || part.includes('\\') || part.includes('\0'))) {
    throw new Error(`Unsafe public media URL: ${url}`);
  }
  return parts.join('/');
}

async function sourceFile(relative: string, roots: [string, boolean][]) {
  for (const [root, underMedia] of roots) {
    const candidate = path.join(root, underMedia ? relative.slice('media/'.length) : relative);
    try {
      const [base, file, stat] = await Promise.all([realpath(root), realpath(candidate), lstat(candidate)]);
      if (!file.startsWith(base + path.sep) || !stat.isFile()) throw new Error(`Media path is not a regular file: ${relative}`);
      return file;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return null;
}

async function downloadPublished(relative: string, destination: string, cmsUrl: URL) {
  const response = await fetch(new URL('/' + relative, cmsUrl), {
    redirect: 'error', signal: AbortSignal.timeout(300000),
  });
  if (!response.ok || !response.body) throw new Error(`Published media is missing: /${relative}`);
  await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), createWriteStream(destination, { flags: 'wx' }));
}

export async function assembleStatic({ catalog, distDir, publicDir, localMediaDir, cmsUrl }: {
  catalog: StaticCatalog; distDir: string; publicDir: string; localMediaDir: string; cmsUrl?: URL;
}) {
  if (!(await lstat(path.join(distDir, 'index.html')).catch(() => null))?.isFile()) {
    throw new Error('Build the static site before assembling its public media');
  }
  const assets = [...referencedMedia(catalog)].map(localMediaPath).filter((value): value is string => !!value);
  const roots: [string, boolean][] = [[publicDir, false], [localMediaDir, true]];
  const copies = await Promise.all(assets.map(async (relative): Promise<[string, string | null]> => [relative, await sourceFile(relative, roots)]));
  if (!cmsUrl && copies.some(([, source]) => !source)) {
    throw new Error(`Published media is missing: /${copies.find(([, source]) => !source)![0]}`);
  }
  const temporary = await mkdtemp(path.join(distDir, '.media-next-'));
  try {
    for (const [relative, source] of copies) {
      const destination = path.join(temporary, relative.slice('media/'.length));
      await mkdir(path.dirname(destination), { recursive: true });
      if (source) await copyFile(source, destination);
      else await downloadPublished(relative, destination, cmsUrl!);
    }
    await writeFile(path.join(temporary, 'archive.json'), JSON.stringify(catalog, null, 2) + '\n');
    await rm(path.join(distDir, 'media'), { recursive: true, force: true });
    await rename(temporary, path.join(distDir, 'media'));
    await rm(path.join(distDir, 'photos'), { recursive: true, force: true });
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
  return assets.length;
}

async function main() {
  const source = process.argv[2];
  if (!['manifest', 'cms'].includes(source)) throw new Error('Use manifest or cms as the catalog source');
  const publicDir = path.join(projectRoot, 'public');
  const localMediaDir = path.resolve(projectRoot, process.env.LOCAL_MEDIA_DIR || '.local/media');
  let catalog: StaticCatalog;
  let cmsUrl: URL | undefined;
  if (source === 'cms') {
    cmsUrl = new URL(process.env.CMS_URL || `http://127.0.0.1:${process.env.CMS_PORT || '8788'}/`);
    if (!['http:', 'https:'].includes(cmsUrl.protocol) || cmsUrl.username || cmsUrl.password) {
      throw new Error('CMS_URL must be an HTTP or HTTPS site URL without credentials');
    }
    const response = await fetch(new URL('/api/site', cmsUrl), { signal: AbortSignal.timeout(10000), headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`CMS catalog request failed: ${response.status}`);
    catalog = await response.json() as StaticCatalog;
  } else {
    catalog = JSON.parse(await readFile(path.join(publicDir, 'media/archive.json'), 'utf8'));
  }
  const count = await assembleStatic({ catalog, distDir: path.join(projectRoot, 'dist'), publicDir, localMediaDir, cmsUrl });
  console.log(`Static gallery assembled from ${source}: ${catalog.shoots.length} shoots, ${count} media files`);
}

if (import.meta.main) await main();
