/**
 * deliverables.ts — Deliverable management.
 *
 * Routes (mount under /api/deliverables):
 *   GET    /:projectId                                  list all deliverables
 *   GET    /:projectId/:revId/:code                     fetch specific deliverable (e.g. A-02 = code label)
 *   POST   /:projectId/:code/preview                    gen thumbnail (stub returns placeholder)
 *   GET    /:projectId/manifest                         INDEX.xlsx-like manifest data
 *
 * Audit khi download.
 */

import { Hono } from 'hono';
import path from 'node:path';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { query, queryOne } from '../lib/db.js';
import { requireAuth, type AuthUser } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';

interface ProjectRow {
  id: string;
  code: string;
  name: string;
  owner_user_id: string;
}

interface DeliverableRow {
  id: string;
  project_id: string;
  revision_id: string;
  agent_run_id: string;
  kind: string;
  path: string;
  size_bytes: number;
  version: number;
  parent_deliverable_id: string | null;
  locked: number;
  signature: string | null;
  created_at: string;
}

function ensureMine(projectId: string, userId: string): ProjectRow | undefined {
  return queryOne<ProjectRow>(
    'SELECT id, code, name, owner_user_id FROM projects WHERE id=? AND owner_user_id=?',
    [projectId, userId],
  );
}

const KIND_TO_MIME: Record<string, string> = {
  dxf: 'application/dxf',
  dwg: 'application/acad',
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ifc: 'application/x-step',
  png: 'image/png',
  jpg: 'image/jpeg',
  glb: 'model/gltf-binary',
  json: 'application/json',
  sql: 'text/plain',
  py: 'text/x-python',
  md: 'text/markdown',
  zip: 'application/zip',
};

function mimeFor(kind: string): string {
  return KIND_TO_MIME[kind] ?? 'application/octet-stream';
}

export function createDeliverableRouter(): Hono {
  const app = new Hono();
  app.use('*', requireAuth);

  // GET /:projectId
  app.get('/:projectId', (c) => {
    const user = c.get('user') as AuthUser;
    const projectId = c.req.param('projectId');
    if (!ensureMine(projectId, user.id)) return c.json({ ok: false, error: 'not_found' }, 404);
    const items = query<DeliverableRow>(
      `SELECT * FROM deliverables WHERE project_id=? ORDER BY created_at DESC LIMIT 1000`,
      [projectId],
    );
    return c.json({ ok: true, total: items.length, items });
  });

  // GET /:projectId/:revId/:code
  app.get('/:projectId/:revId/:code', async (c) => {
    const user = c.get('user') as AuthUser;
    const projectId = c.req.param('projectId');
    const revId = c.req.param('revId');
    const code = c.req.param('code');
    if (!ensureMine(projectId, user.id)) return c.json({ ok: false, error: 'not_found' }, 404);

    const item = queryOne<DeliverableRow>(
      `SELECT * FROM deliverables
       WHERE project_id=? AND revision_id=?
         AND (path LIKE ? OR path LIKE ?)
       ORDER BY version DESC LIMIT 1`,
      [projectId, revId, `%/${code}.%`, `%/${code}-%`],
    );
    if (!item) return c.json({ ok: false, error: 'deliverable_not_found' }, 404);

    audit({
      project_id: projectId,
      action: 'deliverable.fetch',
      actor: user.id,
      target_type: 'deliverable',
      target_id: item.id,
      ip: c.req.header('x-forwarded-for') ?? null,
      ua: c.req.header('user-agent') ?? null,
    });

    // Stream binary if file exists; else metadata
    const wantDownload = c.req.query('download') === '1';
    if (wantDownload && item.path && existsSync(item.path)) {
      const stat = statSync(item.path);
      const buf = readFileSync(item.path);
      c.header('Content-Type', mimeFor(item.kind));
      c.header('Content-Disposition', `attachment; filename="${path.basename(item.path)}"`);
      c.header('Content-Length', String(stat.size));
      return c.body(buf as unknown as ArrayBuffer);
    }
    return c.json({ ok: true, deliverable: item });
  });

  // POST /:projectId/:code/preview — stub
  app.post('/:projectId/:code/preview', (c) => {
    const user = c.get('user') as AuthUser;
    const projectId = c.req.param('projectId');
    const code = c.req.param('code');
    if (!ensureMine(projectId, user.id)) return c.json({ ok: false, error: 'not_found' }, 404);
    audit({
      project_id: projectId,
      action: 'deliverable.preview',
      actor: user.id,
      target_type: 'deliverable',
      target_id: code,
    });
    return c.json({
      ok: true,
      project_id: projectId,
      code,
      preview_url: `${process.env.PUBLIC_BASE_URL ?? ''}/static/previews/${projectId}-${code}.png`,
      generated_at: new Date().toISOString(),
      cached: false,
    });
  });

  // GET /:projectId/manifest — INDEX.xlsx data
  app.get('/:projectId/manifest', (c) => {
    const user = c.get('user') as AuthUser;
    const projectId = c.req.param('projectId');
    const project = ensureMine(projectId, user.id);
    if (!project) return c.json({ ok: false, error: 'not_found' }, 404);

    const items = query<DeliverableRow>(
      `SELECT * FROM deliverables WHERE project_id=? ORDER BY created_at ASC`,
      [projectId],
    );
    const byKind: Record<string, number> = {};
    let totalSize = 0;
    for (const it of items) {
      byKind[it.kind] = (byKind[it.kind] ?? 0) + 1;
      totalSize += it.size_bytes ?? 0;
    }
    return c.json({
      ok: true,
      project: { id: project.id, code: project.code, name: project.name },
      total_files: items.length,
      total_size_bytes: totalSize,
      by_kind: byKind,
      items: items.map((it) => ({
        id: it.id,
        kind: it.kind,
        path: it.path,
        version: it.version,
        size_bytes: it.size_bytes,
        revision_id: it.revision_id,
        created_at: it.created_at,
      })),
    });
  });

  return app;
}
