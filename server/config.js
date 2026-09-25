import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const production = process.env.NODE_ENV === 'production';
const storageDriver = process.env.STORAGE_DRIVER || 'local';

export const config = {
  root,
  production,
  port: Number(process.env.CMS_PORT || 8788),
  databaseUrl: process.env.DATABASE_URL || '',
  pgHost: process.env.PGHOST || '',
  pgPort: Number(process.env.PGPORT || 5432),
  pgUser: process.env.PGUSER || '',
  pgPassword: process.env.PGPASSWORD || '',
  pgDatabase: process.env.PGDATABASE || '',
  sqliteFile: path.resolve(root, process.env.SQLITE_FILE || '.local/cms.sqlite'),
  storageDriver,
  localMediaDir: path.resolve(root, process.env.LOCAL_MEDIA_DIR || '.local/media'),
  stagingDir: path.resolve(root, process.env.STAGING_DIR || '.local/staging'),
  mediaBaseUrl: (process.env.MEDIA_BASE_URL || '/media').replace(/\/$/, ''),
  s3Endpoint: process.env.S3_ENDPOINT || '',
  s3Region: process.env.S3_REGION || 'auto',
  s3Bucket: process.env.S3_BUCKET || '',
  s3AccessKeyId: process.env.S3_ACCESS_KEY_ID || '',
  s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
  s3ForcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  adminPasswordHash: process.env.CMS_ADMIN_PASSWORD_HASH || '',
  localAdminPassword: process.env.CMS_ADMIN_PASSWORD || '',
  sessionSecret: process.env.CMS_SESSION_SECRET || randomBytes(32).toString('hex'),
};

export function validateConfig(settings = config) {
  if (!['local', 's3'].includes(settings.storageDriver)) {
    throw new Error('STORAGE_DRIVER must be local or s3');
  }
  if (settings.production && !settings.databaseUrl && !settings.pgHost) {
    throw new Error('Production requires DATABASE_URL or PGHOST (PostgreSQL)');
  }
  if (settings.production && !process.env.CMS_SESSION_SECRET) {
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
    for (const key of ['s3Bucket', 's3AccessKeyId', 's3SecretAccessKey']) {
      if (!settings[key]) throw new Error(`S3 storage requires ${key}`);
    }
    if (!/^https?:\/\//.test(settings.mediaBaseUrl)) {
      throw new Error('S3 storage requires a public MEDIA_BASE_URL');
    }
  }
}
