// ===============================================================
// File Naming — Pattern + Vietnamese diacritics sanitizer
// ===============================================================
// Convention:
//   {ProjectCode}_{Phase}_{Code}_{Description}_v{rev}_{date}.{ext}
//   VCT-2026-001_B3_A-02_Matbang-tang1_v3_20260503.dwg
// ===============================================================

import type { DeliverableSpec, ProjectInfo } from './types.js';

/** Bảng dấu Việt → ASCII (đã test với toàn bộ 6 dấu × 12 nguyên âm × hoa/thường) */
const VN_DIACRITICS: Record<string, string> = {
  à: 'a', á: 'a', ả: 'a', ã: 'a', ạ: 'a',
  ă: 'a', ằ: 'a', ắ: 'a', ẳ: 'a', ẵ: 'a', ặ: 'a',
  â: 'a', ầ: 'a', ấ: 'a', ẩ: 'a', ẫ: 'a', ậ: 'a',
  è: 'e', é: 'e', ẻ: 'e', ẽ: 'e', ẹ: 'e',
  ê: 'e', ề: 'e', ế: 'e', ể: 'e', ễ: 'e', ệ: 'e',
  ì: 'i', í: 'i', ỉ: 'i', ĩ: 'i', ị: 'i',
  ò: 'o', ó: 'o', ỏ: 'o', õ: 'o', ọ: 'o',
  ô: 'o', ồ: 'o', ố: 'o', ổ: 'o', ỗ: 'o', ộ: 'o',
  ơ: 'o', ờ: 'o', ớ: 'o', ở: 'o', ỡ: 'o', ợ: 'o',
  ù: 'u', ú: 'u', ủ: 'u', ũ: 'u', ụ: 'u',
  ư: 'u', ừ: 'u', ứ: 'u', ử: 'u', ữ: 'u', ự: 'u',
  ỳ: 'y', ý: 'y', ỷ: 'y', ỹ: 'y', ỵ: 'y',
  đ: 'd',
};

/** Sanitize diacritics + replace non-ASCII safe set */
export function sanitizeVi(input: string): string {
  if (!input) return '';
  // 1) NFD normalize → giữ ký tự không dấu, có thể khớp regex combining marks
  let out = input.normalize('NFD').replace(/\p{Mn}/gu, '');
  // 2) Map đặc biệt cho đ/Đ và một số ký tự không tách được
  out = out.replace(/[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/g,
    (c) => VN_DIACRITICS[c] ?? c);
  out = out.replace(/[ÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴĐ]/g,
    (c) => (VN_DIACRITICS[c.toLowerCase()] ?? c.toLowerCase()).toUpperCase());
  return out;
}

/** Slug-an-toàn cho filename: chỉ a-z, A-Z, 0-9, _, -, dấu chấm */
export function slugify(input: string, maxLen = 80): string {
  let s = sanitizeVi(input);
  s = s.replace(/[\s ]+/g, '-');           // space → -
  s = s.replace(/[^A-Za-z0-9._-]/g, '');         // remove invalid
  s = s.replace(/-{2,}/g, '-').replace(/^-|-$/g, '');
  if (s.length > maxLen) s = s.substring(0, maxLen).replace(/-$/, '');
  return s || 'file';
}

/** Format date như "20260503" */
function fmtDate(d?: Date): string {
  const date = d ?? new Date();
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${y}${m}${dd}`;
}

/** Build filename theo pattern Viet-Contech */
export function buildFileName(opts: {
  projectCode: string;
  phase: string;
  code: string;
  description: string;
  revision: number;
  ext: string;
  date?: Date;
}): string {
  const proj = slugify(opts.projectCode, 30);
  const phase = slugify(opts.phase, 6);
  const code = slugify(opts.code, 12);
  const desc = slugify(opts.description, 40);
  const ext = opts.ext.replace(/^\./, '').toLowerCase();
  const date = fmtDate(opts.date);
  return `${proj}_${phase}_${code}_${desc}_v${opts.revision}_${date}.${ext}`;
}

/** Build filename từ DeliverableSpec + ProjectInfo (helper chính cho ZIP builder) */
export function buildDeliverableFileName(
  spec: DeliverableSpec,
  project: ProjectInfo,
  ext?: string,
): string {
  return buildFileName({
    projectCode: project.code,
    phase: spec.phase,
    code: spec.code,
    description: spec.name,
    revision: project.revision_num,
    ext: ext ?? spec.kind,
  });
}

/** Build ZIP filename: VCT-2026-001-rev3-20260503.zip */
export function buildZipFileName(project: ProjectInfo, kind = 'full', date?: Date): string {
  const proj = slugify(project.code, 30);
  const k = slugify(kind, 12);
  return `${proj}-rev${project.revision_num}-${k}-${fmtDate(date)}.zip`;
}

/** Tên file con cho R-01 (render): style-{slug}-angle-{n}.png */
export function buildRenderFileName(styleName: string, angle: number): string {
  return `style-${slugify(styleName, 25)}-angle-${String(angle).padStart(2, '0')}.png`;
}
