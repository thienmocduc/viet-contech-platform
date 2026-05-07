/**
 * audit.ts — Append-only audit log voi chain hash sha256.
 *
 * immutable_hash = sha256(prev_hash + canonical_json(this_row))
 * Co bao mat ngam: cac row sau dang voi row truoc -> sua row giua se invalidate
 * tat ca hash sau no.
 */

import crypto from 'node:crypto';
import { exec, queryOne } from './db.js';
import { uid } from './uid.js';

export interface AuditInput {
  project_id?: string | null;
  action: string;            // e.g. 'project.create', 'auth.login'
  actor: string;             // user_id | agent_id | 'system'
  target_type: string;       // e.g. 'project','user','deliverable'
  target_id?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  ua?: string | null;
}

function canonical(o: unknown): string {
  if (o === null || o === undefined) return 'null';
  if (typeof o !== 'object') return JSON.stringify(o);
  if (Array.isArray(o)) return '[' + o.map(canonical).join(',') + ']';
  const obj = o as Record<string, unknown>;
  return (
    '{' +
    Object.keys(obj)
      .sort()
      .map((k) => JSON.stringify(k) + ':' + canonical(obj[k]))
      .join(',') +
    '}'
  );
}

function lastHash(): string {
  const row = queryOne<{ immutable_hash: string }>(
    'SELECT immutable_hash FROM audit_log ORDER BY ts DESC LIMIT 1',
  );
  return row?.immutable_hash ?? '0000';
}

export function audit(input: AuditInput): void {
  const id = uid('al');
  const prev = lastHash();
  const beforeJson = input.before === undefined ? null : canonical(input.before);
  const afterJson = input.after === undefined ? null : canonical(input.after);
  const seed = canonical({
    id,
    project_id: input.project_id ?? null,
    action: input.action,
    actor: input.actor,
    target_type: input.target_type,
    target_id: input.target_id ?? null,
    before_json: beforeJson,
    after_json: afterJson,
    ip: input.ip ?? null,
    ua: input.ua ?? null,
  });
  const immutable = crypto.createHash('sha256').update(prev + seed).digest('hex');

  exec(
    `INSERT INTO audit_log
       (id, project_id, action, actor, target_type, target_id, before_json, after_json, ip, ua, immutable_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.project_id ?? null,
      input.action,
      input.actor,
      input.target_type,
      input.target_id ?? null,
      beforeJson,
      afterJson,
      input.ip ?? null,
      input.ua ?? null,
      immutable,
    ],
  );
}
