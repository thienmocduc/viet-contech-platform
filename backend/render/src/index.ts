/**
 * Render Farm Orchestrator — public API (spec v2).
 *
 * Mission: Sau pipeline thiet ke xong, mot project can ~100-200 anh
 *          render 4K cho 9 phong cach x 8 goc x N phong.
 *
 * Class:
 *   - submitJob({ projectId, scenes, styles, resolution, hdr, priority })
 *   - getStatus(jobId)
 *   - getResults(jobId)
 *
 * Internals:
 *   - Provider: ZeniL3 (primary) | Mock (dev/test) | future Replicate
 *   - Queue:    in-memory priority queue, parallel concurrent (default 4)
 *   - Pipeline: Provider.generate → Watermark → Resize 1024px → OutputFolder
 *   - Manifest: write JSON khi job done
 */

import { randomUUID } from 'crypto';
import {
  RenderJobOptsSchema,
  RESOLUTION_SEC_PER_RENDER,
  PRIORITY_RANK,
} from './types.js';
import type {
  RenderJobOpts, SubmitJobInfo, RenderResultV2, Scene,
  Style, SpecAngle, Resolution, Priority, SubmitJobStatus,
} from './types.js';
import { buildPromptV2 } from './prompt-builder.js';
import { applyWatermark } from './watermark.js';
import { resizeForPreview } from './resizer.js';
import { OutputFolder, folderForResolution } from './output-folder.js';
import type { ImageProvider } from './providers/provider.js';
import { ZeniL3Provider } from './providers/zeni-l3.js';
import { MockProvider } from './providers/mock.js';

// ============================================================
// Queue task internal
// ============================================================
interface QueueTask {
  id: string;
  jobId: string;
  scene: Scene;
  style: Style;
  angle: SpecAngle;
  resolution: Resolution;
  hdr: boolean;
  watermark: boolean;
  watermarkText: string;
  generatePreview: boolean;
  priority: Priority;
  retries: number;
}

// ============================================================
// Internal job state
// ============================================================
interface JobState {
  info: SubmitJobInfo;
  opts: RenderJobOpts;
  results: RenderResultV2[];
  errors: Array<{ taskId: string; error: string }>;
  folder: OutputFolder;
  pendingTasks: number;
}

// ============================================================
// Config
// ============================================================
export interface RenderFarmConfig {
  provider?: ImageProvider;
  fallbackProvider?: ImageProvider;
  baseDir?: string;
  concurrent?: number;        // default 4
  maxRetries?: number;        // default 3
  retryBackoffMs?: number;    // default 200 (exponential)
}

// ============================================================
// Main class
// ============================================================
export class RenderFarm {
  private provider: ImageProvider;
  private fallback: ImageProvider | undefined;
  private baseDir: string | undefined;
  private concurrent: number;
  private maxRetries: number;
  private retryBackoffMs: number;

  private jobs = new Map<string, JobState>();
  private taskQueue: QueueTask[] = [];
  private running = 0;
  private draining = false;

  constructor(cfg: RenderFarmConfig = {}) {
    this.provider = cfg.provider ?? new ZeniL3Provider();
    // Auto-fallback: neu primary la real Zeni → fallback mock cho test/dev
    this.fallback = cfg.fallbackProvider ??
      (this.provider.isMock() ? undefined : new MockProvider());
    this.baseDir = cfg.baseDir;
    this.concurrent = cfg.concurrent ?? 4;
    this.maxRetries = cfg.maxRetries ?? 3;
    this.retryBackoffMs = cfg.retryBackoffMs ?? 200;
  }

  // ----------------------------------------------------------
  // submitJob
  // ----------------------------------------------------------
  async submitJob(opts: RenderJobOpts): Promise<{ jobId: string; estimatedSec: number }> {
    const parsed = RenderJobOptsSchema.parse(opts);

    const jobId = `rj_${Date.now()}_${randomUUID().slice(0, 8)}`;

    // Tinh tong frames: scene.angles x styles
    const totalRenders = parsed.scenes.reduce(
      (sum, s) => sum + s.angles.length * parsed.styles.length, 0,
    );
    const secPerRender = RESOLUTION_SEC_PER_RENDER[parsed.resolution];
    // ETA = (total / concurrent) * sec/render
    const estimatedSec = Math.ceil((totalRenders / this.concurrent) * secPerRender);

    const folder = new OutputFolder({
      baseDir: this.baseDir,
      projectId: parsed.projectId,
      revisionId: parsed.revisionId,
      resolutionFolder: folderForResolution(parsed.resolution),
    });
    await folder.ensure();

    const info: SubmitJobInfo = {
      jobId,
      projectId: parsed.projectId,
      revisionId: parsed.revisionId,
      status: 'waiting',
      totalRenders,
      completed: 0,
      failed: 0,
      costUsdSoFar: 0,
      costVndSoFar: 0,
      startedAt: Date.now(),
    };

    const state: JobState = {
      info,
      opts: parsed,
      results: [],
      errors: [],
      folder,
      pendingTasks: totalRenders,
    };
    this.jobs.set(jobId, state);

    // Enqueue tasks
    let taskCounter = 0;
    for (const scene of parsed.scenes) {
      for (const style of parsed.styles) {
        for (const angle of scene.angles) {
          this.taskQueue.push({
            id: `${jobId}_t${taskCounter++}`,
            jobId,
            scene,
            style,
            angle,
            resolution: parsed.resolution,
            hdr: parsed.hdr,
            watermark: parsed.watermark,
            watermarkText: parsed.watermarkText,
            generatePreview: parsed.generatePreview,
            priority: parsed.priority,
            retries: 0,
          });
        }
      }
    }

    // Sort queue by priority (urgent first)
    this.sortQueue();

    // Kick worker
    info.status = 'running';
    void this.drain();

    return { jobId, estimatedSec };
  }

  // ----------------------------------------------------------
  // getStatus
  // ----------------------------------------------------------
  async getStatus(jobId: string): Promise<SubmitJobInfo> {
    const state = this.jobs.get(jobId);
    if (!state) throw new Error(`job not found: ${jobId}`);
    return { ...state.info };
  }

  // ----------------------------------------------------------
  // getResults
  // ----------------------------------------------------------
  async getResults(jobId: string): Promise<RenderResultV2[]> {
    const state = this.jobs.get(jobId);
    if (!state) throw new Error(`job not found: ${jobId}`);
    return [...state.results];
  }

  /**
   * Cancel mot job (best-effort: chi remove tasks chua run).
   */
  async cancelJob(jobId: string): Promise<void> {
    const state = this.jobs.get(jobId);
    if (!state) return;
    this.taskQueue = this.taskQueue.filter((t) => t.jobId !== jobId);
    state.info.status = 'cancelled';
    state.info.finishedAt = Date.now();
  }

  // ==========================================================
  // Internals
  // ==========================================================

  private sortQueue(): void {
    this.taskQueue.sort((a, b) => {
      const pa = PRIORITY_RANK[a.priority];
      const pb = PRIORITY_RANK[b.priority];
      if (pa !== pb) return pa - pb;
      return 0;
    });
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.taskQueue.length > 0 || this.running > 0) {
        while (this.running < this.concurrent && this.taskQueue.length > 0) {
          const task = this.taskQueue.shift()!;
          this.running++;
          // Fire & track (no await)
          void this.runTask(task).finally(() => {
            this.running--;
          });
        }
        // Yield
        await new Promise((r) => setImmediate(r));
      }
    } finally {
      this.draining = false;
    }
  }

  private async runTask(task: QueueTask): Promise<void> {
    const state = this.jobs.get(task.jobId);
    if (!state || state.info.status === 'cancelled') return;

    try {
      const result = await this.executeTaskWithRetry(task, state);
      state.results.push(result);
      state.info.completed++;
      state.info.costUsdSoFar = round4(state.info.costUsdSoFar + result.costUsd);
      state.info.costVndSoFar += result.costVnd;
    } catch (e) {
      state.errors.push({
        taskId: task.id,
        error: e instanceof Error ? e.message : String(e),
      });
      state.info.failed++;
    }

    state.pendingTasks--;
    if (state.pendingTasks === 0) {
      await this.finalizeJob(state);
    }
  }

  private async executeTaskWithRetry(task: QueueTask, state: JobState): Promise<RenderResultV2> {
    let lastErr: Error | null = null;
    let attempt = 0;
    while (attempt <= this.maxRetries) {
      try {
        return await this.executeTask(task, state, attempt);
      } catch (e) {
        lastErr = e instanceof Error ? e : new Error(String(e));
        attempt++;
        if (attempt <= this.maxRetries) {
          const delay = this.retryBackoffMs * 2 ** (attempt - 1);
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }
    throw lastErr ?? new Error('unknown render error');
  }

  private async executeTask(task: QueueTask, state: JobState, attempt: number): Promise<RenderResultV2> {
    const { prompt, negative_prompt } = buildPromptV2({
      style: task.style,
      scene: task.scene,
      angle: task.angle,
      resolution: task.resolution,
      hdr: task.hdr,
    });

    // Gen via primary, fall back to secondary on attempt > 0 if available
    const provider = (attempt > 0 && this.fallback) ? this.fallback : this.provider;
    const resp = await provider.generate({
      prompt,
      negative_prompt,
      resolution: task.resolution,
      hdr: task.hdr,
      seed: 42000 + hashInt(`${task.scene.roomCode}_${task.style}_${task.angle}`),
      label: `${task.style} ${task.scene.roomName} ${task.angle}`,
    });

    let bytes = resp.bytes;
    if (task.watermark) {
      bytes = await applyWatermark(bytes, { text: task.watermarkText });
    }

    const fullPath = await state.folder.writeFull(
      task.scene.roomCode, task.style, task.angle, bytes, 'png',
    );

    let previewPath: string | undefined;
    if (task.generatePreview) {
      const previewBytes = await resizeForPreview(bytes, {
        width: 1024, format: 'jpeg', quality: 80,
      });
      previewPath = await state.folder.writePreview(
        task.scene.roomCode, task.style, task.angle, previewBytes, 'jpg',
      );
    }

    return {
      scene: task.scene.roomCode,
      style: task.style,
      angle: task.angle,
      paths: { full: fullPath, preview: previewPath },
      hash: resp.hash,
      seed: resp.seed,
      costUsd: resp.cost_usd,
      costVnd: resp.cost_vnd,
      durationMs: resp.duration_ms,
      watermark: task.watermark,
      resolution: task.resolution,
    };
  }

  private async finalizeJob(state: JobState): Promise<void> {
    const finishedAt = Date.now();
    state.info.finishedAt = finishedAt;
    const allOk = state.info.failed === 0;
    const newStatus: SubmitJobStatus = allOk ? 'done' : (state.info.completed > 0 ? 'done' : 'failed');
    state.info.status = newStatus;
    if (!allOk) {
      state.info.error = `${state.info.failed} renders failed (of ${state.info.totalRenders})`;
    }

    // Write manifest
    await state.folder.writeManifest({
      ...state.info,
      resolution: state.opts.resolution,
      watermark: state.opts.watermark,
      hdr: state.opts.hdr,
      priority: state.opts.priority,
      durationMs: finishedAt - state.info.startedAt,
      renders: state.results.sort((a, b) => {
        if (a.scene !== b.scene) return a.scene.localeCompare(b.scene);
        if (a.style !== b.style) return a.style.localeCompare(b.style);
        return a.angle.localeCompare(b.angle);
      }),
      rootDir: state.folder.root,
      createdAt: new Date(state.info.startedAt).toISOString(),
    });
  }
}

// ============================================================
// Helpers
// ============================================================
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function hashInt(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 100000;
}

// ============================================================
// Re-exports
// ============================================================
export { RenderJobOptsSchema } from './types.js';
export type {
  RenderJobOpts, Scene, SubmitJobInfo, RenderResultV2,
  Style, SpecAngle, Resolution, Priority,
} from './types.js';
export { ZeniL3Provider } from './providers/zeni-l3.js';
export { MockProvider } from './providers/mock.js';
export type { ImageProvider, ProviderRequest, ProviderResponse } from './providers/provider.js';
export { applyWatermark, hasWatermark } from './watermark.js';
export { resizeForPreview, getDimensions } from './resizer.js';
export { OutputFolder } from './output-folder.js';
