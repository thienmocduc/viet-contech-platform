/**
 * G03 — Ket cau BTCT (TCVN 5574:2018).
 * Phase B4. Check be tong, cot/dam min, ti le cot thep, do vong.
 */

import type { CheckItem, GateContext, GateResult } from '../types.js';
import { finalize } from './_finalize.js';

const ALLOWED_CONCRETE = ['B15', 'B20', 'B22.5', 'B25', 'B30', 'B35', 'B40'];
const ALLOWED_REBAR = ['CB240-T', 'CB300-V', 'CB400-V', 'CB500-V'];

export async function runG03(ctx: GateContext): Promise<GateResult> {
  const t0 = Date.now();
  const checks: CheckItem[] = [];
  const s = ctx.design.structural;

  // 1. Be tong B20 tro len cho nha o
  checks.push({
    name: 'Cap be tong >= B20',
    passed: !!s && ALLOWED_CONCRETE.indexOf(s.concrete_grade) >= 1,
    actual: s?.concrete_grade ?? 'unknown',
    expected: 'B20+',
    severity: 'high',
    tcvn_ref: 'TCVN 5574:2018 6.1.2',
    suggestion: 'Nang cap be tong toi thieu B20',
  });

  // 2. Cot thep CB300+
  checks.push({
    name: 'Cot thep CB300-V tro len',
    passed: !!s && ALLOWED_REBAR.indexOf(s.rebar_grade) >= 1,
    actual: s?.rebar_grade ?? 'unknown',
    expected: 'CB300-V+',
    severity: 'high',
    tcvn_ref: 'TCVN 5574:2018 6.2.5',
    suggestion: 'Doi cot thep len CB300-V/CB400-V',
  });

  // 3. Cot toi thieu 200x200mm
  const minCol = s?.smallest_column_mm;
  const colOk = !!minCol && minCol.w >= 200 && minCol.h >= 200;
  checks.push({
    name: 'Cot >= 200x200mm',
    passed: colOk,
    actual: minCol ? `${minCol.w}x${minCol.h}` : 'none',
    expected: '>=200x200',
    severity: 'critical',
    tcvn_ref: 'TCVN 5574:2018 7.1.4',
    suggestion: !colOk ? 'Tang tiet dien cot toi thieu 200x200mm' : undefined,
  });

  // 4. Dam toi thieu 200x300mm
  const minBeam = s?.smallest_beam_mm;
  const beamOk = !!minBeam && minBeam.w >= 200 && minBeam.h >= 300;
  checks.push({
    name: 'Dam >= 200x300mm',
    passed: beamOk,
    actual: minBeam ? `${minBeam.w}x${minBeam.h}` : 'none',
    expected: '>=200x300',
    severity: 'critical',
    tcvn_ref: 'TCVN 5574:2018 7.2.3',
    suggestion: !beamOk ? 'Tang tiet dien dam toi thieu 200x300mm' : undefined,
  });

  // 5. San day >= 100mm
  const slab = s?.slab_thickness_mm ?? 0;
  checks.push({
    name: 'San day >= 100mm',
    passed: slab >= 100,
    actual: slab,
    expected: 100,
    severity: 'high',
    tcvn_ref: 'TCVN 5574:2018 7.3.1',
    suggestion: slab < 100 ? `Tang san den ${100 - slab}mm` : undefined,
  });

  // 6. Ti le cot thep min >= 0.4%
  const ratio = s?.rebar_ratio_min ?? 0;
  checks.push({
    name: 'Ti le cot thep min >= 0.4%',
    passed: ratio >= 0.4,
    actual: ratio,
    expected: 0.4,
    severity: 'high',
    tcvn_ref: 'TCVN 5574:2018 8.3.5',
    suggestion: ratio < 0.4 ? 'Tang so cay thep doc' : undefined,
  });

  // 7. Do vong dam <= L/250
  const defl = s?.deflection_ratio_max ?? 999;
  checks.push({
    name: 'Do vong <= L/250',
    passed: defl <= 1 / 250,
    actual: defl.toFixed(5),
    expected: `<=${(1 / 250).toFixed(5)}`,
    severity: 'high',
    tcvn_ref: 'TCVN 5574:2018 9.4.2',
    suggestion: defl > 1 / 250 ? 'Tang tiet dien dam hoac giam khau do' : undefined,
  });

  return finalize('G03', 'Ket cau BTCT (TCVN 5574:2018)', 'B4', checks, t0);
}
