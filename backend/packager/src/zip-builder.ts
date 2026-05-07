// ===============================================================
// ZIP Builder — đóng gói toàn bộ deliverables thành ZIP gửi khách
// ===============================================================
// Cấu trúc:
//   VCT-{projectCode}-rev{n}-{date}.zip
//   ├── 00-OVERVIEW/      README + INDEX + PROJECT-SUMMARY
//   ├── 01-ARCHITECTURE/  A-01 → A-11
//   ├── 02-STRUCTURAL/    S-01 → S-04
//   ├── 03-MEP/           ELECTRIC | PLUMBING | HVAC | FIRE-SAFETY
//   ├── 04-INTERIOR/      I-01 → I-03
//   ├── 05-3D-RENDER/     9-styles + 360-walkthrough
//   ├── 06-BOQ/           B-01 → B-03 (Excel)
//   ├── 07-BIM/           IFC4
//   ├── 08-LEGAL/         Hồ sơ xin phép Sở XD (8 mục)
//   └── 09-AUDIT/         DECISIONS + QC-REPORT + manifest.json
// ===============================================================

import archiver from 'archiver';
import { createWriteStream } from 'node:fs';
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type {
  DeliverableRecord, ProjectInfo, PackageKind, PackageMetadata,
  ChecksumManifestEntry, BuildJob,
} from './types.js';
import {
  reconcileManifest, buildIndexRows, indexRowsToCsv, buildReadme,
  TOTAL_DELIVERABLES, SCHEMA_VERSION,
} from './manifest-builder.js';
import { buildDeliverableFileName, buildZipFileName, slugify } from './file-naming.js';
import { buildEmbedMetadata } from './metadata-embed.js';
import { sha256File, buildChecksumManifest, renderSha256SumFile } from './checksum.js';
import { generatePreview } from './preview-generator.js';
import { buildPermitPackage } from './permit-builder.js';

export interface ZipBuildOptions {
  outDir: string;
  project: ProjectInfo;
  records: DeliverableRecord[];
  kind: PackageKind;
  /** Tùy chọn: bao gồm preview *.preview.png cạnh mỗi file */
  includePreviews?: boolean;
  /** Decisions log (markdown) — copy vào 09-AUDIT */
  decisionsMd?: string;
  /** QC report (text/markdown) */
  qcReport?: string;
  /** CSV agent_runs */
  agentRunsCsv?: string;
  /** Project summary 1 trang (text/markdown) — render PROJECT-SUMMARY */
  projectSummary?: string;
  /** Tỉ lệ pass QC */
  qcPassRate?: number;
  qcGatesPassed?: number;
  qcGatesTotal?: number;
  /** Callback progress */
  onProgress?: (job: BuildJob) => void;
  /** ID job để track */
  jobId?: string;
  built_by?: string;
}

export interface ZipBuildResult {
  zip_path: string;
  zip_size_bytes: number;
  package_metadata: PackageMetadata;
  checksum_signature: string;
  files_added: number;
  warnings: string[];
}

const FOLDER_BY_GROUP: Record<string, string> = {
  ARCHITECTURE: '01-ARCHITECTURE',
  STRUCTURAL:   '02-STRUCTURAL',
  MEP_ELECTRIC: '03-MEP/ELECTRIC',
  MEP_PLUMBING: '03-MEP/PLUMBING',
  MEP_HVAC:     '03-MEP/HVAC',
  FIRE:         '03-MEP/FIRE-SAFETY',
  INTERIOR:     '04-INTERIOR',
  RENDER:       '05-3D-RENDER',
  BOQ:          '06-BOQ',
  BIM:          '07-BIM',
  LEGAL:        '08-LEGAL',
  AUDIT:        '09-AUDIT',
  OVERVIEW:     '00-OVERVIEW',
};

/** Build ZIP — main entry */
export async function buildZipPackage(opts: ZipBuildOptions): Promise<ZipBuildResult> {
  const warnings: string[] = [];
  const startTs = Date.now();
  const jobId = opts.jobId ?? `job-${Date.now()}`;
  const emitProgress = (progress: number, step: string) => {
    if (!opts.onProgress) return;
    opts.onProgress({
      id: jobId,
      project_id: opts.project.id,
      revision_id: opts.project.revision_id,
      kind: opts.kind,
      status: 'running',
      progress,
      current_step: step,
      started_at: new Date(startTs).toISOString(),
      eta_sec: progress > 0 ? Math.round(((Date.now() - startTs) / progress) * (100 - progress) / 1000) : undefined,
    });
  };

  emitProgress(2, 'Reconciling manifest');

  // 1) Reconcile manifest
  const recon = reconcileManifest(opts.records, { floors: opts.project.scale.floors });
  if (!recon.ready_for_pack && opts.kind !== 'partial') {
    throw new Error(
      `Thiếu ${recon.missing_required.length} deliverable bắt buộc: ` +
      recon.missing_required.map((s) => s.code).join(', '),
    );
  }
  if (recon.missing_required.length > 0) {
    warnings.push(`Thiếu ${recon.missing_required.length} required (partial mode)`);
  }
  if (recon.orphans.length > 0) {
    warnings.push(`${recon.orphans.length} file orphan → đặt vào 99-MISC`);
  }

  // 2) Chuẩn bị output dir + filename
  await mkdir(opts.outDir, { recursive: true });
  const zipName = buildZipFileName(opts.project, opts.kind);
  const zipPath = join(opts.outDir, zipName);
  const stagingDir = join(opts.outDir, `_staging-${jobId}`);
  await mkdir(stagingDir, { recursive: true });

  emitProgress(8, 'Generating overview docs');

  // 3) Gen 00-OVERVIEW
  const overviewDir = join(stagingDir, FOLDER_BY_GROUP.OVERVIEW!);
  await mkdir(overviewDir, { recursive: true });
  const readmePath = join(overviewDir, 'README.md');
  await writeFile(readmePath, buildReadme(opts.project, recon), 'utf-8');
  const summaryPath = join(overviewDir, 'PROJECT-SUMMARY.md');
  await writeFile(summaryPath, opts.projectSummary ?? buildProjectSummary(opts.project, recon), 'utf-8');
  const indexCsvPath = join(overviewDir, 'INDEX.csv');
  const indexRows = buildIndexRows(recon, (r) => relPathOf(r, opts.project));
  await writeFile(indexCsvPath, indexRowsToCsv(indexRows), 'utf-8');

  emitProgress(15, 'Building 08-LEGAL permit package');

  // 4) Build hồ sơ xin phép vào 08-LEGAL
  const legalDir = join(stagingDir, FOLDER_BY_GROUP.LEGAL!);
  await buildPermitPackage({ outDir: legalDir, project: opts.project, records: opts.records });

  // 5) Generate AUDIT folder
  emitProgress(22, 'Writing 09-AUDIT');
  const auditDir = join(stagingDir, FOLDER_BY_GROUP.AUDIT!);
  await mkdir(auditDir, { recursive: true });
  if (opts.decisionsMd) await writeFile(join(auditDir, 'DECISIONS.md'), opts.decisionsMd, 'utf-8');
  if (opts.qcReport)    await writeFile(join(auditDir, 'QC-REPORT.md'),  opts.qcReport,  'utf-8');
  if (opts.agentRunsCsv) await writeFile(join(auditDir, 'AGENT-RUNS.csv'), opts.agentRunsCsv, 'utf-8');

  // 6) Stage records vào folders
  emitProgress(30, 'Staging deliverable files');
  const stagedFiles: { rel_path: string; abs_path: string; record?: DeliverableRecord }[] = [];

  // helper: stage 1 file
  async function stageOne(absPath: string, relPath: string, record?: DeliverableRecord) {
    if (!existsSync(absPath)) {
      warnings.push(`File missing: ${absPath} (${record?.spec.code ?? 'orphan'})`);
      return;
    }
    stagedFiles.push({ rel_path: relPath, abs_path: absPath, record });
  }

  for (const m of recon.matched) {
    const folder = m.spec.folder ?? FOLDER_BY_GROUP.OVERVIEW;
    if (m.records.length === 1) {
      const rec = m.records[0]!;
      const fname = buildDeliverableFileName(m.spec, opts.project);
      await stageOne(rec.abs_path, `${folder}/${fname}`, rec);
    } else {
      // VD R-01 = 72 file render
      for (let i = 0; i < m.records.length; i++) {
        const rec = m.records[i]!;
        const fname = buildDeliverableFileName(m.spec, opts.project, m.spec.kind)
          .replace(/\.[^.]+$/, `_${String(i + 1).padStart(3, '0')}.${m.spec.kind}`);
        await stageOne(rec.abs_path, `${folder}/${fname}`, rec);
      }
    }
  }

  // Orphans → 99-MISC
  if (recon.orphans.length > 0) {
    for (const r of recon.orphans) {
      const ext = r.spec.kind;
      const fname = `${slugify(r.spec.code, 12)}_${slugify(r.spec.name, 30)}.${ext}`;
      await stageOne(r.abs_path, `99-MISC/${fname}`, r);
    }
  }

  emitProgress(50, 'Generating previews');

  // 7) Optional: gen previews
  if (opts.includePreviews) {
    let i = 0;
    for (const sf of stagedFiles) {
      i++;
      if (!sf.record) continue;
      try {
        const result = await generatePreview(sf.abs_path, sf.record.spec.kind);
        if (result.generated && result.preview_path) {
          stagedFiles.push({
            rel_path: sf.rel_path + '.preview.png',
            abs_path: result.preview_path,
          });
        }
      } catch (err) {
        warnings.push(`Preview failed: ${sf.rel_path}`);
      }
      if (i % 20 === 0) emitProgress(50 + Math.round((i / stagedFiles.length) * 15), 'Generating previews');
    }
  }

  emitProgress(68, 'Computing checksums');

  // 8) Build checksum entries — overview/audit/legal đã staged ở filesystem
  const allStaged: { rel_path: string; abs_path: string; kind: string; code?: string }[] = [];

  // overview / audit / legal đi từ stagingDir
  for (const f of [
    { rel: '00-OVERVIEW/README.md', kind: 'md' },
    { rel: '00-OVERVIEW/PROJECT-SUMMARY.md', kind: 'md' },
    { rel: '00-OVERVIEW/INDEX.csv', kind: 'csv' },
  ]) {
    allStaged.push({ rel_path: f.rel, abs_path: join(stagingDir, f.rel), kind: f.kind });
  }
  // legal files
  await collectStaged(stagingDir, FOLDER_BY_GROUP.LEGAL!, allStaged);
  // audit files
  await collectStaged(stagingDir, FOLDER_BY_GROUP.AUDIT!, allStaged);
  // deliverable files
  for (const sf of stagedFiles) {
    allStaged.push({
      rel_path: sf.rel_path,
      abs_path: sf.abs_path,
      kind: sf.record?.spec.kind ?? 'json',
      code: sf.record?.spec.code,
    });
  }

  // 9) Compute SHA-256 cho mọi file
  const checksumEntries: ChecksumManifestEntry[] = [];
  for (const f of allStaged) {
    try {
      const { sha256, size } = await sha256File(f.abs_path);
      checksumEntries.push({
        rel_path: f.rel_path,
        size_bytes: size,
        sha256,
        kind: f.kind as ChecksumManifestEntry['kind'],
        code: f.code,
      });
    } catch (err) {
      warnings.push(`Checksum failed: ${f.rel_path}`);
    }
  }

  emitProgress(80, 'Building checksum manifest');

  const packageId = `PKG-${slugify(opts.project.code, 30)}-rev${opts.project.revision_num}-${Date.now()}`;
  const manifest = buildChecksumManifest({ package_id: packageId, entries: checksumEntries });
  const manifestJsonPath = join(auditDir, 'manifest.json');
  await writeFile(manifestJsonPath, JSON.stringify(manifest, null, 2), 'utf-8');
  const manifestTxtPath = join(auditDir, 'manifest.txt');
  await writeFile(manifestTxtPath, renderSha256SumFile(manifest), 'utf-8');

  emitProgress(85, 'Creating ZIP archive');

  // 10) Build ZIP với archiver
  const zipSize = await zipDirectory(stagingDir, zipPath, (bytes, total) => {
    const pct = total > 0 ? Math.round((bytes / total) * 12) : 0; // 85..97
    emitProgress(Math.min(85 + pct, 97), 'Compressing');
  });

  emitProgress(99, 'Finalizing');

  // 11) Build PackageMetadata
  const totalSize = checksumEntries.reduce((s, e) => s + e.size_bytes, 0);
  const packageMetadata: PackageMetadata = {
    package_id: packageId,
    project: opts.project,
    kind: opts.kind,
    built_at: new Date().toISOString(),
    built_by: opts.built_by ?? 'system',
    total_files: checksumEntries.length,
    total_size_bytes: totalSize,
    qc_pass_rate: opts.qcPassRate ?? 1,
    qc_gates_passed: opts.qcGatesPassed ?? 12,
    qc_gates_total: opts.qcGatesTotal ?? 12,
    required_missing: recon.missing_required.map((s) => s.code),
    schema_version: SCHEMA_VERSION,
  };
  await writeFile(
    join(auditDir, 'PACKAGE-META.json'),
    JSON.stringify(packageMetadata, null, 2),
    'utf-8',
  );

  emitProgress(100, 'Done');

  return {
    zip_path: zipPath,
    zip_size_bytes: zipSize,
    package_metadata: packageMetadata,
    checksum_signature: manifest.manifest_signature,
    files_added: checksumEntries.length,
    warnings,
  };
}

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function relPathOf(rec: DeliverableRecord, project: ProjectInfo): string {
  const folder = rec.spec.folder ?? '00-OVERVIEW';
  const fname = buildDeliverableFileName(rec.spec, project);
  return `${folder}/${fname}`;
}

function buildProjectSummary(project: ProjectInfo, recon: ReturnType<typeof reconcileManifest>): string {
  return [
    `# Tóm tắt dự án`, '',
    `**${project.name}**`,
    `Mã: ${project.code} | Revision: v${project.revision_num}`,
    `Chủ đầu tư: ${project.owner.full_name}`,
    `Địa điểm: ${project.lot.address}, ${project.lot.ward}, ${project.lot.district}, ${project.lot.city}`,
    `Quy mô: ${project.scale.floors} tầng — ${project.scale.gfa_m2} m²`,
    '',
    `## Trạng thái`,
    `- ${recon.matched.length}/${TOTAL_DELIVERABLES} deliverables`,
    `- ${recon.missing_required.length} required missing`,
    '',
    `_Generated by Viet-Contech Output Packager_`,
  ].join('\n');
}

/** Recursively collect all files in stagingDir/subfolder */
async function collectStaged(
  stagingDir: string,
  subfolder: string,
  out: { rel_path: string; abs_path: string; kind: string }[],
): Promise<void> {
  const { readdir } = await import('node:fs/promises');
  const root = join(stagingDir, subfolder);
  if (!existsSync(root)) return;

  async function walk(dir: string, relPrefix: string) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const abs = join(dir, e.name);
      const rel = relPrefix ? `${relPrefix}/${e.name}` : e.name;
      if (e.isDirectory()) {
        await walk(abs, rel);
      } else {
        const ext = e.name.split('.').pop()?.toLowerCase() ?? 'bin';
        out.push({ rel_path: `${subfolder}/${rel}`, abs_path: abs, kind: ext });
      }
    }
  }
  await walk(root, '');
}

/** Zip 1 folder thành 1 file ZIP, return size */
function zipDirectory(
  srcDir: string,
  outPath: string,
  onProgress?: (bytes: number, total: number) => void,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(outPath);
    const archive = archiver('zip', { zlib: { level: 6 } });

    output.on('close', () => resolve(archive.pointer()));
    output.on('error', reject);
    archive.on('warning', (err) => {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') reject(err);
    });
    archive.on('error', reject);
    if (onProgress) {
      archive.on('progress', (p) => {
        onProgress(p.fs.processedBytes, p.fs.totalBytes);
      });
    }

    archive.pipe(output);
    archive.directory(srcDir, false);
    archive.finalize();
  });
}
