// ===============================================================
// API — Hono routes cho Output Packager
// ===============================================================
//   POST  /api/export/build
//   GET   /api/export/job/:id
//   GET   /api/export/download/:projectId/:revId
//   POST  /api/export/share
// ===============================================================

import { Hono } from 'hono';
import { randomUUID, randomBytes } from 'node:crypto';
import { stat, mkdir } from 'node:fs/promises';
import { existsSync, createReadStream } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { buildZipPackage } from './zip-builder.js';
import { buildArchive, dryRun } from './archive-builder.js';
import { validatePackOpts, formatValidationReport } from './validators.js';
import { PackOptsSchema, type PackOpts } from './types.js';
import type { BuildJob, ProjectInfo, DeliverableRecord, PackageKind, ShareLink, PackerJob, PackResult } from './types.js';

// ----------------------------------------------------------------
// In-memory stores (production: thay bằng SQLite + Redis pubsub)
// ----------------------------------------------------------------

const jobs = new Map<string, BuildJob>();
const shares = new Map<string, ShareLink>();
const packageIndex = new Map<string, string>(); // `${projectId}:${revId}` → zip_path

// Stores cho /api/packager/* (new generation API)
const packerJobs = new Map<string, PackerJob>();
const packerArchiveIndex = new Map<string, string>(); // jobId → archive_path

export interface PackagerDeps {
  /** Lookup project info từ DB. Trả về null nếu không tìm thấy. */
  getProject: (projectId: string, revId?: string) => Promise<ProjectInfo | null>;
  /** Lookup tất cả deliverables thuộc project + revision. */
  getDeliverables: (projectId: string, revId: string) => Promise<DeliverableRecord[]>;
  /** Output folder root */
  outputRoot: string;
  /** QC stats lookup */
  getQcStats?: (projectId: string, revId: string) => Promise<{ pass_rate: number; passed: number; total: number }>;
  /** Audit lookup (trả về 3 file: decisions, qc-report, agent-runs) */
  getAuditArtifacts?: (projectId: string, revId: string) => Promise<{
    decisionsMd?: string; qcReportMd?: string; agentRunsCsv?: string;
  }>;
  /** Built-by user — từ JWT */
  authMiddleware?: (c: any) => string | undefined;
}

// ----------------------------------------------------------------
// Validators
// ----------------------------------------------------------------

const buildBodySchema = z.object({
  project_id: z.string().min(1),
  revision_id: z.string().min(1),
  kind: z.enum(['full', 'partial', 'permit', 'client', 'tech']).default('full'),
  include_previews: z.boolean().optional(),
});

const shareBodySchema = z.object({
  project_id: z.string().min(1),
  revision_id: z.string().min(1),
  recipients_emails: z.array(z.string().email()).min(1).max(10),
  expires_in_days: z.number().int().min(1).max(30).optional(),
});

// ----------------------------------------------------------------
// Build app
// ----------------------------------------------------------------

export function buildPackagerApp(deps: PackagerDeps): Hono {
  const app = new Hono();

  // POST /api/export/build — trigger build async
  app.post('/api/export/build', async (c) => {
    const json = await c.req.json().catch(() => ({}));
    const parsed = buildBodySchema.safeParse(json);
    if (!parsed.success) {
      return c.json({ ok: false, error: 'invalid_body', details: parsed.error.flatten() }, 400);
    }
    const { project_id, revision_id, kind, include_previews } = parsed.data;
    const builtBy = deps.authMiddleware?.(c) ?? 'anonymous';

    const project = await deps.getProject(project_id, revision_id);
    if (!project) return c.json({ ok: false, error: 'project_not_found' }, 404);

    const records = await deps.getDeliverables(project_id, revision_id);
    if (records.length === 0 && kind !== 'permit') {
      return c.json({ ok: false, error: 'no_deliverables' }, 422);
    }

    const jobId = `job_${randomUUID()}`;
    const job: BuildJob = {
      id: jobId,
      project_id,
      revision_id,
      kind,
      status: 'pending',
      progress: 0,
      started_at: new Date().toISOString(),
    };
    jobs.set(jobId, job);

    // Spawn async — không await để return ngay
    queueMicrotask(async () => {
      const updated: BuildJob = { ...job, status: 'running' };
      jobs.set(jobId, updated);

      try {
        const audit = await deps.getAuditArtifacts?.(project_id, revision_id);
        const qc = await deps.getQcStats?.(project_id, revision_id);
        const outDir = join(deps.outputRoot, project_id, revision_id);
        await mkdir(outDir, { recursive: true });

        const result = await buildZipPackage({
          outDir,
          project,
          records,
          kind,
          includePreviews: include_previews ?? false,
          decisionsMd: audit?.decisionsMd,
          qcReport: audit?.qcReportMd,
          agentRunsCsv: audit?.agentRunsCsv,
          qcPassRate: qc?.pass_rate,
          qcGatesPassed: qc?.passed,
          qcGatesTotal: qc?.total,
          jobId,
          built_by: builtBy,
          onProgress: (j) => {
            const cur = jobs.get(jobId);
            if (!cur) return;
            jobs.set(jobId, { ...cur, ...j, status: 'running' });
          },
        });

        jobs.set(jobId, {
          ...jobs.get(jobId)!,
          status: 'success',
          progress: 100,
          output_zip_path: result.zip_path,
          manifest_url: `/api/export/download/${project_id}/${revision_id}`,
          finished_at: new Date().toISOString(),
        });
        packageIndex.set(`${project_id}:${revision_id}`, result.zip_path);
      } catch (err) {
        jobs.set(jobId, {
          ...jobs.get(jobId)!,
          status: 'failed',
          error: err instanceof Error ? err.message : 'unknown',
          finished_at: new Date().toISOString(),
        });
      }
    });

    return c.json({ ok: true, job_id: jobId, status: 'pending' });
  });

  // GET /api/export/job/:id
  app.get('/api/export/job/:id', (c) => {
    const id = c.req.param('id');
    const job = jobs.get(id);
    if (!job) return c.json({ ok: false, error: 'job_not_found' }, 404);
    return c.json({ ok: true, job });
  });

  // GET /api/export/download/:projectId/:revId
  app.get('/api/export/download/:projectId/:revId', async (c) => {
    const { projectId, revId } = c.req.param();
    const zipPath = packageIndex.get(`${projectId}:${revId}`);
    if (!zipPath || !existsSync(zipPath)) {
      return c.json({ ok: false, error: 'package_not_found' }, 404);
    }
    const stats = await stat(zipPath);
    return c.json({
      ok: true,
      zip_path: zipPath,
      size_bytes: stats.size,
      // Production: return signed URL S3 hoặc stream file qua Hono.body
      download_url: `file://${zipPath}`,
    });
  });

  // POST /api/export/share — tạo share link
  app.post('/api/export/share', async (c) => {
    const json = await c.req.json().catch(() => ({}));
    const parsed = shareBodySchema.safeParse(json);
    if (!parsed.success) {
      return c.json({ ok: false, error: 'invalid_body', details: parsed.error.flatten() }, 400);
    }
    const { project_id, revision_id, recipients_emails } = parsed.data;
    const expiresInDays = parsed.data.expires_in_days ?? 7;

    const zipPath = packageIndex.get(`${project_id}:${revision_id}`);
    if (!zipPath) return c.json({ ok: false, error: 'package_not_built' }, 404);

    const shareId = `share_${randomUUID()}`;
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 3600 * 1000).toISOString();

    const link: ShareLink = {
      id: shareId,
      package_id: `${project_id}:${revision_id}`,
      recipients_emails,
      expires_at: expiresAt,
      token,
      created_at: new Date().toISOString(),
      download_count: 0,
    };
    shares.set(shareId, link);

    // Production: gửi email tới recipients qua nodemailer
    return c.json({
      ok: true,
      share_id: shareId,
      share_url: `/api/export/shared/${shareId}?token=${token}`,
      expires_at: expiresAt,
      recipients: recipients_emails,
    });
  });

  // GET /api/export/shared/:shareId — verify token + download
  app.get('/api/export/shared/:shareId', async (c) => {
    const shareId = c.req.param('shareId');
    const token = c.req.query('token');
    const link = shares.get(shareId);
    if (!link) return c.json({ ok: false, error: 'share_not_found' }, 404);
    if (link.token !== token) return c.json({ ok: false, error: 'invalid_token' }, 403);
    if (Date.parse(link.expires_at) < Date.now()) {
      return c.json({ ok: false, error: 'share_expired' }, 410);
    }
    link.download_count++;
    const zipPath = packageIndex.get(link.package_id);
    if (!zipPath || !existsSync(zipPath)) {
      return c.json({ ok: false, error: 'package_missing' }, 404);
    }
    return c.json({ ok: true, zip_path: zipPath, downloads: link.download_count });
  });

  // ----------------------------------------------------------------
  // /api/packager/* — new generation API (uses OutputPackager)
  // ----------------------------------------------------------------

  // POST /api/packager/build — body { ...PackOpts }  → trả jobId
  app.post('/api/packager/build', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = PackOptsSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ ok: false, error: 'invalid_packopts', details: parsed.error.flatten() }, 400);
    }
    const packOpts: PackOpts = parsed.data;
    const outDir = packOpts.outDir ?? join(deps.outputRoot, 'packager', packOpts.projectId, packOpts.revisionId);

    const jobId = `pkg_${randomUUID()}`;
    const job: PackerJob = {
      id: jobId,
      projectId: packOpts.projectId,
      revisionId: packOpts.revisionId,
      packageType: packOpts.packageType,
      status: 'pending',
      progress: 0,
      started_at: new Date().toISOString(),
    };
    packerJobs.set(jobId, job);

    // Spawn async
    queueMicrotask(async () => {
      packerJobs.set(jobId, { ...job, status: 'running' });
      try {
        await mkdir(outDir, { recursive: true });
        const result = await buildArchive({
          packOpts,
          outDir,
          jobId,
          onProgress: (p) => {
            const cur = packerJobs.get(jobId);
            if (cur) {
              packerJobs.set(jobId, {
                ...cur,
                progress: p.progress,
                current_step: p.current_step,
              });
            }
          },
        });
        packerJobs.set(jobId, {
          ...packerJobs.get(jobId)!,
          status: 'success',
          progress: 100,
          result,
          finished_at: new Date().toISOString(),
        });
        packerArchiveIndex.set(jobId, result.archive_path);
      } catch (err) {
        packerJobs.set(jobId, {
          ...packerJobs.get(jobId)!,
          status: 'failed',
          error: err instanceof Error ? err.message : 'unknown',
          finished_at: new Date().toISOString(),
        });
      }
    });

    return c.json({ ok: true, jobId, status: 'pending' });
  });

  // GET /api/packager/job/:jobId
  app.get('/api/packager/job/:jobId', (c) => {
    const id = c.req.param('jobId');
    const job = packerJobs.get(id);
    if (!job) return c.json({ ok: false, error: 'job_not_found' }, 404);
    return c.json({ ok: true, job });
  });

  // GET /api/packager/download/:jobId — stream archive bytes
  app.get('/api/packager/download/:jobId', async (c) => {
    const jobId = c.req.param('jobId');
    const archivePath = packerArchiveIndex.get(jobId);
    if (!archivePath || !existsSync(archivePath)) {
      return c.json({ ok: false, error: 'archive_not_found' }, 404);
    }
    const stats = await stat(archivePath);
    const filename = archivePath.split(/[/\\]/).pop()!;
    const stream = createReadStream(archivePath);
    // Hono v4 supports ReadableStream in c.body
    return new Response(stream as unknown as ReadableStream, {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(stats.size),
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  });

  // POST /api/packager/dry-run — validation only, không build
  app.post('/api/packager/dry-run', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = PackOptsSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ ok: false, error: 'invalid_packopts', details: parsed.error.flatten() }, 400);
    }
    const result = await dryRun(parsed.data);
    return c.json({
      ok: result.ok,
      validation: result,
      report: formatValidationReport(result),
    });
  });

  return app;
}

/** Helpers exported cho tests */
export const __test = {
  jobs,
  shares,
  packageIndex,
  packerJobs,
  packerArchiveIndex,
};
