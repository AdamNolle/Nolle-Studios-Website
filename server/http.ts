import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

/** An error whose message is safe to show the Content Room. */
export class HttpError extends Error {
  status: ContentfulStatusCode;
  constructor(status: ContentfulStatusCode, message: string) {
    super(message);
    this.status = status;
  }
}

export type Body = Record<string, unknown>;

/** A JSON object body; an empty body reads as {}. */
export async function readJson(c: Context): Promise<Body> {
  const text = await c.req.text();
  if (!text.trim()) return {};
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new HttpError(400, 'Invalid JSON request'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'Invalid JSON request');
  return value as Body;
}

export const text = (value: unknown, max = 500) => typeof value === 'string' ? value.trim().slice(0, max) : '';
export const flag = (value: unknown) => value === true || value === 1 || value === 'true' || value === '1' ? 1 : 0;
export const integer = (value: unknown, fallback = 0) => Number.isSafeInteger(Number(value)) ? Number(value) : fallback;

/**
 * Stream a raw request body to a private temporary file, stopping as soon as
 * it passes `limit`. Large videos never sit in memory.
 */
export async function receiveFile(c: Context, directory: string, limit: number, tooLarge: string) {
  const declared = Number(c.req.header('content-length'));
  if (Number.isFinite(declared) && declared > limit) throw new HttpError(413, tooLarge);
  const body = c.req.raw.body;
  if (!body) throw new HttpError(400, 'Choose a file to upload');
  await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, randomUUID());
  let size = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      size += chunk.length;
      done(size > limit ? new HttpError(413, tooLarge) : null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(body as import('node:stream/web').ReadableStream), meter, createWriteStream(file, { flags: 'wx', mode: 0o600 }));
  } catch (error) {
    await fs.rm(file, { force: true });
    throw error;
  }
  if (!size) {
    await fs.rm(file, { force: true });
    throw new HttpError(400, 'Choose a file to upload');
  }
  return { file, size };
}
