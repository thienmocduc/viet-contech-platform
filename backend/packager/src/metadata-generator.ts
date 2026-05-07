// ===============================================================
// Metadata Generator — metadata.json + index.html cho package
// ===============================================================
// Mỗi package ZIP có:
//   - 00_metadata.json — toàn bộ thông tin gói + sha256 từng file
//   - 00_README.html   — trang chủ offline browseable, click → mở DWG/PDF
//
// Khách giải nén ZIP → mở README.html → thấy bảng đẹp với tất cả
// bản vẽ + click thumbnail mở native (browser sẽ trigger app handler).
// ===============================================================

import type {
  PackOpts, PackProjectInfo, Branding, PackageType, OutputFormat,
} from './types.js';
import type { ChecksumManifestEntry } from './types.js';

// ----------------------------------------------------------------
// Metadata JSON shape
// ----------------------------------------------------------------

export interface PackageMetadataDoc {
  schema_version: string;
  package_id: string;
  package_type: PackageType;
  archive_format: OutputFormat;
  generated_at: string;
  project: PackProjectInfo & { id: string; revision_id: string };
  branding: Branding;
  counts: {
    drawings: number;
    renders: number;
    reports: number;
    boq: number;
    ifc: number;
    permit_files: number;
    total: number;
  };
  totals: {
    drawings_count: number;
    boq_total_vnd?: number;
    revision: number;
  };
  signed_by_kts?: string;
  qc_pass: boolean;
  qc_pass_rate?: number;
  files: ChecksumManifestEntry[];
  manifest_signature: string;
  online_review_url?: string;
}

export const METADATA_SCHEMA_VERSION = '2.0.0';

export function buildMetadataDoc(opts: {
  packageId: string;
  packOpts: PackOpts;
  entries: ChecksumManifestEntry[];
  manifest_signature: string;
  counts: PackageMetadataDoc['counts'];
  boqTotalVnd?: number;
  qcPass?: boolean;
  qcPassRate?: number;
}): PackageMetadataDoc {
  const project = opts.packOpts.project ?? {
    code: 'UNKNOWN',
    name: 'Unknown Project',
    owner_name: 'N/A',
    address: 'N/A',
    phase: 'DD' as const,
    designed_by: 'Viet-Contech Co., Ltd',
  };

  return {
    schema_version: METADATA_SCHEMA_VERSION,
    package_id: opts.packageId,
    package_type: opts.packOpts.packageType,
    archive_format: opts.packOpts.output_format ?? 'zip',
    generated_at: new Date().toISOString(),
    project: {
      ...project,
      id: opts.packOpts.projectId,
      revision_id: opts.packOpts.revisionId,
    },
    branding: opts.packOpts.branding ?? {
      company: 'VIET CONTECH',
      color: '#C4933A',
    },
    counts: opts.counts,
    totals: {
      drawings_count: opts.counts.drawings,
      boq_total_vnd: opts.boqTotalVnd,
      revision: parseRevisionNumber(opts.packOpts.revisionId),
    },
    signed_by_kts: project.signed_by_kts,
    qc_pass: opts.qcPass ?? true,
    qc_pass_rate: opts.qcPassRate,
    files: opts.entries,
    manifest_signature: opts.manifest_signature,
    online_review_url: opts.packOpts.online_review_url,
  };
}

function parseRevisionNumber(revId: string): number {
  // "rev_3" / "R02" / "rev3" → 3
  const m = revId.match(/(\d+)/);
  return m ? parseInt(m[1]!, 10) : 1;
}

// ----------------------------------------------------------------
// HTML index — offline browseable
// ----------------------------------------------------------------

const HTML_ESCAPE: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function htmlEscape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPE[c] ?? c);
}

function fmtVnd(n?: number): string {
  if (n === undefined || n === null) return '—';
  return n.toLocaleString('vi-VN') + ' đ';
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/**
 * Build trang HTML offline-browseable. Click 1 dòng bản vẽ →
 * mở file native (browser tự handler DWG/PDF).
 */
export function buildIndexHtml(meta: PackageMetadataDoc): string {
  const accent = meta.branding.color || '#C4933A';
  const company = htmlEscape(meta.branding.company || 'VIET CONTECH');
  const proj = meta.project;

  // Group files theo folder prefix (01_KienTruc, 02_KetCau, ...)
  const groups = new Map<string, ChecksumManifestEntry[]>();
  for (const f of meta.files) {
    const seg = f.rel_path.split('/');
    const folder = seg[0] ?? 'OTHER';
    const arr = groups.get(folder) ?? [];
    arr.push(f);
    groups.set(folder, arr);
  }
  const sortedFolders = Array.from(groups.keys()).sort();

  const groupSections = sortedFolders.map(folder => {
    const files = groups.get(folder) ?? [];
    const fileRows = files
      .sort((a, b) => a.rel_path.localeCompare(b.rel_path))
      .map(f => {
        const fileName = f.rel_path.split('/').pop() ?? f.rel_path;
        const ext = (f.kind || '').toLowerCase();
        const icon = pickIcon(ext);
        return `<tr>
  <td class="ic">${icon}</td>
  <td><a href="./${htmlEscape(f.rel_path)}" target="_blank">${htmlEscape(fileName)}</a></td>
  <td class="num">${htmlEscape(ext.toUpperCase())}</td>
  <td class="num">${fmtBytes(f.size_bytes)}</td>
  <td class="hash" title="${htmlEscape(f.sha256)}">${htmlEscape(f.sha256.slice(0, 12))}…</td>
</tr>`;
      }).join('\n');
    return `<section class="group">
  <h2>${htmlEscape(folder)} <span class="count">${files.length} file</span></h2>
  <table class="file-table">
    <thead><tr><th></th><th>Tên file</th><th>Loại</th><th>KB</th><th>SHA-256</th></tr></thead>
    <tbody>${fileRows}</tbody>
  </table>
</section>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8" />
<title>${company} — ${htmlEscape(proj.name)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  :root { --accent: ${accent}; --bg: #0e0d0a; --fg: #f0e8d8; --muted: #8a7f6a; --card: #1a1813; --border: #2c2820; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'Noto Serif', Georgia, serif; background: var(--bg); color: var(--fg); }
  header { background: linear-gradient(135deg, #1a1813 0%, #0e0d0a 100%); border-bottom: 2px solid var(--accent); padding: 32px 40px; }
  header h1 { margin: 0 0 8px; font-size: 28px; color: var(--accent); letter-spacing: 1px; }
  header .sub { color: var(--muted); font-size: 14px; }
  .meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; padding: 24px 40px; background: var(--card); border-bottom: 1px solid var(--border); }
  .meta .item { font-size: 13px; }
  .meta .item .label { color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; font-size: 11px; }
  .meta .item .value { color: var(--fg); margin-top: 4px; font-weight: 500; }
  main { padding: 24px 40px 60px; }
  section.group { margin-top: 32px; }
  section.group h2 { color: var(--accent); border-left: 3px solid var(--accent); padding-left: 12px; font-size: 18px; }
  section.group h2 .count { color: var(--muted); font-size: 13px; font-weight: normal; margin-left: 8px; }
  table.file-table { width: 100%; border-collapse: collapse; margin-top: 8px; font-family: 'JetBrains Mono', Menlo, monospace; font-size: 13px; }
  table.file-table th, table.file-table td { padding: 8px 12px; border-bottom: 1px solid var(--border); text-align: left; }
  table.file-table th { color: var(--muted); text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px; }
  table.file-table tr:hover { background: rgba(196, 147, 58, 0.08); }
  table.file-table .ic { width: 24px; text-align: center; }
  table.file-table .num { color: var(--muted); white-space: nowrap; }
  table.file-table .hash { color: #66bb6a; font-size: 11px; }
  table.file-table a { color: var(--fg); text-decoration: none; border-bottom: 1px dashed transparent; }
  table.file-table a:hover { color: var(--accent); border-bottom-color: var(--accent); }
  footer { padding: 24px 40px; border-top: 1px solid var(--border); color: var(--muted); font-size: 12px; text-align: center; }
  footer .signature { font-family: monospace; color: #66bb6a; word-break: break-all; }
  .badge { display: inline-block; padding: 3px 10px; background: var(--accent); color: #0e0d0a; border-radius: 12px; font-size: 11px; font-weight: 700; letter-spacing: 0.5px; margin-left: 8px; }
</style>
</head>
<body>
<header>
  <h1>${company} <span class="badge">${htmlEscape(meta.package_type)}</span></h1>
  <div class="sub">${htmlEscape(proj.name)} • ${htmlEscape(proj.code)} • Revision ${meta.totals.revision}</div>
</header>
<div class="meta">
  <div class="item"><div class="label">Chủ đầu tư</div><div class="value">${htmlEscape(proj.owner_name)}</div></div>
  <div class="item"><div class="label">Địa điểm</div><div class="value">${htmlEscape(proj.address)}</div></div>
  <div class="item"><div class="label">Đơn vị thiết kế</div><div class="value">${htmlEscape(proj.designed_by)}</div></div>
  <div class="item"><div class="label">Phase</div><div class="value">${htmlEscape(proj.phase)}</div></div>
  ${proj.signed_by_kts ? `<div class="item"><div class="label">KTS chủ trì</div><div class="value">${htmlEscape(proj.signed_by_kts)}</div></div>` : ''}
  <div class="item"><div class="label">Tổng số bản vẽ</div><div class="value">${meta.totals.drawings_count}</div></div>
  <div class="item"><div class="label">Tổng dự toán</div><div class="value">${fmtVnd(meta.totals.boq_total_vnd)}</div></div>
  <div class="item"><div class="label">QC</div><div class="value">${meta.qc_pass ? 'ĐẠT' : 'CHƯA ĐẠT'}${meta.qc_pass_rate !== undefined ? ` (${(meta.qc_pass_rate * 100).toFixed(0)}%)` : ''}</div></div>
  <div class="item"><div class="label">Generated</div><div class="value">${htmlEscape(meta.generated_at.slice(0, 19).replace('T', ' '))}</div></div>
</div>
<main>
${groupSections}
</main>
<footer>
  <div>Package ID: <span class="signature">${htmlEscape(meta.package_id)}</span></div>
  <div style="margin-top:6px">Manifest signature (SHA-256): <span class="signature">${htmlEscape(meta.manifest_signature)}</span></div>
  <div style="margin-top:6px">Verify integrity: <code>sha256sum -c 00_manifest.txt</code></div>
  <div style="margin-top:12px">Generated by Viet-Contech Output Packager v${htmlEscape(METADATA_SCHEMA_VERSION)} • ${htmlEscape(meta.archive_format)} archive</div>
</footer>
</body>
</html>`;
}

function pickIcon(ext: string): string {
  switch (ext) {
    case 'dwg':
    case 'dxf': return '<span style="color:#5c9eff">▣</span>';
    case 'pdf': return '<span style="color:#e57373">▤</span>';
    case 'xlsx':
    case 'csv': return '<span style="color:#66bb6a">▦</span>';
    case 'ifc': return '<span style="color:#ffb74d">◈</span>';
    case 'png':
    case 'jpg': return '<span style="color:#ba68c8">◉</span>';
    case 'glb':
    case 'usdz': return '<span style="color:#4dd0e1">◊</span>';
    case 'json':
    case 'md': return '<span style="color:#90a4ae">▢</span>';
    default: return '<span style="color:#90a4ae">○</span>';
  }
}
