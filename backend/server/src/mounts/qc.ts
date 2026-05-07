/**
 * mounts/qc.ts — mount /api/qc/* (lazy-load QC sub-app).
 *
 * QC module export createQCApp() return Hono. Server mount sub-app
 * dung pattern Hono.route('/', sub) khi co request dau tien.
 */

import type { Hono } from 'hono';
import { loadExternal } from '../lib/external-loader.js';

interface QcMod {
  createQCApp: () => Hono;
}

let qcSubApp: Hono | null = null;
async function ensureSub(): Promise<Hono | null> {
  if (qcSubApp) return qcSubApp;
  try {
    const mod = await loadExternal<QcMod>('qc/src/api.js');
    qcSubApp = mod.createQCApp();
    return qcSubApp;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[qc] load failed:', (e as Error).message);
    return null;
  }
}

export function mountQCRoutes(app: Hono): void {
  // Health phai dang ky TRUOC wildcard de avoid bi sub-app block
  app.get('/api/qc/health', (c) => c.json({ ok: true, service: 'qc', gates: 12 }));

  // Proxy: forward request /api/qc/* sang sub-app
  app.all('/api/qc/*', async (c) => {
    const sub = await ensureSub();
    if (!sub) return c.json({ ok: false, error: 'qc_unavailable' }, 503);
    return sub.fetch(c.req.raw);
  });
}
