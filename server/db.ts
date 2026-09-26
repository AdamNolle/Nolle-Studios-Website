import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';
import type { Settings } from './settings.ts';

export type SqlValue = string | number | null;
export type Row = Record<string, unknown>;

export interface Db {
  dialect: 'postgres' | 'sqlite';
  query<T = Row>(sql: string, params?: SqlValue[]): Promise<T[]>;
  close(): Promise<void>;
}

export interface ShootRow {
  id: string; title: string; slug: string; description: string; shot_date: string; location: string;
  sort_order: number; published: number; approved: number; created_at: string; updated_at: string;
  live_title: string | null; live_slug: string | null; live_description: string | null;
  live_shot_date: string | null; live_location: string | null; live_sort_order: number | null;
}

export interface PhotoRow {
  id: string; shoot_id: string | null; title: string; alt: string; caption: string;
  width: number; height: number; kind: string; duration: number; video_assets_json: string;
  sort_order: number; published: number; approved: number; is_cover: number;
  assets_json: string; storage_prefix: string; created_at: string; updated_at: string;
  live_alt: string | null; live_shoot_id: string | null; live_sort_order: number | null; live_is_cover: number | null;
  file_name: string; alt_suggestion: string;
}

export interface CollectionRow {
  id: string; title: string; slug: string; description: string; sort_order: number;
  published: number; approved: number; created_at: string; updated_at: string;
  live_title: string | null; live_slug: string | null; live_description: string | null;
  live_sort_order: number | null; live_photo_ids_json: string | null;
}

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
    kind TEXT NOT NULL DEFAULT 'image', duration REAL NOT NULL DEFAULT 0,
    video_assets_json TEXT NOT NULL DEFAULT '{}',
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
  `CREATE TABLE IF NOT EXISTS manifest_shoots (
    shoot_id TEXT PRIMARY KEY REFERENCES shoots(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS publish_log (
    id TEXT PRIMARY KEY, created_at TEXT NOT NULL, changes INTEGER NOT NULL DEFAULT 0,
    added INTEGER NOT NULL DEFAULT 0, removed INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS admin_sessions (
    token_hash TEXT PRIMARY KEY, csrf_token TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_photos_shoot ON photos(shoot_id, sort_order)',
  'CREATE INDEX IF NOT EXISTS idx_collection_photos ON collection_photos(collection_id, sort_order)',
];

async function columnsOf(db: Db, table: string): Promise<Set<string>> {
  if (db.dialect === 'postgres') {
    const rows = await db.query<{ column_name: string }>('SELECT column_name FROM information_schema.columns WHERE table_name = ?', [table]);
    return new Set(rows.map(row => row.column_name));
  }
  return new Set((await db.query<{ name: string }>(`PRAGMA table_info(${table})`)).map(row => row.name));
}

async function addColumn(db: Db, table: string, existing: Set<string>, name: string, definition: string) {
  if (existing.has(name)) return;
  await db.query(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  existing.add(name);
}

// Older databases gain the approval queue, the live (published) copy of each
// editable field, video metadata, and the columns the Content Room reads.
async function migrate(db: Db) {
  for (const table of ['shoots', 'photos', 'collections']) {
    await addColumn(db, table, await columnsOf(db, table), 'approved', 'INTEGER');
    // Existing published work stays approved when an older database is opened.
    await db.query(`UPDATE ${table} SET approved = published WHERE approved IS NULL`);
  }
  const photoColumns = await columnsOf(db, 'photos');
  for (const [name, definition] of [
    ['kind', "TEXT NOT NULL DEFAULT 'image'"],
    ['duration', 'REAL NOT NULL DEFAULT 0'],
    ['video_assets_json', "TEXT NOT NULL DEFAULT '{}'"],
    ['live_alt', 'TEXT'], ['live_shoot_id', 'TEXT'], ['live_sort_order', 'INTEGER'], ['live_is_cover', 'INTEGER'],
    ['file_name', "TEXT NOT NULL DEFAULT ''"],
    ['alt_suggestion', "TEXT NOT NULL DEFAULT ''"],
  ] as const) await addColumn(db, 'photos', photoColumns, name, definition);
  await db.query('UPDATE photos SET live_alt = alt WHERE live_alt IS NULL');
  await db.query('UPDATE photos SET live_shoot_id = shoot_id WHERE live_shoot_id IS NULL');
  await db.query('UPDATE photos SET live_sort_order = sort_order WHERE live_sort_order IS NULL');
  await db.query('UPDATE photos SET live_is_cover = is_cover WHERE live_is_cover IS NULL');
  const live: [string, [string, string | null][]][] = [
    ['shoots', [['live_title', 'title'], ['live_slug', 'slug'], ['live_description', 'description'],
      ['live_shot_date', 'shot_date'], ['live_location', 'location'], ['live_sort_order', 'sort_order']]],
    ['collections', [['live_title', 'title'], ['live_slug', 'slug'], ['live_description', 'description'],
      ['live_sort_order', 'sort_order'], ['live_photo_ids_json', null]]],
  ];
  for (const [table, columns] of live) {
    const existing = await columnsOf(db, table);
    for (const [name, source] of columns) {
      await addColumn(db, table, existing, name, name.endsWith('sort_order') ? 'INTEGER' : 'TEXT');
      if (source) await db.query(`UPDATE ${table} SET ${name} = ${source} WHERE ${name} IS NULL`);
    }
  }
  const collections = await db.query<{ id: string }>('SELECT id FROM collections WHERE live_photo_ids_json IS NULL');
  for (const collection of collections) {
    const links = await db.query<{ photo_id: string }>('SELECT photo_id FROM collection_photos WHERE collection_id = ? ORDER BY sort_order ASC', [collection.id]);
    await db.query('UPDATE collections SET live_photo_ids_json = ? WHERE id = ?', [JSON.stringify(links.map(link => link.photo_id)), collection.id]);
  }
}

const pgSql = (sql: string) => {
  let number = 0;
  return sql.replace(/\?/g, () => `$${++number}`);
};

export async function openDatabase(settings: Pick<Settings, 'databaseUrl' | 'pgHost' | 'pgPort' | 'pgUser' | 'pgPassword' | 'pgDatabase' | 'sqliteFile'>): Promise<Db> {
  if (settings.databaseUrl || settings.pgHost) {
    const pool = new pg.Pool({
      ...(settings.databaseUrl ? { connectionString: settings.databaseUrl } : {
        host: settings.pgHost, port: settings.pgPort, user: settings.pgUser,
        password: settings.pgPassword, database: settings.pgDatabase,
      }),
      max: 10,
    });
    const db: Db = {
      dialect: 'postgres',
      async query<T>(sql: string, params: SqlValue[] = []) { return (await pool.query(pgSql(sql), params)).rows as T[]; },
      async close() { await pool.end(); },
    };
    try { for (const statement of schema) await db.query(statement); await migrate(db); }
    catch (error) { await pool.end(); throw error; }
    return db;
  }

  fs.mkdirSync(path.dirname(settings.sqliteFile), { recursive: true });
  const sqlite = new DatabaseSync(settings.sqliteFile);
  sqlite.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  for (const statement of schema) sqlite.exec(statement);
  // Prepared statements are reused: the Content Room repeats a small set of queries.
  const statements = new Map<string, ReturnType<DatabaseSync['prepare']>>();
  const db: Db = {
    dialect: 'sqlite',
    async query<T>(sql: string, params: SqlValue[] = []) {
      let statement = statements.get(sql);
      if (!statement) { statement = sqlite.prepare(sql); statements.set(sql, statement); }
      if (!/^\s*(SELECT|WITH|PRAGMA)/i.test(sql) && !/\bRETURNING\b/i.test(sql)) {
        statement.run(...params);
        return [];
      }
      return statement.all(...params) as T[];
    },
    async close() { statements.clear(); sqlite.close(); },
  };
  await migrate(db);
  return db;
}

export const now = () => new Date().toISOString();

function slugify(value: string) {
  return String(value).normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

export async function uniqueSlug(db: Db, table: 'shoots' | 'collections', title: string, id: string) {
  const base = slugify(title) || 'untitled';
  let slug = base;
  let suffix = 2;
  while ((await db.query(`SELECT id FROM ${table} WHERE slug = ? AND id <> ?`, [slug, id])).length) {
    slug = `${base}-${suffix++}`;
  }
  return slug;
}
