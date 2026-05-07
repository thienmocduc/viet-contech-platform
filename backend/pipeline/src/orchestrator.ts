/**
 * Pipeline Orchestrator — coordinator chính 19 agent × 7 phase.
 *
 * Triết lý NASA/SpaceX:
 *   - CTO Agent decompose mission → phase plan
 *   - Mỗi phase chạy theo group (parallel hoặc sequential)
 *   - FDIR detect fault, retry/rollback/escalate
 *   - TMR voting cho QC inspector
 *   - Conflict resolver detect+resolve giữa agent
 *   - Iteration manager closed-loop convergence (max 10)
 *
 * Event emitter cho live progress; logging structured JSON.
 */

import { EventEmitter } from "events";
import {
  AgentCode,
  AgentRunResult,
  Conflict,
  Deliverable,
  IterationResult,
  MissionResult,
  PhaseCode,
  PhaseResult,
  PHASE_ORDER,
  PipelineEvent,
  ProjectBrief,
  ProjectState,
  ProviderConfig,
  QCSummary,
  Resolution,
} from "./types";
import { PHASES, getAgentDependencies } from "./phases";
import { runAgent, getAgentDef, loadProviderConfig } from "./agent-runner";
import { TMRVoter } from "./tmr";
import { FDIR } from "./fdir";
import { ConflictDetector, ConflictResolver } from "./conflict-resolver";
import { IterationManager } from "./iteration";
import { CTOAgent, MissionPlan } from "./cto-agent";

export class PipelineOrchestrator extends EventEmitter {
  private cto = new CTOAgent();
  private fdir = new FDIR();
  private detector = new ConflictDetector();
  private resolver = new ConflictResolver();
  private iter = new IterationManager();
  private tmr = new TMRVoter();
  private states: Map<string, ProjectState> = new Map();
  private plans: Map<string, MissionPlan> = new Map();
  private config: ProviderConfig;

  constructor(config?: Partial<ProviderConfig>) {
    super();
    this.config = { ...loadProviderConfig(), ...(config || {}) };
  }

  // ─────────────────────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────────────────────

  async runMission(projectId: string, brief: ProjectBrief): Promise<MissionResult> {
    const startedAt = Date.now();
    const plan = this.cto.decompose(projectId, brief);
    this.plans.set(projectId, plan);

    const state: ProjectState = {
      project_id: projectId,
      brief,
      current_iteration: 0,
      revisions: [],
      deliverables_by_phase: new Map(),
      agent_outputs: new Map(),
      locked_specs: {},
    };
    this.states.set(projectId, state);

    this.emitEvent({
      type: "mission_started",
      project_id: projectId,
      message: `Mission ${projectId} started · ${plan.phase_plan.length} phase, deadline ${(plan.total_deadline_ms / 60000).toFixed(0)}min`,
    });
    this.emitEvent({
      type: "cto_event",
      project_id: projectId,
      message: `CTO plan: ${plan.notes.join(" · ")}`,
      payload: { plan },
    });

    // Closed-loop iteration (max 10)
    const iterations = await this.iterate(projectId, 10);

    const phases = Array.from(state.deliverables_by_phase.keys()).map((p) => {
      // Build phase result snapshot từ state
      return this.buildPhaseSnapshot(state, p, iterations.length);
    });

    const finalQC = this.computeQCSummary(state);
    const last = iterations[iterations.length - 1];
    const final_status: MissionResult["final_status"] = !last
      ? "fatal_failure"
      : last.converged
        ? "converged"
        : "max_iterations_reached";

    const allDeliverables: Deliverable[] = [];
    for (const list of state.deliverables_by_phase.values()) {
      allDeliverables.push(...list);
    }

    const result: MissionResult = {
      project_id: projectId,
      brief,
      phases,
      iterations,
      final_status,
      total_duration_ms: Date.now() - startedAt,
      qc_summary: finalQC,
      deliverables: allDeliverables,
    };

    this.emitEvent({
      type: "mission_finished",
      project_id: projectId,
      message: `Mission ${projectId} ${final_status} · ${(result.total_duration_ms / 1000).toFixed(1)}s · QC ${finalQC.passed_count}/${finalQC.total_count}`,
      payload: { final_status, qc_score: finalQC.overall_score },
    });

    return result;
  }

  async runPhase(projectId: string, phase: PhaseCode): Promise<PhaseResult> {
    const state = this.requireState(projectId);
    const def = PHASES[phase];
    state.current_phase = phase;
    const startedAt = Date.now();

    this.emitEvent({
      type: "phase_started",
      project_id: projectId,
      phase,
      message: `Phase ${phase} started`,
    });

    const all_runs: AgentRunResult[] = [];

    // Chạy từng group theo thứ tự; trong group thì parallel
    for (const group of def.groups) {
      const promises = group.map((agent) => this.runAgentSafe(projectId, agent, phase));
      const runs = await Promise.all(promises);
      all_runs.push(...runs);

      // Nếu có agent fail nặng → freeze và break
      const fatal = runs.find((r) => r.status === "failed" || r.status === "timeout");
      if (fatal) {
        this.emitEvent({
          type: "fdir_alert",
          project_id: projectId,
          phase,
          agent: fatal.agent_code,
          message: `Agent ${fatal.agent_code} ${fatal.status} — freezing downstream group(s)`,
        });
        break;
      }
    }

    // Collect deliverables
    const deliverables = all_runs.flatMap((r) => r.deliverables);
    state.deliverables_by_phase.set(phase, deliverables);

    // Detect conflicts ở phase này (in-phase, hữu ích cho B5 BIM)
    const conflicts = this.detector.detect({
      brief: state.brief,
      locked_specs: state.locked_specs,
      agent_outputs: state.agent_outputs,
      iteration: state.current_iteration,
    });
    const phaseConflicts = conflicts.filter((c) => c.phase === phase);
    const resolutions = this.resolver.resolve(phaseConflicts);

    for (const c of phaseConflicts) {
      this.emitEvent({
        type: "conflict_detected",
        project_id: projectId,
        phase,
        message: `${c.severity.toUpperCase()} conflict: ${c.message}`,
        payload: { conflict: c },
      });
    }
    for (const r of resolutions) {
      this.emitEvent({
        type: "conflict_resolved",
        project_id: projectId,
        phase,
        message: `Resolved ${r.conflict_id}: ${r.action} (winner=${r.winner_agent})`,
        payload: { resolution: r },
      });
    }

    const status: PhaseResult["status"] = all_runs.every((r) => r.status === "succeeded")
      ? "succeeded"
      : all_runs.some((r) => r.status === "succeeded")
        ? "partial"
        : "failed";

    const result: PhaseResult = {
      phase,
      iteration: state.current_iteration,
      status,
      agent_runs: all_runs,
      conflicts: phaseConflicts,
      resolutions,
      duration_ms: Date.now() - startedAt,
      deadline_ms: def.deadline_ms,
      deliverables,
    };

    this.emitEvent({
      type: "phase_finished",
      project_id: projectId,
      phase,
      message: `Phase ${phase} ${status} · ${result.duration_ms}ms · ${all_runs.length} agents · ${deliverables.length} deliverables`,
    });

    return result;
  }

  async runAgent(projectId: string, agentCode: string, input: any): Promise<AgentRunResult> {
    const state = this.requireState(projectId);
    return this.runAgentSafe(projectId, agentCode as AgentCode, state.current_phase ?? "B1-Brief", input);
  }

  async detectConflicts(projectId: string, _revisionId: string): Promise<Conflict[]> {
    const state = this.requireState(projectId);
    return this.detector.detect({
      brief: state.brief,
      locked_specs: state.locked_specs,
      agent_outputs: state.agent_outputs,
      iteration: state.current_iteration,
    });
  }

  async resolveConflicts(conflicts: Conflict[]): Promise<Resolution[]> {
    return this.resolver.resolve(conflicts);
  }

  async iterate(projectId: string, maxIterations: number = 10): Promise<IterationResult[]> {
    const state = this.requireState(projectId);
    const results: IterationResult[] = [];

    for (let i = 0; i < maxIterations; i++) {
      const iteration = this.iter.startIteration();
      state.current_iteration = iteration;
      const startedAt = Date.now();

      this.emitEvent({
        type: "iteration_started",
        project_id: projectId,
        iteration,
        message: `Iteration ${iteration}/${maxIterations} started`,
      });

      // Chạy từng phase tuần tự
      for (const phase of PHASE_ORDER) {
        await this.runPhase(projectId, phase);
      }

      // Sau khi xong 7 phase: detect conflicts toàn cục + chấm QC
      const conflicts = await this.detectConflicts(projectId, "");
      const qc = this.computeQCSummary(state);

      // Emit gate events
      for (const g of qc.gates) {
        this.emitEvent({
          type: g.passed ? "gate_passed" : "gate_failed",
          project_id: projectId,
          message: `Gate #${g.id} ${g.name}: ${g.passed ? "PASS" : "FAIL"} (${g.score})`,
        });
      }

      const conv = this.iter.checkConvergence(conflicts, qc, state.brief);

      // Refine constraints nếu chưa converge
      let notes: string[] = [];
      if (!conv.converged) {
        const winnerOuts: Record<string, unknown> = {};
        for (const [k, run] of state.agent_outputs.entries()) {
          if (run.status === "succeeded") winnerOuts[run.agent_code] = run.output;
          void k;
        }
        const refine = this.iter.refineConstraints(state.locked_specs, conflicts, winnerOuts);
        state.locked_specs = refine.locked_specs;
        notes = refine.notes;
      }

      const allDel: Deliverable[] = [];
      for (const list of state.deliverables_by_phase.values()) allDel.push(...list);

      const iterRes = this.iter.finishIteration({
        iteration,
        started_at: startedAt,
        conflicts,
        qc,
        converged: conv.converged,
        refinement_notes: notes,
        deliverables: allDel,
      });
      results.push(iterRes);

      this.emitEvent({
        type: "iteration_finished",
        project_id: projectId,
        iteration,
        message: conv.converged
          ? `Iteration ${iteration} CONVERGED · QC ${qc.overall_score} · revision ${iterRes.revision_id}`
          : `Iteration ${iteration} not converged: ${conv.reasons.join("; ")}`,
        payload: { conv, qc_score: qc.overall_score },
      });

      if (conv.converged) break;
    }

    return results;
  }

  // ─────────────────────────────────────────────────────────────
  // INTERNAL
  // ─────────────────────────────────────────────────────────────

  /**
   * Run agent với FDIR + TMR + retry.
   */
  private async runAgentSafe(
    projectId: string,
    agentCode: AgentCode,
    phase: PhaseCode,
    customInput?: any,
  ): Promise<AgentRunResult> {
    const state = this.requireState(projectId);
    const def = getAgentDef(agentCode);
    const tmrEnabled = (def as any).tmr_enabled === true;
    const input = customInput ?? this.buildAgentInput(state, agentCode, phase);

    this.emitEvent({
      type: "agent_started",
      project_id: projectId,
      phase,
      agent: agentCode,
      message: `${agentCode} started (phase ${phase})`,
    });

    let attempt = 0;
    let lastResult: AgentRunResult | null = null;

    while (attempt < def.max_retries + 1) {
      attempt += 1;

      let runResult: AgentRunResult;

      if (tmrEnabled) {
        // TMR: chạy 3 instance, vote
        const tmr = await this.tmr.run({
          agent_code: agentCode,
          phase,
          input,
          config: this.config,
        });
        runResult = {
          agent_code: agentCode,
          phase,
          run_id: `tmr_${Date.now()}`,
          status: tmr.result ? "succeeded" : "failed",
          input,
          output: tmr.result,
          deliverables:
            tmr.result &&
            (tmr.votes[0].result as any)?.deliverables
              ? ((tmr.votes[0].result as any).deliverables as Deliverable[])
              : [],
          warnings: [],
          errors: tmr.result ? [] : tmr.dissent_reasons,
          started_at: Date.now() - tmr.votes[0].duration_ms,
          finished_at: Date.now(),
          duration_ms: tmr.votes[0].duration_ms,
          retry_count: attempt - 1,
          confidence: tmr.confidence,
          dissent_reasons: tmr.dissent_reasons,
        };
        // Mock outputs đã có deliverables nhúng trong .output? — không, tách riêng. Re-run normal để lấy deliverables.
        if (runResult.deliverables.length === 0) {
          const normal = await runAgent({
            agent_code: agentCode,
            phase,
            input,
            config: this.config,
          });
          runResult.deliverables = normal.deliverables;
          if (!runResult.output) runResult.output = normal.output;
        }
        if (tmr.dissent_reasons.length > 0) {
          this.emitEvent({
            type: "tmr_dissent",
            project_id: projectId,
            phase,
            agent: agentCode,
            message: `TMR ${tmr.confidence} · dissent: ${tmr.dissent_reasons.length}`,
            payload: { dissent: tmr.dissent_reasons, confidence: tmr.confidence },
          });
        }
      } else {
        runResult = await runAgent({
          agent_code: agentCode,
          phase,
          input,
          config: this.config,
        });
      }

      runResult.retry_count = attempt - 1;
      lastResult = runResult;

      // FDIR detect
      const fault = this.fdir.detect(runResult, state.locked_specs);
      if (!fault) {
        this.fdir.ack_success(agentCode, phase);
        break;
      }

      // Có fault → plan recovery
      const recovery = this.fdir.plan_recovery(fault);
      this.emitEvent({
        type: "fdir_alert",
        project_id: projectId,
        phase,
        agent: agentCode,
        message: `FDIR ${fault.type}: ${fault.message} → ${recovery.action} (${recovery.rationale})`,
        payload: { fault, recovery },
      });

      if (recovery.action === "escalate" || recovery.action === "rollback") {
        // Không retry nữa — break để báo cáo
        break;
      }

      // Retry: emit và loop
      if (attempt <= def.max_retries) {
        this.emitEvent({
          type: "agent_retry",
          project_id: projectId,
          phase,
          agent: agentCode,
          message: `Retry attempt ${attempt}/${def.max_retries}`,
        });
      }
    }

    if (!lastResult) {
      // Không thể có — nhưng safety
      lastResult = {
        agent_code: agentCode,
        phase,
        run_id: `noresult_${Date.now()}`,
        status: "failed",
        input,
        output: null,
        deliverables: [],
        warnings: [],
        errors: ["No result"],
        started_at: Date.now(),
        finished_at: Date.now(),
        duration_ms: 0,
        retry_count: 0,
      };
    }

    // Lưu vào state
    const key = `${phase}:${agentCode}:${state.current_iteration}`;
    state.agent_outputs.set(key, lastResult);

    this.emitEvent({
      type: "agent_finished",
      project_id: projectId,
      phase,
      agent: agentCode,
      message: `${agentCode} ${lastResult.status} · ${lastResult.duration_ms}ms · ${lastResult.deliverables.length} deliverables`,
    });

    this.log("info", phase, agentCode, `agent finished`, lastResult.duration_ms);

    return lastResult;
  }

  /**
   * Build input cho agent từ project state + dependency outputs.
   */
  private buildAgentInput(
    state: ProjectState,
    agent: AgentCode,
    phase: PhaseCode,
  ): unknown {
    const deps = getAgentDependencies(phase, agent);
    const dep_outputs: Record<string, unknown> = {};
    for (const d of deps) {
      // Tìm output gần nhất của d (any phase, any iteration)
      let latest: AgentRunResult | null = null;
      for (const r of state.agent_outputs.values()) {
        if (r.agent_code === d && r.status === "succeeded") {
          if (!latest || r.finished_at > latest.finished_at) latest = r;
        }
      }
      if (latest) dep_outputs[d] = latest.output;
    }

    return {
      brief: state.brief,
      iteration: state.current_iteration,
      phase,
      dependencies: dep_outputs,
      locked_specs: state.locked_specs,
    };
  }

  /**
   * Tổng hợp QC từ output của qc_inspector + tính variance ngân sách.
   */
  private computeQCSummary(state: ProjectState): QCSummary {
    let qcRun: AgentRunResult | undefined;
    for (const r of state.agent_outputs.values()) {
      if (r.agent_code === "qc_inspector" && r.status === "succeeded") {
        if (!qcRun || r.finished_at > qcRun.finished_at) qcRun = r;
      }
    }

    let boqTotal = 0;
    for (const r of state.agent_outputs.values()) {
      if (r.agent_code === "boq_engine" && r.status === "succeeded") {
        boqTotal = (r.output as any)?.grand_total_vnd ?? 0;
      }
    }
    const budget = state.brief.budget.total_vnd;
    const variance_pct = budget > 0 ? ((boqTotal - budget) / budget) * 100 : 0;

    if (!qcRun) {
      return {
        gates: [],
        passed_count: 0,
        total_count: 12,
        overall_score: 0,
        blocking_failures: 12,
        budget_variance_pct: variance_pct,
      };
    }

    const out = qcRun.output as any;
    const gates = (out?.gates ?? []).map((g: any) => ({
      id: g.id,
      name: g.name,
      category: g.category,
      passed: g.passed,
      score: g.score,
      message: g.message ?? "",
      related_deliverables: g.related_deliverables ?? [],
    }));

    const passed = gates.filter((g: any) => g.passed).length;
    const total = gates.length;
    const overall = total > 0 ? Math.round(gates.reduce((s: number, g: any) => s + g.score, 0) / total) : 0;
    const blocking = gates.filter(
      (g: any) => !g.passed && (g.category === "structural" || g.category === "fire" || g.category === "legal"),
    ).length;

    return {
      gates,
      passed_count: passed,
      total_count: total,
      overall_score: overall,
      blocking_failures: blocking,
      budget_variance_pct: variance_pct,
    };
  }

  private buildPhaseSnapshot(state: ProjectState, phase: PhaseCode, iter: number): PhaseResult {
    const runs: AgentRunResult[] = [];
    for (const r of state.agent_outputs.values()) {
      if (r.phase === phase) runs.push(r);
    }
    const dels = state.deliverables_by_phase.get(phase) ?? [];
    return {
      phase,
      iteration: iter,
      status: runs.every((r) => r.status === "succeeded") ? "succeeded" : "partial",
      agent_runs: runs,
      conflicts: [],
      resolutions: [],
      duration_ms: runs.reduce((s, r) => s + r.duration_ms, 0),
      deadline_ms: PHASES[phase].deadline_ms,
      deliverables: dels,
    };
  }

  private requireState(projectId: string): ProjectState {
    const s = this.states.get(projectId);
    if (!s) throw new Error(`Project ${projectId} chưa khởi tạo runMission`);
    return s;
  }

  private emitEvent(args: Omit<PipelineEvent, "timestamp">): void {
    const ev: PipelineEvent = { ...args, timestamp: Date.now() };
    this.emit("pipeline_event", ev);
    this.emit(ev.type, ev);
  }

  private log(level: "info" | "warn" | "error", phase: PhaseCode, agent: AgentCode, msg: string, ms?: number) {
    const entry = {
      level,
      phase,
      agent,
      msg,
      ms: ms ?? 0,
      ts: new Date().toISOString(),
    };
    if (process.env.PIPELINE_LOG_JSON === "1") {
      // structured JSON
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(entry));
    }
  }
}

// ─────────────────────────────────────────────────────────────────
// Index re-exports
// ─────────────────────────────────────────────────────────────────

export * from "./types";
export * from "./phases";
export * from "./tmr";
export * from "./fdir";
export * from "./conflict-resolver";
export * from "./iteration";
export * from "./cto-agent";
export { runAgent, getAgentDef, loadProviderConfig } from "./agent-runner";
