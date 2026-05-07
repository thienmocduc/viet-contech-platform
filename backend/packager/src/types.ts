// ===============================================================
// Viet-Contech Output Packager — Type definitions
// ===============================================================
// Mọi type dùng cho manifest builder, ZIP builder, permit builder
// và export API. TypeScript strict mode bắt buộc.
// ===============================================================

import { z } from 'zod';

export type DeliverableKind =
  | 'dwg' | 'dxf' | 'pdf' | 'xlsx' | 'ifc'
  | 'png' | 'jpg' | 'glb' | 'usdz' | 'json'
  | 'md' | 'csv';

export type AgentSource =
  | 'architect' | 'structural'
  | 'mep_electric' | 'mep_plumbing' | 'mep_hvac' | 'fire_safety'
  | 'interior_designer' | 'render_3d'
  | 'boq_engine' | 'bim_modeler'
  | 'legal_permit' | 'qc_engine';

export type Phase = 'B1' | 'B2' | 'B3' | 'B4' | 'B5' | 'B6' | 'B7' | 'B8';

export type PackageKind = 'full' | 'partial' | 'permit' | 'client' | 'tech';

export interface DeliverableSpec {
  /** A-01, S-04, R-02... */
  code: string;
  /** Tiếng Việt có dấu */
  name: string;
  kind: DeliverableKind;
  source: AgentSource;
  phase: Phase;
  /** Bắt buộc phải có để pass packager */
  required?: boolean;
  /** Số lượng file (vd render 9 styles × 8 angles = 72) */
  count?: number;
  /** Folder đích trong ZIP — tự suy luận nếu không khai báo */
  folder?: string;
  /** Mô tả ngắn (xuất ra README + INDEX.xlsx) */
  description?: string;
}

export interface ProjectInfo {
  id: string;
  code: string;            // VCT-2026-001
  name: string;            // "Nhà phố ô. Nguyễn Văn A — Q.7"
  owner: OwnerInfo;
  lot: LotInfo;
  scale: { gfa_m2: number; floors: number; lot_area_m2: number };
  designer: DesignerInfo;
  created_at: string;
  /** ID revision hiện tại — dùng cho zip filename + manifest */
  revision_id: string;
  /** Số revision tăng dần (1, 2, 3...) */
  revision_num: number;
}

export interface OwnerInfo {
  full_name: string;
  id_card: string;         // CCCD/CMND — không log full ra audit
  id_issued_date?: string;
  id_issued_place?: string;
  permanent_address: string;
  phone?: string;
  email?: string;
}

export interface LotInfo {
  address: string;
  ward: string;
  district: string;
  city: string;
  cert_no: string;         // số GCN QSDĐ
  cert_date?: string;
  area_m2: number;
  setback?: { front: number; back: number; left: number; right: number };
  /** Giới hạn theo QCXDVN 01:2021 */
  limits?: { density_max: number; height_max_m: number; gfa_coef_max: number };
}

export interface DesignerInfo {
  company: string;        // "Viet-Contech Co., Ltd"
  cert_no: string;        // chứng chỉ hành nghề
  director_name: string;
  contact_phone: string;
  contact_email: string;
}

export interface DeliverableRecord {
  /** ID nội bộ DB */
  id: string;
  spec: DeliverableSpec;
  /** Đường dẫn file thực trên đĩa */
  abs_path: string;
  size_bytes: number;
  sha256: string;
  version: number;
  created_at: string;
  /** Có lock không (đã ký) */
  locked: boolean;
}

export interface PackageMetadata {
  package_id: string;       // PKG-{projectCode}-{rev}-{ts}
  project: ProjectInfo;
  kind: PackageKind;
  built_at: string;
  built_by: string;         // user_id hoặc "system"
  total_files: number;
  total_size_bytes: number;
  qc_pass_rate: number;     // 0..1
  qc_gates_passed: number;  // 12/12
  qc_gates_total: number;
  required_missing: string[]; // [] nếu đủ
  schema_version: string;
}

export interface BuildJob {
  id: string;
  project_id: string;
  revision_id: string;
  kind: PackageKind;
  status: 'pending' | 'running' | 'success' | 'failed';
  progress: number;         // 0..100
  current_step?: string;
  output_zip_path?: string;
  manifest_url?: string;
  error?: string;
  eta_sec?: number;
  started_at: string;
  finished_at?: string;
}

export interface ChecksumManifestEntry {
  rel_path: string;
  size_bytes: number;
  sha256: string;
  kind: DeliverableKind;
  code?: string;
}

export interface ChecksumManifest {
  package_id: string;
  schema_version: string;
  generated_at: string;
  total_files: number;
  total_size_bytes: number;
  entries: ChecksumManifestEntry[];
  /** SHA-256 của entries JSON (immutability seal) */
  manifest_signature: string;
}

export interface PermitDocument {
  /** 1..8 theo NĐ 15/2021 */
  order: number;
  code: string;             // L-01-1, L-01-2...
  title: string;
  required: boolean;
  source_path?: string;     // file đã có
  is_placeholder: boolean;  // true = chưa có file thật
  notes?: string;
}

export interface ShareLink {
  id: string;
  package_id: string;
  recipients_emails: string[];
  expires_at: string;
  token: string;            // signed JWT
  created_at: string;
  download_count: number;
}

// ===============================================================
// PackOpts zod schemas — public API contract của OutputPackager
// ===============================================================

/** Loại bộ hồ sơ xuất ra */
export const PackageTypeEnum = z.enum([
  'client_full',         // Bộ đầy đủ gửi khách
  'permit_submission',   // Hồ sơ nộp Sở XD
  'tech_only',           // Chỉ kỹ thuật (KT/KC/MEP/BIM)
  'commercial_only',     // BOQ + render + cover (gửi khách review)
]);
export type PackageType = z.infer<typeof PackageTypeEnum>;

/** Format archive output */
export const OutputFormatEnum = z.enum(['zip', 'tar.gz', '7z']);
export type OutputFormat = z.infer<typeof OutputFormatEnum>;

/** 1 bản vẽ trong deliverables list */
export const DrawingItemSchema = z.object({
  type: z.string().min(1),                      // KT/KC/DT/CN/HVAC/NT/PCCC/RD
  layer: z.string().optional(),                 // ví dụ "Tầng 1", "Mặt cắt A-A"
  format: z.enum(['dwg', 'dxf', 'pdf']),
  path: z.string().min(1),
  /** Mã + tên hiển thị trên cover/index */
  code: z.string().optional(),
  name: z.string().optional(),
  number: z.string().optional(),                // "01", "02"
  phase: z.string().optional(),                 // SD/DD/CD
});
export type DrawingItem = z.infer<typeof DrawingItemSchema>;

/** 1 báo cáo (PDF Etabs / kết cấu / khảo sát địa chất) */
export const ReportItemSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  /** Folder đích tuỳ chọn (mặc định 10_BaoCao) */
  folder: z.string().optional(),
});
export type ReportItem = z.infer<typeof ReportItemSchema>;

/** Branding — logo + màu công ty trên cover */
export const BrandingSchema = z.object({
  company: z.string().default('VIET CONTECH'),
  logo_path: z.string().optional(),
  /** Hex màu chính — mặc định rose gold #C4933A */
  color: z.string().regex(/^#([0-9A-Fa-f]{6})$/).default('#C4933A'),
  tagline: z.string().optional(),
  website: z.string().optional(),
}).default({});
export type Branding = z.infer<typeof BrandingSchema>;

/** Project info nhẹ cho PackOpts (tuỳ chọn — packager có thể fetch từ DB) */
export const PackProjectInfoSchema = z.object({
  code: z.string().min(1),                      // VCT-2026-001
  name: z.string().min(1),
  owner_name: z.string(),
  address: z.string(),
  phase: z.enum(['SD', 'DD', 'CD', 'TD', 'AB']).default('DD'),
  designed_by: z.string().default('Viet-Contech Co., Ltd'),
  /** KTS chủ trì + chứng chỉ */
  signed_by_kts: z.string().optional(),
  cert_no: z.string().optional(),
});
export type PackProjectInfo = z.infer<typeof PackProjectInfoSchema>;

/** Main contract — input cho OutputPackager.pack() */
export const PackOptsSchema = z.object({
  projectId: z.string().uuid().or(z.string().min(4)),
  revisionId: z.string().min(4),
  packageType: PackageTypeEnum,
  deliverables: z.object({
    drawings: z.array(DrawingItemSchema).default([]),
    boq: z.string().optional(),                 // path .xlsx
    ifc: z.string().optional(),                 // path .ifc
    renders: z.array(z.string()).optional(),    // path PNG list
    reports: z.array(ReportItemSchema).optional(),
    /** Hồ sơ xin phép (PDFs) */
    permit_files: z.array(z.string()).optional(),
  }),
  project: PackProjectInfoSchema.optional(),
  branding: BrandingSchema.optional(),
  output_format: OutputFormatEnum.default('zip'),
  /** Thư mục output — mặc định data/output */
  outDir: z.string().optional(),
  /** Online review URL → embed vào QR code trên cover */
  online_review_url: z.string().url().optional(),
});
export type PackOpts = z.infer<typeof PackOptsSchema>;

/** Result trả về từ pack() */
export interface PackResult {
  ok: boolean;
  jobId: string;
  packageId: string;
  archive_path: string;
  archive_size_bytes: number;
  archive_format: OutputFormat;
  total_files: number;
  total_size_bytes: number;
  /** SHA-256 của archive file (tamper detect) */
  archive_sha256: string;
  /** SHA-256 của manifest entries (immutability seal) */
  manifest_signature: string;
  /** Số lượng từng nhóm */
  counts: {
    drawings: number;
    renders: number;
    reports: number;
    boq: number;
    ifc: number;
    permit_files: number;
  };
  warnings: string[];
  /** Thời gian build tính bằng ms */
  duration_ms: number;
  generated_at: string;
}

/** Job tracking cho async pack flow */
export interface PackerJob {
  id: string;
  projectId: string;
  revisionId: string;
  packageType: PackageType;
  status: 'pending' | 'running' | 'success' | 'failed';
  progress: number;
  current_step?: string;
  result?: PackResult;
  error?: string;
  started_at: string;
  finished_at?: string;
}
