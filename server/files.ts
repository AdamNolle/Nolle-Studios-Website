import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { Context } from 'hono';

const TYPES: Record<string, string> = {
  '.avif': 'image/avif', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.gif': 'image/gif',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.json': 'application/json; charset=utf-8',
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8',
};

const typeOf = (file: string) => TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';

/** Resolve `relative` under `root`, refusing anything that escapes it. */
export function within(root: string, relative: string): string | null {
  let decoded: string;
  try { decoded = decodeURIComponent(relative); } catch { return null; }
  if (decoded.includes('\0')) return null;
  const base = path.resolve(root);
  const file = path.resolve(base, '.' + path.posix.normalize('/' + decoded.replaceAll('\\', '/')));
  return file.startsWith(base + path.sep) ? file : null;
}

/**
 * Stream a regular file with byte-range support (video seeking needs it).
 * Returns null when the file does not exist so callers can fall through.
 */
export async function sendFile(c: Context, file: string, headers: Record<string, string> = {}): Promise<Response | null> {
  let stat;
  try { stat = await fs.stat(file); } catch { return null; }
  if (!stat.isFile()) return null;
  const base: Record<string, string> = { 'Content-Type': typeOf(file), 'Accept-Ranges': 'bytes', 'Last-Modified': stat.mtime.toUTCString(), ...headers };
  const header = c.req.header('range');
  let start = 0, end = stat.size - 1, status = 200;
  if (header) {
    const range = /^bytes=(\d*)-(\d*)$/.exec(header);
    if (!range || (!range[1] && !range[2])) return c.body(null, 416, { ...base, 'Content-Range': `bytes */${stat.size}` });
    if (!range[1]) start = Math.max(0, stat.size - Number(range[2]));
    else {
      start = Number(range[1]);
      if (range[2]) end = Math.min(end, Number(range[2]));
    }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= stat.size) {
      return c.body(null, 416, { ...base, 'Content-Range': `bytes */${stat.size}` });
    }
    status = 206;
    base['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
  }
  base['Content-Length'] = String(end - start + 1);
  if (c.req.method === 'HEAD') return c.body(null, status as 200, base);
  const stream = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream;
  return c.body(stream, status as 200, base);
}
