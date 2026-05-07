/**
 * G10 — BOQ + Ngan sach (+/- 5%).
 * Phase B7. Check tong gia, sai lech ngan sach, % BOQ tu DXF, do moi don gia.
 */

import type { CheckItem, GateContext, GateResult } from '../types.js';
import { finalize } from './_finalize.js';

const VAR_THRESHOLD_PCT = 5;
const PRICE_AGE_MAX_DAYS = 90;
const MIN_PCT_FROM_DXF = 95;

export async function runG10(ctx: GateContext): Promise<GateResult> {
  const t0 = Date.now();
  const checks: CheckItem[] = [];
  const b = ctx.design.boq;

  // 1. Sai lech ngan sach <= 5%
  const v = Math.abs(b?.variance_pct ?? 999);
  checks.push({
    name: `Variance vs budget <= ${VAR_THRESHOLD_PCT}%`,
    passed: v <= VAR_THRESHOLD_PCT,
    actual: v,
    expected: VAR_THRESHOLD_PCT,
    severity: 'high',
    suggestion: v > VAR_THRESHOLD_PCT ? 'Auto-down-spec / cat scope' : undefined,
  });

  // 2. >= 95% items boc tu DXF (khong nhap tay)
  const pct = b?.pct_from_dxf ?? 0;
  checks.push({
    name: `>= ${MIN_PCT_FROM_DXF}% boc tu DXF geometry`,
    passed: pct >= MIN_PCT_FROM_DXF,
    actual: pct,
    expected: MIN_PCT_FROM_DXF,
    severity: 'high',
    suggestion: pct < MIN_PCT_FROM_DXF ? 'Re-run agent boq_extractor tu DXF' : undefined,
  });

  // 3. Don gia khong qua 90 ngay
  const age = b?.unit_price_age_days_max ?? 999;
  checks.push({
    name: `Don gia <= ${PRICE_AGE_MAX_DAYS} ngay`,
    passed: age <= PRICE_AGE_MAX_DAYS,
    actual: age,
    expected: PRICE_AGE_MAX_DAYS,
    severity: 'medium',
    suggestion: age > PRICE_AGE_MAX_DAYS ? 'Cap nhat materials.last_updated_quarter' : undefined,
  });

  // 4. Co BOQ items
  const cnt = b?.items_count ?? 0;
  checks.push({
    name: 'BOQ co items >= 50',
    passed: cnt >= 50,
    actual: cnt,
    expected: 50,
    severity: 'high',
    suggestion: cnt < 50 ? 'BOQ chua du chi tiet — re-run boq_extractor' : undefined,
  });

  // 5. Tong > 0
  const total = b?.total_vnd ?? 0;
  checks.push({
    name: 'Tong BOQ > 0',
    passed: total > 0,
    actual: total,
    expected: '> 0',
    severity: 'critical',
    suggestion: total === 0 ? 'BOQ rong — chay lai pipeline' : undefined,
  });

  // 6. Budget khai bao > 0
  const budget = b?.budget_vnd ?? 0;
  checks.push({
    name: 'Budget khai bao > 0',
    passed: budget > 0,
    actual: budget,
    expected: '> 0',
    severity: 'high',
    suggestion: budget === 0 ? 'Lay budget tu brief' : undefined,
  });

  return finalize('G10', 'BOQ + Ngan sach (+/-5%)', 'B7', checks, t0);
}
