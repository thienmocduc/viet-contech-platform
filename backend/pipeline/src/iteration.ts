/**
 * Iteration Manager — closed-loop convergence.
 *
 * Vòng lặp:
 *   1. Run pipeline (7 phase)
 *   2. Detect conflicts + chấm QC
 *   3. Nếu chưa converge → refine constraints, locked_specs từ winner output → run lại
 *   4. Mỗi iteration commit revision (Git-like hash)
 *
 * Convergence criteria (tất cả phải pass):
 *   - 0 conflict severity ≥ major
 *   - QC overall_score ≥ 90
 *   - budget_variance trong ±5%
 *   - 12/12 QC gate pass
 *
 * Max 10 iterations.
 */

import * as crypto from "crypto";
import {
  Conflict,
  Deliverable,
  IterationResult,
  ProjectBrief,
  QCSummary,
  Revision,
} from "./types";

export interface ConvergenceCheck {
  converged: boolean;
  reasons: string[];
  qc_score: number;
  budget_variance_pct: number;
  conflicts_count_major_plus: number;
}

export class IterationManager {
  private revisions: Revision[] = [];
  private currentIteration = 0;

  startIteration(): number {
    this.currentIteration += 1;
    return this.currentIteration;
  }

  /** Check tất cả convergence criteria */
  checkConvergence(
    conflicts: Conflict[],
    qc: QCSummary,
    brief: ProjectBrief,
  ): ConvergenceCheck {
    const reasons: string[] = [];
    const majorPlus = conflicts.filter(
      (c) => c.severity === "major" || c.severity === "critical",
    ).length;

    if (majorPlus > 0) {
      reasons.push(`${majorPlus} conflict severity ≥ major`);
    }

    if (qc.overall_score < 90) {
      reasons.push(`QC score ${qc.overall_score} < 90`);
    }

    if (qc.passed_count < qc.total_count) {
      reasons.push(`QC ${qc.passed_count}/${qc.total_count} gates passed`);
    }

    const tol = brief.budget.tolerance_pct;
    if (Math.abs(qc.budget_variance_pct) > tol) {
      reasons.push(
        `Budget variance ${qc.budget_variance_pct.toFixed(1)}% vượt ±${tol}%`,
      );
    }

    return {
      converged: reasons.length === 0,
      reasons,
      qc_score: qc.overall_score,
      budget_variance_pct: qc.budget_variance_pct,
      conflicts_count_major_plus: majorPlus,
    };
  }

  /** Build IterationResult */
  finishIteration(args: {
    iteration: number;
    started_at: number;
    conflicts: Conflict[];
    qc: QCSummary;
    converged: boolean;
    refinement_notes: string[];
    deliverables: Deliverable[];
  }): IterationResult {
    const finished_at = Date.now();
    const revision = this.commitRevision({
      iteration: args.iteration,
      message: args.converged
        ? `iter ${args.iteration} — CONVERGED`
        : `iter ${args.iteration} — refining`,
      deliverables: args.deliverables,
      qc_score: args.qc.overall_score,
    });

    return {
      iteration: args.iteration,
      started_at: args.started_at,
      finished_at,
      conflicts_count: args.conflicts.length,
      qc_score: args.qc.overall_score,
      budget_variance_pct: args.qc.budget_variance_pct,
      converged: args.converged,
      refinement_notes: args.refinement_notes,
      revision_id: revision.id,
    };
  }

  /** Refine constraints/locked_specs cho iteration sau dựa vào conflicts */
  refineConstraints(
    locked_specs: Record<string, unknown>,
    conflicts: Conflict[],
    winner_outputs: Record<string, unknown>,
  ): { locked_specs: Record<string, unknown>; notes: string[] } {
    const next = { ...locked_specs };
    const notes: string[] = [];

    for (const c of conflicts) {
      if (c.severity === "major" || c.severity === "critical") {
        // Lock winner output để iteration sau tránh divergence
        const winner = winner_outputs[c.source_agent] || winner_outputs[c.target_agent];
        if (winner) {
          const k = `${c.type}_${c.source_agent}_${c.target_agent}`;
          next[k] = winner;
          notes.push(
            `Lock spec từ winner ${c.source_agent} cho conflict ${c.type}`,
          );
        }
      }
    }

    return { locked_specs: next, notes };
  }

  // ─────────────────────────────────────────────────────────────
  // Revision (Git-like)
  // ─────────────────────────────────────────────────────────────

  private commitRevision(args: {
    iteration: number;
    message: string;
    deliverables: Deliverable[];
    qc_score: number;
  }): Revision {
    const parent_id = this.revisions[this.revisions.length - 1]?.id;
    const payload = JSON.stringify({
      parent_id,
      iteration: args.iteration,
      message: args.message,
      deliverable_count: args.deliverables.length,
      qc_score: args.qc_score,
      ts: Date.now(),
    });
    const hash = crypto.createHash("sha1").update(payload).digest("hex").slice(0, 12);

    const rev: Revision = {
      id: hash,
      parent_id,
      iteration: args.iteration,
      message: args.message,
      created_at: Date.now(),
      snapshot: {
        deliverables: args.deliverables,
        agent_outputs_count: 0, // populate ngoài nếu cần
        qc_score: args.qc_score,
      },
    };
    this.revisions.push(rev);
    return rev;
  }

  getRevisions(): Revision[] {
    return [...this.revisions];
  }

  /** Rollback về revision id; trả về revision hoặc null */
  rollbackTo(revisionId: string): Revision | null {
    const idx = this.revisions.findIndex((r) => r.id === revisionId);
    if (idx === -1) return null;
    // Cắt mọi revision sau idx
    this.revisions = this.revisions.slice(0, idx + 1);
    return this.revisions[idx];
  }

  /** Last good revision (qc_score ≥ 80) */
  lastGoodRevision(): Revision | null {
    for (let i = this.revisions.length - 1; i >= 0; i--) {
      if (this.revisions[i].snapshot.qc_score >= 80) return this.revisions[i];
    }
    return null;
  }
}
