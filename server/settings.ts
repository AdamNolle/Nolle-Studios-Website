import path from 'node:path';

export interface Settings {
  root: string;
  production: boolean;
  port: number;
  databaseUrl: string;
  pgHost: string;
  pgPort: number;
  pgUser: string;
  pgPassword: string;
  pgDatabase: string;
  sqliteFile: string;
  storageDriver: 'local' | 's3';
  localMediaDir: string;
  stagingDir: string;
  /** Built Content Room (vite build --mode admin). */
  adminDir: string;
  mediaBaseUrl: string;
  siteUrl: string;
  s3Endpoint: string;
  s3Region: string;
  s3Bucket: string;
  s3AccessKeyId: string;
  s3SecretAccessKey: string;
  s3ForcePathStyle: boolean;
  adminPasswordHash: string;
  localAdminPassword: string;
  sessionSecret: string;
  /** OpenAI-compatible vision endpoint (llama-server) for alt-text drafts; empty disables. */
  altTextUrl: string;
  altTextModel: string;
  /** Draft alt text in the background after each upload. */
  altTextAuto: boolean;
}

/** Local-development defaults rooted at a directory; tests override what they need. */
export function localSettings(root: string, overrides: Partial<Settings> = {}): Settings {
  return {
    root, production: false, port: 8788,
    databaseUrl: '', pgHost: '', pgPort: 5432, pgUser: '', pgPassword: '', pgDatabase: '',
    sqliteFile: path.join(root, '.local/cms.sqlite'),
    storageDriver: 'local',
    localMediaDir: path.join(root, '.local/media'),
    stagingDir: path.join(root, '.local/staging'),
    adminDir: path.join(root, 'dist-admin'),
    mediaBaseUrl: '/media', siteUrl: '',
    s3Endpoint: '', s3Region: 'auto', s3Bucket: '', s3AccessKeyId: '', s3SecretAccessKey: '', s3ForcePathStyle: false,
    adminPasswordHash: '', localAdminPassword: '', sessionSecret: '',
    altTextUrl: '', altTextModel: '', altTextAuto: true,
    ...overrides,
  };
}
