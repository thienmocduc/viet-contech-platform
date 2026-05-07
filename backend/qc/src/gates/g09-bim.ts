/**
 * G09 — BIM clash detection.
 * Phase B5. Check tat ca element xuat ra IFC, hard clash = 0, soft clash <= 5.
 */

import type { CheckItem, GateContext, GateResult } from '../types.js';
import { finalize } from './_finalize.js';

const MIN_ELEMENTS = 100;
const MAX_HARD = 0;
const MAX_SOFT = 5;

export async function runG09(ctx: GateContext): Promise<GateResult> {
  const t0 = Date.now();
  const checks: CheckItem[] = [];
  const b = ctx.design.bim;

  // 1. So element BIM >= 100 (mot du an du chi tiet)
  const total = b?.total_elements ?? 0;
  checks.push({
    name: `Total BIM elements >= ${MIN_ELEMENTS}`,
    passed: total >= MIN_ELEMENTS,
    actual: total,
    expected: MIN_ELEMENTS,
    severity: 'medium',
    suggestion: total < MIN_ELEMENTS ? 'BIM con thieu chi tiet — chay agent bim_modeler them' : undefined,
  });

  // 2. Hard clash = 0
  const hard = b?.hard_clashes ?? 0;
  checks.push({
    name: 'BIM hard clash = 0',
    passed: hard === MAX_HARD,
    actual: hard,
    expected: MAX_HARD,
    severity: 'critical',
    suggestion: hard > 0 ? `Sua ${hard} hard clash truoc khi xuat ban ve` : undefined,
  });

  // 3. Soft clash <= 5
  const soft = b?.soft_clashes ?? 0;
  checks.push({
    name: `BIM soft clash <= ${MAX_SOFT}`,
    passed: soft <= MAX_SOFT,
    actual: soft,
    expected: MAX_SOFT,
    severity: 'medium',
    suggestion: soft > MAX_SOFT ? `Auto-shift line de fix soft clash` : undefined,
  });

  // 4. Xuat IFC OK
  checks.push({
    name: 'IFC export OK',
    passed: !!b?.ifc_export_ok,
    actual: b?.ifc_export_ok ?? false,
    expected: true,
    severity: 'high',
    suggestion: !b?.ifc_export_ok ? 'Re-export IFC; check loi schema' : undefined,
  });

  // 5. Cross-check: MEP soft clash khop voi BIM
  const mepSoft = ctx.design.mep?.soft_clashes ?? 0;
  checks.push({
    name: 'MEP soft clash khop BIM soft clash',
    passed: Math.abs((soft) - mepSoft) <= 2,
    actual: `BIM=${soft}, MEP=${mepSoft}`,
    expected: 'sai lech <=2',
    severity: 'low',
    suggestion: Math.abs(soft - mepSoft) > 2 ? 'Re-run clash detection tren BIM moi' : undefined,
  });

  // 6. Cross-check: MEP hard clash khop BIM hard clash
  const mepHard = ctx.design.mep?.hard_clashes ?? 0;
  checks.push({
    name: 'MEP hard clash khop BIM hard clash',
    passed: hard === mepHard,
    actual: `BIM=${hard}, MEP=${mepHard}`,
    expected: '0/0',
    severity: 'high',
    suggestion: hard !== mepHard ? 'Sync MEP voi BIM lai' : undefined,
  });

  return finalize('G09', 'BIM clash detection', 'B5', checks, t0);
}
