/**
 * Agent Runner — gọi 19 agent qua mock hoặc real provider.
 *
 * Mock mode (PROVIDER_MODE=mock):
 *   - Trả response giả realistic theo schema
 *   - Latency mô phỏng 50-300ms để E2E test <30s
 *
 * Real mode (PROVIDER_MODE=real):
 *   - Gọi POST /api/v1/router/route?ws=... lên Zeni Cloud
 *   - DNA prompt + input → text response
 */

import * as fs from "fs";
import * as path from "path";
import {
  AgentCode,
  AgentRunResult,
  AgentRunStatus,
  Deliverable,
  PhaseCode,
  ProviderConfig,
  ProviderMode,
} from "./types";

interface AgentDef {
  code: AgentCode;
  name: string;
  phase: string;
  dna_prompt: string;
  timeout_ms: number;
  max_retries: number;
  tmr_enabled?: boolean;
}

// ─────────────────────────────────────────────────────────────────
// Registry loader
// ─────────────────────────────────────────────────────────────────

let _registry: Record<AgentCode, AgentDef> | null = null;

export function loadRegistry(registryPath?: string): Record<AgentCode, AgentDef> {
  if (_registry) return _registry;
  const p =
    registryPath ||
    path.resolve(__dirname, "../../agents/registry.json");
  if (!fs.existsSync(p)) {
    throw new Error(`Agent registry not found: ${p}`);
  }
  const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
  // Accept both shapes:
  //   1) plain array: [{ code, ... }, ...]
  //   2) { agents: { code: { ... } } } legacy/object form
  const map: Record<string, AgentDef> = {};
  if (Array.isArray(raw)) {
    for (const a of raw as AgentDef[]) {
      if (a && a.code) map[a.code] = a;
    }
  } else if (raw && typeof raw === "object") {
    if (raw.agents && typeof raw.agents === "object") {
      Object.assign(map, raw.agents);
    } else {
      Object.assign(map, raw);
    }
  }
  _registry = map as Record<AgentCode, AgentDef>;
  return _registry;
}

export function getAgentDef(code: AgentCode): AgentDef {
  const r = loadRegistry();
  const def = r[code];
  if (!def) throw new Error(`Unknown agent: ${code}`);
  return def;
}

// ─────────────────────────────────────────────────────────────────
// Provider config
// ─────────────────────────────────────────────────────────────────

export function loadProviderConfig(): ProviderConfig {
  const mode = (process.env.PROVIDER_MODE as ProviderMode) || "mock";
  return {
    mode,
    zeni_router_url: process.env.ZENI_ROUTER_URL,
    zeni_workspace: process.env.ZENI_WORKSPACE,
    zeni_api_key: process.env.ZENI_API_KEY,
  };
}

// ─────────────────────────────────────────────────────────────────
// Mock outputs theo từng agent — realistic per schema
// ─────────────────────────────────────────────────────────────────

const MOCK_OUTPUTS: Record<AgentCode, (input: any) => { output: any; deliverables: Deliverable[] }> = {
  brief_analyst: (input) => ({
    output: {
      project_context: {
        project_name: input?.brief?.project_name ?? "Untitled",
        program: input?.brief?.program ?? {},
        constraint_envelope: {
          buildable_area_m2: (input?.brief?.lot?.area_m2 ?? 280) * 0.7,
          max_height_m: 12,
          far: input?.brief?.lot?.far_max ?? 2.5,
        },
      },
    },
    deliverables: [
      { id: "d_proj_ctx", type: "json", name: "project_context.json" },
      { id: "d_constraint", type: "json", name: "constraint_envelope.json" },
    ],
  }),

  phongthuy_master: (input) => {
    const year = input?.brief?.owner?.birth_year ?? 1985;
    const gender = input?.brief?.owner?.gender ?? "male";
    // Bát Trạch: tính cung mệnh đơn giản
    const lastDigit = year % 9;
    const cung = ["Khảm", "Ly", "Cấn", "Đoài", "Càn", "Khôn", "Tốn", "Chấn", "Trung"][lastDigit] ?? "Khảm";
    const isDong = ["Khảm", "Ly", "Tốn", "Chấn"].includes(cung);
    return {
      output: {
        cung_menh: cung,
        nhom: isDong ? "Đông tứ trạch" : "Tây tứ trạch",
        huong_tot: isDong ? ["Bắc", "Đông", "Đông Nam", "Nam"] : ["Tây", "Tây Bắc", "Tây Nam", "Đông Bắc"],
        huong_xau: isDong ? ["Tây", "Tây Bắc", "Tây Nam", "Đông Bắc"] : ["Bắc", "Đông", "Đông Nam", "Nam"],
        gender,
      },
      deliverables: [{ id: "d_pt", type: "json", name: "pt_analysis.json" }],
    };
  },

  creative_ai: () => ({
    output: {
      concepts: Array.from({ length: 5 }, (_, i) => ({
        id: `concept_${i + 1}`,
        name: ["Thanh tịnh Á đông", "Hiện đại tối giản", "Indochine ấm", "Luxury cổ điển", "Japandi xanh"][i],
        mood: "calm + connect-nature",
        palette: ["#F5F1E8", "#1F2A1E", "#C4933A"],
      })),
    },
    deliverables: [
      { id: "d_concept", type: "json", name: "concept_pack_5.json" },
      { id: "d_moodboard", type: "json", name: "moodboard.json" },
    ],
  }),

  interior_designer: () => ({
    output: {
      style_chosen: "japandi",
      palette: ["#EDE6D6", "#3A4A3A", "#C4933A", "#1A1A1A"],
      materials: ["gỗ sồi tự nhiên", "đá travertine", "vải linen", "thép sơn tĩnh điện"],
    },
    deliverables: [{ id: "d_int_pack", type: "spec", name: "interior_pack.json" }],
  }),

  layout_gen: () => ({
    output: {
      options: Array.from({ length: 32 }, (_, i) => ({
        id: `opt_${i + 1}`,
        score: 0.6 + Math.random() * 0.4,
        circulation_ok: true,
        sunlight_ratio: 0.18 + Math.random() * 0.05,
      })),
    },
    deliverables: [{ id: "d_layout_opts", type: "json", name: "layout_options.json" }],
  }),

  architect: () => ({
    output: {
      chosen_option: "opt_7",
      rooms: [
        { code: "LR", name: "Phòng khách", area_m2: 35 },
        { code: "K", name: "Bếp", area_m2: 18 },
        { code: "MB1", name: "Master bedroom", area_m2: 28 },
      ],
      facades: ["A-04", "A-05", "A-06", "A-07"],
      sections: ["A-08", "A-09"],
    },
    deliverables: [
      { id: "d_a01", type: "drawing", name: "A-01.dxf" },
      { id: "d_a02", type: "drawing", name: "A-02.dxf" },
      { id: "d_a03", type: "drawing", name: "A-03.dxf" },
      { id: "d_layout", type: "json", name: "layout.json" },
    ],
  }),

  load_engineer: () => ({
    output: {
      static_load_kn_m2: 4.5,
      live_load_kn_m2: 2.0,
      wind_load_kn_m2: 0.83,
      seismic_zone: "VII",
    },
    deliverables: [{ id: "d_loads", type: "json", name: "loads.json" }],
  }),

  structural: () => ({
    output: {
      columns: [{ code: "C1", section: "250x250", concrete: "M300", rebar: "4φ16+φ8@200", mu: 0.0128 }],
      beams: [{ code: "DM1", section: "250x500", concrete: "M300", rebar_top: "4φ18", rebar_bot: "3φ16" }],
      slabs: [{ code: "S1", thickness_mm: 120, concrete: "M250", rebar: "φ10@200" }],
      footings: [{ code: "MB1", section: "900x300", concrete: "M250", rebar: "4φ14" }],
      tcvn_5574_compliance: true,
    },
    deliverables: [
      { id: "d_s01", type: "drawing", name: "S-01.dxf" },
      { id: "d_s02", type: "drawing", name: "S-02.dxf" },
      { id: "d_s03", type: "drawing", name: "S-03.dxf" },
      { id: "d_s04", type: "drawing", name: "S-04.dxf" },
    ],
  }),

  mep_electric: () => ({
    output: { total_load_kva: 22, main_cb: "3P-100A", circuits: 18 },
    deliverables: [{ id: "d_mep_e", type: "drawing", name: "MEP-E.dxf" }],
  }),

  mep_plumbing: () => ({
    output: { supply_dn: 32, pressure_bar: 2.5, fixture_units: 18 },
    deliverables: [{ id: "d_mep_p", type: "drawing", name: "MEP-P.dxf" }],
  }),

  mep_hvac: () => ({
    output: { system: "VRV", outdoor_units: 1, indoor_units: 4, total_btu: 54000 },
    deliverables: [{ id: "d_mep_ac", type: "drawing", name: "MEP-AC.dxf" }],
  }),

  security_camera: () => ({
    output: { cameras: 8, sensors: 12, access_points: 3 },
    deliverables: [{ id: "d_mep_cctv", type: "drawing", name: "MEP-CCTV.dxf" }],
  }),

  fire_safety: () => ({
    output: { sprinklers: 24, smoke_detectors: 16, emergency_exits: 2, qcvn_06_compliance: true },
    deliverables: [{ id: "d_mep_fire", type: "drawing", name: "MEP-FIRE.dxf" }],
  }),

  bim_modeler: () => ({
    output: {
      ifc_version: "IFC4",
      element_count: 1247,
      clashes: [
        // Inject 1 clash nhẹ để test conflict resolver
        { id: "cl_001", type: "spatial", source: "structural", target: "mep_plumbing", severity: "minor" },
      ],
    },
    deliverables: [
      { id: "d_bim", type: "package", name: "BIM_model.ifc" },
      { id: "d_clash", type: "report", name: "clash_report.json" },
    ],
  }),

  render_3d: () => ({
    output: { rooms_rendered: 6, angles_per_room: 8, total_renders: 48, day_night: true },
    deliverables: Array.from({ length: 8 }, (_, i) => ({
      id: `d_render_${i}`,
      type: "render" as const,
      name: `renders/room_${i + 1}.png`,
    })),
  }),

  material_specialist: () => ({
    output: {
      bom_items: 187,
      total_cost_vnd: 2_350_000_000,
      categories: ["floor", "wall", "ceiling", "door", "furniture"],
    },
    deliverables: [{ id: "d_bom", type: "boq", name: "material_BOM.xlsx" }],
  }),

  boq_engine: () => ({
    output: {
      boq_kt_total_vnd: 1_120_000_000,
      boq_kc_total_vnd: 850_000_000,
      boq_nt_total_vnd: 480_000_000,
      grand_total_vnd: 2_450_000_000,
    },
    deliverables: [
      { id: "d_boq_kt", type: "boq", name: "BOQ_KT.xlsx" },
      { id: "d_boq_kc", type: "boq", name: "BOQ_KC.xlsx" },
      { id: "d_boq_nt", type: "boq", name: "BOQ_NT.xlsx" },
    ],
  }),

  qc_inspector: (input) => {
    // Mock: 12 gates, 11 pass + 1 minor
    return {
      output: {
        gates: [
          { id: 1, name: "Pháp lý", category: "legal", passed: true, score: 98 },
          { id: 2, name: "Schema KT", category: "schema", passed: true, score: 100 },
          { id: 3, name: "TCVN 5574 KC", category: "structural", passed: true, score: 95 },
          { id: 4, name: "TCVN 2737 tải", category: "structural", passed: true, score: 96 },
          { id: 5, name: "IEC 60364 điện", category: "mep", passed: true, score: 94 },
          { id: 6, name: "Hunter cấp nước", category: "mep", passed: true, score: 92 },
          { id: 7, name: "BTU HVAC", category: "mep", passed: true, score: 91 },
          { id: 8, name: "QCVN 06 PCCC", category: "fire", passed: true, score: 97 },
          { id: 9, name: "Bát Trạch hướng", category: "phongthuy", passed: true, score: 90 },
          { id: 10, name: "Clash detect", category: "schema", passed: true, score: 88 },
          { id: 11, name: "Ngân sách ±5%", category: "budget", passed: true, score: 93 },
          { id: 12, name: "Sign-off KTS", category: "schema", passed: true, score: 99 },
        ],
        passed_count: 12,
        total_count: 12,
      },
      deliverables: [{ id: "d_qc", type: "report", name: "QC_report.pdf" }],
    };
  },

  legal_permit: () => ({
    output: { permit_doc_pages: 28, nghi_dinh: "15/2021", checklist_complete: true },
    deliverables: [
      { id: "d_permit", type: "report", name: "permit_application.pdf" },
      { id: "d_pkg", type: "package", name: "PROJECT_PACKAGE.zip" },
    ],
  }),
};

// ─────────────────────────────────────────────────────────────────
// Run agent (mock or real)
// ─────────────────────────────────────────────────────────────────

export interface RunAgentOptions {
  agent_code: AgentCode;
  phase: PhaseCode;
  input: unknown;
  context?: Record<string, unknown>;
  config?: ProviderConfig;
  variant_seed?: number; // dùng cho TMR (mỗi instance dùng seed khác)
}

let _runCounter = 0;

export async function runAgent(opts: RunAgentOptions): Promise<AgentRunResult> {
  const cfg = opts.config ?? loadProviderConfig();
  const def = getAgentDef(opts.agent_code);
  const startedAt = Date.now();
  const runId = `run_${++_runCounter}_${startedAt}`;
  const baseResult: AgentRunResult = {
    agent_code: opts.agent_code,
    phase: opts.phase,
    run_id: runId,
    status: "running",
    input: opts.input,
    output: null,
    deliverables: [],
    warnings: [],
    errors: [],
    started_at: startedAt,
    finished_at: 0,
    duration_ms: 0,
    retry_count: 0,
  };

  try {
    if (cfg.mode === "mock") {
      const result = await runMock(opts);
      return finalizeResult(baseResult, "succeeded", result);
    } else {
      const result = await runReal(opts, cfg);
      return finalizeResult(baseResult, "succeeded", result);
    }
  } catch (err) {
    const status: AgentRunStatus =
      (err as Error).message.includes("timeout") ? "timeout" : "failed";
    return finalizeResult(baseResult, status, {
      output: null,
      deliverables: [],
      error: (err as Error).message,
    });
  }
}

function finalizeResult(
  base: AgentRunResult,
  status: AgentRunStatus,
  payload: { output: unknown; deliverables: Deliverable[]; error?: string },
): AgentRunResult {
  const finishedAt = Date.now();
  return {
    ...base,
    status,
    output: payload.output,
    deliverables: payload.deliverables ?? [],
    errors: payload.error ? [payload.error] : [],
    finished_at: finishedAt,
    duration_ms: finishedAt - base.started_at,
  };
}

// ─────────────────────────────────────────────────────────────────
// Mock runner — latency 50-300ms, occasional fail (5%) cho test FDIR
// ─────────────────────────────────────────────────────────────────

async function runMock(
  opts: RunAgentOptions,
): Promise<{ output: unknown; deliverables: Deliverable[] }> {
  const delay = 50 + Math.random() * 250;
  await sleep(delay);

  // Inject deterministic output theo agent
  const fn = MOCK_OUTPUTS[opts.agent_code];
  if (!fn) throw new Error(`No mock output for agent: ${opts.agent_code}`);
  return fn(opts.input);
}

// ─────────────────────────────────────────────────────────────────
// Real runner — gọi Zeni Cloud router (TODO khi cloud sẵn sàng)
// ─────────────────────────────────────────────────────────────────

async function runReal(
  opts: RunAgentOptions,
  cfg: ProviderConfig,
): Promise<{ output: unknown; deliverables: Deliverable[] }> {
  if (!cfg.zeni_router_url || !cfg.zeni_workspace) {
    throw new Error("Real mode requires ZENI_ROUTER_URL + ZENI_WORKSPACE");
  }
  const def = getAgentDef(opts.agent_code);

  // Lazy-import node-fetch (CommonJS-friendly)
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fetch: typeof globalThis.fetch =
    (globalThis as any).fetch ?? require("node-fetch").default;

  const url = `${cfg.zeni_router_url}/api/v1/router/route?ws=${encodeURIComponent(
    cfg.zeni_workspace,
  )}`;

  const body = {
    agent_code: opts.agent_code,
    dna_prompt: def.dna_prompt,
    input: opts.input,
    context: opts.context ?? {},
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), def.timeout_ms);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: cfg.zeni_api_key ? `Bearer ${cfg.zeni_api_key}` : "",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Zeni router ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as { output: unknown; deliverables?: Deliverable[] };
    return {
      output: json.output,
      deliverables: json.deliverables ?? [],
    };
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────────────────────────────────────────────────────────
// Util
// ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
