// ===============================================================
// Archive Builder — đóng gói package vào ZIP
// ===============================================================
// Folder structure (theo yêu cầu Sở Xây dựng + chuẩn ngành VN):
//
//   VCT-2026-001_DD_R02_2026-05-12.zip
//   ├── 00_README.html              (index browseable)
//   ├── 00_metadata.json
//   ├── 00_manifest.txt             (sha256sum format)
//   ├── 00_cover.pdf
//   ├── 01_KienTruc/
//   │   ├── VCT-2026-001_DD_KT_01_MatBangTang1_R02.dwg
//   │   ├── VCT-2026-001_DD_KT_01_MatBangTang1_R02.pdf
//   │   └── ...
//   ├── 02_KetCau/
//   ├── 03_DienNuoc/
//   │   ├── Dien/
//   │   └── CapThoatNuoc/
//   ├── 04_HVAC_PCCC/
//   │   ├── HVAC/
//   │   └── PCCC/
//   ├── 05_NoiThat/
//   ├── 06_Render/
//   ├── 07_BOQ/
//   ├── 08_BIM/
//   ├── 09_HoSoPhapLy/
//   └── 10_BaoCao/
// ===============================================================

import archiver from 'archiver';
import { createWriteStream, createReadStream } from 'node:fs';
import { mkdir, writeFile, copyFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { createHash } from 'node:crypto';
import type {
  PackOpts, PackResult, OutputFormat, ChecksumManifestEntry, DeliverableKind,
  PackerJob,
} from './types.js';
import {
  buildIndustryName, FOLDER_BY_DISCIPLINE, DisciplineCode, phaseCodeOf,
} from './naming-convention.js';
import { sanitizeVi, slugify } from './file-naming.js';
import { sha256File, buildChecksumManifest, renderSha256SumFile } from './checksum.js';
import { buildMetadataDoc, buildIndexHtml } from './metadata-generator.js';
import { buildCoverPdf } from './cover-page.js';
import { validatePackOpts, type ValidationResult } from './validators.js';

// ----------------------------------------------------------------
// Build options
// ----------------------------------------------------------------

export interface ArchiveBuildOptions {
  packOpts: PackOpts;
  outDir: string;
  jobId?: string;
  /** Callback để track progress 0..100 */
  onProgress?: (job: Pick<PackerJob, 'progress' | 'current_step'>) => void;
}

// ----------------------------------------------------------------
// Build archive — main entry
// ----------------------------------------------------------------

export async function buildArchive(opts: ArchiveBuildOptions): Promise<PackResult> {
  const startedAt = Date.now();
  const warnings: string[] = [];
  const jobId = opts.jobId ?? `pkg_${startedAt}`;

  const emit = (progress: number, step: string) => {
    opts.onProgress?.({ progress, current_step: step });
  };

  emit(2, 'Validating inputs');

  // 1) Validate
  const validation = await validatePackOpts(opts.packOpts);
  if (!validation.ok) {
    throw new Error(
      `Validation failed: ${validation.errors.map(e => `[${e.code}] ${e.message}`).join('; ')}`,
    );
  }
  for (const w of validation.warnings) warnings.push(`[${w.code}] ${w.message}`);

  emit(8, 'Preparing staging directory');

  // 2) Setup paths
  await mkdir(opts.outDir, { recursive: true });
  const stagingDir = join(opts.outDir, `_staging_${jobId}`);
  await mkdir(stagingDir, { recursive: true });

  const projCode = opts.packOpts.project?.code || 'VCT-UNKNOWN';
  const phase = opts.packOpts.project?.phase || 'DD';
  const revisionNum = parseRevisionNumber(opts.packOpts.revisionId);
  const dateStr = new Date().toISOString().slice(0, 10);
  const archiveName = `${slugify(projCode, 30)}_${phase}_R${String(revisionNum).padStart(2, '0')}_${dateStr}.${opts.packOpts.output_format ?? 'zip'}`;
  const archivePath = join(opts.outDir, archiveName);

  emit(15, 'Staging deliverables');

  // 3) Stage deliverables vào folders
  const stagedFiles: { abs_path: string; rel_path: string; kind: DeliverableKind; code?: string }[] = [];

  // 3a) Drawings → split theo discipline
  const drawings = opts.packOpts.deliverables.drawings ?? [];
  for (let i = 0; i < drawings.length; i++) {
    const d = drawings[i]!;
    if (!existsSync(d.path)) {
      warnings.push(`Drawing missing: ${d.path}`);
      continue;
    }
    const disc = (d.type || 'GEN').toUpperCase() as DisciplineCode;
    const folder = FOLDER_BY_DISCIPLINE[disc] ?? '10_BaoCao';
    const number = d.number ?? String(i + 1).padStart(2, '0');
    const description = d.name ?? d.layer ?? `Drawing${i + 1}`;
    const fileName = buildIndustryName({
      projectCode: projCode,
      phase: phaseCodeOf(d.phase ?? phase),
      discipline: disc,
      number,
      description,
      revision: revisionNum,
      ext: d.format,
    });
    const stagedPath = join(stagingDir, folder, fileName);
    await mkdir(join(stagingDir, folder), { recursive: true });
    await copyFile(d.path, stagedPath);
    stagedFiles.push({
      abs_path: stagedPath,
      rel_path: `${folder}/${fileName}`,
      kind: d.format as DeliverableKind,
      code: d.code,
    });
  }

  emit(35, 'Staging BOQ + IFC + renders');

  // 3b) BOQ → 07_BOQ
  if (opts.packOpts.deliverables.boq) {
    const src = opts.packOpts.deliverables.boq;
    if (existsSync(src)) {
      const fname = buildIndustryName({
        projectCode: projCode,
        phase,
        discipline: 'BOQ',
        number: '01',
        description: 'BOQ',
        revision: revisionNum,
        ext: 'xlsx',
      });
      const dst = join(stagingDir, '07_BOQ', fname);
      await mkdir(join(stagingDir, '07_BOQ'), { recursive: true });
      await copyFile(src, dst);
      stagedFiles.push({ abs_path: dst, rel_path: `07_BOQ/${fname}`, kind: 'xlsx', code: 'BOQ-01' });
    } else {
      warnings.push(`BOQ file missing: ${src}`);
    }
  }

  // 3c) IFC → 08_BIM
  if (opts.packOpts.deliverables.ifc) {
    const src = opts.packOpts.deliverables.ifc;
    if (existsSync(src)) {
      const fname = buildIndustryName({
        projectCode: projCode,
        phase,
        discipline: 'BIM',
        number: '01',
        description: 'BimModel',
        revision: revisionNum,
        ext: 'ifc',
      });
      const dst = join(stagingDir, '08_BIM', fname);
      await mkdir(join(stagingDir, '08_BIM'), { recursive: true });
      await copyFile(src, dst);
      stagedFiles.push({ abs_path: dst, rel_path: `08_BIM/${fname}`, kind: 'ifc', code: 'BIM-01' });
    } else {
      warnings.push(`IFC file missing: ${src}`);
    }
  }

  // 3d) Renders → 06_Render
  const renders = opts.packOpts.deliverables.renders ?? [];
  for (let i = 0; i < renders.length; i++) {
    const src = renders[i]!;
    if (!existsSync(src)) {
      warnings.push(`Render missing: ${src}`);
      continue;
    }
    const ext = (extname(src).slice(1) || 'png').toLowerCase();
    const baseName = basename(src, extname(src));
    // Render numbering: support format S{style}-A{angle} or sequential
    const m = baseName.match(/style(\d+).*angle(\d+)/i);
    const number = m ? `S${m[1]!.padStart(2, '0')}-A${m[2]!.padStart(2, '0')}` : String(i + 1).padStart(3, '0');
    const fname = buildIndustryName({
      projectCode: projCode,
      phase,
      discipline: 'RD',
      number,
      description: m ? 'PhongCach' : 'Render',
      revision: revisionNum,
      ext,
    });
    const dst = join(stagingDir, '06_Render', fname);
    await mkdir(join(stagingDir, '06_Render'), { recursive: true });
    await copyFile(src, dst);
    stagedFiles.push({
      abs_path: dst, rel_path: `06_Render/${fname}`,
      kind: ext as DeliverableKind, code: `RD-${number}`,
    });
  }

  emit(55, 'Staging reports + permit files');

  // 3e) Reports → 10_BaoCao (hoặc folder override)
  const reports = opts.packOpts.deliverables.reports ?? [];
  for (let i = 0; i < reports.length; i++) {
    const r = reports[i]!;
    if (!existsSync(r.path)) {
      warnings.push(`Report missing: ${r.path}`);
      continue;
    }
    const ext = (extname(r.path).slice(1) || 'pdf').toLowerCase();
    const folder = r.folder ?? '10_BaoCao';
    const fname = buildIndustryName({
      projectCode: projCode,
      phase,
      discipline: 'GEN',
      number: String(i + 1).padStart(2, '0'),
      description: r.name,
      revision: revisionNum,
      ext,
    });
    const dst = join(stagingDir, folder, fname);
    await mkdir(join(stagingDir, folder), { recursive: true });
    await copyFile(r.path, dst);
    stagedFiles.push({
      abs_path: dst, rel_path: `${folder}/${fname}`,
      kind: ext as DeliverableKind, code: `RPT-${i + 1}`,
    });
  }

  // 3f) Permit files → 09_HoSoPhapLy
  const permitFiles = opts.packOpts.deliverables.permit_files ?? [];
  for (let i = 0; i < permitFiles.length; i++) {
    const src = permitFiles[i]!;
    if (!existsSync(src)) {
      warnings.push(`Permit file missing: ${src}`);
      continue;
    }
    const ext = (extname(src).slice(1) || 'pdf').toLowerCase();
    const baseName = sanitizeVi(basename(src, extname(src))).replace(/[^A-Za-z0-9._-]/g, '');
    const fname = `${slugify(projCode, 30)}_${phase}_HS_${String(i + 1).padStart(2, '0')}_${slugify(baseName, 40)}_R${String(revisionNum).padStart(2, '0')}.${ext}`;
    const dst = join(stagingDir, '09_HoSoPhapLy', fname);
    await mkdir(join(stagingDir, '09_HoSoPhapLy'), { recursive: true });
    await copyFile(src, dst);
    stagedFiles.push({
      abs_path: dst, rel_path: `09_HoSoPhapLy/${fname}`,
      kind: ext as DeliverableKind, code: `HS-${i + 1}`,
    });
  }

  emit(70, 'Computing SHA-256 checksums');

  // 4) SHA-256 cho mỗi file
  const entries: ChecksumManifestEntry[] = [];
  for (const sf of stagedFiles) {
    try {
      const { sha256, size } = await sha256File(sf.abs_path);
      entries.push({
        rel_path: sf.rel_path,
        size_bytes: size,
        sha256,
        kind: sf.kind,
        code: sf.code,
      });
    } catch (err) {
      warnings.push(`SHA-256 failed: ${sf.rel_path} — ${err instanceof Error ? err.message : 'unknown'}`);
    }
  }

  // 5) Build manifest signature
  const packageId = `PKG-${slugify(projCode, 30)}-R${String(revisionNum).padStart(2, '0')}-${Date.now()}`;
  const manifest = buildChecksumManifest({ package_id: packageId, entries });

  emit(80, 'Generating cover PDF + index.html');

  // 6) Generate cover PDF + metadata + index.html
  const counts = {
    drawings: drawings.length,
    renders: renders.length,
    reports: reports.length,
    boq: opts.packOpts.deliverables.boq ? 1 : 0,
    ifc: opts.packOpts.deliverables.ifc ? 1 : 0,
    permit_files: permitFiles.length,
  };
  const totalCount = Object.values(counts).reduce((a, b) => a + b, 0);

  const metadataDoc = buildMetadataDoc({
    packageId,
    packOpts: opts.packOpts,
    entries,
    manifest_signature: manifest.manifest_signature,
    counts: { ...counts, total: totalCount },
  });

  // Write metadata.json
  const metadataPath = join(stagingDir, '00_metadata.json');
  await writeFile(metadataPath, JSON.stringify(metadataDoc, null, 2), 'utf-8');

  // Write manifest.txt (sha256sum format)
  const manifestTxtPath = join(stagingDir, '00_manifest.txt');
  await writeFile(manifestTxtPath, renderSha256SumFile(manifest), 'utf-8');

  // Write README.html (offline browseable)
  const readmePath = join(stagingDir, '00_README.html');
  await writeFile(readmePath, buildIndexHtml(metadataDoc), 'utf-8');

  // Write cover.pdf
  let coverPath: string | undefined;
  try {
    const coverPdf = await buildCoverPdf({
      project: opts.packOpts.project ?? {
        code: projCode,
        name: 'Unknown Project',
        owner_name: 'N/A',
        address: 'N/A',
        phase,
        designed_by: 'Viet-Contech Co., Ltd',
      },
      packageType: opts.packOpts.packageType,
      revision: revisionNum,
      drawings: drawings,
      branding: opts.packOpts.branding ?? {
        company: 'VIET CONTECH',
        color: '#C4933A',
      },
      online_review_url: opts.packOpts.online_review_url,
      render_count: counts.renders,
      has_ifc: counts.ifc > 0,
      generated_at: new Date().toISOString(),
    });
    coverPath = join(stagingDir, '00_cover.pdf');
    await writeFile(coverPath, coverPdf);
  } catch (err) {
    warnings.push(`Cover PDF generation failed: ${err instanceof Error ? err.message : 'unknown'}`);
  }

  emit(90, 'Compressing archive');

  // 7) Build archive
  const archiveSize = await zipDirectory(
    stagingDir,
    archivePath,
    opts.packOpts.output_format ?? 'zip',
  );

  // 8) Compute archive SHA-256
  const { sha256: archiveSha } = await sha256File(archivePath);

  // 9) Total size = sum of original files
  const totalSize = entries.reduce((s, e) => s + e.size_bytes, 0);

  emit(100, 'Done');

  const result: PackResult = {
    ok: true,
    jobId,
    packageId,
    archive_path: archivePath,
    archive_size_bytes: archiveSize,
    archive_format: opts.packOpts.output_format ?? 'zip',
    total_files: entries.length + (coverPath ? 4 : 3), // entries + cover/metadata/readme/manifest
    total_size_bytes: totalSize,
    archive_sha256: archiveSha,
    manifest_signature: manifest.manifest_signature,
    counts,
    warnings,
    duration_ms: Date.now() - startedAt,
    generated_at: new Date().toISOString(),
  };

  return result;
}

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function parseRevisionNumber(revId: string): number {
  const m = revId.match(/(\d+)/);
  return m ? parseInt(m[1]!, 10) : 1;
}

/**
 * Zip 1 folder → archive file. Hỗ trợ zip + tar.gz (7z fallback to zip).
 * Trả về số bytes của archive.
 */
function zipDirectory(srcDir: string, outPath: string, format: OutputFormat): Promise<number> {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(outPath);
    let archive: archiver.Archiver;

    if (format === 'tar.gz') {
      archive = archiver('tar', { gzip: true, gzipOptions: { level: 6 } });
    } else if (format === '7z') {
      // archiver không hỗ trợ 7z native — fallback ZIP
      archive = archiver('zip', { zlib: { level: 9 } });
    } else {
      archive = archiver('zip', { zlib: { level: 6 } });
    }

    output.on('close', () => resolve(archive.pointer()));
    output.on('error', reject);
    archive.on('warning', (err) => {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') reject(err);
    });
    archive.on('error', reject);

    archive.pipe(output);
    archive.directory(srcDir, false);
    archive.finalize();
  });
}

/**
 * Re-export validation report cho debugging.
 */
export async function dryRun(opts: PackOpts): Promise<ValidationResult> {
  return validatePackOpts(opts);
}
