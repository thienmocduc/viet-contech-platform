/**
 * MEP routing API — designed for Hono.
 *
 * If Hono is installed in the parent backend, the routes auto-register; otherwise
 * the lightweight `mepHandlers` adapter can be wired into any Node HTTP server.
 *
 *   POST /api/mep/electric   { layout_json } → ElectricSystem
 *   POST /api/mep/plumbing   { layout_json } → PlumbingSystem
 *   POST /api/mep/camera     { layout_json, fov?, range? } → { cameras, coverage }
 *   POST /api/mep/all        { layout_json } → MEPSystem
 */

import { routeElectric } from './routing/electric.js';
import { routePlumbing } from './routing/plumbing.js';
import { placeCameras } from './routing/camera.js';
import { computeCoverage } from './routing/coverage.js';
import type {
  CameraOptions,
  ElectricSystem,
  LayoutJSON,
  MEPSystem,
  PlumbingSystem,
} from './types.js';

// ============================================================
// Pure handler functions (transport-agnostic)
// ============================================================

export const mepHandlers = {
  electric(layout: LayoutJSON): ElectricSystem {
    return routeElectric(layout);
  },
  plumbing(layout: LayoutJSON): PlumbingSystem {
    return routePlumbing(layout);
  },
  camera(layout: LayoutJSON, opts: CameraOptions = {}) {
    const cameras = placeCameras(layout, opts);
    const coverage = computeCoverage(layout, cameras, opts.cell_size_mm ?? 500);
    return { cameras, coverage };
  },
  all(layout: LayoutJSON, opts: CameraOptions = {}): MEPSystem {
    const electric = routeElectric(layout);
    const plumbing = routePlumbing(layout);
    const cameras = placeCameras(layout, opts);
    const coverage = computeCoverage(layout, cameras, opts.cell_size_mm ?? 500);
    return { electric, plumbing, cameras, coverage };
  },
};

// ============================================================
// Hono router builder (optional)
// ============================================================

interface HonoLike {
  post(path: string, handler: (c: HonoCtx) => Promise<unknown> | unknown): unknown;
}

interface HonoCtx {
  req: { json(): Promise<unknown> };
  json(value: unknown, status?: number): unknown;
}

export function registerMepRoutes(app: HonoLike): HonoLike {
  app.post('/api/mep/electric', async (c) => {
    const body = (await c.req.json()) as { layout_json?: LayoutJSON } | LayoutJSON;
    const layout = extractLayout(body);
    if (!layout) return c.json({ error: 'layout_json required' }, 400);
    return c.json(mepHandlers.electric(layout));
  });

  app.post('/api/mep/plumbing', async (c) => {
    const body = (await c.req.json()) as { layout_json?: LayoutJSON } | LayoutJSON;
    const layout = extractLayout(body);
    if (!layout) return c.json({ error: 'layout_json required' }, 400);
    return c.json(mepHandlers.plumbing(layout));
  });

  app.post('/api/mep/camera', async (c) => {
    const body = (await c.req.json()) as { layout_json?: LayoutJSON; fov?: number; range?: number };
    const layout = extractLayout(body);
    if (!layout) return c.json({ error: 'layout_json required' }, 400);
    const opts: CameraOptions = {};
    if (typeof body?.fov === 'number') opts.fov_degrees = body.fov;
    if (typeof body?.range === 'number') opts.max_range_mm = body.range;
    return c.json(mepHandlers.camera(layout, opts));
  });

  app.post('/api/mep/all', async (c) => {
    const body = (await c.req.json()) as { layout_json?: LayoutJSON };
    const layout = extractLayout(body);
    if (!layout) return c.json({ error: 'layout_json required' }, 400);
    return c.json(mepHandlers.all(layout));
  });

  return app;
}

function extractLayout(body: unknown): LayoutJSON | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (b.layout_json && typeof b.layout_json === 'object') return b.layout_json as unknown as LayoutJSON;
  if (Array.isArray(b.rooms)) return b as unknown as LayoutJSON;
  return null;
}
