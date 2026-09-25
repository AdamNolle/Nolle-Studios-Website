import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';

const schema = [
  `CREATE TABLE IF NOT EXISTS shoots (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '', shot_date TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0,
    published INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS collections (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0,
    published INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS photos (
    id TEXT PRIMARY KEY, shoot_id TEXT REFERENCES shoots(id) ON DELETE SET NULL,
    title TEXT NOT NULL DEFAULT '', alt TEXT NOT NULL DEFAULT '',
    caption TEXT NOT NULL DEFAULT '', width INTEGER NOT NULL, height INTEGER NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0, published INTEGER NOT NULL DEFAULT 0,
    is_cover INTEGER NOT NULL DEFAULT 0, assets_json TEXT NOT NULL,
    storage_prefix TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS collection_photos (
    collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(collection_id, photo_id)
  )`,
  `CREATE TABLE IF NOT EXISTS admin_sessions (
    token_hash TEXT PRIMARY KEY, csrf_token TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_photos_shoot ON photos(shoot_id, sort_order)',
  'CREATE INDEX IF NOT EXISTS idx_collection_photos ON collection_photos(collection_id, sort_order)',
];

function pgSql(sql) {
  let number = 0;
  return sql.replace(/\?/g, () => `$${++number}`);
}

export async function openDatabase(settings) {
  if (settings.databaseUrl || settings.pgHost) {
    const options = settings.databaseUrl ? { connectionString: settings.databaseUrl } : {
      host: settings.pgHost, port: settings.pgPort, user: settings.pgUser,
      password: settings.pgPassword, database: settings.pgDatabase,
    };
    const pool = new pg.Pool({ ...options, max: 10 });
    const db = {
      dialect: 'postgres',
      async query(sql, params = []) { return (await pool.query(pgSql(sql), params)).rows; },
      async close() { await pool.end(); },
    };
    try { for (const statement of schema) await db.query(statement); }
    catch (error) { await pool.end(); throw error; }
    return db;
  }

  fs.mkdirSync(path.dirname(settings.sqliteFile), { recursive: true });
  const sqlite = new DatabaseSync(settings.sqliteFile);
  sqlite.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  for (const statement of schema) sqlite.exec(statement);
  return {
    dialect: 'sqlite',
    async query(sql, params = []) {
      const statement = sqlite.prepare(sql);
      if (!/^\s*(SELECT|WITH|PRAGMA)/i.test(sql) && !/\bRETURNING\b/i.test(sql)) {
        statement.run(...params);
        return [];
      }
      return statement.all(...params);
    },
    async close() { sqlite.close(); },
  };
}

export const now = () => new Date().toISOString();

export function slugify(value) {
  return String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

export async function uniqueSlug(db, table, title, id) {
  const base = slugify(title) || 'untitled';
  let slug = base;
  let suffix = 2;
  while ((await db.query(`SELECT id FROM ${table} WHERE slug = ? AND id <> ?`, [slug, id])).length) {
    slug = `${base}-${suffix++}`;
  }
  return slug;
}
