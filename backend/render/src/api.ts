/**
 * Hono API routes cho Render Farm.
 *
 * Endpoints:
 *   POST /api/render/room              — render 1 room 1 style 8 angles
 *   POST /api/render/all-styles        — 9 styles x 8 angles
 *   POST /api/render/360               — 360 panorama walkthrough
 *   GET  /api/render/job/:id           — status + progress 1 job
 *   GET  /api/render/results/:projectId — list all rendered files
 *   GET  /api/render/cost-estimate     — uoc tinh chi phi truoc khi run
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { RenderFarm as RenderFarmLegacy } from './render-farm.js';
import { LocalStorageAdapter } from './storage.js';
import { ZeniL3Client } from './zeni-l3-client.js';
import { globalJobRegistry } from './queue.js';
import { ALL_STYLES, ALL_ANGLES, QUALITY_PRESETS, VND_PER_USD, RenderJobOptsSchema } from './types.js';
import type {
  RenderRoomOptions, RenderAllStylesOptions, Walkthrough360Options,
  Style, RoomType, CungMenh, Quality,
} from './types.js';
import { RenderFarm as RenderFarmV2 } from './index.js';

// ============================================================
// Body validators (light, runtime)
// ============================================================
function isStr(x: unknown): x is string {
  return typeof x === 'string' && x.length > 0;
}

function asStyle(s: unknown): Style | null {
  return ALL_STYLES.includes(s as Style) ? (s as Style) : null;
}

const ROOM_TYPES: RoomType[] = ['living', 'bedroom', 'kitchen', 'bathroom', 'office', 'dining', 'foyer'];
function asRoomType(s: unknown): RoomType | null {
  return ROOM_TYPES.includes(s as RoomType) ? (s as RoomType) : null;
}

const CUNG_MENH_LIST: CungMenh[] = ['kham', 'khon', 'chan', 'ton', 'can', 'doai', 'cangroup', 'ly', 'unknown'];
function asCungMenh(s: unknown): CungMenh | null {
  return CUNG_MENH_LIST.includes(s as CungMenh) ? (s as CungMenh) : null;
}

function asQuality(s: unknown): Quality | null {
  return s === 'preview' || s === 'production' ? s : null;
}

// ============================================================
// Factory
// ============================================================
export function createRenderApp(opts?: {
  farm?: RenderFarmLegacy;
  farmV2?: RenderFarmV2;
}): Hono {
  const farm = opts?.farm ?? new RenderFarmLegacy({
    client: new ZeniL3Client(),
    storage: new LocalStorageAdapter(),
    registry: globalJobRegistry,
  });
  const farmV2 = opts?.farmV2 ?? new RenderFarmV2();
  const storage = (farm as unknown as { storage: LocalStorageAdapter }).storage;

  const app = new Hono();

  // ============================================================
  // SPEC v2 — submitJob batch API
  // ============================================================

  // POST /api/render/submit
  app.post('/api/render/submit', async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: 'invalid json body' }, 400);
    const parsed = RenderJobOptsSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'validation failed', issues: parsed.error.issues }, 400);
    }
    const { jobId, estimatedSec } = await farmV2.submitJob(parsed.data);
    return c.json({ jobId, estimatedSec });
  });

  // GET /api/render/job/:jobId
  app.get('/api/render/job/:jobId', async (c) => {
    const id = c.req.param('jobId');
    try {
      const status = await farmV2.getStatus(id);
      return c.json(status);
    } catch {
      // Fallback toi legacy registry
      const job = globalJobRegistry.getJob(id);
      if (!job) return c.json({ error: 'job not found' }, 404);
      return c.json(job);
    }
  });

  // GET /api/render/job/:jobId/results
  app.get('/api/render/job/:jobId/results', async (c) => {
    const id = c.req.param('jobId');
    try {
      const results = await farmV2.getResults(id);
      return c.json({ jobId: id, count: results.length, results });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 404);
    }
  });

  // SSE /api/render/stream/:jobId
  app.get('/api/render/stream/:jobId', (c) => {
    const id = c.req.param('jobId');
    return streamSSE(c, async (stream) => {
      let lastCompleted = -1;
      let lastFailed = -1;
      while (true) {
        let info;
        try {
          info = await farmV2.getStatus(id);
        } catch {
          await stream.writeSSE({ event: 'error', data: JSON.stringify({ error: 'job not found' }) });
          return;
        }
        if (info.completed !== lastCompleted || info.failed !== lastFailed) {
          await stream.writeSSE({
            event: 'progress',
            data: JSON.stringify({
              jobId: id,
              completed: info.completed,
              failed: info.failed,
              total: info.totalRenders,
              status: info.status,
              costUsd: info.costUsdSoFar,
            }),
          });
          lastCompleted = info.completed;
          lastFailed = info.failed;
        }
        if (info.status === 'done' || info.status === 'failed' || info.status === 'cancelled') {
          await stream.writeSSE({ event: 'done', data: JSON.stringify(info) });
          return;
        }
        await stream.sleep(500);
      }
    });
  });

  // ============================================================
  // LEGACY v1 endpoints (Wave 1 compat)
  // ============================================================

  // ------------------------------------------------------------
  // POST /api/render/room
  // ------------------------------------------------------------
  app.post('/api/render/room', async (c) => {
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return c.json({ error: 'invalid json body' }, 400);

    const projectId = body.projectId ?? body.project_id;
    const roomType = asRoomType(body.roomType ?? body.room_type);
    const style = asStyle(body.style);
    const cungMenh = asCungMenh(body.cung_menh ?? body.cungMenh ?? 'unknown');
    const layout = (body.layout_2d_path as string) ?? '';
    const numAngles = typeof body.num_angles === 'number' ? body.num_angles : 8;
    const quality = asQuality(body.quality) ?? 'preview';

    if (!isStr(projectId) || !roomType || !style || !cungMenh) {
      return c.json({ error: 'required: projectId, roomType, style, cung_menh' }, 400);
    }

    const renderOpts: RenderRoomOptions = {
      projectId,
      roomType,
      style,
      cung_menh: cungMenh,
      layout_2d_path: layout,
      num_angles: numAngles,
      quality,
    };
    const result = await farm.renderRoom(renderOpts);
    return c.json(result);
  });

  // ------------------------------------------------------------
  // POST /api/render/all-styles
  // ------------------------------------------------------------
  app.post('/api/render/all-styles', async (c) => {
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return c.json({ error: 'invalid json body' }, 400);

    const projectId = body.projectId ?? body.project_id;
    const roomType = asRoomType(body.roomType ?? body.room_type);
    const cungMenh = asCungMenh(body.cung_menh ?? body.cungMenh ?? 'unknown');
    const layout = (body.layout_2d_path as string) ?? '';
    const numAngles = typeof body.num_angles === 'number' ? body.num_angles : 8;
    const quality = asQuality(body.quality) ?? 'preview';
    const stylesIn = Array.isArray(body.styles)
      ? body.styles.map(asStyle).filter((s): s is Style => s !== null)
      : ALL_STYLES;

    if (!isStr(projectId) || !roomType || !cungMenh) {
      return c.json({ error: 'required: projectId, roomType, cung_menh' }, 400);
    }

    const renderOpts: RenderAllStylesOptions = {
      projectId,
      roomType,
      cung_menh: cungMenh,
      layout_2d_path: layout,
      num_angles: numAngles,
      quality,
      styles: stylesIn,
    };
    const result = await farm.renderAll9Styles(renderOpts);
    return c.json(result);
  });

  // ------------------------------------------------------------
  // POST /api/render/360
  // ------------------------------------------------------------
  app.post('/api/render/360', async (c) => {
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return c.json({ error: 'invalid json body' }, 400);

    const projectId = body.projectId ?? body.project_id;
    const roomType = asRoomType(body.roomType ?? body.room_type);
    const style = asStyle(body.style);
    const cungMenh = asCungMenh(body.cung_menh ?? body.cungMenh ?? 'unknown');
    const quality = asQuality(body.quality) ?? 'production';

    if (!isStr(projectId) || !roomType || !style || !cungMenh) {
      return c.json({ error: 'required: projectId, roomType, style, cung_menh' }, 400);
    }

    const opts: Walkthrough360Options = {
      projectId,
      roomType,
      style,
      cung_menh: cungMenh,
      quality,
    };
    const result = await farm.render360(opts);
    return c.json(result);
  });

  // ------------------------------------------------------------
  // GET /api/render/legacy-job/:id  (Wave 1 registry compat)
  // ------------------------------------------------------------
  app.get('/api/render/legacy-job/:id', (c) => {
    const id = c.req.param('id');
    const job = globalJobRegistry.getJob(id);
    if (!job) return c.json({ error: 'job not found' }, 404);
    return c.json(job);
  });

  // ------------------------------------------------------------
  // GET /api/render/results/:projectId
  // ------------------------------------------------------------
  app.get('/api/render/results/:projectId', async (c) => {
    const projectId = c.req.param('projectId');
    const files = await storage.list(projectId);
    return c.json({
      project_id: projectId,
      file_count: files.length,
      files,
    });
  });

  // ------------------------------------------------------------
  // GET /api/render/cost-estimate
  // ------------------------------------------------------------
  app.get('/api/render/cost-estimate', (c) => {
    const numRooms = parseInt(c.req.query('num_rooms') ?? '1', 10);
    const numStyles = parseInt(c.req.query('num_styles') ?? '9', 10);
    const numAngles = parseInt(c.req.query('num_angles') ?? '8', 10);
    const include360 = c.req.query('include_360') === 'true';
    const quality = (c.req.query('quality') as Quality) ?? 'preview';

    const spec = QUALITY_PRESETS[quality] ?? QUALITY_PRESETS.preview;
    const numFrames = numRooms * numStyles * numAngles;
    const frameUsd = numFrames * spec.cost_usd;
    const pano360Usd = include360 ? numRooms * 6 * spec.cost_usd : 0;
    const totalUsd = frameUsd + pano360Usd;

    return c.json({
      num_rooms: numRooms,
      num_styles: numStyles,
      num_angles: numAngles,
      quality,
      include_360: include360,
      breakdown: {
        room_renders: numFrames,
        room_renders_usd: roundCurrency(frameUsd),
        panorama_360_faces: include360 ? numRooms * 6 : 0,
        panorama_360_usd: roundCurrency(pano360Usd),
      },
      total_images: numFrames + (include360 ? numRooms * 6 : 0),
      total_usd: roundCurrency(totalUsd),
      total_vnd: Math.round(totalUsd * VND_PER_USD),
    });
  });

  return app;
}

function roundCurrency(n: number): number {
  return Math.round(n * 100) / 100;
}
