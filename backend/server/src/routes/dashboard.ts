/**
 * dashboard.ts — Dashboard KPI cho admin/KTS.
 *
 * Routes (mount under /api/dashboard):
 *   GET /overview          project count, agent runs 24h, qc pass rate, avg duration
 *   GET /agent-stats       per agent: success rate, avg duration, tokens
 *   GET /recent-activity   last 50 audit events
 */

import { Hono } from 'hono';
import { query, queryOne } from '../lib/db.js';
import { requireAuth } from '../middleware/auth.js';

export function createDashboardRouter(): Hono {
  const app = new Hono();
  app.use('*', requireAuth);

  app.get('/overview', (c) => {
    const projectsByStatus = query<{ status: string; c: number }>(
      `SELECT status, COUNT(*) AS c FROM projects GROUP BY status ORDER BY status`,
    );
    const runs24h = queryOne<{ c: number }>(
      `SELECT COUNT(*) AS c FROM agent_runs WHERE started_at >= datetime('now','-1 day')`,
    );
    const qcPass = queryOne<{ pass: number; total: number }>(
      `SELECT SUM(CASE WHEN status IN ('passed','auto_fixed') THEN 1 ELSE 0 END) AS pass,
              COUNT(*) AS total
       FROM qc_gates`,
    );
    const avgDur = queryOne<{ avg_ms: number | null }>(
      `SELECT AVG(duration_ms) AS avg_ms FROM agent_runs WHERE duration_ms IS NOT NULL`,
    );
    const totalRevenue = queryOne<{ total: number | null }>(
      `SELECT SUM(total_vnd) AS total FROM boq_items`,
    );
    return c.json({
      ok: true,
      projects_by_status: projectsByStatus,
      agent_runs_24h: runs24h?.c ?? 0,
      qc_pass_rate: qcPass && qcPass.total > 0 ? qcPass.pass / qcPass.total : null,
      avg_agent_duration_ms: avgDur?.avg_ms ?? 0,
      total_boq_revenue_vnd: totalRevenue?.total ?? 0,
    });
  });

  app.get('/agent-stats', (c) => {
    const rows = query<{
      agent_id: string;
      total: number;
      succ: number;
      fail: number;
      avg_ms: number | null;
      tokens: number | null;
      cost_vnd: number | null;
    }>(
      `SELECT agent_id,
              COUNT(*) AS total,
              SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) AS succ,
              SUM(CASE WHEN status IN ('failed','timeout') THEN 1 ELSE 0 END) AS fail,
              AVG(duration_ms) AS avg_ms,
              SUM(tokens_used) AS tokens,
              SUM(cost_vnd) AS cost_vnd
       FROM agent_runs
       GROUP BY agent_id
       ORDER BY total DESC`,
    );
    return c.json({
      ok: true,
      items: rows.map((r) => ({
        ...r,
        success_rate: r.total > 0 ? r.succ / r.total : null,
      })),
    });
  });

  app.get('/recent-activity', (c) => {
    const rows = query<{
      id: string;
      project_id: string | null;
      action: string;
      actor: string;
      target_type: string;
      target_id: string | null;
      ts: string;
    }>(
      `SELECT id, project_id, action, actor, target_type, target_id, ts
       FROM audit_log ORDER BY ts DESC LIMIT 50`,
    );
    return c.json({ ok: true, items: rows });
  });

  return app;
}
