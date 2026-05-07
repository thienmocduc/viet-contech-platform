/**
 * mounts/boq.ts — mount /api/boq/* (lazy-load BOQ bridge).
 */

import type { Hono } from 'hono';
import { loadExternal } from '../lib/external-loader.js';

interface BoqHandlers {
  extractHandler: (b: unknown) => Promise<{ status: number; body: Record<string, unknown> }>;
  generateHandler: (b: unknown) => Promise<{ status: number; body: Record<string, unknown> }>;
  exportHandler: (b: unknown) => Promise<{ status: number; body: Record<string, unknown> }>;
  healthHandler: () => { status: number; body: Record<string, unknown> };
}
let cached: BoqHandlers | null = null;
async function getMod(): Promise<BoqHandlers | null> {
  if (cached) return cached;
  try {
    cached = await loadExternal<BoqHandlers>('boq/node-bridge/api.js');
    return cached;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[boq] load failed:', (e as Error).message);
    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function code(s: number): any {
  return s;
}

export function mountBOQRoutes(app: Hono): void {
  app.post('/api/boq/extract', async (c) => {
    const mod = await getMod();
    if (!mod) return c.json({ ok: false, error: 'boq_unavailable' }, 503);
    const body = await c.req.json().catch(() => ({}));
    const r = await mod.extractHandler(body);
    return c.json(r.body, code(r.status));
  });
  app.post('/api/boq/generate', async (c) => {
    const mod = await getMod();
    if (!mod) return c.json({ ok: false, error: 'boq_unavailable' }, 503);
    const body = await c.req.json().catch(() => ({}));
    const r = await mod.generateHandler(body);
    return c.json(r.body, code(r.status));
  });
  app.post('/api/boq/export', async (c) => {
    const mod = await getMod();
    if (!mod) return c.json({ ok: false, error: 'boq_unavailable' }, 503);
    const body = await c.req.json().catch(() => ({}));
    const r = await mod.exportHandler(body);
    return c.json(r.body, code(r.status));
  });
  app.get('/api/boq/health', async (c) => {
    const mod = await getMod();
    if (!mod) return c.json({ ok: false, error: 'boq_unavailable' }, 503);
    const r = mod.healthHandler();
    return c.json(r.body, code(r.status));
  });
}
