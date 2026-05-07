/**
 * TMR Voter (Triple Modular Redundancy).
 * 3 voter chay song song qua Promise.all, majority 2/3 quyet dinh.
 *
 * Voter strategies (cho moi gate):
 *  - v1: chuan (default rule chinh)
 *  - v2_alt: variant (relaxed hoac aggressive)
 *  - strict: chi check theo TCVN, khong nhan nhuong
 *
 * Confidence:
 *  - 3 vote pass / 3 fail -> high
 *  - 2 vote dong y         -> medium
 *  - 1+ abstain or split   -> low
 */

import type {
  GateCode, GateContext, GateResult, SingleVote, VoteResult,
  VoterConfig, VoterFn,
} from './types.js';

// ============================================================
// Voter Pool — registry global
// ============================================================
const VOTER_POOL = new Map<string, VoterConfig>();

export function registerVoter(cfg: VoterConfig): void {
  VOTER_POOL.set(cfg.id, cfg);
}

export function getVoter(id: string): VoterConfig | undefined {
  return VOTER_POOL.get(id);
}

// ============================================================
// TMR Vote class
// ============================================================
export class TMRVote {
  constructor(private readonly voter_ids: string[]) {
    if (voter_ids.length !== 3) {
      throw new Error(`TMR yeu cau dung 3 voter, got ${voter_ids.length}`);
    }
  }

  async vote(gate_code: GateCode, ctx: GateContext): Promise<VoteResult> {
    const t0 = Date.now();
    // Run 3 voter PARALLEL
    const votes: SingleVote[] = await Promise.all(
      this.voter_ids.map(async (vid): Promise<SingleVote> => {
        const v = VOTER_POOL.get(vid);
        if (!v) {
          return {
            voter_id: vid,
            voter_label: 'unknown',
            status: 'abstain',
            reason: `voter ${vid} chua dang ky`,
            score: 0,
            duration_ms: 0,
          };
        }
        try {
          return await v.fn(gate_code, ctx);
        } catch (err: unknown) {
          return {
            voter_id: vid,
            voter_label: v.label,
            status: 'abstain',
            reason: `loi voter: ${(err as Error).message ?? String(err)}`,
            score: 0,
            duration_ms: 0,
          };
        }
      })
    );

    const passed = votes.filter((v) => v.status === 'pass').length;
    const failed = votes.filter((v) => v.status === 'fail').length;
    const abstained = votes.filter((v) => v.status === 'abstain').length;

    let majority: VoteResult['majority'];
    if (passed >= 2) majority = 'pass';
    else if (failed >= 2) majority = 'fail';
    else majority = 'tie';

    let confidence: VoteResult['confidence'];
    if (abstained === 0 && (passed === 3 || failed === 3)) confidence = 'high';
    else if (abstained === 0 && (passed === 2 || failed === 2)) confidence = 'medium';
    else confidence = 'low';

    const dissent_reasons = votes
      .filter((v) => v.status === 'fail')
      .map((v) => `[${v.voter_label}] ${v.reason}`);

    return {
      gate_code,
      votes,
      majority,
      confidence,
      dissent_reasons,
      duration_ms: Date.now() - t0,
    };
  }
}

// ============================================================
// Default voter strategies — wrap gate.run + bias score
// ============================================================
function makeVoter(
  id: string,
  label: string,
  bias: 'default' | 'lenient' | 'strict',
  runner: (ctx: GateContext) => Promise<GateResult>
): VoterFn {
  return async (gate_code, ctx): Promise<SingleVote> => {
    const t0 = Date.now();
    const r = await runner(ctx);
    let pass: boolean;
    let score = r.score;
    let reason = r.summary;

    if (bias === 'default') {
      pass = r.status === 'pass';
    } else if (bias === 'lenient') {
      // Cho qua neu chi co fail medium/low
      const hasHigh = r.checks.some((c) => !c.passed && (c.severity === 'critical' || c.severity === 'high'));
      pass = !hasHigh;
      if (pass && r.status !== 'pass') {
        score = Math.max(70, r.score);
        reason = `Lenient: bo qua warn medium/low. Score=${score}`;
      }
    } else {
      // strict: yeu cau 100% pass + score >= 90
      pass = r.status === 'pass' && r.score >= 90;
      if (!pass) {
        const failedHigh = r.checks
          .filter((c) => !c.passed)
          .map((c) => `${c.name} (${c.severity})`)
          .slice(0, 3)
          .join('; ');
        reason = `Strict TCVN: ${failedHigh || 'score < 90'}`;
      }
    }
    return {
      voter_id: id,
      voter_label: label,
      status: pass ? 'pass' : 'fail',
      reason,
      score,
      duration_ms: Date.now() - t0,
    };
  };
}

// ============================================================
// Bootstrap default voters cho 12 gate (3 voter / gate = 36 voter)
// ============================================================
export function bootstrapDefaultVoters(
  runners: Record<GateCode, (ctx: GateContext) => Promise<GateResult>>
): void {
  const codes: GateCode[] = ['G01','G02','G03','G04','G05','G06','G07','G08','G09','G10','G11','G12'];
  const variants: { id: string; label: string; bias: 'default' | 'lenient' | 'strict' }[][] = codes.map(
    (code) => [
      { id: `${code.toLowerCase()}_v1`, label: `${code}-default`, bias: 'default' },
      { id: `${code.toLowerCase()}_v2_alt`, label: `${code}-alt`, bias: 'lenient' },
      { id: `${code.toLowerCase()}_strict`, label: `${code}-strict`, bias: 'strict' },
    ]
  );

  codes.forEach((code, i) => {
    const setOf = variants[i];
    if (!setOf) return;
    const runner = runners[code];
    if (!runner) return;
    setOf.forEach((v) => {
      registerVoter({
        id: v.id,
        label: v.label,
        fn: makeVoter(v.id, v.label, v.bias, runner),
      });
    });
  });
}

// Cho phep test pool
export function clearVoterPool(): void {
  VOTER_POOL.clear();
}

export function listVoters(): string[] {
  return Array.from(VOTER_POOL.keys()).sort();
}
