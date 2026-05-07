/**
 * Bridge re-export DB layer cua platform/backend/src/lib/db.ts.
 * Server module su dung helper goc: query / queryOne / exec / tx / hash.
 *
 * Server cung mo rong them bang `users` (auth-only, khong co trong 18 schema goc)
 * va `audit_log` da co san. Migration `999_users.sql` se chay khi import lan dau
 * (database layer original tu auto-load tat ca *.sql files trong /db/migrations).
 */

export {
  db,
  query,
  queryOne,
  exec,
  tx,
  hash,
} from '../../../src/lib/db.js';
