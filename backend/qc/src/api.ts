/**
 * Hono routes cho QC system.
 *
 * Endpoints:
 *   POST /api/qc/run                                  -> chay all 12 gate, return QCReport
 *   POST /api/qc/gate/:code                           -> chay 1 gate theo code
 *   GET  /api/qc/report/:project_id/:revision_id      -> fetch report tu cache
 *   GET  /api/qc/checklist/:project_id                -> live status 12 gate
 *
 * Note: dung in-memory store cho cache report (production swap sang DB qc_gates).
 */

import { Hono } from 'hono';
import { QCRunner } from './qc-runner.js';
import { getGate, QC_GATES } from './gates/index.js';
import type {
  AuditEntry, DesignSnapshot, GateCode, GateContext, QCReport,
} from './types.js';

// Simple in-memory store cho report cache + audit log
const reportCache = new Map<string, QCReport>();   // key = project:revision
const auditLog: AuditEntry[] = [];

function cacheKey(p: string, r: string): string {
  return `${p}:${r}`;
}

function makeAudit(actor: string): (e: AuditEntry) => void {
  return (e) => auditLog.push({ ...e, actor: e.actor || actor });
}

// ============================================================
// Body schema validation (light, runtime)
// ============================================================
function isValidRunBody(b: unknown): b is {
  project_id: string;
  revision_id: string;
  design: DesignSnapshot;
  locked_specs?: string[];
} {
  if (typeof b !== 'object' || b === null) return false;
  const o = b as Record<string, unknown>;
  return typeof o.project_id === 'string'
    && typeof o.revision_id === 'string'
    && typeof o.design === 'object' && o.design !== null;
}

// ============================================================
// Routes
// ============================================================
export function createQCApp(): Hono {
  const app = new Hono();

  // POST /api/qc/run — chay all 12 gate
  app.post('/api/qc/run', async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!isValidRunBody(body)) {
      return c.json({ error: 'invalid body. yeu cau project_id, revision_id, design' }, 400);
    }
    const ctx: GateContext = {
      project_id: body.project_id,
      revision_id: body.revision_id,
      design: body.design,
      locked_specs: body.locked_specs ?? [],
      audit: makeAudit('qc.api.run'),
    };
    const runner = new QCRunner();
    const report = await runner.runAll(ctx);
    reportCache.set(cacheKey(body.project_id, body.revision_id), report);
    return c.json(report);
  });

  // POST /api/qc/gate/:code — chay 1 gate
  app.post('/api/qc/gate/:code', async (c) => {
    const code = c.req.param('code') as GateCode;
    const gate = getGate(code);
    if (!gate) return c.json({ error: `unknown gate ${code}` }, 404);

    const body = await c.req.json().catch(() => null);
    if (!isValidRunBody(body)) {
      return c.json({ error: 'invalid body' }, 400);
    }
    const ctx: GateContext = {
      project_id: body.project_id,
      revision_id: body.revision_id,
      design: body.design,
      locked_specs: body.locked_specs ?? [],
      audit: makeAudit('qc.api.gate'),
    };
    const runner = new QCRunner();
    const result = await runner.runOne(gate, ctx);
    return c.json(result);
  });

  // GET /api/qc/report/:project_id/:revision_id
  app.get('/api/qc/report/:project_id/:revision_id', (c) => {
    const project_id = c.req.param('project_id');
    const revision_id = c.req.param('revision_id');
    const r = reportCache.get(cacheKey(project_id, revision_id));
    if (!r) return c.json({ error: 'report not found' }, 404);
    return c.json(r);
  });

  // GET /api/qc/checklist/:project_id — live status 12 gate
  app.get('/api/qc/checklist/:project_id', (c) => {
    const project_id = c.req.param('project_id');
    // Lay revision moi nhat tu cache
    const entries = Array.from(reportCache.entries())
      .filter(([k]) => k.startsWith(`${project_id}:`));
    const latest = entries.at(-1)?.[1];
    const items = QC_GATES.map((g) => {
      const found = latest?.results.find((r) => r.gate_code === g.code);
      return {
        code: g.code,
        name: g.name,
        phase: g.phase,
        status: found?.status ?? 'pending',
        score: found?.score ?? null,
        ran_at: found?.ran_at ?? null,
      };
    });
    return c.json({
      project_id,
      total: QC_GATES.length,
      items,
      overall: latest?.overall ?? 'PENDING',
    });
  });

  // GET /api/qc/audit/:project_id — debug audit log
  app.get('/api/qc/audit/:project_id', (c) => {
    const project_id = c.req.param('project_id');
    return c.json(auditLog.filter((e) => e.target_id?.startsWith(project_id) || true));
  });

  return app;
}

// ============================================================
// Stand-alone entry — neu can chay rieng module
// ============================================================
export const qcApp = createQCApp();
