/**
 * DB layer cho Viet-Contech AI Design Platform.
 * - better-sqlite3 (sync, file-based, fast) cho dev/early prod
 * - Auto chay migrations on boot tu db/migrations/*.sql theo thu tu file name
 * - Track applied migrations trong table `_migrations`
 * - Schema viet kieu Postgres-compatible (CHECK CONSTRAINT thay cho ENUM)
 *   sau swap sang `pg` cho production khong phai sua nhieu
 *
 * Helpers public:
 *   - query<T>(sql, params)     -> T[]
 *   - queryOne<T>(sql, params)  -> T | undefined
 *   - exec(sql, params)         -> { changes, lastInsertRowid }
 *   - tx(fn)                    -> T (auto rollback khi throw)
 *   - hash(obj)                 -> hex sha256 (stable JSON)
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import type { Database as DbType, Statement } from 'better-sqlite3';

// -----------------------------------------------------
// Resolve duong dan tu vi tri file (dist/lib/db.js hoac src/lib/db.ts)
// -----------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// platform/backend/ root: tu src/lib len 2 cap (hoac dist/lib len 2 cap)
const BACKEND_ROOT = path.resolve(__dirname, '..', '..');
const MIGRATIONS_DIR = path.join(BACKEND_ROOT, 'db', 'migrations');
const DEFAULT_DB_PATH = path.join(BACKEND_ROOT, 'data', 'vct.db');

// -----------------------------------------------------
// Resolve DB path: env VCT_DB_PATH > default data/vct.db
// -----------------------------------------------------
const DB_FILE: string = (() => {
  const fromEnv = process.env.VCT_DB_PATH;
  if (fromEnv && fromEnv.trim()) {
    return path.isAbsolute(fromEnv) ? fromEnv : path.resolve(BACKEND_ROOT, fromEnv);
  }
  return DEFAULT_DB_PATH;
})();

// Tao folder chua DB neu chua co
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

// -----------------------------------------------------
// Init Database (export ra cho debug / advanced use)
// -----------------------------------------------------
export const db: DbType = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// -----------------------------------------------------
// Migrations runner
// -----------------------------------------------------
function ensureMigrationsTable(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name        TEXT PRIMARY KEY,
      applied_at  TEXT NOT NULL
    )
  `);
}

function listMigrationFiles(): string[] {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort(); // 001_xxx -> 002_xxx -> ...
}

function appliedMigrations(): Set<string> {
  const rows = db.prepare<[], { name: string }>('SELECT name FROM _migrations').all();
  return new Set(rows.map((r) => r.name));
}

function runMigrations(): number {
  ensureMigrationsTable();
  const files = listMigrationFiles();
  const applied = appliedMigrations();
  let count = 0;

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const insertMigration = db.prepare(
      'INSERT INTO _migrations (name, applied_at) VALUES (?, ?)'
    );
    const apply = db.transaction(() => {
      db.exec(sql);
      insertMigration.run(file, new Date().toISOString());
    });
    apply();
    count++;
  }
  return count;
}

// -----------------------------------------------------
// Boot — chay 1 lan khi import module
// -----------------------------------------------------
const migratedCount = runMigrations();

// Dem so row da seed o cac bang chinh sau khi migrations chay xong
function countRows(table: string): number {
  try {
    const row = db.prepare<[], { c: number }>(`SELECT COUNT(*) AS c FROM ${table}`).get();
    return row?.c ?? 0;
  } catch {
    return 0;
  }
}

const TABLE_NAMES: readonly string[] = [
  'projects',
  'project_revisions',
  'requirements',
  'lot_specs',
  'client_profile',
  'concepts',
  'agents_registry',
  'agent_runs',
  'deliverables',
  'conflicts',
  'qc_gates',
  'tcvn_rules',
  'decisions',
  'audit_log',
  'materials',
  'boq_items',
  'bim_elements',
  'clash_detections',
];

const tableCount = TABLE_NAMES.filter((t) => {
  try {
    db.prepare(`SELECT 1 FROM ${t} LIMIT 1`).all();
    return true;
  } catch {
    return false;
  }
}).length;

const agentSeedCount = countRows('agents_registry');
const tcvnSeedCount = countRows('tcvn_rules');

console.log(
  `[DB] OK ${tableCount} tables, ${agentSeedCount} agents seed, ${tcvnSeedCount} TCVN seed | migrations=${migratedCount} | file=${DB_FILE}`
);

// -----------------------------------------------------
// Public helpers
// -----------------------------------------------------
type Param = string | number | bigint | Buffer | null;
type Params = Param[] | Record<string, Param>;

/** Query nhieu row. Luon dung prepared statement (chong SQL injection). */
export function query<T = unknown>(sql: string, params: Params = []): T[] {
  const stmt = db.prepare(sql) as Statement<unknown[], T>;
  if (Array.isArray(params)) {
    return stmt.all(...(params as unknown[])) as T[];
  }
  return stmt.all(params as Record<string, unknown>) as T[];
}

/** Query 1 row, tra ve undefined neu khong co. */
export function queryOne<T = unknown>(sql: string, params: Params = []): T | undefined {
  const stmt = db.prepare(sql) as Statement<unknown[], T>;
  if (Array.isArray(params)) {
    return stmt.get(...(params as unknown[])) as T | undefined;
  }
  return stmt.get(params as Record<string, unknown>) as T | undefined;
}

/** Exec INSERT/UPDATE/DELETE, tra ve { changes, lastInsertRowid }. */
export function exec(
  sql: string,
  params: Params = []
): { changes: number; lastInsertRowid: number | bigint } {
  const stmt = db.prepare(sql);
  const info = Array.isArray(params)
    ? stmt.run(...(params as unknown[]))
    : stmt.run(params as Record<string, unknown>);
  return { changes: info.changes, lastInsertRowid: info.lastInsertRowid };
}

/** Transaction wrapper. Tu dong rollback khi throw. */
export function tx<T>(fn: () => T): T {
  return db.transaction(fn)();
}

/**
 * Stable JSON sha256 hash — dung cho input_hash / output_hash trong agent_runs
 * va deliverables.signature. Sort key de cung 1 noi dung -> cung 1 hash.
 */
export function hash(obj: unknown): string {
  const stable = stableStringify(obj);
  return crypto.createHash('sha256').update(stable, 'utf8').digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']';
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}

// -----------------------------------------------------
// Tien ich check khi run truc tiep: `tsx src/lib/db.ts`
// -----------------------------------------------------
const isMain =
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? '');

if (isMain) {
  const sample = queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM projects');
  console.log(`[DB] self-test: projects rows = ${sample?.c ?? 0}`);
  console.log(`[DB] self-test: hash demo = ${hash({ a: 1, b: [2, 3] }).slice(0, 16)}...`);
}
