/**
 * health.ts - Detailed /healthz endpoint
 *
 *   GET /healthz
 *     - ok flag
 *     - service version (semver)
 *     - DB tables count + sizes
 *     - Agents count (registry.json)
 *     - Pipeline orchestrator status
 *     - SMTP/JWT/Zeni provider statuses
 *     - Memory + uptime
 *
 *   GET /readyz
 *     - 200 only when DB ready + agents loaded
 */

import { Hono } from 'hono';
import { query, queryOne } from '../lib/db.js';
import { env, smtpConfigured } from '../env.js';
import { agentsCount } from './agents.js';

const TABLE_LIST = [
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
  'users',
  'sessions',
] as const;

const STARTED_AT = Date.now();
const VERSION = '1.0.0';

interface CountRow {
  c: number;
}

function tablesStatus(): { ready: number; total: number; rows: Record<string, number> } {
  const out: Record<string, number> = {};
  let ready = 0;
  for (const t of TABLE_LIST) {
    try {
      const r = queryOne<CountRow>(`SELECT COUNT(*) AS c FROM ${t}`);
      out[t] = r?.c ?? 0;
      ready++;
    } catch {
      out[t] = -1; // not present
    }
  }
  return { ready, total: TABLE_LIST.length, rows: out };
}

function pipelineStatus(): { ready: boolean; provider_mode: string } {
  // Pipeline registry resolves lazily; we just probe ENV here.
  return {
    ready: true,
    provider_mode: process.env.PROVIDER_MODE ?? 'mock',
  };
}

export function createHealthRouter(): Hono {
  const app = new Hono();

  app.get('/healthz', (c) => {
    const tbl = tablesStatus();
    const ag = agentsCount();
    const pl = pipelineStatus();
    const recentRuns = (() => {
      try {
        const r = queryOne<CountRow>(
          `SELECT COUNT(*) AS c FROM agent_runs WHERE started_at >= datetime('now','-1 day')`,
        );
        return r?.c ?? 0;
      } catch {
        return 0;
      }
    })();
    const usersCount = (() => {
      try {
        const r = queryOne<CountRow>(`SELECT COUNT(*) AS c FROM users`);
        return r?.c ?? 0;
      } catch {
        return 0;
      }
    })();
    const tcvnCount = (() => {
      try {
        const r = queryOne<CountRow>(`SELECT COUNT(*) AS c FROM tcvn_rules`);
        return r?.c ?? 0;
      } catch {
        return 0;
      }
    })();
    const allOk =
      tbl.ready >= 18 && ag >= 1 && pl.ready === true; // 18 = Wave-1 schema; users/sessions are bonus

    const mem = process.memoryUsage();

    return c.json(
      {
        ok: allOk,
        service: 'vct-design-platform',
        version: VERSION,
        env: env.NODE_ENV,
        time: new Date().toISOString(),
        uptime_seconds: Math.round((Date.now() - STARTED_AT) / 1000),
        db: {
          file: env.VCT_DB_PATH,
          tables_ready: tbl.ready,
          tables_expected: tbl.total,
          rows: tbl.rows,
          users: usersCount,
          tcvn_rules: tcvnCount,
          agent_runs_24h: recentRuns,
        },
        agents: {
          count: ag,
          source: 'agents/registry.json',
        },
        pipeline: pl,
        providers: {
          smtp_configured: smtpConfigured(),
          jwt_configured: env.JWT_SECRET.length >= 16,
          zeni_l3_configured: Boolean(env.ZENI_L3_API_KEY),
        },
        memory_mb: {
          rss: Math.round(mem.rss / 1024 / 1024),
          heap_used: Math.round(mem.heapUsed / 1024 / 1024),
          heap_total: Math.round(mem.heapTotal / 1024 / 1024),
        },
      },
      allOk ? 200 : 503,
    );
  });

  app.get('/readyz', (c) => {
    const tbl = tablesStatus();
    const ag = agentsCount();
    if (tbl.ready < 18 || ag < 1) {
      return c.json({ ok: false, ready: false, db: tbl.ready, agents: ag }, 503);
    }
    return c.json({ ok: true, ready: true });
  });

  app.get('/livez', (c) =>
    c.json({ ok: true, alive: true, uptime_seconds: Math.round((Date.now() - STARTED_AT) / 1000) }),
  );

  return app;
}

// Export so other modules can read recent runs / table counts if needed.
export const __health = { tablesStatus, pipelineStatus, STARTED_AT, VERSION };

// Light-touch helper to compute total inserted rows since boot, for debugging dashboards.
export function totalRowsSeed(): number {
  let total = 0;
  for (const t of TABLE_LIST) {
    try {
      const r = queryOne<CountRow>(`SELECT COUNT(*) AS c FROM ${t}`);
      total += r?.c ?? 0;
    } catch {
      // ignore
    }
  }
  return total;
}

// Top-5 most common audit actions in the last hour — for debugging.
export function topActivity(): Array<{ action: string; c: number }> {
  try {
    return query<{ action: string; c: number }>(
      `SELECT action, COUNT(*) AS c FROM audit_log
       WHERE ts >= datetime('now','-1 hour')
       GROUP BY action ORDER BY c DESC LIMIT 5`,
    );
  } catch {
    return [];
  }
}
