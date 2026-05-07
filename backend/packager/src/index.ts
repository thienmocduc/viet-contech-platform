// ===============================================================
// Output Packager — public exports + OutputPackager class
// ===============================================================

import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { PackOpts, PackResult, PackerJob } from './types.js';
import { PackOptsSchema } from './types.js';
import { buildArchive } from './archive-builder.js';
import { validatePackOpts, formatValidationReport } from './validators.js';

// ----------------------------------------------------------------
// Re-exports — public API
// ----------------------------------------------------------------

export * from './types.js';
export {
  DELIVERABLE_MANIFEST,
  REQUIRED_CODES,
  TOTAL_DELIVERABLES,
  SCHEMA_VERSION,
  reconcileManifest,
  buildIndexRows,
  indexRowsToCsv,
  buildReadme,
} from './manifest-builder.js';
export {
  sanitizeVi, slugify,
  buildFileName, buildDeliverableFileName, buildZipFileName, buildRenderFileName,
} from './file-naming.js';
export {
  DISCIPLINE_CODES, PHASE_CODES, FOLDER_BY_DISCIPLINE,
  disciplineOfAgent, phaseCodeOf,
  buildIndustryName, buildIndustryNameFromSpec, camelize,
  isValidIndustryName, parseIndustryName,
} from './naming-convention.js';
export {
  sha256File, sha256Buffer,
  buildChecksumManifest, renderSha256SumFile,
  verifyManifest, verifyEntry, buildEntry,
} from './checksum.js';
export {
  buildEmbedMetadata, writeMetadataSidecar,
  buildDwgTitleBlock, buildPdfInfoDict, buildIfcHeader, buildXlsxCoreProps,
} from './metadata-embed.js';
export {
  generatePreview, generatePreviewsBatch, getPreviewSpec, previewPathOf,
} from './preview-generator.js';
export {
  buildPermitPackage, buildPermitChecklist,
  renderForm01Text, renderEnvCommitmentText, renderDesignContractText,
} from './permit-builder.js';
export { buildZipPackage } from './zip-builder.js';
export { buildPackagerApp } from './api.js';
export {
  buildArchive, dryRun,
} from './archive-builder.js';
export {
  buildMetadataDoc, buildIndexHtml, METADATA_SCHEMA_VERSION,
  type PackageMetadataDoc,
} from './metadata-generator.js';
export { buildCoverPdf, type CoverPageInput } from './cover-page.js';
export {
  validatePackOpts, preflightCheck, formatValidationReport,
  type ValidationResult, type ValidationError, type ValidationWarning,
} from './validators.js';

// ----------------------------------------------------------------
// OutputPackager — main class API
// ----------------------------------------------------------------

export interface OutputPackagerOptions {
  /** Default output dir nếu PackOpts.outDir không set */
  defaultOutDir?: string;
  /** Logger callback (level, msg, ctx?) */
  logger?: (level: 'info' | 'warn' | 'error', msg: string, ctx?: Record<string, unknown>) => void;
}

/**
 * OutputPackager — đóng gói tất cả deliverable cho 1 project + revision.
 *
 * Usage:
 * ```ts
 * const packager = new OutputPackager({ defaultOutDir: './data/output' });
 * const result = await packager.pack({
 *   projectId: 'proj_uuid',
 *   revisionId: 'rev_3',
 *   packageType: 'client_full',
 *   deliverables: { drawings: [...], boq: '...', ifc: '...' },
 *   project: { code: 'VCT-2026-001', ... },
 *   branding: { company: 'VIET CONTECH', color: '#C4933A' },
 * });
 * console.log(result.archive_path);
 * ```
 */
export class OutputPackager {
  private readonly defaultOutDir: string;
  private readonly logger: NonNullable<OutputPackagerOptions['logger']>;
  private readonly jobs = new Map<string, PackerJob>();

  constructor(options: OutputPackagerOptions = {}) {
    this.defaultOutDir = options.defaultOutDir ?? join(process.cwd(), 'data', 'output');
    this.logger = options.logger ?? defaultLogger;
  }

  /** Sync validate (nhanh, không build) — dùng cho UI preview */
  async validate(opts: PackOpts) {
    const parsed = PackOptsSchema.parse(opts);
    return validatePackOpts(parsed);
  }

  /** Format validation report dạng text — UX cho CLI */
  reportValidation = formatValidationReport;

  /** Main entry — pack toàn bộ deliverable thành archive */
  async pack(opts: PackOpts): Promise<PackResult> {
    const t0 = Date.now();
    const parsed = PackOptsSchema.parse(opts);
    const jobId = `pkg_${randomUUID()}`;
    const outDir = parsed.outDir ?? this.defaultOutDir;

    this.logger('info', 'pack:start', {
      jobId,
      projectId: parsed.projectId,
      revisionId: parsed.revisionId,
      packageType: parsed.packageType,
    });

    // Track job
    const job: PackerJob = {
      id: jobId,
      projectId: parsed.projectId,
      revisionId: parsed.revisionId,
      packageType: parsed.packageType,
      status: 'running',
      progress: 0,
      started_at: new Date().toISOString(),
    };
    this.jobs.set(jobId, job);

    try {
      const result = await buildArchive({
        packOpts: parsed,
        outDir,
        jobId,
        onProgress: (p) => {
          const cur = this.jobs.get(jobId);
          if (cur) {
            this.jobs.set(jobId, {
              ...cur,
              progress: p.progress,
              current_step: p.current_step,
            });
          }
          if (p.progress % 20 === 0 || p.progress === 100) {
            this.logger('info', `pack:progress`, { jobId, ...p });
          }
        },
      });

      this.jobs.set(jobId, {
        ...job,
        status: 'success',
        progress: 100,
        result,
        finished_at: new Date().toISOString(),
      });

      this.logger('info', 'pack:done', {
        jobId,
        archive_path: result.archive_path,
        size_mb: (result.archive_size_bytes / 1024 / 1024).toFixed(2),
        files: result.total_files,
        duration_ms: Date.now() - t0,
        warnings: result.warnings.length,
      });

      return result;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'unknown error';
      this.jobs.set(jobId, {
        ...job,
        status: 'failed',
        error: errMsg,
        finished_at: new Date().toISOString(),
      });
      this.logger('error', 'pack:failed', { jobId, error: errMsg });
      throw err;
    }
  }

  /** Lookup job status (dùng cho async API) */
  getJob(jobId: string): PackerJob | undefined {
    return this.jobs.get(jobId);
  }

  /** List recent jobs (newest first) — limit default 50 */
  listJobs(limit = 50): PackerJob[] {
    return Array.from(this.jobs.values())
      .sort((a, b) => b.started_at.localeCompare(a.started_at))
      .slice(0, limit);
  }
}

// ----------------------------------------------------------------
// Default logger — structured JSON to stdout/stderr
// ----------------------------------------------------------------

function defaultLogger(
  level: 'info' | 'warn' | 'error',
  msg: string,
  ctx?: Record<string, unknown>,
): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    component: 'packager',
    msg,
    ...(ctx ?? {}),
  });
  if (level === 'error') console.error(line);
  else console.log(line);
}
