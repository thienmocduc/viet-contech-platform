/**
 * Job queue voi parallel limit + retry + progress events.
 *
 * Co che:
 *   - taskQueue: array task
 *   - workers: max concurrent (default 5)
 *   - mortifies retry tu 0..MAX_RETRIES (default 3)
 *   - progress events qua callback onProgress
 *
 * Khong dung BullMQ vi muon zero-dep va in-memory cho mock.
 * Production swap sang BullMQ + Redis.
 */

import { randomBytes } from 'crypto';
import type {
  RenderJob, JobStatus, JobProgressEvent,
} from './types.js';

// ============================================================
// 1 task trong queue
// ============================================================
export interface QueueTask<T> {
  id: string;
  fn: () => Promise<T>;
  retries_left: number;
}

// ============================================================
// Concurrency limit + retry runner
// ============================================================
export interface RunPoolOptions<T> {
  concurrent?: number;
  max_retries?: number;
  on_task_done?: (id: string, result: T, idx: number) => void;
  on_task_failed?: (id: string, error: Error, idx: number) => void;
  on_task_retry?: (id: string, attempt: number) => void;
}

/**
 * Run pool: chay parallel max concurrent task, moi task retry max_retries lan.
 *
 * Tra ve mang ket qua theo thu tu input. Cac task fail het sau retry → result undefined.
 */
export async function runPool<T>(
  tasks: Array<() => Promise<T>>,
  opts: RunPoolOptions<T> = {},
): Promise<Array<T | undefined>> {
  const concurrent = opts.concurrent ?? 5;
  const maxRetries = opts.max_retries ?? 3;

  const results: Array<T | undefined> = new Array(tasks.length);
  let nextIdx = 0;
  const errors: Error[] = [];

  async function worker(): Promise<void> {
    while (true) {
      const idx = nextIdx++;
      if (idx >= tasks.length) return;

      const taskFn = tasks[idx];
      const taskId = `t${idx}`;
      let attempt = 0;
      let lastErr: Error | null = null;

      while (attempt <= maxRetries) {
        try {
          const r = await taskFn();
          results[idx] = r;
          opts.on_task_done?.(taskId, r, idx);
          lastErr = null;
          break;
        } catch (e) {
          lastErr = e instanceof Error ? e : new Error(String(e));
          attempt++;
          if (attempt <= maxRetries) {
            opts.on_task_retry?.(taskId, attempt);
            // Exponential backoff: 100ms, 200ms, 400ms
            await new Promise((r) => setTimeout(r, 100 * 2 ** (attempt - 1)));
          }
        }
      }

      if (lastErr) {
        errors.push(lastErr);
        opts.on_task_failed?.(taskId, lastErr, idx);
      }
    }
  }

  const workers = Array(Math.min(concurrent, tasks.length)).fill(0).map(() => worker());
  await Promise.all(workers);
  return results;
}

// ============================================================
// In-memory job registry (cho API tracking)
// ============================================================
export class JobRegistry {
  private jobs = new Map<string, RenderJob>();
  private listeners = new Map<string, Array<(ev: JobProgressEvent) => void>>();

  createJob(opts: {
    projectId: string;
    jobType: 'room' | 'all_styles' | '360';
    totalFrames: number;
  }): RenderJob {
    const job: RenderJob = {
      job_id: `job_${Date.now()}_${randomBytes(4).toString('hex')}`,
      project_id: opts.projectId,
      job_type: opts.jobType,
      status: 'queued',
      progress_pct: 0,
      total_frames: opts.totalFrames,
      frames_done: 0,
      frames_failed: 0,
      cost_vnd_so_far: 0,
      cost_usd_so_far: 0,
      started_at: Date.now(),
      retries: 0,
    };
    this.jobs.set(job.job_id, job);
    return job;
  }

  setStatus(jobId: string, status: JobStatus, error?: string): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.status = status;
    if (error) job.error = error;
    if (status === 'done' || status === 'failed' || status === 'cancelled') {
      job.finished_at = Date.now();
    }
    this.emit({
      job_id: jobId,
      type: status === 'done' ? 'job_done' : status === 'failed' ? 'job_failed' : 'job_started',
      progress_pct: job.progress_pct,
      frames_done: job.frames_done,
      frames_failed: job.frames_failed,
      cost_vnd_so_far: job.cost_vnd_so_far,
    });
  }

  reportFrameDone(jobId: string, costVnd: number, costUsd: number): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.frames_done++;
    job.cost_vnd_so_far += costVnd;
    job.cost_usd_so_far += costUsd;
    job.progress_pct = Math.round(((job.frames_done + job.frames_failed) / job.total_frames) * 100);
    this.emit({
      job_id: jobId,
      type: 'frame_done',
      progress_pct: job.progress_pct,
      frames_done: job.frames_done,
      frames_failed: job.frames_failed,
      cost_vnd_so_far: job.cost_vnd_so_far,
    });
  }

  reportFrameFailed(jobId: string, error: string): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.frames_failed++;
    job.progress_pct = Math.round(((job.frames_done + job.frames_failed) / job.total_frames) * 100);
    this.emit({
      job_id: jobId,
      type: 'frame_failed',
      progress_pct: job.progress_pct,
      frames_done: job.frames_done,
      frames_failed: job.frames_failed,
      cost_vnd_so_far: job.cost_vnd_so_far,
      message: error,
    });
  }

  setResult(jobId: string, result: NonNullable<RenderJob['result']>): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.result = result;
  }

  getJob(jobId: string): RenderJob | undefined {
    return this.jobs.get(jobId);
  }

  listByProject(projectId: string): RenderJob[] {
    return Array.from(this.jobs.values()).filter((j) => j.project_id === projectId);
  }

  on(jobId: string, listener: (ev: JobProgressEvent) => void): void {
    const arr = this.listeners.get(jobId) ?? [];
    arr.push(listener);
    this.listeners.set(jobId, arr);
  }

  private emit(ev: JobProgressEvent): void {
    const arr = this.listeners.get(ev.job_id) ?? [];
    for (const fn of arr) {
      try { fn(ev); } catch { /* swallow */ }
    }
  }
}

// Singleton registry (1 process)
export const globalJobRegistry = new JobRegistry();
