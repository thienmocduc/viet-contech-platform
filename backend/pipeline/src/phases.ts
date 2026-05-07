/**
 * Phase definitions — 7 giai đoạn × 19 agents.
 *
 * Mỗi phase có:
 *   - sequence: list các agent group; mỗi group là array (agents trong group chạy PARALLEL)
 *   - dependencies: agent nào cần input của agent nào
 *   - deadline_ms: từ types.PHASE_DEADLINE_MS
 *
 * Group rule:
 *   - groups[0] chạy đầu, hoàn thành xong mới qua groups[1]
 *   - Trong 1 group: tất cả agents chạy parallel (Promise.all)
 */

import { AgentCode, PhaseCode, PHASE_DEADLINE_MS } from "./types";

export interface AgentDependency {
  agent: AgentCode;
  needs: AgentCode[]; // agents này phải xong trước
}

export interface PhaseDef {
  phase: PhaseCode;
  description: string;
  groups: AgentCode[][]; // sequential groups; agents trong cùng 1 group = parallel
  dependencies: AgentDependency[];
  deadline_ms: number;
  deliverables_expected: string[];
}

export const PHASES: Record<PhaseCode, PhaseDef> = {
  // ─────────────────────────────────────────────────────────────
  "B1-Brief": {
    phase: "B1-Brief",
    description: "Validate brief, tính cung mệnh, phân tích lô đất + constraint envelope",
    groups: [
      ["brief_analyst", "phongthuy_master"], // chạy parallel
    ],
    dependencies: [
      { agent: "brief_analyst", needs: [] },
      { agent: "phongthuy_master", needs: [] },
    ],
    deadline_ms: PHASE_DEADLINE_MS["B1-Brief"],
    deliverables_expected: ["project_context.json", "pt_analysis.json", "constraint_envelope.json"],
  },

  // ─────────────────────────────────────────────────────────────
  "B2-Concept": {
    phase: "B2-Concept",
    description: "Sinh 5 concept tổng (creative + interior parallel) → user chọn 1",
    groups: [
      ["creative_ai", "interior_designer"], // parallel — gen concept
    ],
    dependencies: [
      { agent: "creative_ai", needs: ["brief_analyst", "phongthuy_master"] },
      { agent: "interior_designer", needs: ["brief_analyst", "phongthuy_master"] },
    ],
    deadline_ms: PHASE_DEADLINE_MS["B2-Concept"],
    deliverables_expected: ["concept_pack_5.json", "moodboard.json"],
  },

  // ─────────────────────────────────────────────────────────────
  "B3-Layout": {
    phase: "B3-Layout",
    description: "MDO sinh 30+ option layout → architect chọn top 1",
    groups: [
      ["layout_gen"], // sinh 30 option
      ["architect"], // chọn top 1, refine
    ],
    dependencies: [
      { agent: "layout_gen", needs: ["brief_analyst", "phongthuy_master", "creative_ai"] },
      { agent: "architect", needs: ["layout_gen"] },
    ],
    deadline_ms: PHASE_DEADLINE_MS["B3-Layout"],
    deliverables_expected: ["A-01.dxf", "A-02.dxf", "A-03.dxf", "layout.json"],
  },

  // ─────────────────────────────────────────────────────────────
  "B4-Structural": {
    phase: "B4-Structural",
    description: "Tải trọng + kết cấu BTCT theo TCVN 5574:2018, TCVN 2737",
    groups: [
      ["load_engineer"], // tính tải trọng
      ["structural"], // thiết kế cột/dầm/sàn/móng
    ],
    dependencies: [
      { agent: "load_engineer", needs: ["architect"] },
      { agent: "structural", needs: ["load_engineer", "architect"] },
    ],
    deadline_ms: PHASE_DEADLINE_MS["B4-Structural"],
    deliverables_expected: ["S-01.dxf", "S-02.dxf", "S-03.dxf", "S-04.dxf", "loads.json"],
  },

  // ─────────────────────────────────────────────────────────────
  "B5-MEP+BIM": {
    phase: "B5-MEP+BIM",
    description: "5 MEP agents PARALLEL → BIM merge + clash detection",
    groups: [
      // 5 MEP chạy parallel
      ["mep_electric", "mep_plumbing", "mep_hvac", "security_camera", "fire_safety"],
      ["bim_modeler"], // merge + clash detect
    ],
    dependencies: [
      { agent: "mep_electric", needs: ["architect", "structural"] },
      { agent: "mep_plumbing", needs: ["architect", "structural"] },
      { agent: "mep_hvac", needs: ["architect", "structural"] },
      { agent: "security_camera", needs: ["architect"] },
      { agent: "fire_safety", needs: ["architect", "structural"] },
      {
        agent: "bim_modeler",
        needs: [
          "architect",
          "structural",
          "mep_electric",
          "mep_plumbing",
          "mep_hvac",
          "security_camera",
          "fire_safety",
        ],
      },
    ],
    deadline_ms: PHASE_DEADLINE_MS["B5-MEP+BIM"],
    deliverables_expected: [
      "MEP-E.dxf",
      "MEP-P.dxf",
      "MEP-AC.dxf",
      "MEP-CCTV.dxf",
      "MEP-FIRE.dxf",
      "BIM_model.ifc",
      "clash_report.json",
    ],
  },

  // ─────────────────────────────────────────────────────────────
  "B6-Interior+3D": {
    phase: "B6-Interior+3D",
    description: "Chốt 1 phong cách → render 8 góc/phòng → BOM vật liệu",
    groups: [
      ["interior_designer"], // chốt 1 style
      ["render_3d", "material_specialist"], // render + BOM parallel
    ],
    dependencies: [
      { agent: "interior_designer", needs: ["architect", "bim_modeler"] },
      { agent: "render_3d", needs: ["interior_designer"] },
      { agent: "material_specialist", needs: ["interior_designer"] },
    ],
    deadline_ms: PHASE_DEADLINE_MS["B6-Interior+3D"],
    deliverables_expected: ["I-01.dxf", "renders/*.png", "material_BOM.xlsx"],
  },

  // ─────────────────────────────────────────────────────────────
  "B7-QC+Export": {
    phase: "B7-QC+Export",
    description: "BOQ → 12 gate QC (TMR) → hồ sơ pháp lý → đóng gói",
    groups: [
      ["boq_engine"], // bóc tách dự toán
      ["qc_inspector"], // 12 gate QC (chạy TMR voting)
      ["legal_permit"], // hồ sơ xin phép
    ],
    dependencies: [
      { agent: "boq_engine", needs: ["material_specialist", "bim_modeler"] },
      {
        agent: "qc_inspector",
        needs: ["boq_engine", "bim_modeler", "structural", "mep_electric", "fire_safety"],
      },
      { agent: "legal_permit", needs: ["qc_inspector"] },
    ],
    deadline_ms: PHASE_DEADLINE_MS["B7-QC+Export"],
    deliverables_expected: [
      "BOQ_KT.xlsx",
      "BOQ_KC.xlsx",
      "BOQ_NT.xlsx",
      "QC_report.pdf",
      "permit_application.pdf",
      "PROJECT_PACKAGE.zip",
    ],
  },
};

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

export function getPhaseDef(phase: PhaseCode): PhaseDef {
  return PHASES[phase];
}

export function listPhaseAgents(phase: PhaseCode): AgentCode[] {
  return PHASES[phase].groups.flat();
}

export function isAgentParallelInPhase(phase: PhaseCode, agent: AgentCode): boolean {
  const def = PHASES[phase];
  for (const group of def.groups) {
    if (group.includes(agent)) {
      return group.length > 1;
    }
  }
  return false;
}

export function getAgentDependencies(phase: PhaseCode, agent: AgentCode): AgentCode[] {
  const def = PHASES[phase];
  const dep = def.dependencies.find((d) => d.agent === agent);
  return dep ? dep.needs : [];
}
