/**
 * mounts/export.ts — mount /api/export/* (packager).
 *
 * POST /api/export/zip   body: { project_id } -> tao zip cua all deliverables -> URL
 * GET  /api/export/health
 *
 * Khi project chua co deliverable -> tra error 422.
 */

import type { Hono } from 'hono';
import { z } from 'zod';
import path from 'node:path';
import fs from 'node:fs';
import archiver from 'archiver';
import { env } from '../env.js';
import { query, queryOne } from '../lib/db.js';
import { audit } from '../lib/audit.js';
import { publishPipelineEvent } from '../lib/event-bus.js';
import { requireAuth } from '../middleware/auth.js';

const SERVER_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), '..', '..');
const EXPORT_DIR = path.resolve(env.PUBLIC_BASE_URL ? path.join(SERVER_ROOT, 'data', 'exports') : path.join(process.cwd(), 'exports'));

const ExportSchema = z.object({
  project_id: z.string().min(1),
});

interface DeliverableRow {
  id: string;
  path: string;
  kind: string;
  size_bytes: number;
}

interface ProjectRow {
  id: string;
  code: string;
  owner_user_id: string;
}

export function mountExportRoutes(app: Hono): void {
  app.use('/api/export/*', requireAuth);

  app.post('/api/export/zip', async (c) => {
    const user = c.get('user') as { id: string };
    const body = await c.req.json().catch(() => null);
    const parsed = ExportSchema.safeParse(body);
    if (!parsed.success) return c.json({ ok: false, error: 'invalid_input' }, 400);

    const proj = queryOne<ProjectRow>(
      'SELECT id, code, owner_user_id FROM projects WHERE id=?',
      [parsed.data.project_id],
    );
    if (!proj || proj.owner_user_id !== user.id) {
      return c.json({ ok: false, error: 'not_found' }, 404);
    }

    const items = query<DeliverableRow>(
      `SELECT id, path, kind, size_bytes FROM deliverables WHERE project_id=?`,
      [proj.id],
    );

    fs.mkdirSync(EXPORT_DIR, { recursive: true });
    const filename = `${proj.code}-${Date.now()}.zip`;
    const outPath = path.join(EXPORT_DIR, filename);

    await new Promise<void>((resolve, reject) => {
      const out = fs.createWriteStream(outPath);
      const archive = archiver('zip', { zlib: { level: 9 } });
      out.on('close', () => resolve());
      out.on('error', reject);
      archive.on('error', reject);
      archive.pipe(out);

      // Manifest INDEX.json
      archive.append(
        JSON.stringify(
          {
            project: { id: proj.id, code: proj.code },
            generated_at: new Date().toISOString(),
            total_files: items.length,
            items,
          },
          null,
          2,
        ),
        { name: 'INDEX.json' },
      );

      for (const it of items) {
        if (it.path && fs.existsSync(it.path)) {
          archive.file(it.path, { name: path.basename(it.path) });
        } else {
          archive.append(`# placeholder for ${it.id} (${it.kind}) — file missing\n`, {
            name: `_missing/${it.id}.txt`,
          });
        }
      }
      archive.finalize();
    });

    audit({
      project_id: proj.id,
      action: 'export.zip',
      actor: user.id,
      target_type: 'project',
      target_id: proj.id,
      after: { filename },
    });
    publishPipelineEvent({
      type: 'export.completed',
      project_id: proj.id,
      message: `Export ${filename} ready`,
      payload: { filename },
    });

    const stat = fs.statSync(outPath);
    const url = `${env.PUBLIC_BASE_URL}/static/exports/${filename}`;
    return c.json({ ok: true, url, filename, size_bytes: stat.size, items: items.length });
  });

  app.get('/api/export/health', (c) =>
    c.json({ ok: true, service: 'packager', export_dir: EXPORT_DIR }),
  );
}
