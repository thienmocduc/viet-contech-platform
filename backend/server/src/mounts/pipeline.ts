/**
 * mounts/pipeline.ts — mount /api/pipeline/* (lazy-load pipeline orchestrator).
 *
 * Endpoints:
 *   GET  /api/pipeline/health
 *   POST /api/pipeline/run                { project_id, brief }
 *   POST /api/pipeline/run/:projectId     thin alias — body {brief?}; reuse Wave-2 contract
 *   POST /api/pipeline/phase              { project_id, phase }
 *   GET  /api/pipeline/state/:id
 *   GET  /api/pipeline/status/:jobId      polling endpoint, returns latest job snapshot
 *   GET  /api/pipeline/stream/:jobId      SSE — emit events scoped to job's project_id
 */

import { Hono } from 'hono';
import type { Hono as HonoApp } from 'hono';
import { stream } from 'hono/streaming';
import { z } from 'zod';
import { loadExternal } from '../lib/external-loader.js';
import { bus, publishPipelineEvent } from '../lib/event-bus.js';
import { uid, nowIso } from '../lib/uid.js';
import { queryOne } from '../lib/db.js';

interface OrchestratorCtor {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  new (config?: Record<string, unknown>): any;
}
interface OrchestratorMod {
  PipelineOrchestrator: OrchestratorCtor;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let orchestrator: any | null = null;
let loading: Promise<void> | null = null;
async function ensureOrchestrator(): Promise<void> {
  if (orchestrator) return;
  if (loading) return loading;
  loading = (async () => {
    try {
      const mod = await loadExternal<OrchestratorMod>('pipeline/src/orchestrator.js');
      orchestrator = new mod.PipelineOrchestrator();
      orchestrator.on('pipeline_event', (ev: Record<string, unknown>) => {
        publishPipelineEvent({
          type: String(ev.type ?? 'pipeline'),
          project_id: ev.project_id ? String(ev.project_id) : undefined,
          phase: ev.phase as string | number | undefined,
          agent: ev.agent as string | undefined,
          message: ev.message as string | undefined,
          payload: ev.payload,
        });
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[pipeline] orchestrator load failed:', (e as Error).message);
    }
  })();
  return loading;
}

const RunSchema = z.object({
  project_id: z.string().min(1),
  brief: z.record(z.unknown()),
});

const RunByIdSchema = z.object({
  brief: z.record(z.unknown()).optional(),
});

const PhaseSchema = z.object({
  project_id: z.string().min(1),
  phase: z.string().min(1),
});

// In-memory job index (job_id -> snapshot). For real prod: persist to agent_runs.
interface JobSnapshot {
  job_id: string;
  project_id: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  started_at: string;
  finished_at: string | null;
  progress_pct: number;
  current_phase: string | null;
  error: string | null;
  result: unknown;
}
const jobs = new Map<string, JobSnapshot>();

const PHASE_ORDER = [
  'B1-Brief',
  'B2-Concept',
  'B3-Layout',
  'B4-Structural',
  'B5-MEP+BIM',
  'B6-Interior+3D',
  'B7-QC+Export',
] as const;

async function startJob(projectId: string, brief: Record<string, unknown>): Promise<JobSnapshot> {
  const jobId = uid('pipe');
  const snap: JobSnapshot = {
    job_id: jobId,
    project_id: projectId,
    status: 'queued',
    started_at: nowIso(),
    finished_at: null,
    progress_pct: 0,
    current_phase: null,
    error: null,
    result: null,
  };
  jobs.set(jobId, snap);
  publishPipelineEvent({
    type: 'pipeline.queued',
    project_id: projectId,
    message: `Pipeline queued ${jobId}`,
    payload: { job_id: jobId },
  });

  // Run in background — don't block client.
  void (async () => {
    snap.status = 'running';
    publishPipelineEvent({
      type: 'pipeline.started',
      project_id: projectId,
      message: `Pipeline ${jobId} started`,
      payload: { job_id: jobId },
    });
    try {
      await ensureOrchestrator();
      if (orchestrator) {
        // Real run via orchestrator — orchestrator emits its own events through bus.
        const res = await orchestrator.runMission(projectId, brief);
        snap.result = res;
      } else {
        // Mock run — emit phase progress to drive UI.
        for (let i = 0; i < PHASE_ORDER.length; i++) {
          const ph = PHASE_ORDER[i] as string;
          snap.current_phase = ph;
          snap.progress_pct = Math.round(((i + 1) / PHASE_ORDER.length) * 100);
          publishPipelineEvent({
            type: 'phase.started',
            project_id: projectId,
            phase: ph,
            message: `Phase ${ph} started`,
            payload: { job_id: jobId, progress_pct: snap.progress_pct },
          });
          await new Promise((r) => setTimeout(r, 80));
        }
        snap.result = { mode: 'mock', phases: PHASE_ORDER };
      }
      snap.status = 'done';
      snap.progress_pct = 100;
      snap.finished_at = nowIso();
      publishPipelineEvent({
        type: 'pipeline.done',
        project_id: projectId,
        message: `Pipeline ${jobId} done`,
        payload: { job_id: jobId },
      });
    } catch (e) {
      snap.status = 'failed';
      snap.error = e instanceof Error ? e.message : String(e);
      snap.finished_at = nowIso();
      publishPipelineEvent({
        type: 'pipeline.failed',
        project_id: projectId,
        message: snap.error ?? 'pipeline failed',
        payload: { job_id: jobId },
      });
    }
  })();

  return snap;
}

export function mountPipelineRoutes(app: HonoApp): void {
  app.get('/api/pipeline/health', async (c) => {
    await ensureOrchestrator();
    return c.json({
      ok: true,
      service: 'pipeline-orchestrator',
      mode: process.env.PROVIDER_MODE ?? 'mock',
      ready: !!orchestrator,
      jobs_in_memory: jobs.size,
    });
  });

  app.post('/api/pipeline/run', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = RunSchema.safeParse(body);
    if (!parsed.success) return c.json({ ok: false, error: 'invalid_input' }, 400);
    const snap = await startJob(parsed.data.project_id, parsed.data.brief);
    return c.json({ ok: true, job_id: snap.job_id, status: snap.status, snapshot: snap });
  });

  // Thin alias — POST /api/pipeline/run/:projectId
  app.post('/api/pipeline/run/:projectId', async (c) => {
    const projectId = c.req.param('projectId');
    const proj = queryOne<{ id: string }>(`SELECT id FROM projects WHERE id=?`, [projectId]);
    if (!proj) return c.json({ ok: false, error: 'project_not_found' }, 404);
    const body = await c.req.json().catch(() => ({}));
    const parsed = RunByIdSchema.safeParse(body ?? {});
    if (!parsed.success) return c.json({ ok: false, error: 'invalid_input' }, 400);
    const snap = await startJob(projectId, parsed.data.brief ?? {});
    return c.json({ ok: true, job_id: snap.job_id, status: snap.status, snapshot: snap });
  });

  app.post('/api/pipeline/phase', async (c) => {
    await ensureOrchestrator();
    if (!orchestrator) return c.json({ ok: false, error: 'orchestrator_unavailable' }, 503);
    const body = await c.req.json().catch(() => null);
    const parsed = PhaseSchema.safeParse(body);
    if (!parsed.success) return c.json({ ok: false, error: 'invalid_input' }, 400);
    try {
      const res = await orchestrator.runPhase(parsed.data.project_id, parsed.data.phase);
      return c.json({ ok: true, result: res });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return c.json({ ok: false, error: msg }, 400);
    }
  });

  app.get('/api/pipeline/state/:id', (c) => {
    const id = c.req.param('id');
    return c.json({
      ok: true,
      project_id: id,
      message: 'use SSE /api/pipeline/stream/:jobId or /api/events/stream/:projectId',
    });
  });

  // Polling
  app.get('/api/pipeline/status/:jobId', (c) => {
    const j = jobs.get(c.req.param('jobId'));
    if (!j) return c.json({ ok: false, error: 'job_not_found' }, 404);
    return c.json({ ok: true, job: j });
  });

  // SSE per job — auth optional, scoped by project_id binding.
  app.get('/api/pipeline/stream/:jobId', (c) => {
    const j = jobs.get(c.req.param('jobId'));
    if (!j) return c.json({ ok: false, error: 'job_not_found' }, 404);

    c.header('Content-Type', 'text/event-stream');
    c.header('Cache-Control', 'no-cache, no-transform');
    c.header('Connection', 'keep-alive');
    c.header('X-Accel-Buffering', 'no');

    return stream(c, async (writer) => {
      const send = async (ev: { type: string; data: unknown }): Promise<void> => {
        await writer.write(`event: ${ev.type}\n`);
        await writer.write(`data: ${JSON.stringify(ev.data)}\n\n`);
      };
      await writer.write(`: connected ${nowIso()}\n\n`);
      // Snapshot first
      await send({ type: 'snapshot', data: j });

      const unsub = bus.subscribe({ project_id: j.project_id }, (ev) => {
        // forward only events that match this job
        const payload = ev.payload as Record<string, unknown> | undefined;
        if (payload && typeof payload.job_id === 'string' && payload.job_id !== j.job_id) {
          return;
        }
        void send({ type: ev.type, data: ev });
      });

      const hb = setInterval(() => {
        void writer.write(`: ping ${Date.now()}\n\n`);
        // Also push periodic snapshot updates so clients can render.
        const cur = jobs.get(j.job_id);
        if (cur) void send({ type: 'snapshot', data: cur });
      }, 5_000);

      writer.onAbort(() => {
        unsub();
        clearInterval(hb);
      });
      await new Promise<void>((resolve) => writer.onAbort(() => resolve()));
    });
  });
}

// Test-only — used for e2e smoke
export function _hasJobsInMem(): number {
  return jobs.size;
}

// Simple Hono router (kept for tree-shake parity). Not currently mounted directly,
// but exported for future per-router refactors.
export function createPipelineRouter(): Hono {
  const app = new Hono();
  return app;
}
