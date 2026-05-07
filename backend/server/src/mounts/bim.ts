/**
 * mounts/bim.ts — mount /api/bim/* (lazy-load BIM bridge).
 */

import type { Hono } from 'hono';
import { loadExternal } from '../lib/external-loader.js';

interface BimMod {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleGenerate: (b: any) => Promise<unknown>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleClash: (b: any) => Promise<unknown>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleResolve: (b: any) => Promise<unknown>;
  handleListElements: (q: {
    project_id: string;
    revision_id?: string | undefined;
    type?: string | undefined;
    limit?: number | undefined;
  }) => unknown[];
}

let cached: BimMod | null = null;
async function getMod(): Promise<BimMod | null> {
  if (cached) return cached;
  try {
    cached = await loadExternal<BimMod>('bim/node-bridge/api.js');
    return cached;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[bim] load failed:', (e as Error).message);
    return null;
  }
}

export function mountBIMRoutes(app: Hono): void {
  app.post('/api/bim/generate', async (c) => {
    const mod = await getMod();
    if (!mod) return c.json({ ok: false, error: 'bim_unavailable' }, 503);
    try {
      const body = await c.req.json();
      return c.json((await mod.handleGenerate(body)) as Record<string, unknown>);
    } catch (e) {
      return c.json({ ok: false, error: (e as Error).message }, 500);
    }
  });

  app.post('/api/bim/clash', async (c) => {
    const mod = await getMod();
    if (!mod) return c.json({ ok: false, error: 'bim_unavailable' }, 503);
    try {
      const body = await c.req.json();
      return c.json((await mod.handleClash(body)) as Record<string, unknown>);
    } catch (e) {
      return c.json({ ok: false, error: (e as Error).message }, 500);
    }
  });

  app.post('/api/bim/resolve', async (c) => {
    const mod = await getMod();
    if (!mod) return c.json({ ok: false, error: 'bim_unavailable' }, 503);
    try {
      const body = await c.req.json();
      return c.json((await mod.handleResolve(body)) as Record<string, unknown>);
    } catch (e) {
      return c.json({ ok: false, error: (e as Error).message }, 500);
    }
  });

  app.get('/api/bim/elements', async (c) => {
    const mod = await getMod();
    if (!mod) return c.json({ ok: false, error: 'bim_unavailable' }, 503);
    try {
      const project_id = c.req.query('project_id');
      if (!project_id) return c.json({ ok: false, error: 'project_id required' }, 400);
      const items = mod.handleListElements({
        project_id,
        revision_id: c.req.query('revision_id'),
        type: c.req.query('type'),
        limit: c.req.query('limit') ? Number(c.req.query('limit')) : undefined,
      });
      return c.json({ ok: true, total: items.length, elements: items });
    } catch (e) {
      return c.json({ ok: false, error: (e as Error).message }, 500);
    }
  });

  app.get('/api/bim/health', (c) =>
    c.json({ ok: true, service: 'bim-bridge', python: 'lazy' }),
  );
}
