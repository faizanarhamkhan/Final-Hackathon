import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { SCHEMA } from './schema.js';

/**
 * Database access. Production uses Supabase Postgres through DATABASE_URL (postgres.js).
 * Without DATABASE_URL an embedded Postgres (PGlite) is used, so the app and the tests
 * run with zero setup. Services only see query helpers and tx(); SQL is plain Postgres
 * written with `?` placeholders, converted to $1..$n here.
 */

let adapterPromise = null;
const txStore = new AsyncLocalStorage();

function toPg(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

const norm = (params) => params.map((v) => (v === undefined ? null : v));

async function createPostgresAdapter(url) {
  const { default: postgres } = await import('postgres');
  const sql = postgres(url, {
    prepare: false, // required by the Supabase transaction pooler
    max: Number(process.env.DB_POOL_MAX) || 5,
    idle_timeout: 20,
    onnotice: () => {}, // "already exists, skipping" notices from the idempotent schema
    ssl: /localhost|127\.0\.0\.1/.test(url) ? false : 'require',
    types: {
      date: { to: 1082, from: [1082], serialize: (x) => x, parse: (x) => x },
      ts: { to: 1184, from: [1114, 1184], serialize: (x) => x, parse: (x) => new Date(x).toISOString() },
      num: { to: 1700, from: [20, 1700], serialize: (x) => String(x), parse: (x) => Number(x) },
    },
  });
  const wrap = (exec) => ({ query: (text, params) => exec.unsafe(text, params) });
  return {
    kind: 'supabase-postgres',
    ...wrap(sql),
    exec: (text) => sql.unsafe(text),
    transaction: (fn) => sql.begin((t) => fn(wrap(t))),
    close: () => sql.end({ timeout: 5 }),
  };
}

async function createPgliteAdapter(dir) {
  const { PGlite } = await import('@electric-sql/pglite');
  if (dir !== 'memory://') fs.mkdirSync(dir, { recursive: true });
  const pg = new PGlite({
    dataDir: dir,
    parsers: {
      1082: (v) => v,
      1114: (v) => new Date(`${v}Z`).toISOString(),
      1184: (v) => new Date(v).toISOString(),
      20: Number,
      1700: Number,
    },
  });
  await pg.waitReady;
  const wrap = (exec) => ({ query: async (text, params) => (await exec.query(text, params)).rows });
  return {
    kind: dir === 'memory://' ? 'pglite-memory' : 'pglite',
    ...wrap(pg),
    exec: (text) => pg.exec(text),
    transaction: (fn) => pg.transaction((t) => fn(wrap(t))),
    close: () => pg.close(),
  };
}

async function init() {
  const adapter = config.databaseUrl
    ? await createPostgresAdapter(config.databaseUrl)
    : await createPgliteAdapter(config.pgliteDir === 'memory://' ? 'memory://' : path.resolve(config.pgliteDir));
  await adapter.exec(SCHEMA);
  return adapter;
}

// Lazily connects once per process (works for serverless cold starts too).
export function db() {
  if (!adapterPromise) {
    adapterPromise = init().catch((err) => {
      adapterPromise = null;
      throw err;
    });
  }
  return adapterPromise;
}

export async function closeDb() {
  if (!adapterPromise) return;
  const a = await adapterPromise;
  adapterPromise = null;
  await a.close();
}

async function executor() {
  return txStore.getStore() || (await db());
}

export async function all(sql, ...params) {
  const ex = await executor();
  return Array.from(await ex.query(toPg(sql), norm(params)));
}
export async function get(sql, ...params) {
  return (await all(sql, ...params))[0];
}
export const run = all;

// Transaction scoped through AsyncLocalStorage; nested calls join the outer transaction.
export async function tx(fn) {
  if (txStore.getStore()) return fn();
  const a = await db();
  return a.transaction((t) => txStore.run(t, fn));
}

export async function getMeta(key) {
  return (await get('SELECT value FROM meta WHERE key = ?', key))?.value ?? null;
}
export async function setMeta(key, value) {
  await run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', key, value);
}

export const nowIso = () => new Date().toISOString();

// Placeholder list for IN (...) clauses.
export const marks = (arr) => arr.map(() => '?').join(', ');
