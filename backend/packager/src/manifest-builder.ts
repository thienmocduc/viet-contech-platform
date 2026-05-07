// ===============================================================
// Manifest Builder — danh mục 30 deliverable chuẩn Viet-Contech
// ===============================================================
// Khi pipeline hoàn tất 7 phase, packager đối chiếu deliverables
// thực tế với manifest này. Thiếu item required → block ZIP build.
// ===============================================================

import type { DeliverableSpec, DeliverableRecord, ProjectInfo } from './types.js';

/**
 * 30 deliverable codes chuẩn — lineage từ 19 agents legion qua 7 phase.
 * Phase mapping: B3=KT, B4=KC, B5=MEP+BIM, B6=NT+3D, B7=BOQ+Permit.
 */
export const DELIVERABLE_MANIFEST: DeliverableSpec[] = [
  // ── ARCHITECTURE (KT) — phase B3 ──
  { code: 'A-01', name: 'Mặt bằng tổng thể',          kind: 'dwg', source: 'architect', phase: 'B3', required: true,
    folder: '01-ARCHITECTURE', description: 'Tổng mặt bằng + định vị công trình trên lô đất' },
  { code: 'A-02', name: 'Mặt bằng tầng 1',            kind: 'dwg', source: 'architect', phase: 'B3', required: true,
    folder: '01-ARCHITECTURE' },
  { code: 'A-03', name: 'Mặt bằng tầng 2 (nếu có)',   kind: 'dwg', source: 'architect', phase: 'B3',
    folder: '01-ARCHITECTURE' },
  { code: 'A-04', name: 'Mặt bằng tầng 3 (nếu có)',   kind: 'dwg', source: 'architect', phase: 'B3',
    folder: '01-ARCHITECTURE' },
  { code: 'A-05', name: 'Mặt bằng mái',                kind: 'dwg', source: 'architect', phase: 'B3', required: true,
    folder: '01-ARCHITECTURE' },
  { code: 'A-06', name: 'Mặt đứng chính',              kind: 'dwg', source: 'architect', phase: 'B3', required: true,
    folder: '01-ARCHITECTURE' },
  { code: 'A-07', name: 'Mặt đứng bên trái',           kind: 'dwg', source: 'architect', phase: 'B3', required: true,
    folder: '01-ARCHITECTURE' },
  { code: 'A-08', name: 'Mặt đứng bên phải',           kind: 'dwg', source: 'architect', phase: 'B3', required: true,
    folder: '01-ARCHITECTURE' },
  { code: 'A-09', name: 'Mặt đứng sau',                kind: 'dwg', source: 'architect', phase: 'B3', required: true,
    folder: '01-ARCHITECTURE' },
  { code: 'A-10', name: 'Mặt cắt A-A',                 kind: 'dwg', source: 'architect', phase: 'B3', required: true,
    folder: '01-ARCHITECTURE' },
  { code: 'A-11', name: 'Mặt cắt B-B',                 kind: 'dwg', source: 'architect', phase: 'B3', required: true,
    folder: '01-ARCHITECTURE' },

  // ── STRUCTURAL (KC) — phase B4 ──
  { code: 'S-01', name: 'Mặt bằng cọc móng',           kind: 'dwg', source: 'structural', phase: 'B4', required: true,
    folder: '02-STRUCTURAL' },
  { code: 'S-02', name: 'Mặt bằng cột tầng',           kind: 'dwg', source: 'structural', phase: 'B4', required: true,
    folder: '02-STRUCTURAL' },
  { code: 'S-03', name: 'Mặt bằng dầm sàn',            kind: 'dwg', source: 'structural', phase: 'B4', required: true,
    folder: '02-STRUCTURAL' },
  { code: 'S-04', name: 'Báo cáo tính toán Etabs',     kind: 'pdf', source: 'structural', phase: 'B4', required: true,
    folder: '02-STRUCTURAL', description: 'Báo cáo phân tích kết cấu + tổ hợp tải trọng theo TCVN 2737:2023' },

  // ── MEP — phase B5 ──
  { code: 'E-01', name: 'Mặt bằng điện chính',         kind: 'dwg', source: 'mep_electric',  phase: 'B5', required: true,
    folder: '03-MEP/ELECTRIC' },
  { code: 'E-02', name: 'Sơ đồ nguyên lý điện',        kind: 'dwg', source: 'mep_electric',  phase: 'B5', required: true,
    folder: '03-MEP/ELECTRIC' },
  { code: 'P-01', name: 'Mặt bằng cấp thoát nước',     kind: 'dwg', source: 'mep_plumbing',  phase: 'B5', required: true,
    folder: '03-MEP/PLUMBING' },
  { code: 'H-01', name: 'Mặt bằng HVAC',               kind: 'dwg', source: 'mep_hvac',      phase: 'B5', required: true,
    folder: '03-MEP/HVAC' },
  { code: 'F-01', name: 'Mặt bằng PCCC',               kind: 'dwg', source: 'fire_safety',   phase: 'B5', required: true,
    folder: '03-MEP/FIRE-SAFETY', description: 'Bình chữa cháy + đầu báo + lối thoát hiểm' },

  // ── INTERIOR — phase B6 ──
  { code: 'I-01', name: 'Mặt bằng nội thất',           kind: 'dwg', source: 'interior_designer', phase: 'B6', required: true,
    folder: '04-INTERIOR' },
  { code: 'I-02', name: 'Mặt bằng trần',               kind: 'dwg', source: 'interior_designer', phase: 'B6', required: true,
    folder: '04-INTERIOR' },
  { code: 'I-03', name: 'Chi tiết tủ kệ',              kind: 'dwg', source: 'interior_designer', phase: 'B6', required: true,
    folder: '04-INTERIOR' },

  // ── 3D & VISUALIZATION ──
  { code: 'R-01', name: 'Render 3D 9 phong cách',      kind: 'png', source: 'render_3d', phase: 'B6', required: true, count: 72,
    folder: '05-3D-RENDER/9-styles', description: '9 styles × 8 angles = 72 PNG (4K)' },
  { code: 'R-02', name: '360° walkthrough',            kind: 'glb', source: 'render_3d', phase: 'B6',
    folder: '05-3D-RENDER/360-walkthrough' },

  // ── BOQ + COST ──
  { code: 'B-01', name: 'BOQ Phần thô',                kind: 'xlsx', source: 'boq_engine', phase: 'B7', required: true,
    folder: '06-BOQ' },
  { code: 'B-02', name: 'BOQ Hoàn thiện',              kind: 'xlsx', source: 'boq_engine', phase: 'B7', required: true,
    folder: '06-BOQ' },
  { code: 'B-03', name: 'BOQ Nội thất',                kind: 'xlsx', source: 'boq_engine', phase: 'B7', required: true,
    folder: '06-BOQ' },

  // ── BIM ──
  { code: 'M-01', name: 'IFC 4 BIM model',             kind: 'ifc',  source: 'bim_modeler', phase: 'B5', required: true,
    folder: '07-BIM', description: 'IFC4 (ISO 16739) — coordination model 4D' },

  // ── LEGAL — phase B7 ──
  { code: 'L-01', name: 'Hồ sơ xin phép xây dựng',     kind: 'pdf',  source: 'legal_permit', phase: 'B7', required: true,
    folder: '08-LEGAL', description: 'Hồ sơ Sở XD theo NĐ 15/2021/NĐ-CP — 8 mục bắt buộc' },
];

export const REQUIRED_CODES: string[] = DELIVERABLE_MANIFEST.filter(d => d.required).map(d => d.code);
export const TOTAL_DELIVERABLES = DELIVERABLE_MANIFEST.length;
export const SCHEMA_VERSION = '1.0.0';

// ----------------------------------------------------------------
// Reconciliation — đối chiếu manifest <-> records thực tế từ DB
// ----------------------------------------------------------------

export interface ReconciliationResult {
  total_specs: number;
  total_records: number;
  matched: { spec: DeliverableSpec; records: DeliverableRecord[] }[];
  missing_required: DeliverableSpec[];
  missing_optional: DeliverableSpec[];
  orphans: DeliverableRecord[];     // có file nhưng không khớp spec
  ready_for_pack: boolean;
}

/**
 * Reconcile danh sách deliverable thực tế với manifest spec.
 * - 1 spec có thể map nhiều records (vd R-01 = 72 PNG).
 * - records không khớp code nào → orphans (vẫn pack vào folder _MISC).
 * - thiếu required → block (caller quyết định fail hay degrade).
 */
export function reconcileManifest(
  records: DeliverableRecord[],
  scale?: { floors?: number },
): ReconciliationResult {
  const byCode = new Map<string, DeliverableRecord[]>();
  for (const r of records) {
    const code = r.spec.code;
    const arr = byCode.get(code) ?? [];
    arr.push(r);
    byCode.set(code, arr);
  }

  const matched: ReconciliationResult['matched'] = [];
  const missing_required: DeliverableSpec[] = [];
  const missing_optional: DeliverableSpec[] = [];

  for (const spec of DELIVERABLE_MANIFEST) {
    const recs = byCode.get(spec.code);
    if (recs && recs.length > 0) {
      matched.push({ spec, records: recs });
      byCode.delete(spec.code);
    } else if (spec.required) {
      // Floor-conditional: A-03 chỉ required nếu nhà ≥2 tầng, A-04 ≥3 tầng
      const floors = scale?.floors ?? 1;
      if (spec.code === 'A-03' && floors < 2) continue;
      if (spec.code === 'A-04' && floors < 3) continue;
      missing_required.push(spec);
    } else {
      missing_optional.push(spec);
    }
  }

  const orphans: DeliverableRecord[] = [];
  for (const arr of byCode.values()) orphans.push(...arr);

  return {
    total_specs: DELIVERABLE_MANIFEST.length,
    total_records: records.length,
    matched,
    missing_required,
    missing_optional,
    orphans,
    ready_for_pack: missing_required.length === 0,
  };
}

// ----------------------------------------------------------------
// INDEX.xlsx data builder — convert manifest+records sang rows
// ----------------------------------------------------------------

export interface IndexRow {
  stt: number;
  code: string;
  name: string;
  kind: string;
  phase: string;
  source: string;
  required: 'Có' | 'Không';
  status: 'OK' | 'THIẾU' | 'TÙY CHỌN';
  file_count: number;
  total_size_kb: number;
  rel_path: string;
  notes: string;
}

export function buildIndexRows(
  recon: ReconciliationResult,
  pathOf: (rec: DeliverableRecord) => string,
): IndexRow[] {
  const rows: IndexRow[] = [];
  let stt = 1;

  for (const m of recon.matched) {
    const totalSize = m.records.reduce((s, r) => s + r.size_bytes, 0);
    const firstPath = m.records.length === 1 ? pathOf(m.records[0]!) : `${m.spec.folder ?? ''}/`;
    rows.push({
      stt: stt++,
      code: m.spec.code,
      name: m.spec.name,
      kind: m.spec.kind.toUpperCase(),
      phase: m.spec.phase,
      source: m.spec.source,
      required: m.spec.required ? 'Có' : 'Không',
      status: 'OK',
      file_count: m.records.length,
      total_size_kb: Math.round(totalSize / 1024),
      rel_path: firstPath,
      notes: m.spec.description ?? '',
    });
  }

  for (const spec of recon.missing_required) {
    rows.push({
      stt: stt++, code: spec.code, name: spec.name, kind: spec.kind.toUpperCase(),
      phase: spec.phase, source: spec.source, required: 'Có', status: 'THIẾU',
      file_count: 0, total_size_kb: 0, rel_path: '-',
      notes: 'BẮT BUỘC nhưng chưa có — pipeline cần re-run',
    });
  }
  for (const spec of recon.missing_optional) {
    rows.push({
      stt: stt++, code: spec.code, name: spec.name, kind: spec.kind.toUpperCase(),
      phase: spec.phase, source: spec.source, required: 'Không', status: 'TÙY CHỌN',
      file_count: 0, total_size_kb: 0, rel_path: '-', notes: 'Không bắt buộc',
    });
  }

  return rows;
}

/** Render INDEX dạng CSV (UTF-8 BOM) — giả lập xlsx ở stage 1 */
export function indexRowsToCsv(rows: IndexRow[]): string {
  const headers = [
    'STT', 'Mã', 'Tên bản vẽ', 'Loại', 'Phase', 'Agent nguồn',
    'Bắt buộc', 'Trạng thái', 'Số file', 'Dung lượng (KB)',
    'Đường dẫn', 'Ghi chú',
  ];
  const escape = (v: string | number) => {
    const s = String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push([
      r.stt, r.code, r.name, r.kind, r.phase, r.source,
      r.required, r.status, r.file_count, r.total_size_kb,
      r.rel_path, r.notes,
    ].map(escape).join(','));
  }
  return '﻿' + lines.join('\r\n');
}

/** Tóm tắt project sang README.md (00-OVERVIEW) */
export function buildReadme(project: ProjectInfo, recon: ReconciliationResult): string {
  const lines: string[] = [];
  lines.push(`# ${project.name}`);
  lines.push('');
  lines.push(`**Mã dự án:** ${project.code}  `);
  lines.push(`**Revision:** v${project.revision_num} (${project.revision_id})  `);
  lines.push(`**Chủ đầu tư:** ${project.owner.full_name}  `);
  lines.push(`**Địa điểm:** ${project.lot.address}, ${project.lot.ward}, ${project.lot.district}, ${project.lot.city}  `);
  lines.push(`**Quy mô:** ${project.scale.floors} tầng — ${project.scale.gfa_m2} m² sàn / lô ${project.scale.lot_area_m2} m²  `);
  lines.push(`**Ngày đóng gói:** ${new Date().toISOString().slice(0, 10)}  `);
  lines.push('');
  lines.push('## Cấu trúc thư mục');
  lines.push('```');
  lines.push('00-OVERVIEW/   - README + tóm tắt + INDEX');
  lines.push('01-ARCHITECTURE/ - Kiến trúc (A-01 → A-11)');
  lines.push('02-STRUCTURAL/   - Kết cấu (S-01 → S-04)');
  lines.push('03-MEP/          - Điện / Nước / HVAC / PCCC');
  lines.push('04-INTERIOR/     - Nội thất (I-01 → I-03)');
  lines.push('05-3D-RENDER/    - 9 styles × 8 angles + 360° walkthrough');
  lines.push('06-BOQ/          - Bóc khối lượng + dự toán');
  lines.push('07-BIM/          - IFC4 BIM model');
  lines.push('08-LEGAL/        - Hồ sơ xin phép Sở XD');
  lines.push('09-AUDIT/        - Decisions log + QC report + checksum');
  lines.push('```');
  lines.push('');
  lines.push('## Trạng thái deliverables');
  lines.push(`- Đầy đủ: **${recon.matched.length}/${recon.total_specs}**`);
  lines.push(`- Thiếu (bắt buộc): **${recon.missing_required.length}**`);
  lines.push(`- Tùy chọn chưa có: **${recon.missing_optional.length}**`);
  lines.push(`- Tổng số file: **${recon.total_records}**`);
  lines.push('');
  lines.push('## Cách verify integrity');
  lines.push('1. Mở `09-AUDIT/manifest.json` để xem checksum SHA-256 mỗi file.');
  lines.push('2. Chạy `sha256sum -c manifest.txt` để verify toàn bộ package.');
  lines.push('3. So `manifest_signature` với chữ ký Viet-Contech (qrcode in package).');
  lines.push('');
  lines.push('## Liên hệ');
  lines.push(`- ${project.designer.company}`);
  lines.push(`- Hotline: ${project.designer.contact_phone}`);
  lines.push(`- Email: ${project.designer.contact_email}`);
  lines.push('');
  lines.push('---');
  lines.push('_Generated by Viet-Contech Output Packager v' + SCHEMA_VERSION + '_');
  return lines.join('\n');
}
