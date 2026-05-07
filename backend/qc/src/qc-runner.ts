/**
 * QCRunner — chay tat ca 12 gate cho 1 revision.
 *
 * Flow:
 *  for each gate:
 *    1. TMR vote (3 voter parallel)
 *    2. gate.run() -> result
 *    3. neu fail + gate.auto_fixable -> AutoFixer.apply -> re-run gate (1 lan)
 *    4. EscalationEngine.buildAction -> notify
 *    5. neu critical/high -> stop pipeline (configurable)
 *
 * Tat ca run audit -> ctx.audit() -> append-only audit_log
 */

import { AutoFixer } from './auto-fix.js';
import { EscalationEngine } from './escalation.js';
import { GATE_RUNNERS, QC_GATES } from './gates/index.js';
import { TMRVote, bootstrapDefaultVoters } from './voting.js';
import type {
  AuditEntry, EscalationAction, GateContext, GateResult, QCGate, QCReport,
} from './types.js';

export interface QCRunnerOptions {
  stop_on_critical?: boolean;
  stop_on_high?: boolean;
  audit?: (entry: AuditEntry) => void;
}

export class QCRunner {
  private autoFixer = new AutoFixer();
  private escalation = new EscalationEngine();
  private bootstrapped = false;

  constructor(private readonly opts: QCRunnerOptions = {}) {}

  private ensureBootstrap(): void {
    if (this.bootstrapped) return;
    bootstrapDefaultVoters(GATE_RUNNERS);
    this.bootstrapped = true;
  }

  async runAll(ctx: GateContext): Promise<QCReport> {
    this.ensureBootstrap();
    const t0 = Date.now();
    const results: GateResult[] = [];
    const escalations: EscalationAction[] = [];

    let stopped = false;

    for (const gate of QC_GATES) {
      if (stopped) {
        // Skip — neu pipeline da stop
        continue;
      }
      const r = await this.runOne(gate, ctx);
      results.push(r);

      const act = this.escalation.buildAction(r);
      escalations.push(act);
      this.escalation.notify(act);

      // Audit
      ctx.audit?.({
        action: 'qc.gate.completed',
        actor: 'qc.runner',
        target_type: 'gate',
        target_id: r.gate_code,
        after: { status: r.status, score: r.score },
      });

      if (this.opts.stop_on_critical !== false && act.level === 'critical') {
        stopped = true;
      } else if (this.opts.stop_on_high && act.level === 'block') {
        stopped = true;
      }
    }

    const passed = results.filter((r) => r.status === 'pass').length;
    const auto_fixed = results.filter((r) => r.status === 'auto_fixed').length;
    const failed = results.filter((r) => r.status === 'fail').length;
    const warnings = results.filter((r) => r.status === 'warn').length;
    const completed = passed + auto_fixed + failed + warnings;
    const totalScore = completed > 0
      ? Math.round(results.reduce((s, r) => s + r.score, 0) / completed)
      : 0;

    let overall: QCReport['overall'];
    if (failed === 0 && completed === QC_GATES.length) overall = 'PASS';
    else if (failed > 0 && passed + auto_fixed >= 8) overall = 'PARTIAL';
    else overall = 'FAIL';

    return {
      project_id: ctx.project_id,
      revision_id: ctx.revision_id,
      overall,
      total_gates: QC_GATES.length,
      passed,
      failed,
      auto_fixed,
      warnings,
      total_score: totalScore,
      results,
      escalations,
      ran_at: new Date().toISOString(),
      duration_ms: Date.now() - t0,
    };
  }

  /**
   * Run 1 gate — TMR vote + check + auto-fix re-run + final result.
   */
  async runOne(gate: QCGate, ctx: GateContext): Promise<GateResult> {
    this.ensureBootstrap();

    // Buoc 1: TMR vote
    const tmr = new TMRVote(gate.voters);
    const vote = await tmr.vote(gate.code, ctx);

    // Buoc 2: chay gate.run() de lay check chi tiet
    let result = await gate.run(ctx);
    result.vote = vote;

    // Buoc 3: neu fail + auto_fixable -> auto-fix + re-run 1 lan
    if (result.status === 'fail' && gate.auto_fixable) {
      const fix = await this.autoFixer.apply(result, ctx);
      if (fix.applied.length > 0) {
        // Re-run gate
        const reRun = await gate.run(ctx);
        // Re-vote ngan gon (khong loop vo han)
        reRun.vote = await tmr.vote(gate.code, ctx);
        reRun.auto_fix_applied = true;
        reRun.auto_fixes = fix.applied;
        if (reRun.status === 'pass') {
          reRun.status = 'auto_fixed';
          reRun.summary = `${gate.name}: AUTO-FIXED (${fix.applied.length} pattern). ${reRun.summary}`;
        }
        result = reRun;
      }
    }

    // Buoc 4: neu pass nhung TMR voting tie/fail majority -> downgrade warn
    if (result.status === 'pass' && (vote.majority === 'fail' || vote.majority === 'tie')) {
      result.status = 'warn';
      result.summary = `${gate.name}: TMR khong nhat tri (${vote.majority}, conf=${vote.confidence}). ${result.summary}`;
    }

    return result;
  }
}
