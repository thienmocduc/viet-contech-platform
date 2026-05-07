/**
 * Helper finalize 1 gate result tu danh sach checks.
 * Score = % check pass; status = pass neu 0 fail; worst_severity = highest of fails.
 */

import type {
  CheckItem, GateCode, GateResult, Phase, Severity,
} from '../types.js';

const SEV_ORDER: Severity[] = ['critical', 'high', 'medium', 'low'];

export function finalize(
  code: GateCode,
  name: string,
  phase: Phase,
  checks: CheckItem[],
  t0: number
): GateResult {
  const failed = checks.filter((c) => !c.passed);
  const total = Math.max(1, checks.length);
  const score = Math.round(((checks.length - failed.length) / total) * 100);
  const status: GateResult['status'] = failed.length === 0 ? 'pass' : 'fail';
  const worst = failed.length === 0
    ? undefined
    : SEV_ORDER.find((s) => failed.some((c) => c.severity === s));
  const summary = failed.length === 0
    ? `${name}: PASS (${checks.length}/${checks.length} check)`
    : `${name}: FAIL ${failed.length}/${checks.length} check (worst=${worst})`;

  return {
    gate_code: code,
    gate_name: name,
    phase,
    status,
    score,
    checks,
    worst_severity: worst,
    summary,
    ran_at: new Date().toISOString(),
    duration_ms: Date.now() - t0,
  };
}
