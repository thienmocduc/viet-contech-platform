/**
 * G07 — Nang luong (QCVN 09:2017/BXD).
 * Phase B5. Check EPI <= 120 kWh/m2/year, U-value tuong/mai, WWR.
 */

import type { CheckItem, GateContext, GateResult } from '../types.js';
import { finalize } from './_finalize.js';

const EPI_TARGET = 120; // kWh/m2/year
const U_WALL_MAX = 1.8; // W/m2.K
const U_ROOF_MAX = 1.0; // W/m2.K
const WWR_MAX_PCT = 40;

export async function runG07(ctx: GateContext): Promise<GateResult> {
  const t0 = Date.now();
  const checks: CheckItem[] = [];
  const e = ctx.design.energy;

  // 1. EPI <= 120 kWh/m2/year
  const epi = e?.epi_kwh_per_m2_year ?? 999;
  checks.push({
    name: `EPI <= ${EPI_TARGET} kWh/m2/year`,
    passed: epi <= EPI_TARGET,
    actual: epi,
    expected: EPI_TARGET,
    severity: 'high',
    tcvn_ref: 'QCVN 09:2017 5.1',
    suggestion: epi > EPI_TARGET ? 'Bo sung cach nhiet, doi den LED, kinh low-E' : undefined,
  });

  // 2. U-value tuong <= 1.8 W/m2.K
  const uw = e?.u_value_wall ?? 999;
  checks.push({
    name: `U-value tuong <= ${U_WALL_MAX}`,
    passed: uw <= U_WALL_MAX,
    actual: uw,
    expected: U_WALL_MAX,
    severity: 'medium',
    tcvn_ref: 'QCVN 09:2017 5.2',
    suggestion: uw > U_WALL_MAX ? 'Bo sung cach nhiet (XPS/EPS) tuong' : undefined,
  });

  // 3. U-value mai <= 1.0 W/m2.K
  const ur = e?.u_value_roof ?? 999;
  checks.push({
    name: `U-value mai <= ${U_ROOF_MAX}`,
    passed: ur <= U_ROOF_MAX,
    actual: ur,
    expected: U_ROOF_MAX,
    severity: 'high',
    tcvn_ref: 'QCVN 09:2017 5.2.2',
    suggestion: ur > U_ROOF_MAX ? 'Bo sung cach nhiet mai (50-80mm)' : undefined,
  });

  // 4. WWR <= 40%
  const wwr = e?.wwr_pct ?? 999;
  checks.push({
    name: `Window-to-wall ratio <= ${WWR_MAX_PCT}%`,
    passed: wwr <= WWR_MAX_PCT,
    actual: wwr,
    expected: WWR_MAX_PCT,
    severity: 'medium',
    tcvn_ref: 'QCVN 09:2017 5.3',
    suggestion: wwr > WWR_MAX_PCT ? `Giam dien tich kinh, hoac dung kinh low-E (SHGC<=0.4)` : undefined,
  });

  // 5. Co cach nhiet tuong (U <= 2.5 minimum)
  checks.push({
    name: 'Tuong co cach nhiet (U khac default)',
    passed: uw < 2.5,
    actual: uw,
    expected: '<2.5',
    severity: 'low',
    suggestion: uw >= 2.5 ? 'Bo sung lop cach nhiet toi thieu 30mm' : undefined,
  });

  // 6. Mai khong qua nong (U <= 1.5)
  checks.push({
    name: 'Mai cach nhiet (U <= 1.5)',
    passed: ur <= 1.5,
    actual: ur,
    expected: 1.5,
    severity: 'medium',
    suggestion: ur > 1.5 ? 'Boi them lop cach nhiet hoac PUF' : undefined,
  });

  return finalize('G07', 'Nang luong (QCVN 09:2017)', 'B5', checks, t0);
}
