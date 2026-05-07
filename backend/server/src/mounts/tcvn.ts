/**
 * mounts/tcvn.ts — mount /api/tcvn/*.
 * Lazy-load tcvn engine khi co request dau tien (avoid tsc follow source).
 */

import type { Hono } from 'hono';
import { z } from 'zod';
import { loadExternal } from '../lib/external-loader.js';

interface TcvnEngine {
  loadRules: (dir?: string) => unknown[];
  validateDesign: (design: unknown, rules: unknown[]) => unknown[];
  summarize: (results: unknown[]) => {
    total_rules: number;
    passed: number;
    failed: number;
    warnings: number;
    skipped: number;
    results: unknown[];
  };
}

let cachedEngine: TcvnEngine | null = null;
let cachedRules: unknown[] | null = null;
async function getEngine(): Promise<TcvnEngine> {
  if (cachedEngine) return cachedEngine;
  const mod = await loadExternal<TcvnEngine>('tcvn/src/engine.js');
  cachedEngine = mod;
  return mod;
}
async function rules(): Promise<unknown[]> {
  if (cachedRules) return cachedRules;
  try {
    const eng = await getEngine();
    cachedRules = eng.loadRules();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[tcvn] loadRules failed:', (e as Error).message);
    cachedRules = [];
  }
  return cachedRules;
}

const ValidateSchema = z.object({
  design: z.record(z.unknown()),
});

interface RuleShape {
  code: string;
  category: string;
  standard: string;
  severity: string;
  statement_vi: string;
}

export function mountTCVNRoutes(app: Hono): void {
  app.get('/api/tcvn/rules', async (c) => {
    const list = (await rules()) as RuleShape[];
    const byCategory: Record<string, number> = {};
    for (const r of list) byCategory[r.category] = (byCategory[r.category] ?? 0) + 1;
    return c.json({
      ok: true,
      total: list.length,
      by_category: byCategory,
      sample: list.slice(0, 20).map((r) => ({
        code: r.code,
        category: r.category,
        standard: r.standard,
        severity: r.severity,
        statement_vi: r.statement_vi,
      })),
    });
  });

  app.get('/api/tcvn/rules/:code', async (c) => {
    const code = c.req.param('code');
    const list = (await rules()) as RuleShape[];
    const r = list.find((x) => x.code === code);
    if (!r) return c.json({ ok: false, error: 'rule_not_found' }, 404);
    return c.json({ ok: true, rule: r });
  });

  app.post('/api/tcvn/validate', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = ValidateSchema.safeParse(body);
    if (!parsed.success) return c.json({ ok: false, error: 'invalid_input' }, 400);
    const eng = await getEngine();
    const out = eng.validateDesign(parsed.data.design, await rules());
    return c.json({ ok: true, report: eng.summarize(out) });
  });
}
