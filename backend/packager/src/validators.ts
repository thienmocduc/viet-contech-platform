// ===============================================================
// Validators — kiểm tra package trước khi build ZIP
// ===============================================================
// Rule:
//   - permit_submission:  ≥ 28 bản vẽ + có hồ sơ pháp lý
//   - client_full:         BOQ + IFC bắt buộc
//   - tech_only:           ≥ 1 drawing per discipline (KT/KC/MEP)
//   - commercial_only:     BOQ + ≥ 1 render bắt buộc
//   - SHA256 mỗi file (tự động compute trong archive-builder)
//   - Total size < 2GB → cảnh báo (không block)
// ===============================================================

import { stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { PackOpts, PackageType } from './types.js';

export interface ValidationResult {
  ok: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  stats: {
    drawing_count: number;
    render_count: number;
    report_count: number;
    has_boq: boolean;
    has_ifc: boolean;
    has_permit_files: boolean;
    total_files: number;
    total_size_bytes: number;
    estimated_zip_size_bytes: number;
  };
  /** Per-discipline drawing count (for tech_only validation) */
  by_discipline: Record<string, number>;
  /** List file path không tồn tại */
  missing_files: string[];
}

export interface ValidationError {
  code: string;
  message: string;
  field?: string;
}

export interface ValidationWarning {
  code: string;
  message: string;
}

// ----------------------------------------------------------------
// Constants
// ----------------------------------------------------------------

const SIZE_WARN_THRESHOLD = 2 * 1024 * 1024 * 1024;   // 2 GB
const SIZE_HARD_LIMIT = 10 * 1024 * 1024 * 1024;       // 10 GB hard fail

const PERMIT_MIN_DRAWINGS = 28;
const TECH_REQUIRED_DISCIPLINES = ['KT', 'KC'];

// Approximate ZIP compression ratio (deflate level 6 trên CAD/PDF):
//   DWG 0.65, PDF 0.95, PNG 1.0 (already compressed), XLSX 0.85
// Aggregate = ~0.85 ratio.
const ZIP_RATIO_APPROX = 0.85;

// ----------------------------------------------------------------
// Main validator
// ----------------------------------------------------------------

export async function validatePackOpts(opts: PackOpts): Promise<ValidationResult> {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  const missing_files: string[] = [];
  const by_discipline: Record<string, number> = {};

  // 1) Collect file paths to check existence + sizes
  const allPaths: string[] = [];
  const drawings = opts.deliverables.drawings ?? [];
  for (const d of drawings) {
    allPaths.push(d.path);
    const disc = (d.type || 'UNK').toUpperCase();
    by_discipline[disc] = (by_discipline[disc] ?? 0) + 1;
  }
  if (opts.deliverables.boq) allPaths.push(opts.deliverables.boq);
  if (opts.deliverables.ifc) allPaths.push(opts.deliverables.ifc);
  for (const r of opts.deliverables.renders ?? []) allPaths.push(r);
  for (const r of opts.deliverables.reports ?? []) allPaths.push(r.path);
  for (const p of opts.deliverables.permit_files ?? []) allPaths.push(p);

  // 2) File existence + size
  let totalSize = 0;
  for (const p of allPaths) {
    if (!existsSync(p)) {
      missing_files.push(p);
      continue;
    }
    try {
      const s = await stat(p);
      totalSize += s.size;
    } catch {
      missing_files.push(p);
    }
  }

  if (missing_files.length > 0) {
    errors.push({
      code: 'files_missing',
      message: `${missing_files.length} file không tồn tại: ${missing_files.slice(0, 3).join(', ')}${missing_files.length > 3 ? '…' : ''}`,
    });
  }

  // 3) Type-specific rules
  validateByPackageType(opts, by_discipline, errors, warnings);

  // 4) Size sanity
  const estZip = Math.round(totalSize * ZIP_RATIO_APPROX);
  if (totalSize > SIZE_HARD_LIMIT) {
    errors.push({
      code: 'package_too_large',
      message: `Tổng dung lượng ${formatGb(totalSize)} > giới hạn cứng ${formatGb(SIZE_HARD_LIMIT)} — cần split package`,
    });
  } else if (totalSize > SIZE_WARN_THRESHOLD) {
    warnings.push({
      code: 'package_large',
      message: `Tổng dung lượng ${formatGb(totalSize)} > 2GB — upload sẽ chậm, cân nhắc tách render thành package phụ`,
    });
  }

  // 5) Drawing count for permit
  if (opts.packageType === 'permit_submission' && drawings.length < PERMIT_MIN_DRAWINGS) {
    errors.push({
      code: 'permit_drawings_insufficient',
      message: `Hồ sơ xin phép cần ≥ ${PERMIT_MIN_DRAWINGS} bản vẽ — hiện chỉ có ${drawings.length}`,
      field: 'deliverables.drawings',
    });
  }

  // 6) Branding logo check (optional)
  if (opts.branding?.logo_path && !existsSync(opts.branding.logo_path)) {
    warnings.push({
      code: 'logo_missing',
      message: `Logo branding không tồn tại: ${opts.branding.logo_path} → fallback sang text logo`,
    });
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    stats: {
      drawing_count: drawings.length,
      render_count: opts.deliverables.renders?.length ?? 0,
      report_count: opts.deliverables.reports?.length ?? 0,
      has_boq: !!opts.deliverables.boq,
      has_ifc: !!opts.deliverables.ifc,
      has_permit_files: (opts.deliverables.permit_files?.length ?? 0) > 0,
      total_files: allPaths.length,
      total_size_bytes: totalSize,
      estimated_zip_size_bytes: estZip,
    },
    by_discipline,
    missing_files,
  };
}

function validateByPackageType(
  opts: PackOpts,
  byDisc: Record<string, number>,
  errors: ValidationError[],
  warnings: ValidationWarning[],
): void {
  switch (opts.packageType) {
    case 'client_full': {
      if (!opts.deliverables.boq) {
        errors.push({
          code: 'client_full_boq_required',
          message: 'Bộ client_full bắt buộc có BOQ',
          field: 'deliverables.boq',
        });
      }
      if (!opts.deliverables.ifc) {
        errors.push({
          code: 'client_full_ifc_required',
          message: 'Bộ client_full bắt buộc có IFC (BIM model)',
          field: 'deliverables.ifc',
        });
      }
      if ((opts.deliverables.drawings?.length ?? 0) < 20) {
        warnings.push({
          code: 'client_full_few_drawings',
          message: `Bộ client_full thường có ≥ 20 bản vẽ — hiện ${opts.deliverables.drawings?.length ?? 0}`,
        });
      }
      if (!opts.deliverables.renders || opts.deliverables.renders.length === 0) {
        warnings.push({
          code: 'client_full_no_renders',
          message: 'Bộ client_full nên có render 3D để khách dễ hình dung',
        });
      }
      break;
    }

    case 'permit_submission': {
      if ((opts.deliverables.drawings?.length ?? 0) < PERMIT_MIN_DRAWINGS) {
        // Đã add ở main flow — không duplicate
      }
      const hasArch = (byDisc['KT'] ?? 0) > 0;
      const hasStruct = (byDisc['KC'] ?? 0) > 0;
      const hasFire = (byDisc['PCCC'] ?? 0) > 0;
      if (!hasArch) {
        errors.push({ code: 'permit_kt_required', message: 'Hồ sơ xin phép thiếu bản vẽ Kiến trúc (KT)' });
      }
      if (!hasStruct) {
        errors.push({ code: 'permit_kc_required', message: 'Hồ sơ xin phép thiếu bản vẽ Kết cấu (KC)' });
      }
      if (!hasFire) {
        warnings.push({ code: 'permit_pccc_recommended', message: 'Khuyến nghị có PCCC trong hồ sơ xin phép (bắt buộc với nhà ≥ 7 tầng)' });
      }
      break;
    }

    case 'tech_only': {
      for (const disc of TECH_REQUIRED_DISCIPLINES) {
        if (!byDisc[disc] || byDisc[disc] === 0) {
          errors.push({
            code: 'tech_discipline_missing',
            message: `Bộ tech_only thiếu discipline ${disc}`,
          });
        }
      }
      break;
    }

    case 'commercial_only': {
      if (!opts.deliverables.boq) {
        errors.push({
          code: 'commercial_boq_required',
          message: 'Bộ commercial_only bắt buộc có BOQ',
          field: 'deliverables.boq',
        });
      }
      if (!opts.deliverables.renders || opts.deliverables.renders.length === 0) {
        errors.push({
          code: 'commercial_renders_required',
          message: 'Bộ commercial_only bắt buộc có ≥ 1 render',
          field: 'deliverables.renders',
        });
      }
      break;
    }
  }
}

function formatGb(bytes: number): string {
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// ----------------------------------------------------------------
// Quick preflight (dùng cho UI estimate trước khi pack)
// ----------------------------------------------------------------

export async function preflightCheck(opts: PackOpts): Promise<{
  ok: boolean;
  warnings: number;
  errors: number;
  estimate_zip_mb: number;
  estimated_duration_sec: number;
}> {
  const result = await validatePackOpts(opts);
  // Build time empirical: ~80ms per file (incl SHA + zip)
  const estDuration = Math.max(2, Math.round(result.stats.total_files * 0.08));
  return {
    ok: result.ok,
    warnings: result.warnings.length,
    errors: result.errors.length,
    estimate_zip_mb: Math.round(result.stats.estimated_zip_size_bytes / 1024 / 1024),
    estimated_duration_sec: estDuration,
  };
}

/** Format errors thành string user-readable */
export function formatValidationReport(result: ValidationResult): string {
  const lines: string[] = [];
  lines.push(`Validation: ${result.ok ? 'PASS' : 'FAIL'}`);
  lines.push(`  Drawings: ${result.stats.drawing_count} | Renders: ${result.stats.render_count} | Reports: ${result.stats.report_count}`);
  lines.push(`  BOQ: ${result.stats.has_boq ? 'YES' : 'NO'} | IFC: ${result.stats.has_ifc ? 'YES' : 'NO'} | Permit: ${result.stats.has_permit_files ? 'YES' : 'NO'}`);
  lines.push(`  Total files: ${result.stats.total_files} | Size: ${(result.stats.total_size_bytes / 1024 / 1024).toFixed(2)} MB | Est ZIP: ${(result.stats.estimated_zip_size_bytes / 1024 / 1024).toFixed(2)} MB`);
  if (Object.keys(result.by_discipline).length > 0) {
    lines.push(`  By discipline: ${Object.entries(result.by_discipline).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  }
  if (result.errors.length > 0) {
    lines.push('');
    lines.push('ERRORS:');
    for (const e of result.errors) lines.push(`  - [${e.code}] ${e.message}`);
  }
  if (result.warnings.length > 0) {
    lines.push('');
    lines.push('WARNINGS:');
    for (const w of result.warnings) lines.push(`  - [${w.code}] ${w.message}`);
  }
  if (result.missing_files.length > 0) {
    lines.push('');
    lines.push('MISSING FILES:');
    for (const f of result.missing_files.slice(0, 10)) lines.push(`  - ${f}`);
    if (result.missing_files.length > 10) lines.push(`  ... +${result.missing_files.length - 10} more`);
  }
  return lines.join('\n');
}
