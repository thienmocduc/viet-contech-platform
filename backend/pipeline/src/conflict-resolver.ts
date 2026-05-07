/**
 * Conflict Resolver — detect & resolve conflicts giữa output 2 agent.
 *
 * Loại conflict:
 *   1. schema_mismatch — A's output structure khác B's expected input
 *   2. spatial_clash   — vd cột structural va cửa kiến trúc
 *   3. resource_overrun — BOQ vượt ngân sách
 *   4. tcvn_violation  — vi phạm TCVN (μ < 0.25% hoặc > 4%, hành lang < 900mm)
 *   5. phongthuy_violation — hướng phòng vi phạm Bát Trạch
 *   6. contradiction   — output mâu thuẫn locked spec
 *
 * Resolution priority (số nhỏ = ưu tiên cao):
 *   QC Inspector (0) > structural/load_engineer (1) > fire_safety/legal (2) >
 *   MEP/BOQ/BIM (3-4) > architect/layout (5) > interior/material (6) >
 *   render (7) > creative (8) > brief/phongthuy (9)
 *
 * Action:
 *   - Conflict info/minor → auto_fix patch
 *   - Conflict major → rerun_low_priority (giữ output ưu tiên cao, chạy lại bên thấp)
 *   - Conflict critical → escalate_cto + freeze_downstream
 */

import {
  AGENT_PRIORITY,
  AgentCode,
  AgentRunResult,
  Conflict,
  ConflictSeverity,
  ConflictType,
  PhaseCode,
  ProjectBrief,
  Resolution,
  ResolutionAction,
} from "./types";

let _conflictCounter = 0;

// ─────────────────────────────────────────────────────────────────
// DETECT
// ─────────────────────────────────────────────────────────────────

export interface DetectionContext {
  brief: ProjectBrief;
  locked_specs: Record<string, unknown>;
  agent_outputs: Map<string, AgentRunResult>; // key = `${phase}:${agent}:${iteration}`
  iteration: number;
}

export class ConflictDetector {
  detect(ctx: DetectionContext): Conflict[] {
    const conflicts: Conflict[] = [];

    const outputs = Array.from(ctx.agent_outputs.values()).filter(
      (r) => r.status === "succeeded",
    );

    // 1. Spatial clash: BIM clash report
    const bim = outputs.find((r) => r.agent_code === "bim_modeler");
    if (bim) {
      const clashes = (bim.output as any)?.clashes ?? [];
      for (const c of clashes) {
        conflicts.push(
          this.make({
            type: "spatial_clash",
            severity: c.severity ?? "minor",
            source_agent: c.source as AgentCode,
            target_agent: c.target as AgentCode,
            phase: bim.phase,
            message: `BIM clash giữa ${c.source} và ${c.target}`,
            data: c,
          }),
        );
      }
    }

    // 2. Resource overrun: BOQ vs budget
    const boq = outputs.find((r) => r.agent_code === "boq_engine");
    if (boq) {
      const total = (boq.output as any)?.grand_total_vnd ?? 0;
      const budget = ctx.brief.budget.total_vnd;
      const tolerance = ctx.brief.budget.tolerance_pct / 100;
      const variance = (total - budget) / budget;
      if (Math.abs(variance) > tolerance) {
        const sev: ConflictSeverity =
          Math.abs(variance) > 0.15 ? "critical" : Math.abs(variance) > 0.1 ? "major" : "minor";
        conflicts.push(
          this.make({
            type: "resource_overrun",
            severity: sev,
            source_agent: "boq_engine",
            target_agent: "material_specialist",
            phase: boq.phase,
            message: `BOQ ${(variance * 100).toFixed(1)}% so với ngân sách (cho phép ±${ctx.brief.budget.tolerance_pct}%)`,
            data: { total, budget, variance_pct: variance * 100 },
          }),
        );
      }
    }

    // 3. TCVN violation: structural reinforcement ratio
    const struct = outputs.find((r) => r.agent_code === "structural");
    if (struct) {
      const cols = (struct.output as any)?.columns ?? [];
      for (const c of cols) {
        if (typeof c.mu === "number" && (c.mu < 0.0025 || c.mu > 0.04)) {
          conflicts.push(
            this.make({
              type: "tcvn_violation",
              severity: "major",
              source_agent: "structural",
              target_agent: "qc_inspector",
              phase: struct.phase,
              message: `TCVN 5574: cột ${c.code} có μ=${c.mu} ngoài [0.25%, 4%]`,
              data: c,
            }),
          );
        }
      }
    }

    // 4. Phongthuy violation: hướng cửa chính
    const arch = outputs.find((r) => r.agent_code === "architect");
    const pt = outputs.find((r) => r.agent_code === "phongthuy_master");
    if (arch && pt) {
      const main_door_dir = (arch.output as any)?.main_door_direction;
      const huong_xau = (pt.output as any)?.huong_xau ?? [];
      if (main_door_dir && huong_xau.includes(main_door_dir)) {
        conflicts.push(
          this.make({
            type: "phongthuy_violation",
            severity: "major",
            source_agent: "architect",
            target_agent: "phongthuy_master",
            phase: arch.phase,
            message: `Cửa chính hướng ${main_door_dir} thuộc hướng xấu Bát Trạch`,
            data: { direction: main_door_dir, bad_dirs: huong_xau },
          }),
        );
      }
    }

    // 5. Contradiction with locked specs (chạy iteration ≥2)
    if (ctx.iteration > 1 && Object.keys(ctx.locked_specs).length > 0) {
      for (const r of outputs) {
        const out = r.output as Record<string, unknown>;
        if (!out || typeof out !== "object") continue;
        for (const [key, locked] of Object.entries(ctx.locked_specs)) {
          if (key in out) {
            try {
              if (JSON.stringify(out[key]) !== JSON.stringify(locked)) {
                conflicts.push(
                  this.make({
                    type: "contradiction",
                    severity: "critical",
                    source_agent: r.agent_code,
                    target_agent: "qc_inspector",
                    phase: r.phase,
                    message: `Agent ${r.agent_code} mâu thuẫn locked spec "${key}"`,
                    data: { key, got: out[key], expected: locked },
                  }),
                );
              }
            } catch {
              // ignore
            }
          }
        }
      }
    }

    return conflicts;
  }

  private make(args: Omit<Conflict, "id" | "detected_at">): Conflict {
    return {
      id: `cf_${++_conflictCounter}_${Date.now()}`,
      detected_at: Date.now(),
      ...args,
    };
  }
}

// ─────────────────────────────────────────────────────────────────
// RESOLVE
// ─────────────────────────────────────────────────────────────────

export class ConflictResolver {
  resolve(conflicts: Conflict[]): Resolution[] {
    return conflicts.map((c) => this.resolveOne(c));
  }

  private resolveOne(c: Conflict): Resolution {
    const action = this.decideAction(c);
    const winner = this.pickWinner(c);
    const loser = winner === c.source_agent ? c.target_agent : c.source_agent;

    return {
      conflict_id: c.id,
      action,
      winner_agent: winner,
      loser_agent: loser,
      patch: this.buildPatch(c, action),
      rationale: this.rationale(c, action, winner),
      applied_at: Date.now(),
    };
  }

  private decideAction(c: Conflict): ResolutionAction {
    if (c.severity === "critical") {
      return c.type === "contradiction" ? "rollback_revision" : "escalate_cto";
    }
    if (c.severity === "major") {
      return "rerun_low_priority";
    }
    if (c.severity === "minor") {
      return "auto_fix";
    }
    return "auto_fix"; // info
  }

  private pickWinner(c: Conflict): AgentCode {
    const ps = AGENT_PRIORITY[c.source_agent];
    const pt = AGENT_PRIORITY[c.target_agent];
    return ps <= pt ? c.source_agent : c.target_agent;
  }

  private buildPatch(c: Conflict, action: ResolutionAction): Record<string, unknown> {
    if (action === "auto_fix" && c.type === "spatial_clash") {
      return {
        action: "shift_mep_route",
        offset_mm: 200,
        target: c.target_agent,
      };
    }
    if (action === "auto_fix" && c.type === "tcvn_violation") {
      return { action: "increase_rebar", target: "structural" };
    }
    if (action === "rerun_low_priority") {
      return { rerun_agent: c.target_agent };
    }
    return {};
  }

  private rationale(c: Conflict, action: ResolutionAction, winner: AgentCode): string {
    switch (action) {
      case "auto_fix":
        return `Conflict ${c.severity} → patch tự động (giữ ${winner})`;
      case "rerun_low_priority":
        return `Major conflict — giữ ${winner}, chạy lại bên priority thấp`;
      case "escalate_cto":
        return `Critical — chuyển CTO Agent quyết`;
      case "rollback_revision":
        return `Mâu thuẫn locked spec — rollback revision`;
      default:
        return "Default";
    }
  }
}
