import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { localSettings } from './settings.ts';
import type { Settings } from './settings.ts';

// Environment variables are loaded by `node --env-file-if-exists=.env`.
const env = process.env;
const root = path.resolve(import.meta.dirname, '..');
const production = env.NODE_ENV === 'production';

function localSessionSecret() {
  const file = path.join(root, '.local/cms-session-secret');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    const saved = fs.readFileSync(file, 'utf8').trim();
    if (saved.length >= 32) return saved;
    throw new Error('Local CMS session secret is invalid');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const secret = randomBytes(32).toString('hex');
  try { fs.writeFileSync(file, secret, { flag: 'wx', mode: 0o600 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    return fs.readFileSync(file, 'utf8').trim();
  }
  return secret;
}

const resolved = (value: string | undefined, fallback: string) => path.resolve(root, value || fallback);

export const config: Settings = localSettings(root, {
  production,
  port: Number(env.CMS_PORT || 8788),
  databaseUrl: env.DATABASE_URL || '',
  pgHost: env.PGHOST || '',
  pgPort: Number(env.PGPORT || 5432),
  pgUser: env.PGUSER || '',
  pgPassword: env.PGPASSWORD || '',
  pgDatabase: env.PGDATABASE || '',
  sqliteFile: resolved(env.SQLITE_FILE, '.local/cms.sqlite'),
  storageDriver: (env.STORAGE_DRIVER || 'local') as Settings['storageDriver'],
  localMediaDir: resolved(env.LOCAL_MEDIA_DIR, '.local/media'),
  stagingDir: resolved(env.STAGING_DIR, '.local/staging'),
  adminDir: resolved(env.ADMIN_DIR, 'dist-admin'),
  mediaBaseUrl: (env.MEDIA_BASE_URL || '/media').replace(/\/$/, ''),
  siteUrl: env.SITE_URL || '',
  s3Endpoint: env.S3_ENDPOINT || '',
  s3Region: env.S3_REGION || 'auto',
  s3Bucket: env.S3_BUCKET || '',
  s3AccessKeyId: env.S3_ACCESS_KEY_ID || '',
  s3SecretAccessKey: env.S3_SECRET_ACCESS_KEY || '',
  s3ForcePathStyle: env.S3_FORCE_PATH_STYLE === 'true',
  adminPasswordHash: env.CMS_ADMIN_PASSWORD_HASH || '',
  localAdminPassword: env.CMS_ADMIN_PASSWORD || '',
  sessionSecret: env.CMS_SESSION_SECRET || (production ? randomBytes(32).toString('hex') : localSessionSecret()),
  // Local development expects `npm run alt:model`; production opts in explicitly.
  altTextUrl: (env.ALT_TEXT_URL ?? (production ? '' : 'http://127.0.0.1:8790')).replace(/\/$/, ''),
  altTextModel: env.ALT_TEXT_MODEL || '',
  altTextAuto: env.ALT_TEXT_AUTO !== 'false',
});

export function validateConfig(settings: Settings = config) {
  if (!['local', 's3'].includes(settings.storageDriver)) {
    throw new Error('STORAGE_DRIVER must be local or s3');
  }
  if (settings.production && !settings.databaseUrl && !settings.pgHost) {
    throw new Error('Production requires DATABASE_URL or PGHOST (PostgreSQL)');
  }
  if (settings.production && !env.CMS_SESSION_SECRET) {
    throw new Error('Production requires CMS_SESSION_SECRET');
  }
  if (settings.production && settings.sessionSecret.length < 32) {
    throw new Error('CMS_SESSION_SECRET must be at least 32 characters');
  }
  if (!settings.adminPasswordHash && !(settings.localAdminPassword && !settings.production)) {
    throw new Error('Set CMS_ADMIN_PASSWORD_HASH (or CMS_ADMIN_PASSWORD for local development)');
  }
  if (settings.adminPasswordHash && !/^scrypt\$[a-f0-9]{32,}\$[a-f0-9]{128}$/i.test(settings.adminPasswordHash)) {
    throw new Error('CMS_ADMIN_PASSWORD_HASH has an invalid format');
  }
  if (settings.storageDriver === 's3') {
    for (const key of ['s3Bucket', 's3AccessKeyId', 's3SecretAccessKey'] as const) {
      if (!settings[key]) throw new Error(`S3 storage requires ${key}`);
    }
    if (!/^https?:\/\//.test(settings.mediaBaseUrl)) throw new Error('S3 storage requires a public MEDIA_BASE_URL');
  }
  for (const [name, value, rootOnly] of [['SITE_URL', settings.siteUrl, true], ['ALT_TEXT_URL', settings.altTextUrl, false]] as const) {
    if (!value) continue;
    let url: URL | undefined;
    try { url = new URL(value); } catch { /* Reported below. */ }
    if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
        (rootOnly && (url.pathname !== '/' || url.search || url.hash))) {
      throw new Error(`${name} must be an HTTP or HTTPS ${rootOnly ? 'site root' : 'URL'}`);
    }
  }
}
