/**
 * projects.ts — Project CRUD + pipeline lifecycle.
 *
 * Routes (mount under /api/projects):
 *   POST   /                            create project (lock requirements DNA sau gen concept)
 *   GET    /                            list mine
 *   GET    /:id                         detail + status
 *   PATCH  /:id                         update meta
 *   POST   /:id/start-pipeline          kick off pipeline (lock locked_revision_id)
 *   GET    /:id/pipeline                current state + progress
 *   GET    /:id/revisions               list revisions
 *   POST   /:id/revisions/:revId/restore  rollback
 *   DELETE /:id                         soft delete (status='archived')
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { exec, query, queryOne, tx } from '../lib/db.js';
import { uid, nowIso } from '../lib/uid.js';
import { requireAuth, type AuthUser } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { publishPipelineEvent } from '../lib/event-bus.js';
import { loadExternal } from '../lib/external-loader.js';

// ============================================================
// Schemas
// ============================================================
const CreateProjectSchema = z.object({
  name: z.string().trim().min(2).max(160),
  code: z
    .string()
    .trim()
    .regex(/^[A-Z0-9-]{3,32}$/, 'Code chi cho A-Z/0-9/-, 3-32 ky tu')
    .optional(),
  lot: z
    .object({
      width_m: z.number().positive(),
      depth_m: z.number().positive(),
      direction: z.string().min(1),
      address: z.string().optional(),
      gfa_target: z.number().positive().optional(),
    })
    .optional(),
  client: z
    .object({
      full_name: z.string().min(2),
      year_born: z.number().int().min(1900).max(2100).optional(),
      gender: z.enum(['male', 'female', 'other']).optional(),
      family_size: z.number().int().min(1).max(20).optional(),
      phone: z.string().optional(),
    })
    .optional(),
  requirements: z
    .array(
      z.object({
        type: z.string().min(1),
        key: z.string().min(1),
        value: z.string().min(1),
      }),
    )
    .default([]),
});

const UpdateProjectSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  status: z
    .enum(['draft', 'briefing', 'running', 'review', 'locked', 'delivered', 'archived', 'failed'])
    .optional(),
});

// ============================================================
// Types
// ============================================================
interface ProjectRow {
  id: string;
  code: string;
  name: string;
  owner_user_id: string;
  status: string;
  locked_revision_id: string | null;
  created_at: string;
  updated_at: string;
}

interface RevisionRow {
  id: string;
  project_id: string;
  parent_revision_id: string | null;
  message: string;
  agent: string | null;
  created_at: string;
}

interface RunStatRow {
  status: string;
  c: number;
}

// ============================================================
// Helpers
// ============================================================

function fmtCode(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 16);
  const stamp = Date.now().toString(36).toUpperCase().slice(-4);
  return `VCT-${slug || 'PRJ'}-${stamp}`;
}

function loadProjectMine(id: string, userId: string): ProjectRow | undefined {
  return queryOne<ProjectRow>(
    'SELECT * FROM projects WHERE id=? AND owner_user_id=?',
    [id, userId],
  );
}

// ============================================================
// Router
// ============================================================
export function createProjectRouter(): Hono {
  const app = new Hono();

  // All routes require auth
  app.use('*', requireAuth);

  // ----- POST / create -----
  app.post('/', async (c) => {
    const user = c.get('user') as AuthUser;
    const json = await c.req.json().catch(() => null);
    const parsed = CreateProjectSchema.safeParse(json);
    if (!parsed.success) {
      return c.json({ ok: false, error: 'invalid_input', issues: parsed.error.issues }, 400);
    }

    const id = uid('prj');
    const code = parsed.data.code ?? fmtCode(parsed.data.name);
    const revId = uid('rev');
    const now = nowIso();

    tx(() => {
      exec(
        `INSERT INTO projects (id, code, name, owner_user_id, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'draft', ?, ?)`,
        [id, code, parsed.data.name, user.id, now, now],
      );
      exec(
        `INSERT INTO project_revisions (id, project_id, parent_revision_id, message, agent, created_at)
         VALUES (?, ?, NULL, ?, NULL, ?)`,
        [revId, id, 'rev:0 — initial brief', now],
      );
      // Lot spec
      if (parsed.data.lot) {
        const lot = parsed.data.lot;
        const area = lot.width_m * lot.depth_m;
        exec(
          `INSERT INTO lot_specs (project_id, width_m, depth_m, area_m2, direction, address, gfa_target)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [id, lot.width_m, lot.depth_m, area, lot.direction, lot.address ?? null, lot.gfa_target ?? null],
        );
      }
      // Client profile
      if (parsed.data.client) {
        const cp = parsed.data.client;
        exec(
          `INSERT INTO client_profile (project_id, full_name, phone, year_born, gender, family_size)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            id,
            cp.full_name,
            cp.phone ?? null,
            cp.year_born ?? null,
            cp.gender ?? null,
            cp.family_size ?? null,
          ],
        );
      }
      // Requirements
      for (const r of parsed.data.requirements) {
        exec(
          `INSERT INTO requirements (id, project_id, source, type, key, value, locked)
           VALUES (?, ?, 'brief', ?, ?, ?, 0)`,
          [uid('req'), id, r.type, r.key, r.value],
        );
      }
      return null;
    });

    audit({
      project_id: id,
      action: 'project.create',
      actor: user.id,
      target_type: 'project',
      target_id: id,
      after: { id, code, name: parsed.data.name },
      ip: c.req.header('x-forwarded-for') ?? null,
      ua: c.req.header('user-agent') ?? null,
    });
    publishPipelineEvent({ type: 'project.created', project_id: id, message: `Project ${code} tao` });
    const row = queryOne<ProjectRow>('SELECT * FROM projects WHERE id=?', [id]);
    return c.json({ ok: true, project: row });
  });

  // ----- GET / list mine -----
  app.get('/', (c) => {
    const user = c.get('user') as AuthUser;
    const items = query<ProjectRow>(
      `SELECT * FROM projects WHERE owner_user_id=? ORDER BY created_at DESC LIMIT 200`,
      [user.id],
    );
    return c.json({ ok: true, total: items.length, items });
  });

  // ----- GET /:id -----
  app.get('/:id', (c) => {
    const user = c.get('user') as AuthUser;
    const id = c.req.param('id');
    const p = loadProjectMine(id, user.id);
    if (!p) return c.json({ ok: false, error: 'not_found' }, 404);

    const revisions = query<RevisionRow>(
      'SELECT * FROM project_revisions WHERE project_id=? ORDER BY created_at ASC',
      [id],
    );
    const runStats = query<RunStatRow>(
      `SELECT status, COUNT(*) AS c FROM agent_runs WHERE project_id=? GROUP BY status`,
      [id],
    );
    const qcCount = queryOne<{ c: number }>(
      `SELECT COUNT(*) AS c FROM qc_gates WHERE project_id=? AND status IN ('passed','auto_fixed')`,
      [id],
    );
    return c.json({
      ok: true,
      project: p,
      revisions,
      runs_by_status: runStats,
      qc_passed: qcCount?.c ?? 0,
    });
  });

  // ----- PATCH /:id -----
  app.patch('/:id', async (c) => {
    const user = c.get('user') as AuthUser;
    const id = c.req.param('id');
    const json = await c.req.json().catch(() => null);
    const parsed = UpdateProjectSchema.safeParse(json);
    if (!parsed.success) return c.json({ ok: false, error: 'invalid_input' }, 400);

    const p = loadProjectMine(id, user.id);
    if (!p) return c.json({ ok: false, error: 'not_found' }, 404);

    const next = { ...p, ...parsed.data, updated_at: nowIso() };
    exec(
      `UPDATE projects SET name=?, status=?, updated_at=? WHERE id=?`,
      [next.name, next.status, next.updated_at, id],
    );
    audit({
      project_id: id,
      action: 'project.update',
      actor: user.id,
      target_type: 'project',
      target_id: id,
      before: p,
      after: next,
    });
    return c.json({ ok: true, project: next });
  });

  // ----- DELETE /:id -----
  app.delete('/:id', (c) => {
    const user = c.get('user') as AuthUser;
    const id = c.req.param('id');
    const p = loadProjectMine(id, user.id);
    if (!p) return c.json({ ok: false, error: 'not_found' }, 404);
    exec(`UPDATE projects SET status='archived', updated_at=? WHERE id=?`, [nowIso(), id]);
    audit({
      project_id: id,
      action: 'project.archive',
      actor: user.id,
      target_type: 'project',
      target_id: id,
      before: p,
    });
    return c.json({ ok: true, archived: true });
  });

  // ----- POST /:id/brief/analyze -----
  app.post('/:id/brief/analyze', async (c) => {
    const user = c.get('user') as AuthUser;
    const id = c.req.param('id');
    const p = loadProjectMine(id, user.id);
    if (!p) return c.json({ ok: false, error: 'not_found' }, 404);

    // Build brief payload tu lot_specs + client_profile + requirements
    const lot = queryOne<Record<string, unknown>>('SELECT * FROM lot_specs WHERE project_id=?', [
      id,
    ]);
    const client = queryOne<Record<string, unknown>>(
      'SELECT * FROM client_profile WHERE project_id=?',
      [id],
    );
    const reqs = query<{ type: string; key: string; value: string }>(
      'SELECT type, key, value FROM requirements WHERE project_id=?',
      [id],
    );
    const brief = {
      project_id: id,
      lot,
      client,
      requirements: reqs,
    };

    // Lazy load brief_analyst via pipeline agent-runner
    interface RunnerMod {
      runAgent: (opts: {
        agent_code: string;
        phase: string;
        input: unknown;
      }) => Promise<unknown>;
    }
    let runner: RunnerMod | null = null;
    try {
      runner = await loadExternal<RunnerMod>('pipeline/src/agent-runner.js');
    } catch {
      runner = null;
    }
    if (!runner) {
      return c.json({
        ok: true,
        result: {
          agent_code: 'brief_analyst',
          status: 'mock',
          output: { project_id: id, summary: 'agent runner unavailable — echo brief', brief },
        },
      });
    }
    try {
      const result = await runner.runAgent({
        agent_code: 'brief_analyst',
        phase: 'B1-Brief',
        input: brief,
      });
      audit({
        project_id: id,
        action: 'brief.analyze',
        actor: user.id,
        target_type: 'project',
        target_id: id,
      });
      publishPipelineEvent({
        type: 'brief.analyzed',
        project_id: id,
        message: 'Brief analyst done',
      });
      return c.json({ ok: true, result });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return c.json({ ok: false, error: 'analyze_failed', message: msg }, 500);
    }
  });

  // ----- POST /:id/start-pipeline -----
  app.post('/:id/start-pipeline', (c) => {
    const user = c.get('user') as AuthUser;
    const id = c.req.param('id');
    const p = loadProjectMine(id, user.id);
    if (!p) return c.json({ ok: false, error: 'not_found' }, 404);
    if (p.status === 'running') {
      return c.json({ ok: false, error: 'already_running' }, 409);
    }
    // Lock requirements DNA + tao revision moi
    const revId = uid('rev');
    const now = nowIso();
    tx(() => {
      exec(
        `INSERT INTO project_revisions (id, project_id, parent_revision_id, message, agent, created_at)
         VALUES (?, ?, NULL, 'rev — start pipeline', NULL, ?)`,
        [revId, id, now],
      );
      exec(`UPDATE requirements SET locked=1 WHERE project_id=?`, [id]);
      exec(
        `UPDATE projects SET status='running', locked_revision_id=?, updated_at=? WHERE id=?`,
        [revId, now, id],
      );
      return null;
    });
    audit({
      project_id: id,
      action: 'pipeline.start',
      actor: user.id,
      target_type: 'project',
      target_id: id,
      after: { revision_id: revId },
    });
    // Goi pipeline orchestrator se duoc lam khi mountPipelineRoutes ket noi.
    // O day chi emit event de SSE consumer thay tien do.
    publishPipelineEvent({
      type: 'pipeline.started',
      project_id: id,
      message: `Pipeline started — revision ${revId}`,
      payload: { revision_id: revId },
    });
    // Mock progressive events theo phase de UI co the test
    const phases = [1, 2, 3, 4, 5, 6, 7];
    for (const ph of phases) {
      setTimeout(() => {
        publishPipelineEvent({
          type: 'phase.started',
          project_id: id,
          phase: ph,
          message: `Phase ${ph} started`,
        });
      }, ph * 50);
    }
    return c.json({ ok: true, revision_id: revId, status: 'running' });
  });

  // ----- GET /:id/pipeline -----
  app.get('/:id/pipeline', (c) => {
    const user = c.get('user') as AuthUser;
    const id = c.req.param('id');
    const p = loadProjectMine(id, user.id);
    if (!p) return c.json({ ok: false, error: 'not_found' }, 404);

    const phases = query<{ phase: number; total: number; succeeded: number }>(
      `SELECT phase,
              COUNT(*) AS total,
              SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) AS succeeded
       FROM agent_runs
       WHERE project_id=?
       GROUP BY phase
       ORDER BY phase`,
      [id],
    );
    const conflicts = queryOne<{ c: number }>(
      `SELECT COUNT(*) AS c FROM conflicts WHERE project_id=? AND status='open'`,
      [id],
    );
    const qcGates = query<{ gate_code: string; status: string }>(
      `SELECT gate_code, status FROM qc_gates WHERE project_id=? ORDER BY gate_code`,
      [id],
    );
    return c.json({
      ok: true,
      project_id: id,
      status: p.status,
      locked_revision_id: p.locked_revision_id,
      phases,
      open_conflicts: conflicts?.c ?? 0,
      qc_gates: qcGates,
    });
  });

  // ----- GET /:id/revisions -----
  app.get('/:id/revisions', (c) => {
    const user = c.get('user') as AuthUser;
    const id = c.req.param('id');
    if (!loadProjectMine(id, user.id)) return c.json({ ok: false, error: 'not_found' }, 404);
    const rows = query<RevisionRow>(
      'SELECT * FROM project_revisions WHERE project_id=? ORDER BY created_at ASC',
      [id],
    );
    return c.json({ ok: true, total: rows.length, items: rows });
  });

  // ----- POST /:id/revisions/:revId/restore -----
  app.post('/:id/revisions/:revId/restore', (c) => {
    const user = c.get('user') as AuthUser;
    const id = c.req.param('id');
    const revId = c.req.param('revId');
    const p = loadProjectMine(id, user.id);
    if (!p) return c.json({ ok: false, error: 'not_found' }, 404);

    const rev = queryOne<RevisionRow>(
      'SELECT * FROM project_revisions WHERE id=? AND project_id=?',
      [revId, id],
    );
    if (!rev) return c.json({ ok: false, error: 'revision_not_found' }, 404);

    const newRev = uid('rev');
    const now = nowIso();
    exec(
      `INSERT INTO project_revisions (id, project_id, parent_revision_id, message, agent, created_at)
       VALUES (?, ?, ?, ?, NULL, ?)`,
      [newRev, id, revId, `restore from ${revId}`, now],
    );
    exec(
      `UPDATE projects SET status='review', locked_revision_id=?, updated_at=? WHERE id=?`,
      [newRev, now, id],
    );
    audit({
      project_id: id,
      action: 'project.restore',
      actor: user.id,
      target_type: 'revision',
      target_id: revId,
      after: { new_revision: newRev },
    });
    publishPipelineEvent({
      type: 'project.restored',
      project_id: id,
      message: `Restored from ${revId} -> ${newRev}`,
      payload: { new_revision: newRev, source_revision: revId },
    });
    return c.json({ ok: true, restored_to: newRev });
  });

  return app;
}
