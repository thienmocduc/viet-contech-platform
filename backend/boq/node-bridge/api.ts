/**
 * api.ts - Hono routes cho BOQ Engine
 * =====================================
 * POST /api/boq/extract  - DXF URL -> quantities
 * POST /api/boq/generate - quantities + meta -> BOQ JSON
 * POST /api/boq/export   - BOQ JSON -> .xlsx URL
 *
 * Hono is loaded dynamically — backend/package.json may not have it yet.
 * If Hono is not installed, import only the handlers (extractHandler,
 * generateHandler, exportHandler) and bind them to your framework manually.
 */
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - hono is optional at type-check time
import type { Hono as HonoT } from 'hono';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  ExtractRequestSchema,
  GenerateRequestSchema,
  ExportRequestSchema,
} from './types.js';
import {
  extractQuantities,
  generateBOQ,
  exportBOQExcel,
} from './index.js';

const BOQ_TMP_DIR = resolve(
  process.env.BOQ_TMP_DIR || join(process.cwd(), 'data', 'boq-tmp'),
);
const BOQ_EXPORT_DIR = resolve(
  process.env.BOQ_EXPORT_DIR || join(process.cwd(), 'data', 'boq-exports'),
);
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || '';

/**
 * Helper: tai DXF tu URL ve disk (de Python doc).
 */
async function downloadDxf(url: string): Promise<string> {
  await mkdir(BOQ_TMP_DIR, { recursive: true });

  // Local path (Windows or Unix absolute)
  if (/^[A-Za-z]:[\\/]/.test(url) || url.startsWith('/')) {
    return url;
  }

  // Remote URL: download
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Cannot fetch DXF: ${res.status} ${res.statusText}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const localPath = join(BOQ_TMP_DIR, `${randomUUID()}.dxf`);
  await writeFile(localPath, buf);
  return localPath;
}

// ============================================================
// FRAMEWORK-AGNOSTIC HANDLERS
// Type signature compatible with Hono / Express / Fastify wrappers.
// ============================================================
export type HandlerInput = unknown;
export type HandlerResult = {
  status: number;
  body: Record<string, unknown>;
};

export async function extractHandler(
  body: HandlerInput,
): Promise<HandlerResult> {
  try {
    const parsed = ExtractRequestSchema.parse(body);
    const dxfPath = await downloadDxf(parsed.dxf_url);
    const quantities = await extractQuantities(dxfPath);
    return {
      status: 200,
      body: { ok: true, project_id: parsed.project_id, quantities },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: 400, body: { ok: false, error: message } };
  }
}

export async function generateHandler(
  body: HandlerInput,
): Promise<HandlerResult> {
  try {
    const parsed = GenerateRequestSchema.parse(body);
    const boq = await generateBOQ(
      parsed.quantities,
      parsed.project_meta,
      parsed.materials_override,
    );
    return { status: 200, body: { ok: true, boq } };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: 400, body: { ok: false, error: message } };
  }
}

export async function exportHandler(
  body: HandlerInput,
): Promise<HandlerResult> {
  try {
    const parsed = ExportRequestSchema.parse(body);

    if (parsed.format === 'pdf') {
      return {
        status: 501,
        body: { ok: false, error: 'PDF export not implemented yet' },
      };
    }

    await mkdir(BOQ_EXPORT_DIR, { recursive: true });
    const filename = `${parsed.project_id}-${parsed.revision_id || 'rev'}-${Date.now()}.xlsx`;
    const outputPath = join(BOQ_EXPORT_DIR, filename);
    const xlsxPath = await exportBOQExcel(parsed.boq, outputPath);
    const { stat } = await import('node:fs/promises');
    const stats = await stat(xlsxPath);

    const url = PUBLIC_BASE_URL
      ? `${PUBLIC_BASE_URL}/static/boq-exports/${filename}`
      : `/static/boq-exports/${filename}`;

    return {
      status: 200,
      body: {
        ok: true,
        project_id: parsed.project_id,
        revision_id: parsed.revision_id,
        format: parsed.format,
        url,
        path: xlsxPath,
        size_bytes: stats.size,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: 400, body: { ok: false, error: message } };
  }
}

export function healthHandler(): HandlerResult {
  return {
    status: 200,
    body: {
      ok: true,
      service: 'boq-engine',
      python_dir: resolve(process.cwd(), 'boq', 'python'),
      tmp_dir: BOQ_TMP_DIR,
      export_dir: BOQ_EXPORT_DIR,
    },
  };
}

// ============================================================
// HONO ROUTER (optional — only used when Hono is installed)
// Usage:
//   import { mountBOQRouter } from './api';
//   const app = new Hono();
//   await mountBOQRouter(app);
// ============================================================
export async function mountBOQRouter(app: HonoT): Promise<HonoT> {
  app.post('/api/boq/extract', async (c: { req: { json: () => Promise<unknown> }; json: (o: unknown, s?: number) => unknown }) => {
    const r = await extractHandler(await c.req.json());
    return c.json(r.body, r.status);
  });
  app.post('/api/boq/generate', async (c: { req: { json: () => Promise<unknown> }; json: (o: unknown, s?: number) => unknown }) => {
    const r = await generateHandler(await c.req.json());
    return c.json(r.body, r.status);
  });
  app.post('/api/boq/export', async (c: { req: { json: () => Promise<unknown> }; json: (o: unknown, s?: number) => unknown }) => {
    const r = await exportHandler(await c.req.json());
    return c.json(r.body, r.status);
  });
  app.get('/api/boq/health', (c: { json: (o: unknown, s?: number) => unknown }) => {
    const r = healthHandler();
    return c.json(r.body, r.status);
  });
  return app;
}
