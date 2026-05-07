/**
 * TypeScript types cho 18 tables cua Viet-Contech AI Design Platform.
 * Khop 1-1 voi 001_init.sql. Khong them field client-side suy ra.
 * Dung TEXT date (datetime('now') ISO-like) thay Date object cho de serialize.
 */

// ============================================================
// 1. projects
// ============================================================
export type ProjectStatus =
  | 'draft'
  | 'briefing'
  | 'running'
  | 'review'
  | 'locked'
  | 'delivered'
  | 'archived'
  | 'failed';

export interface Project {
  id: string;
  code: string;
  name: string;
  owner_user_id: string;
  status: ProjectStatus;
  locked_revision_id: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================
// 2. project_revisions
// ============================================================
export interface ProjectRevision {
  id: string;
  project_id: string;
  parent_revision_id: string | null;
  message: string;
  agent: string | null;
  created_at: string;
}

// ============================================================
// 3. requirements
// ============================================================
export type RequirementSource = 'brief' | 'kts' | 'auto';

export interface Requirement {
  id: string;
  project_id: string;
  source: RequirementSource;
  type: string;
  key: string;
  value: string;
  locked: 0 | 1;
  created_at: string;
}

// ============================================================
// 4. lot_specs
// ============================================================
export interface LotSpec {
  project_id: string;
  width_m: number;
  depth_m: number;
  area_m2: number;
  direction: string;
  address: string | null;
  gfa_target: number | null;
  density_max_pct: number | null;
  setback_min_m: number | null;
}

// ============================================================
// 5. client_profile
// ============================================================
export type Gender = 'male' | 'female' | 'other';

export interface ClientProfile {
  project_id: string;
  full_name: string;
  phone: string | null;
  year_born: number | null;
  gender: Gender | null;
  cung_menh: string | null;
  ngu_hanh: string | null;
  family_size: number | null;
  lifestyle_json: string | null;
}

// ============================================================
// 6. concepts
// ============================================================
export type StyleCode =
  | 'luxury'
  | 'indochine'
  | 'modern'
  | 'walnut'
  | 'neoclassic'
  | 'japandi'
  | 'wabisabi'
  | 'minimalism'
  | 'mediterranean';

export interface Concept {
  id: string;
  project_id: string;
  style_code: StyleCode;
  score_phongthuy: number | null;
  score_budget: number | null;
  score_aesthetic: number | null;
  selected: 0 | 1;
  image_url: string | null;
  created_at: string;
}

// ============================================================
// 7. agents_registry
// ============================================================
export type AgentStatus = 'active' | 'deprecated' | 'training' | 'disabled';

export interface AgentRegistry {
  id: string;
  code: string;
  name: string;
  scope: string;
  version: string;
  dna_prompt: string;
  input_schema_json: string;
  output_schema_json: string;
  tcvn_refs: string | null;
  formulas_json: string | null;
  status: AgentStatus;
  created_at: string;
}

// ============================================================
// 8. agent_runs
// ============================================================
export type AgentRunStatus = 'running' | 'success' | 'failed' | 'timeout';

export interface AgentRun {
  id: string;
  project_id: string;
  revision_id: string;
  agent_id: string;
  phase: number;
  started_at: string;
  finished_at: string | null;
  status: AgentRunStatus;
  input_hash: string;
  output_hash: string | null;
  duration_ms: number | null;
  tokens_used: number;
  cost_vnd: number;
  error_message: string | null;
}

// ============================================================
// 9. deliverables
// ============================================================
export type DeliverableKind =
  | 'dwg'
  | 'dxf'
  | 'pdf'
  | 'xlsx'
  | 'ifc'
  | 'png'
  | 'jpg'
  | 'glb'
  | 'json'
  | 'sql'
  | 'py'
  | 'md'
  | 'zip';

export interface Deliverable {
  id: string;
  project_id: string;
  revision_id: string;
  agent_run_id: string;
  kind: DeliverableKind;
  path: string;
  size_bytes: number;
  version: number;
  parent_deliverable_id: string | null;
  locked: 0 | 1;
  signature: string | null;
  created_at: string;
}

// ============================================================
// 10. conflicts
// ============================================================
export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type ConflictStatus = 'open' | 'resolving' | 'resolved' | 'escalated';

export interface Conflict {
  id: string;
  project_id: string;
  revision_id: string;
  severity: Severity;
  detected_by_agent: string;
  type: string;
  description: string;
  status: ConflictStatus;
  resolution: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
}

// ============================================================
// 11. qc_gates
// ============================================================
export type GateCode =
  | 'G01' | 'G02' | 'G03' | 'G04' | 'G05' | 'G06'
  | 'G07' | 'G08' | 'G09' | 'G10' | 'G11' | 'G12';

export type QcGateStatus = 'pending' | 'passed' | 'failed' | 'auto_fixed';

export type QcVote = 'pass' | 'fail' | 'abstain';

export interface QcVoter {
  agent: string;
  vote: QcVote;
  reason: string;
}

export interface QcGate {
  id: string;
  project_id: string;
  revision_id: string;
  gate_code: GateCode;
  gate_name: string;
  status: QcGateStatus;
  voters_json: string | null;
  auto_fix_applied: 0 | 1;
  blocker_message: string | null;
  ran_at: string | null;
  created_at: string;
}

// ============================================================
// 12. tcvn_rules
// ============================================================
export interface TcvnRule {
  id: string;
  code: string;
  version: string | null;
  category: string;
  statement: string;
  formula_json: string | null;
  source_pdf_path: string | null;
  applicable_phases: string | null;
  severity: Severity;
  created_at: string;
}

// ============================================================
// 13. decisions
// ============================================================
export interface Decision {
  id: string;
  project_id: string;
  revision_id: string;
  decision_type: string;
  made_by_agent: string | null;
  summary: string;
  reasoning_text: string | null;
  requirements_satisfied_json: string | null;
  alternatives_considered_json: string | null;
  locked: 0 | 1;
  made_at: string;
}

// ============================================================
// 14. audit_log
// ============================================================
export interface AuditLog {
  id: string;
  project_id: string | null;
  action: string;
  actor: string;
  target_type: string;
  target_id: string | null;
  before_json: string | null;
  after_json: string | null;
  ip: string | null;
  ua: string | null;
  immutable_hash: string;
  ts: string;
}

// ============================================================
// 15. materials
// ============================================================
export interface Material {
  id: string;
  code: string;
  name: string;
  category: string;
  unit: string;
  price_vnd: number;
  supplier: string | null;
  last_updated_quarter: string;
  created_at: string;
}

// ============================================================
// 16. boq_items
// ============================================================
export interface BoqItem {
  id: string;
  project_id: string;
  revision_id: string;
  code: string;
  description: string;
  quantity: number;
  unit: string;
  material_id: string | null;
  unit_price: number;
  total_vnd: number;
  source_dxf_handle: string | null;
  created_at: string;
}

// ============================================================
// 17. bim_elements
// ============================================================
export type BimElementType =
  | 'wall'
  | 'column'
  | 'beam'
  | 'slab'
  | 'door'
  | 'window'
  | 'stair'
  | 'roof'
  | 'foundation'
  | 'railing'
  | 'furniture'
  | 'space'
  | 'other';

export interface BimElement {
  id: string;
  project_id: string;
  revision_id: string;
  guid: string;
  type: BimElementType;
  geometry_json: string;
  material_id: string | null;
  parent_element_id: string | null;
  ifc_class: string | null;
  created_at: string;
}

// ============================================================
// 18. clash_detections
// ============================================================
export type ClashStatus = 'open' | 'resolving' | 'resolved' | 'ignored';

export interface ClashDetection {
  id: string;
  project_id: string;
  revision_id: string;
  element_a_guid: string;
  element_b_guid: string;
  intersection_volume_mm3: number;
  severity: Severity;
  status: ClashStatus;
  ran_at: string;
}

// ============================================================
// Tien ich: 12 QC gate names (canonical)
// ============================================================
export const GATE_NAMES: Record<GateCode, string> = {
  G01: 'Brief day du 13 truong',
  G02: 'Mat bang trong Buildable Envelope',
  G03: 'PT Score >= 70/100',
  G04: 'Luu thong TCVN 4513',
  G05: 'Ket cau TCVN 5574:2018',
  G06: 'MEP du cong suat',
  G07: 'Noi that khong vi pham clearance',
  G08: 'Scale calibrate tu anh',
  G09: 'Bo ban ve du 28/28',
  G10: 'BOQ 100% tu DXF geometry',
  G11: 'Ky su ket cau ky duyet',
  G12: 'KTS/CEO review & sign-off',
};

// ============================================================
// Tien ich: 7 phase canonical
// ============================================================
export const PHASES = {
  1: 'Brief',
  2: 'Concept',
  3: 'Layout',
  4: 'Structural',
  5: 'MEP+BIM',
  6: 'Interior+3D',
  7: 'QC+Export',
} as const;

export type PhaseNumber = keyof typeof PHASES;
