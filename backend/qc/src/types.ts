/**
 * Types cho 12 QC Gates Checkpoint System.
 * Mirror lai field cua qc_gates table trong db/migrations/001_init.sql,
 * mo rong them context runtime cho rule engine va TMR voter.
 */

// ============================================================
// Severity & status (canonical, dung tat ca module)
// ============================================================
export type Severity = 'low' | 'medium' | 'high' | 'critical';

export type GateStatus = 'pending' | 'pass' | 'fail' | 'warn' | 'auto_fixed';

export type VoteValue = 'pass' | 'fail' | 'abstain';

export type GateCode =
  | 'G01' | 'G02' | 'G03' | 'G04' | 'G05' | 'G06'
  | 'G07' | 'G08' | 'G09' | 'G10' | 'G11' | 'G12';

export type Phase =
  | 'B1' | 'B2' | 'B3' | 'B4' | 'B5' | 'B6' | 'B7' | 'B12';

// ============================================================
// 1 check item nho trong 1 gate (5+ check items / gate)
// ============================================================
export interface CheckItem {
  name: string;
  passed: boolean;
  actual: number | string | boolean | null;
  expected: number | string | boolean | null;
  severity: Severity;
  /** Goi y sua nhanh khi fail */
  suggestion?: string;
  /** TCVN reference neu lien quan */
  tcvn_ref?: string;
}

// ============================================================
// Gate result chuan (1 gate run xong tra ve cau truc nay)
// ============================================================
export interface GateResult {
  gate_code: GateCode;
  gate_name: string;
  phase: Phase;
  status: GateStatus;
  /** 0..100 */
  score: number;
  checks: CheckItem[];
  /** Severity cao nhat trong cac check fail; undefined neu pass */
  worst_severity?: Severity;
  /** Tom tat 1 dong */
  summary: string;
  /** Chi co khi auto-fix da chay */
  auto_fix_applied?: boolean;
  auto_fixes?: AutoFixApplied[];
  /** TMR vote cuoi cung (sau khi 3 voter chay xong) */
  vote?: VoteResult;
  ran_at: string;
  duration_ms: number;
}

// ============================================================
// TMR voter
// ============================================================
export interface SingleVote {
  voter_id: string;
  voter_label: string;
  status: 'pass' | 'fail' | 'abstain';
  reason: string;
  score: number;
  duration_ms: number;
}

export interface VoteResult {
  gate_code: GateCode;
  votes: SingleVote[];
  /** Da co 2/3 dong y -> majority */
  majority: 'pass' | 'fail' | 'tie';
  confidence: 'low' | 'medium' | 'high';
  /** Ly do cua nhung voter fail */
  dissent_reasons: string[];
  duration_ms: number;
}

export type VoterFn = (
  gate_code: GateCode,
  context: GateContext
) => Promise<SingleVote>;

export interface VoterConfig {
  id: string;
  label: string;
  fn: VoterFn;
}

// ============================================================
// Auto-fix
// ============================================================
export interface AutoFixPattern {
  /** Ten pattern (vd: "shrink-setback-200mm") */
  id: string;
  /** Mo ta ngan */
  description: string;
  /** Gate ap dung */
  applies_to: GateCode[];
  /** Predicate xem result nay co fix duoc khong */
  match: (result: GateResult, ctx: GateContext) => boolean;
  /** Ham fix — modify context.design in-place + return mo ta */
  apply: (
    result: GateResult,
    ctx: GateContext
  ) => Promise<AutoFixApplied>;
  /** Khong fix neu cham vao locked spec — return true = bi block */
  guard: (ctx: GateContext) => boolean;
}

export interface AutoFixApplied {
  pattern_id: string;
  description: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  applied_at: string;
}

// ============================================================
// Escalation
// ============================================================
export type EscalationChannel = 'log' | 'notification' | 'email' | 'sms' | 'slack';

export interface EscalationAction {
  level: 'info' | 'warning' | 'block' | 'critical';
  channels: EscalationChannel[];
  /** STOP pipeline ngay */
  stop_pipeline: boolean;
  /** Lock revision, khong cho run agent moi */
  lock_revision: boolean;
  /** Yeu cau KTS approve moi continue */
  require_kts_approval: boolean;
  /** Notification message */
  message: string;
  /** Chi tiet */
  detail: GateResult;
}

// ============================================================
// QC Gate definition (mot row trong QC_GATES registry)
// ============================================================
export interface QCGate {
  code: GateCode;
  name: string;
  phase: Phase;
  /** 3 voter id (TMR) */
  voters: [string, string, string];
  /** Mo ta muc dich */
  description: string;
  /** Min score de pass (mac dinh 70) */
  pass_threshold: number;
  /** Co the auto-fix khong */
  auto_fixable: boolean;
  /** Severity neu fail */
  severity_on_fail: Severity;
  /** TCVN/QCVN refs */
  tcvn_refs: string[];
  /** Function chay check chinh — thuan TS, dung rule engine */
  run: (ctx: GateContext) => Promise<GateResult>;
}

// ============================================================
// Context truyen vao moi gate
// ============================================================
export interface GateContext {
  project_id: string;
  revision_id: string;
  /** Toan bo design data — KT/KC/MEP/BOQ/... */
  design: DesignSnapshot;
  /** Locked spec — auto-fix khong duoc cham */
  locked_specs: string[];
  /** Audit log callback (write-only) */
  audit?: (entry: AuditEntry) => void;
}

export interface AuditEntry {
  action: string;
  actor: string;
  target_type: string;
  target_id?: string;
  before?: unknown;
  after?: unknown;
}

// ============================================================
// Design snapshot — du lieu thiet ke tom tat de QC check
// (de mock test — production se query tu DB)
// ============================================================
export interface DesignSnapshot {
  brief?: BriefData;
  layout?: LayoutData;
  structural?: StructuralData;
  mep?: MEPData;
  boq?: BOQData;
  bim?: BIMData;
  daylight?: DaylightData;
  acoustic?: AcousticData;
  fire?: FireData;
  energy?: EnergyData;
  legal?: LegalData;
  deliverables?: DeliverableData;
  phongthuy?: PhongThuyData;
}

export interface BriefData {
  required_fields: string[];
  filled_fields: string[];
  client_year_born: number | null;
  cung_menh: string | null;
  budget_vnd: number | null;
  family_size: number | null;
  lifestyle: string | null;
}

export interface PhongThuyData {
  score: number;
  main_door_direction: string;
  bep_huong: string;
  good_directions: string[];
  bad_directions: string[];
}

export interface LayoutData {
  density_pct: number;
  setback_front_m: number;
  setback_back_m: number;
  setback_side_m: number;
  building_height_m: number;
  num_floors: number;
  corridor_width_min_m: number;
  zoning_compliance: boolean;
  rooms: LayoutRoom[];
}

export interface LayoutRoom {
  name: string;
  area_m2: number;
  min_required_m2: number;
}

export interface StructuralData {
  concrete_grade: string;
  rebar_grade: string;
  /** Kiem cot nho nhat (mm x mm) */
  smallest_column_mm: { w: number; h: number };
  /** Min dam */
  smallest_beam_mm: { w: number; h: number };
  slab_thickness_mm: number;
  /** As/As_min ratio */
  rebar_ratio_min: number;
  /** Max delta (chuyen vi) ratio */
  deflection_ratio_max: number;
  earthquake_zone: string;
}

export interface MEPData {
  /** Tai trong dien VA/m2 (target ~70-100) */
  electrical_load_va_per_m2: number;
  /** Drain pipe slope % (>=1%) */
  drain_slope_pct: number;
  /** HVAC capacity Btu/m2 */
  hvac_btu_per_m2: number;
  /** Soft clash count (gap <50mm) */
  soft_clashes: number;
  /** Hard clash count (intersect) */
  hard_clashes: number;
  /** Ductlines vs cable trays va cham (mm) gap */
  duct_cable_min_gap_mm: number;
  /** Khoang cach truc dung (du khong) */
  vertical_shaft_count: number;
}

export interface BOQData {
  total_vnd: number;
  budget_vnd: number;
  /** Pct chenh lech budget vs total */
  variance_pct: number;
  /** % item co source DXF handle */
  pct_from_dxf: number;
  items_count: number;
  unit_price_age_days_max: number;
  /** Items co the down-spec */
  downgradable_items: BOQDowngradable[];
}

export interface BOQDowngradable {
  item_code: string;
  current_unit_price: number;
  alt_unit_price: number;
  saving_vnd: number;
  description: string;
}

export interface BIMData {
  total_elements: number;
  hard_clashes: number;
  soft_clashes: number;
  ifc_export_ok: boolean;
}

export interface DaylightData {
  /** Avg daylight factor */
  avg_df_pct: number;
  /** Min DF in habitable rooms */
  min_df_pct: number;
}

export interface AcousticData {
  /** Db wall transmission */
  wall_stc_db: number;
  /** Floor impact IIC */
  floor_iic_db: number;
}

export interface FireData {
  num_fire_exits: number;
  exit_distance_max_m: number;
  /** Block fireproof rating */
  fireproof_door_rating_min_min: number;
  /** Co lap dat dau bao chay khong */
  smoke_detector_count: number;
  smoke_detector_required: number;
  /** Co he thong sprinkler khong (cho nha >=8 tang) */
  sprinkler_required: boolean;
  sprinkler_installed: boolean;
}

export interface EnergyData {
  /** EPI kWh/m2/year — target <=120 cho QCVN 09:2017 nha o */
  epi_kwh_per_m2_year: number;
  /** U-value walls */
  u_value_wall: number;
  /** U-value roof */
  u_value_roof: number;
  /** Window-to-wall ratio */
  wwr_pct: number;
}

export interface LegalData {
  has_land_use_cert: boolean;
  has_building_permit_form: boolean;
  zoning_match: boolean;
  density_compliant: boolean;
  height_compliant: boolean;
  /** Du tai lieu xin phep khong */
  permit_docs_complete: boolean;
}

export interface DeliverableData {
  required_count: number;
  delivered_count: number;
  /** List file paths */
  delivered_paths: string[];
  /** List file con thieu */
  missing_kinds: string[];
  /** % file co signature */
  pct_signed: number;
}

// ============================================================
// QC Report (overall — sau khi run all 12 gates)
// ============================================================
export interface QCReport {
  project_id: string;
  revision_id: string;
  overall: 'PASS' | 'PARTIAL' | 'FAIL';
  total_gates: number;
  passed: number;
  failed: number;
  auto_fixed: number;
  warnings: number;
  total_score: number;
  results: GateResult[];
  escalations: EscalationAction[];
  /** Time tong */
  ran_at: string;
  duration_ms: number;
}
