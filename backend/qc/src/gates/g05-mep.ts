/**
 * G05 — MEP routing khong clash.
 * Phase B5. Check tai trong dien VA/m2, do doc thoat nuoc, HVAC, ductline gap, truc dung.
 */

import type { CheckItem, GateContext, GateResult } from '../types.js';
import { finalize } from './_finalize.js';

export async function runG05(ctx: GateContext): Promise<GateResult> {
  const t0 = Date.now();
  const checks: CheckItem[] = [];
  const m = ctx.design.mep;

  // 1. Tai dien VA/m2 nam trong khoang 70-100
  const va = m?.electrical_load_va_per_m2 ?? 0;
  checks.push({
    name: 'Tai dien VA/m2 trong [70,100]',
    passed: va >= 70 && va <= 100,
    actual: va,
    expected: '70..100',
    severity: 'medium',
    tcvn_ref: 'TCVN 7447',
    suggestion: va < 70 ? 'Bo sung tai trong dien' : va > 100 ? 'Phan tai cho nhieu nhanh' : undefined,
  });

  // 2. Thoat nuoc do doc >= 1%
  const slope = m?.drain_slope_pct ?? 0;
  checks.push({
    name: 'Do doc thoat nuoc >= 1%',
    passed: slope >= 1.0,
    actual: slope,
    expected: 1.0,
    severity: 'high',
    tcvn_ref: 'TCVN 4513:1988',
    suggestion: slope < 1.0 ? `Tang do doc them ${(1.0 - slope).toFixed(2)}%` : undefined,
  });

  // 3. HVAC capacity (>=400 Btu/m2 cho VN)
  const btu = m?.hvac_btu_per_m2 ?? 0;
  checks.push({
    name: 'HVAC >= 400 Btu/m2',
    passed: btu >= 400,
    actual: btu,
    expected: 400,
    severity: 'medium',
    suggestion: btu < 400 ? 'Tang cap may lanh' : undefined,
  });

  // 4. Hard clash = 0
  const hard = m?.hard_clashes ?? 0;
  checks.push({
    name: 'Hard clash = 0',
    passed: hard === 0,
    actual: hard,
    expected: 0,
    severity: 'critical',
    suggestion: hard > 0 ? `Sua ${hard} clash truoc khi qua phase ke` : undefined,
  });

  // 5. Soft clash <= 5 (nho nhung deu khong duoc nhieu)
  const soft = m?.soft_clashes ?? 0;
  checks.push({
    name: 'Soft clash <= 5',
    passed: soft <= 5,
    actual: soft,
    expected: '<=5',
    severity: 'medium',
    suggestion: soft > 5 ? 'Re-route MEP, dich line >=50mm' : undefined,
  });

  // 6. Khoang cach duct vs cable >= 50mm (cach nhiet)
  const gap = m?.duct_cable_min_gap_mm ?? 0;
  checks.push({
    name: 'Gap duct/cable >= 50mm',
    passed: gap >= 50,
    actual: gap,
    expected: 50,
    severity: 'high',
    tcvn_ref: 'TCVN 9385',
    suggestion: gap < 50 ? `Dich line them ${50 - gap}mm` : undefined,
  });

  // 7. Co truc dung (shaft) >=1 cho moi 200m2
  const shafts = m?.vertical_shaft_count ?? 0;
  checks.push({
    name: 'Co truc dung shaft',
    passed: shafts >= 1,
    actual: shafts,
    expected: '>=1',
    severity: 'high',
    suggestion: 'Bo sung truc dung tap trung MEP',
  });

  return finalize('G05', 'MEP routing khong clash', 'B5', checks, t0);
}
