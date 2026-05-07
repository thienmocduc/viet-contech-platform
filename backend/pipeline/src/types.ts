/**
 * Viet-Contech Pipeline Orchestrator — Type Definitions
 *
 * 7 phase, 19 agent, NASA-style FDIR + TMR + closed-loop iteration.
 * Mọi struct dùng chung cho orchestrator, agent runner, conflict resolver, QC.
 */

// ─────────────────────────────────────────────────────────────────
// PHASES
// ─────────────────────────────────────────────────────────────────

export type PhaseCode =
  | "B1-Brief"
  | "B2-Concept"
  | "B3-Layout"
  | "B4-Structural"
  | "B5-MEP+BIM"
  | "B6-Interior+3D"
  | "B7-QC+Export";

export const PHASE_ORDER: PhaseCode[] = [
  "B1-Brief",
  "B2-Concept",
  "B3-Layout",
  "B4-Structural",
  "B5-MEP+BIM",
  "B6-Interior+3D",
  "B7-QC+Export",
];

// Default deadline per phase (ms) — total ≈ 3h cho real run
export const PHASE_DEADLINE_MS: Record<PhaseCode, number> = {
  "B1-Brief": 10 * 60 * 1000,
  "B2-Concept": 20 * 60 * 1000,
  "B3-Layout": 30 * 60 * 1000,
  "B4-Structural": 45 * 60 * 1000,
  "B5-MEP+BIM": 60 * 60 * 1000,
  "B6-Interior+3D": 45 * 60 * 1000,
  "B7-QC+Export": 20 * 60 * 1000,
};

// ─────────────────────────────────────────────────────────────────
// AGENT
// ─────────────────────────────────────────────────────────────────

export type AgentCode =
  // B1
  | "brief_analyst"
  | "phongthuy_master"
  // B2
  | "creative_ai"
  | "interior_designer"
  // B3
  | "layout_gen"
  | "architect"
  // B4
  | "load_engineer"
  | "structural"
  // B5
  | "mep_electric"
  | "mep_plumbing"
  | "mep_hvac"
  | "security_camera"
  | "fire_safety"
  | "bim_modeler"
  // B6
  | "render_3d"
  | "material_specialist"
  // B7
  | "boq_engine"
  | "qc_inspector"
  | "legal_permit";

export const ALL_AGENTS: AgentCode[] = [
  "brief_analyst",
  "phongthuy_master",
  "creative_ai",
  "interior_designer",
  "layout_gen",
  "architect",
  "load_engineer",
  "structural",
  "mep_electric",
  "mep_plumbing",
  "mep_hvac",
  "security_camera",
  "fire_safety",
  "bim_modeler",
  "render_3d",
  "material_specialist",
  "boq_engine",
  "qc_inspector",
  "legal_permit",
];

// Resolution priority — số nhỏ = ưu tiên cao
export const AGENT_PRIORITY: Record<AgentCode, number> = {
  structural: 1,
  load_engineer: 1,
  fire_safety: 2,
  mep_electric: 3,
  mep_plumbing: 3,
  mep_hvac: 3,
  security_camera: 4,
  bim_modeler: 4,
  architect: 5,
  layout_gen: 5,
  interior_designer: 6,
  material_specialist: 6,
  render_3d: 7,
  creative_ai: 8,
  brief_analyst: 9,
  phongthuy_master: 9,
  boq_engine: 4,
  qc_inspector: 0, // QC overrides all
  legal_permit: 2,
};

export interface AgentSpec {
  code: AgentCode;
  name: string;
  phase: PhaseCode;
  parallel_group?: string;
  dna_prompt: string;
  output_schema: Record<string, unknown>;
  timeout_ms: number;
  max_retries: number;
}

// ─────────────────────────────────────────────────────────────────
// PROJECT BRIEF (input từ user)
// ─────────────────────────────────────────────────────────────────

export interface ProjectBrief {
  project_name: string;
  owner: {
    full_name: string;
    birth_year: number;
    gender: "male" | "female";
    family_size: number;
  };
  lot: {
    address: string;
    area_m2: number;
    width_m: number;
    depth_m: number;
    facing: "N" | "S" | "E" | "W" | "NE" | "NW" | "SE" | "SW";
    setback_front_m: number;
    setback_back_m: number;
    setback_side_m: number;
    far_max: number; // hệ số sử dụng đất
    density_max: number; // mật độ XD %
  };
  program: {
    floors: number;
    bedrooms: number;
    bathrooms: number;
    has_garage: boolean;
    has_pool: boolean;
    has_altar_room: boolean;
    style_preference: "modern" | "indochine" | "japandi" | "luxury" | "classic" | "neoclassic";
  };
  budget: {
    total_vnd: number;
    tolerance_pct: number; // ± %
  };
  legal: {
    permit_status: "approved" | "pending" | "not_started";
    is_renovation: boolean;
  };
}

// ─────────────────────────────────────────────────────────────────
// AGENT RUN
// ─────────────────────────────────────────────────────────────────

export type AgentRunStatus = "queued" | "running" | "succeeded" | "failed" | "timeout" | "skipped";

export interface AgentRunResult {
  agent_code: AgentCode;
  phase: PhaseCode;
  run_id: string;
  status: AgentRunStatus;
  input: unknown;
  output: unknown;
  deliverables: Deliverable[];
  warnings: string[];
  errors: string[];
  started_at: number;
  finished_at: number;
  duration_ms: number;
  retry_count: number;
  // TMR confidence (nếu run qua TMR)
  confidence?: "high" | "medium" | "low";
  dissent_reasons?: string[];
}

export interface Deliverable {
  id: string;
  type: "drawing" | "spec" | "json" | "render" | "boq" | "report" | "package";
  name: string;
  path?: string;
  metadata?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────
// PHASE & MISSION
// ─────────────────────────────────────────────────────────────────

export interface PhaseResult {
  phase: PhaseCode;
  iteration: number;
  status: "succeeded" | "failed" | "partial";
  agent_runs: AgentRunResult[];
  conflicts: Conflict[];
  resolutions: Resolution[];
  duration_ms: number;
  deadline_ms: number;
  deliverables: Deliverable[];
}

export interface MissionResult {
  project_id: string;
  brief: ProjectBrief;
  phases: PhaseResult[];
  iterations: IterationResult[];
  final_status: "converged" | "max_iterations_reached" | "fatal_failure";
  total_duration_ms: number;
  qc_summary: QCSummary;
  deliverables: Deliverable[];
}

// ─────────────────────────────────────────────────────────────────
// CONFLICT & RESOLUTION
// ─────────────────────────────────────────────────────────────────

export type ConflictType =
  | "schema_mismatch"
  | "spatial_clash"
  | "resource_overrun"
  | "tcvn_violation"
  | "phongthuy_violation"
  | "contradiction";

export type ConflictSeverity = "info" | "minor" | "major" | "critical";

export interface Conflict {
  id: string;
  type: ConflictType;
  severity: ConflictSeverity;
  source_agent: AgentCode;
  target_agent: AgentCode;
  phase: PhaseCode;
  message: string;
  data: Record<string, unknown>;
  detected_at: number;
}

export type ResolutionAction =
  | "auto_fix"
  | "rerun_low_priority"
  | "rerun_both"
  | "escalate_cto"
  | "freeze_downstream"
  | "rollback_revision";

export interface Resolution {
  conflict_id: string;
  action: ResolutionAction;
  winner_agent?: AgentCode;
  loser_agent?: AgentCode;
  patch?: Record<string, unknown>;
  rationale: string;
  applied_at: number;
}

// ─────────────────────────────────────────────────────────────────
// QC GATES (12 gates)
// ─────────────────────────────────────────────────────────────────

export interface QCGate {
  id: number;
  name: string;
  category: "legal" | "structural" | "mep" | "fire" | "phongthuy" | "budget" | "schema";
  passed: boolean;
  score: number; // 0-100
  message: string;
  related_deliverables: string[];
}

export interface QCSummary {
  gates: QCGate[];
  passed_count: number;
  total_count: number;
  overall_score: number;
  blocking_failures: number;
  budget_variance_pct: number;
}

// ─────────────────────────────────────────────────────────────────
// ITERATION & CONVERGENCE
// ─────────────────────────────────────────────────────────────────

export interface IterationResult {
  iteration: number;
  started_at: number;
  finished_at: number;
  conflicts_count: number;
  qc_score: number;
  budget_variance_pct: number;
  converged: boolean;
  refinement_notes: string[];
  revision_id: string; // Git-like revision hash
}

// ─────────────────────────────────────────────────────────────────
// EVENTS (live progress)
// ─────────────────────────────────────────────────────────────────

export type PipelineEventType =
  | "mission_started"
  | "mission_finished"
  | "cto_event"
  | "phase_started"
  | "phase_finished"
  | "agent_started"
  | "agent_finished"
  | "agent_retry"
  | "conflict_detected"
  | "conflict_resolved"
  | "gate_passed"
  | "gate_failed"
  | "iteration_started"
  | "iteration_finished"
  | "fdir_alert"
  | "tmr_dissent";

export interface PipelineEvent {
  type: PipelineEventType;
  timestamp: number;
  project_id: string;
  phase?: PhaseCode;
  agent?: AgentCode;
  iteration?: number;
  payload?: Record<string, unknown>;
  message: string;
}

// ─────────────────────────────────────────────────────────────────
// FDIR & TMR
// ─────────────────────────────────────────────────────────────────

export type FaultType =
  | "timeout"
  | "schema_mismatch"
  | "nan_or_infinity"
  | "contradiction_locked"
  | "exception"
  | "empty_output";

export interface FaultReport {
  agent_code: AgentCode;
  phase: PhaseCode;
  type: FaultType;
  message: string;
  detected_at: number;
  recovery_action: "retry" | "rollback" | "escalate" | "freeze_downstream";
  retry_count: number;
}

export interface TMRVote<T = unknown> {
  instance_id: string;
  result: T | null;
  duration_ms: number;
  error?: string;
}

export interface TMRResult<T = unknown> {
  result: T | null;
  confidence: "high" | "medium" | "low";
  votes: TMRVote<T>[];
  dissent_reasons: string[];
  consensus_count: number; // 1, 2, hoặc 3
}

// ─────────────────────────────────────────────────────────────────
// PROJECT STATE (in-memory; sẽ persist sang DB sau)
// ─────────────────────────────────────────────────────────────────

export interface ProjectState {
  project_id: string;
  brief: ProjectBrief;
  current_phase?: PhaseCode;
  current_iteration: number;
  revisions: Revision[];
  deliverables_by_phase: Map<PhaseCode, Deliverable[]>;
  agent_outputs: Map<string, AgentRunResult>; // key = `${phase}:${agent_code}:${iteration}`
  locked_specs: Record<string, unknown>; // spec đã chốt — vi phạm = contradiction
}

export interface Revision {
  id: string; // hash
  parent_id?: string;
  iteration: number;
  phase?: PhaseCode;
  message: string;
  created_at: number;
  snapshot: {
    deliverables: Deliverable[];
    agent_outputs_count: number;
    qc_score: number;
  };
}

// ─────────────────────────────────────────────────────────────────
// PROVIDER MODE
// ─────────────────────────────────────────────────────────────────

export type ProviderMode = "mock" | "real";

export interface ProviderConfig {
  mode: ProviderMode;
  zeni_router_url?: string;
  zeni_workspace?: string;
  zeni_api_key?: string;
}
