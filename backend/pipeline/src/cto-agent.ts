/**
 * CTO Mission Planner — quyết định sequence phase + agent + deadline.
 *
 * Decompose mission từ brief:
 *   1. Validate brief
 *   2. Plan 7 phase, set deadline mỗi phase
 *   3. Adjust khi conflict/escalation:
 *      - Nếu bedrooms ≥ 5 → tăng deadline B3,B5
 *      - Nếu has_pool → thêm sub-task cho mep_plumbing
 *      - Nếu is_renovation → tăng B1 (parse hồ sơ cũ)
 */

import {
  AgentCode,
  PhaseCode,
  PHASE_DEADLINE_MS,
  PHASE_ORDER,
  ProjectBrief,
} from "./types";
import { listPhaseAgents, PHASES } from "./phases";

export interface MissionPlan {
  project_id: string;
  brief: ProjectBrief;
  phase_plan: PhasePlan[];
  total_deadline_ms: number;
  notes: string[];
}

export interface PhasePlan {
  phase: PhaseCode;
  agents: AgentCode[];
  deadline_ms: number;
  parallel_groups: AgentCode[][];
  notes: string[];
}

export class CTOAgent {
  /**
   * Tạo mission plan từ brief.
   */
  decompose(project_id: string, brief: ProjectBrief): MissionPlan {
    this.validate(brief);

    const notes: string[] = [];
    const phase_plan: PhasePlan[] = [];

    let total = 0;
    for (const phase of PHASE_ORDER) {
      const def = PHASES[phase];
      let deadline = def.deadline_ms;
      const phase_notes: string[] = [];

      // Adjust deadline theo brief
      if (phase === "B3-Layout" && brief.program.bedrooms >= 5) {
        deadline = Math.round(deadline * 1.3);
        phase_notes.push(`+30% deadline vì ${brief.program.bedrooms} phòng ngủ`);
      }
      if (phase === "B5-MEP+BIM" && brief.program.has_pool) {
        deadline = Math.round(deadline * 1.2);
        phase_notes.push(`+20% deadline vì có hồ bơi (mep_plumbing phức tạp)`);
      }
      if (phase === "B1-Brief" && brief.legal.is_renovation) {
        deadline = Math.round(deadline * 1.5);
        phase_notes.push(`+50% deadline vì cải tạo (parse hồ sơ cũ)`);
      }
      if (phase === "B4-Structural" && brief.program.floors >= 4) {
        deadline = Math.round(deadline * 1.25);
        phase_notes.push(`+25% deadline vì ${brief.program.floors} tầng`);
      }

      total += deadline;

      phase_plan.push({
        phase,
        agents: listPhaseAgents(phase),
        deadline_ms: deadline,
        parallel_groups: def.groups,
        notes: phase_notes,
      });
    }

    notes.push(
      `Mission ${project_id}: 7 phase, total deadline ${(total / 1000 / 60).toFixed(0)} phút`,
    );

    return {
      project_id,
      brief,
      phase_plan,
      total_deadline_ms: total,
      notes,
    };
  }

  /**
   * Adjust plan giữa run khi có conflict/escalation.
   */
  adjust(
    plan: MissionPlan,
    args: { phase: PhaseCode; reason: string; extra_ms?: number },
  ): MissionPlan {
    const target = plan.phase_plan.find((p) => p.phase === args.phase);
    if (target) {
      const extra = args.extra_ms ?? Math.round(target.deadline_ms * 0.5);
      target.deadline_ms += extra;
      target.notes.push(`+${extra}ms — ${args.reason}`);
      plan.notes.push(`[adjust] ${args.phase} +${extra}ms: ${args.reason}`);
      plan.total_deadline_ms += extra;
    }
    return plan;
  }

  /** Validate brief có đủ field không */
  private validate(brief: ProjectBrief): void {
    if (!brief.project_name) throw new Error("brief.project_name bắt buộc");
    if (!brief.owner?.birth_year) throw new Error("brief.owner.birth_year bắt buộc");
    if (!brief.lot?.area_m2 || brief.lot.area_m2 <= 0) {
      throw new Error("brief.lot.area_m2 phải > 0");
    }
    if (!brief.budget?.total_vnd || brief.budget.total_vnd <= 0) {
      throw new Error("brief.budget.total_vnd phải > 0");
    }
    if (brief.program.bedrooms < 0) throw new Error("brief.program.bedrooms ≥ 0");
  }
}
