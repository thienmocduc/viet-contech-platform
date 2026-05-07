// ===============================================================
// Naming Convention — File naming chuẩn ngành Viet-Contech
// ===============================================================
// Format chuẩn (đồng thuận với các công ty thiết kế VN lớn —
// CONINCO / VINACONEX / Coteccons / Apave / Vinaconex E&C):
//
//   [ProjectCode]_[Phase]_[Discipline]_[Number]_[Description]_[Rev].[ext]
//
// Ví dụ:
//   VCT-2026-001_DD_KT_01_MatBangTang1_R02.dwg
//   VCT-2026-001_CD_KC_03_MatBangDamSan_R01.pdf
//   VCT-2026-001_DD_RD_S01-A04_PhongCach1Goc4_R02.png
//
// Bộ mã chuẩn:
//   - Phase:      SD (Schematic), DD (Design Dev), CD (Construction Doc),
//                 AB (As-Built), TD (Tender Doc)
//   - Discipline: KT (Kiến trúc), KC (Kết cấu), DT (Điện),
//                 CN (Cấp thoát nước), HVAC, NT (Nội thất),
//                 PCCC (PCCC), RD (Render 3D), HS (Hồ sơ pháp lý),
//                 BIM (BIM/IFC), BOQ (Bóc khối lượng)
// ===============================================================

import { sanitizeVi, slugify } from './file-naming.js';
import type { DeliverableSpec, AgentSource } from './types.js';

// ----------------------------------------------------------------
// Discipline codes — chuẩn ngành VN
// ----------------------------------------------------------------

export const DISCIPLINE_CODES = {
  KT: 'Kiến trúc',
  KC: 'Kết cấu',
  DT: 'Điện',           // Điện chiếu sáng + động lực
  CN: 'Cấp thoát nước', // Cấp/thoát nước
  HVAC: 'Điều hòa thông gió',
  NT: 'Nội thất',
  PCCC: 'Phòng cháy chữa cháy',
  RD: 'Render 3D',
  HS: 'Hồ sơ pháp lý',
  BIM: 'BIM model',
  BOQ: 'Bóc khối lượng',
  GEN: 'Tổng hợp',
} as const;

export type DisciplineCode = keyof typeof DISCIPLINE_CODES;

// ----------------------------------------------------------------
// Phase codes — TCVN/quy chuẩn thiết kế xây dựng
// ----------------------------------------------------------------

export const PHASE_CODES = {
  SD: 'Schematic Design — Thiết kế ý tưởng',
  DD: 'Design Development — Thiết kế kỹ thuật',
  CD: 'Construction Documents — Thiết kế thi công',
  TD: 'Tender Documents — Hồ sơ mời thầu',
  AB: 'As-Built — Hoàn công',
} as const;

export type PhaseCode = keyof typeof PHASE_CODES;

// ----------------------------------------------------------------
// Map AgentSource → DisciplineCode
// ----------------------------------------------------------------

const AGENT_TO_DISCIPLINE: Record<AgentSource, DisciplineCode> = {
  architect: 'KT',
  structural: 'KC',
  mep_electric: 'DT',
  mep_plumbing: 'CN',
  mep_hvac: 'HVAC',
  fire_safety: 'PCCC',
  interior_designer: 'NT',
  render_3d: 'RD',
  boq_engine: 'BOQ',
  bim_modeler: 'BIM',
  legal_permit: 'HS',
  qc_engine: 'GEN',
};

/** Map B1..B8 internal phases → industry-standard phase codes */
const INTERNAL_PHASE_TO_CODE: Record<string, PhaseCode> = {
  B1: 'SD', B2: 'SD',
  B3: 'DD', B4: 'DD', B5: 'DD',
  B6: 'CD', B7: 'CD',
  B8: 'AB',
};

export function disciplineOfAgent(source: AgentSource): DisciplineCode {
  return AGENT_TO_DISCIPLINE[source] ?? 'GEN';
}

export function phaseCodeOf(internalPhase: string): PhaseCode {
  return INTERNAL_PHASE_TO_CODE[internalPhase] ?? 'DD';
}

// ----------------------------------------------------------------
// Build filename theo industry standard
// ----------------------------------------------------------------

export interface IndustryNamingOpts {
  projectCode: string;       // VCT-2026-001
  phase: PhaseCode;          // DD
  discipline: DisciplineCode; // KT
  number: string;            // 01, 02, S01-A04
  description: string;       // "Mặt bằng tầng 1"
  revision: number;          // 2 → R02
  ext: string;               // dwg, pdf, png, xlsx, ifc
}

/**
 * Build filename chuẩn:
 * VCT-2026-001_DD_KT_01_MatBangTang1_R02.dwg
 *
 * Quy tắc:
 *   - ProjectCode: giữ nguyên có dấu gạch (slugified nhẹ, ASCII-safe)
 *   - Phase/Discipline: code 2-4 ký tự
 *   - Number: số thứ tự 01..99 hoặc compound S01-A04 (style 1 angle 4)
 *   - Description: Vietnamese-sanitized, CamelCase (no dấu, no space)
 *   - Revision: R + 2 digits (R01, R02)
 *   - Ext: lowercase
 */
export function buildIndustryName(opts: IndustryNamingOpts): string {
  const proj = slugify(opts.projectCode, 30);
  const phase = opts.phase;
  const discipline = opts.discipline;
  const number = slugify(opts.number, 12);
  const desc = camelize(opts.description, 40);
  const rev = `R${String(opts.revision).padStart(2, '0')}`;
  const ext = opts.ext.replace(/^\./, '').toLowerCase();
  return `${proj}_${phase}_${discipline}_${number}_${desc}_${rev}.${ext}`;
}

/** Build từ DeliverableSpec — auto-resolve discipline + phase */
export function buildIndustryNameFromSpec(opts: {
  projectCode: string;
  spec: DeliverableSpec;
  revision: number;
  ext?: string;
  /** Override number nếu spec dùng compound numbering (vd render: S01-A04) */
  overrideNumber?: string;
  overrideDescription?: string;
}): string {
  // spec.code = 'A-02' → number = '02'
  // spec.code = 'F-01' → number = '01'
  const numFromCode = opts.spec.code.split('-').slice(1).join('-') || opts.spec.code;
  return buildIndustryName({
    projectCode: opts.projectCode,
    phase: phaseCodeOf(opts.spec.phase),
    discipline: disciplineOfAgent(opts.spec.source),
    number: opts.overrideNumber ?? numFromCode,
    description: opts.overrideDescription ?? opts.spec.name,
    revision: opts.revision,
    ext: opts.ext ?? opts.spec.kind,
  });
}

// ----------------------------------------------------------------
// CamelCase converter cho description (không dấu, không space)
// ----------------------------------------------------------------

/**
 * "Mặt bằng tầng 1" → "MatBangTang1"
 * "Sơ đồ nguyên lý điện" → "SoDoNguyenLyDien"
 * Giữ chữ số, bỏ ký tự đặc biệt.
 */
export function camelize(input: string, maxLen = 40): string {
  if (!input) return 'File';
  const ascii = sanitizeVi(input);
  // tách theo whitespace + dash + underscore + dot
  const tokens = ascii.split(/[\s\-_.,;:()/]+/).filter(Boolean);
  let camel = tokens
    .map(t => {
      // cap đầu, giữ lower phần còn lại — KHÔNG hủy số
      if (!t) return '';
      const head = t.charAt(0).toUpperCase();
      const tail = t.slice(1).toLowerCase();
      return head + tail;
    })
    .join('');
  // cleanup ký tự không-alphanumeric
  camel = camel.replace(/[^A-Za-z0-9]/g, '');
  if (camel.length > maxLen) camel = camel.substring(0, maxLen);
  return camel || 'File';
}

// ----------------------------------------------------------------
// Folder mapping cho industry-standard ZIP layout
// ----------------------------------------------------------------

/**
 * Map discipline → folder path trong ZIP.
 * Theo cấu trúc Sở Xây dựng + chuẩn nội bộ Viet-Contech.
 */
export const FOLDER_BY_DISCIPLINE: Record<DisciplineCode, string> = {
  KT: '01_KienTruc',
  KC: '02_KetCau',
  DT: '03_DienNuoc/Dien',
  CN: '03_DienNuoc/CapThoatNuoc',
  HVAC: '04_HVAC_PCCC/HVAC',
  PCCC: '04_HVAC_PCCC/PCCC',
  NT: '05_NoiThat',
  RD: '06_Render',
  BOQ: '07_BOQ',
  BIM: '08_BIM',
  HS: '09_HoSoPhapLy',
  GEN: '10_BaoCao',
};

// ----------------------------------------------------------------
// Filename validators
// ----------------------------------------------------------------

const INDUSTRY_FILENAME_RE =
  /^[A-Z]{2,4}-\d{4}-\d{3}_(SD|DD|CD|TD|AB)_(KT|KC|DT|CN|HVAC|NT|PCCC|RD|HS|BIM|BOQ|GEN)_[A-Za-z0-9-]+_[A-Za-z0-9]+_R\d{2}\.[a-z0-9]+$/;

export function isValidIndustryName(filename: string): boolean {
  return INDUSTRY_FILENAME_RE.test(filename);
}

export interface ParsedIndustryName {
  projectCode: string;
  phase: PhaseCode;
  discipline: DisciplineCode;
  number: string;
  description: string;
  revision: number;
  ext: string;
}

/** Reverse parser — tách filename về components */
export function parseIndustryName(filename: string): ParsedIndustryName | null {
  if (!isValidIndustryName(filename)) return null;
  const dot = filename.lastIndexOf('.');
  const ext = filename.slice(dot + 1);
  const stem = filename.slice(0, dot);
  const parts = stem.split('_');
  if (parts.length < 6) return null;
  // VCT-2026-001 _ DD _ KT _ 01 _ MatBangTang1 _ R02
  const [proj, phase, discipline, number, description, revStr] = parts;
  const rev = parseInt(revStr!.replace(/^R/, ''), 10);
  if (isNaN(rev)) return null;
  return {
    projectCode: proj!,
    phase: phase as PhaseCode,
    discipline: discipline as DisciplineCode,
    number: number!,
    description: description!,
    revision: rev,
    ext: ext.toLowerCase(),
  };
}
