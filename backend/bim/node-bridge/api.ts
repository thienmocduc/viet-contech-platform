/**
 * api.ts — Hono HTTP routes cho BIM module
 * ==========================================
 *
 * Routes:
 *   POST /api/bim/generate    — DXF/JSON-layers -> IFC
 *   POST /api/bim/clash       — Detect clash 3-layer
 *   POST /api/bim/resolve     — Auto-fix or escalate
 *   GET  /api/bim/elements    — List elements (filter type)
 *
 * Cau truc:
 *   - Goi Python script qua child_process (`python from_dxf.py ...`)
 *   - Insert ket qua vao bang `bim_elements` + `clash_detections`
 *     dung helper `query/exec/tx/hash` o `src/lib/db.ts`
 *
 * Hono khong bat buoc — neu `hono` chua cai (pipeline backend cua minh
 * hien tai khong co), file nay tu fallback dung Node http server. Khi
 * agent_runner di kem cai Hono, swap import duong line `IF_HONO`.
 */

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

// Import DB layer cua platform (relative tu node-bridge/ ve src/lib/)
import {
  exec as dbExec,
  query as dbQuery,
  tx as dbTx,
  hash as dbHash,
} from '../../src/lib/db.js';

// ============================================================
// Types matching DB
// ============================================================
export interface BimElementRow {
  id: string;
  project_id: string;
  revision_id: string;
  guid: string;
  type: string;
  geometry_json: string;
  material_id: string | null;
  parent_element_id: string | null;
  ifc_class: string | null;
  created_at: string;
}

export interface ClashRow {
  id: string;
  project_id: string;
  revision_id: string;
  element_a_guid: string;
  element_b_guid: string;
  intersection_volume_mm3: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'resolving' | 'resolved' | 'ignored';
  ran_at: string;
}

// ============================================================
// Python runner
// ============================================================
const BIM_PYTHON_DIR = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')),
  '..',
  'python',
);

function runPython(script: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const py = spawn('python', [path.join(BIM_PYTHON_DIR, script), ...args], {
      cwd: BIM_PYTHON_DIR,
    });
    let out = '';
    let err = '';
    py.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()));
    py.stderr.on('data', (chunk: Buffer) => (err += chunk.toString()));
    py.on('close', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`python ${script} exit=${code}: ${err}`));
    });
  });
}

// ============================================================
// DB helpers
// ============================================================
function severityFromClash(c: { kind: string; severity?: string }): ClashRow['severity'] {
  if (c.kind === 'hard') {
    return c.severity === 'critical' ? 'critical' : 'high';
  }
  if (c.kind === 'soft') {
    return (c.severity as ClashRow['severity']) ?? 'medium';
  }
  return 'low'; // workflow
}

function insertElements(
  projectId: string,
  revisionId: string,
  elements: Array<{
    guid: string;
    type: string;
    ifc_class: string;
    geometry: unknown;
    parent_guid: string | null;
  }>,
): number {
  return dbTx(() => {
    const stmt = `
      INSERT OR REPLACE INTO bim_elements
        (id, project_id, revision_id, guid, type, geometry_json, material_id,
         parent_element_id, ifc_class)
      VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)
    `;
    let count = 0;
    for (const e of elements) {
      // Resolve parent_element_id tu parent_guid (look-up ngay trong revision)
      let parentId: string | null = null;
      if (e.parent_guid) {
        const parent = dbQuery<{ id: string }>(
          'SELECT id FROM bim_elements WHERE revision_id=? AND guid=? LIMIT 1',
          [revisionId, e.parent_guid],
        )[0];
        parentId = parent?.id ?? null;
      }
      const id = `BE-${crypto.randomUUID().slice(0, 12)}`;
      dbExec(stmt, [
        id,
        projectId,
        revisionId,
        e.guid,
        e.type,
        JSON.stringify(e.geometry),
        parentId,
        e.ifc_class,
      ]);
      count++;
    }
    return count;
  });
}

function insertClashes(
  projectId: string,
  revisionId: string,
  clashes: Array<{
    element_a_guid: string;
    element_b_guid: string;
    intersection_volume_mm3: number;
    kind: string;
    severity?: string;
  }>,
): number {
  return dbTx(() => {
    let count = 0;
    for (const c of clashes) {
      const id = `CL-${crypto.randomUUID().slice(0, 12)}`;
      dbExec(
        `INSERT INTO clash_detections
           (id, project_id, revision_id, element_a_guid, element_b_guid,
            intersection_volume_mm3, severity, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'open')`,
        [
          id,
          projectId,
          revisionId,
          c.element_a_guid,
          c.element_b_guid,
          c.intersection_volume_mm3,
          severityFromClash(c),
        ],
      );
      count++;
    }
    return count;
  });
}

// ============================================================
// Handlers (framework-agnostic — work with Hono / Express / raw http)
// ============================================================
export interface GenerateBody {
  project_id: string;
  revision_id: string;
  dxf_layout: string | { layers: Record<string, unknown> }; // path or inline
  options?: {
    level_height_mm?: number;
    num_levels?: number;
  };
}

export interface GenerateResponse {
  ok: boolean;
  ifc_url: string;
  element_count: number;
  summary: Record<string, number>;
  inserted_db: number;
}

export async function handleGenerate(body: GenerateBody): Promise<GenerateResponse> {
  // Ghi dxf_layout ra file tam neu la inline JSON
  let dxfPath: string;
  if (typeof body.dxf_layout === 'string') {
    dxfPath = body.dxf_layout;
  } else {
    const tmp = await mkdtemp(path.join(tmpdir(), 'vct-bim-'));
    dxfPath = path.join(tmp, 'layout.dxf.json');
    await writeFile(dxfPath, JSON.stringify(body.dxf_layout), 'utf8');
  }
  const outIfc = path.join(path.dirname(dxfPath), 'out.ifc');

  // Goi Python qua mot helper script - tao 1 wrapper inline
  const script = `
import json, sys
sys.path.insert(0, ${JSON.stringify(BIM_PYTHON_DIR)})
from from_dxf import dxf_to_ifc
res = dxf_to_ifc(${JSON.stringify(dxfPath)},
                 level_height_mm=${body.options?.level_height_mm ?? 3300},
                 num_levels=${body.options?.num_levels ?? 3},
                 output_path=${JSON.stringify(outIfc)})
print(json.dumps(res))
`;
  const result = await new Promise<string>((resolve, reject) => {
    const py = spawn('python', ['-c', script]);
    let out = '';
    let err = '';
    py.stdout.on('data', (c: Buffer) => (out += c.toString()));
    py.stderr.on('data', (c: Buffer) => (err += c.toString()));
    py.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(err))));
  });
  const parsed = JSON.parse(result.trim().split('\n').pop() || '{}');
  const elements = parsed.elements as Array<{
    guid: string;
    type: string;
    ifc_class: string;
    geometry: unknown;
    parent_guid: string | null;
  }>;

  const insertedCount = insertElements(body.project_id, body.revision_id, elements);

  return {
    ok: true,
    ifc_url: parsed.ifc_path,
    element_count: parsed.count,
    summary: parsed.summary,
    inserted_db: insertedCount,
  };
}

export interface ClashBody {
  project_id: string;
  revision_id: string;
  ifc_url: string;
  soft_clearance_overrides?: Record<string, number>;
}

export interface ClashResponse {
  ok: boolean;
  total: number;
  by_kind: Record<string, number>;
  clashes: Array<Record<string, unknown>>;
  inserted_db: number;
}

export async function handleClash(body: ClashBody): Promise<ClashResponse> {
  const overridesStr = JSON.stringify(body.soft_clearance_overrides ?? {});
  const script = `
import json, sys
sys.path.insert(0, ${JSON.stringify(BIM_PYTHON_DIR)})
from clash_detection import detect_clashes
clashes = detect_clashes(${JSON.stringify(body.ifc_url)},
                         soft_clearance_overrides=${overridesStr})
print(json.dumps(clashes))
`;
  const result = await new Promise<string>((resolve, reject) => {
    const py = spawn('python', ['-c', script]);
    let out = '';
    let err = '';
    py.stdout.on('data', (c: Buffer) => (out += c.toString()));
    py.stderr.on('data', (c: Buffer) => (err += c.toString()));
    py.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(err))));
  });
  const clashes = JSON.parse(result.trim().split('\n').pop() || '[]') as Array<{
    kind: string;
    severity: string;
    element_a_guid: string;
    element_b_guid: string;
    intersection_volume_mm3: number;
  }>;
  const byKind = clashes.reduce<Record<string, number>>((acc, c) => {
    acc[c.kind] = (acc[c.kind] ?? 0) + 1;
    return acc;
  }, {});

  const inserted = insertClashes(body.project_id, body.revision_id, clashes);
  return {
    ok: true,
    total: clashes.length,
    by_kind: byKind,
    clashes,
    inserted_db: inserted,
  };
}

export interface ResolveBody {
  project_id: string;
  revision_id: string;
  ifc_url: string;
  clash_id?: string; // resolve 1 clash, neu khong co thi resolve all
}

export async function handleResolve(body: ResolveBody): Promise<{
  ok: boolean;
  fixed: number;
  escalated: number;
  ifc_after_url: string;
  actions: unknown[];
}> {
  // Load clash list tu DB neu co clash_id
  const dbClashes = body.clash_id
    ? dbQuery<ClashRow>('SELECT * FROM clash_detections WHERE id=?', [body.clash_id])
    : dbQuery<ClashRow>(
        'SELECT * FROM clash_detections WHERE revision_id=? AND status=?',
        [body.revision_id, 'open'],
      );
  // Convert sang format Python expect
  const clashesPy = dbClashes.map((c) => ({
    id: c.id,
    element_a_guid: c.element_a_guid,
    element_b_guid: c.element_b_guid,
    intersection_volume_mm3: c.intersection_volume_mm3,
    kind:
      c.severity === 'critical' || c.severity === 'high'
        ? 'hard'
        : c.severity === 'low'
          ? 'workflow'
          : 'soft',
    severity: c.severity,
    auto_fixable: c.severity !== 'critical',
    suggestion: '',
  }));

  const tmp = await mkdtemp(path.join(tmpdir(), 'vct-bim-resolve-'));
  const clashFile = path.join(tmp, 'clashes.json');
  await writeFile(clashFile, JSON.stringify({ clashes: clashesPy }), 'utf8');

  const script = `
import json, sys
sys.path.insert(0, ${JSON.stringify(BIM_PYTHON_DIR)})
from auto_resolve import auto_resolve
with open(${JSON.stringify(clashFile)}, 'r', encoding='utf-8') as f:
    data = json.load(f)
res = auto_resolve(${JSON.stringify(body.ifc_url)}, data['clashes'])
print(json.dumps(res))
`;
  const result = await new Promise<string>((resolve, reject) => {
    const py = spawn('python', ['-c', script]);
    let out = '';
    let err = '';
    py.stdout.on('data', (c: Buffer) => (out += c.toString()));
    py.stderr.on('data', (c: Buffer) => (err += c.toString()));
    py.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(err))));
  });
  const resolved = JSON.parse(result.trim().split('\n').pop() || '{}') as {
    fixed: unknown[];
    escalated: unknown[];
    ifc_path_after: string;
    total_fixed: number;
    total_escalated: number;
  };

  // Update DB status
  dbTx(() => {
    for (const action of resolved.fixed as Array<{ clash_id: string }>) {
      dbExec("UPDATE clash_detections SET status='resolved' WHERE id=?", [
        action.clash_id,
      ]);
    }
    for (const action of resolved.escalated as Array<{ clash_id: string }>) {
      dbExec("UPDATE clash_detections SET status='resolving' WHERE id=?", [
        action.clash_id,
      ]);
    }
    return null;
  });

  return {
    ok: true,
    fixed: resolved.total_fixed,
    escalated: resolved.total_escalated,
    ifc_after_url: resolved.ifc_path_after,
    actions: [...resolved.fixed, ...resolved.escalated],
  };
}

export interface ListElementsQuery {
  project_id: string;
  revision_id?: string;
  type?: string;
  limit?: number;
}

export function handleListElements(q: ListElementsQuery): BimElementRow[] {
  const conds = ['project_id=?'];
  const args: (string | number)[] = [q.project_id];
  if (q.revision_id) {
    conds.push('revision_id=?');
    args.push(q.revision_id);
  }
  if (q.type) {
    conds.push('type=?');
    args.push(q.type);
  }
  const limit = Math.min(q.limit ?? 500, 5000);
  return dbQuery<BimElementRow>(
    `SELECT * FROM bim_elements WHERE ${conds.join(' AND ')} ORDER BY created_at DESC LIMIT ${limit}`,
    args,
  );
}

// ============================================================
// Hono adapter (optional) — chi dung khi `hono` co cai
// ============================================================
type HonoLike = {
  post: (path: string, handler: (c: HonoCtx) => Promise<Response>) => unknown;
  get: (path: string, handler: (c: HonoCtx) => Promise<Response>) => unknown;
};
type HonoCtx = {
  req: { json: () => Promise<unknown>; query: (k: string) => string | undefined };
  json: (data: unknown, status?: number) => Response;
};

export function registerHonoRoutes(app: HonoLike): void {
  app.post('/api/bim/generate', async (c) => {
    try {
      const body = (await c.req.json()) as GenerateBody;
      const out = await handleGenerate(body);
      return c.json(out);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return c.json({ ok: false, error: msg }, 500);
    }
  });

  app.post('/api/bim/clash', async (c) => {
    try {
      const body = (await c.req.json()) as ClashBody;
      const out = await handleClash(body);
      return c.json(out);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return c.json({ ok: false, error: msg }, 500);
    }
  });

  app.post('/api/bim/resolve', async (c) => {
    try {
      const body = (await c.req.json()) as ResolveBody;
      const out = await handleResolve(body);
      return c.json(out);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return c.json({ ok: false, error: msg }, 500);
    }
  });

  app.get('/api/bim/elements', async (c) => {
    try {
      const project_id = c.req.query('project_id');
      if (!project_id) return c.json({ ok: false, error: 'project_id required' }, 400);
      const out = handleListElements({
        project_id,
        revision_id: c.req.query('revision_id'),
        type: c.req.query('type'),
        limit: c.req.query('limit') ? Number(c.req.query('limit')) : undefined,
      });
      return c.json({ ok: true, total: out.length, elements: out });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return c.json({ ok: false, error: msg }, 500);
    }
  });
}

// Audit-friendly hash export — agent_runs.input_hash su dung ham nay
export function hashRequest(body: unknown): string {
  return dbHash(body);
}
