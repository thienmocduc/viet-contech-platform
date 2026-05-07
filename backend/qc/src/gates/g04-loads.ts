/**
 * G04 — Tai trong (TCVN 2737:2020).
 * Phase B4. Check tai trong tinh, hoat tai, tai gio, tai dong dat.
 * Note: Tai trong cu the duoc dua vao structural data — gate nay cross-check.
 */

import type { CheckItem, GateContext, GateResult } from '../types.js';
import { finalize } from './_finalize.js';

const VALID_EQ_ZONES = ['I', 'II.A', 'II.B', 'III', 'IV'];

export async function runG04(ctx: GateContext): Promise<GateResult> {
  const t0 = Date.now();
  const checks: CheckItem[] = [];
  const s = ctx.design.structural;
  const l = ctx.design.layout;

  // 1. Vung dong dat phai duoc khai bao
  const eqZone = s?.earthquake_zone ?? '';
  checks.push({
    name: 'Vung dong dat khai bao',
    passed: VALID_EQ_ZONES.includes(eqZone),
    actual: eqZone || 'unknown',
    expected: VALID_EQ_ZONES.join('/'),
    severity: 'critical',
    tcvn_ref: 'TCVN 9386:2012',
    suggestion: 'Phai khai bao zone dong dat truoc tinh ket cau',
  });

  // 2. Hoat tai san phong o (TCVN 2737:2020 — 1.5 kN/m2)
  // (gan-gia tu min beam — neu beam qua nho thi co the chua chiu du tai)
  const beam = s?.smallest_beam_mm;
  const beamArea = beam ? beam.w * beam.h : 0;
  checks.push({
    name: 'Tiet dien dam du chiu hoat tai 1.5 kN/m2',
    passed: beamArea >= 200 * 300,
    actual: beamArea,
    expected: '>= 60000 mm2 (200x300)',
    severity: 'high',
    tcvn_ref: 'TCVN 2737:2020 5.2',
    suggestion: 'Tang tiet dien dam de chiu tai',
  });

  // 3. Tai gio: chieu cao <= 21m thi tai gio Cap I-II
  const h = l?.building_height_m ?? 0;
  checks.push({
    name: 'Tai gio phu hop chieu cao',
    passed: h <= 21,
    actual: h,
    expected: '<=21m',
    severity: 'high',
    tcvn_ref: 'TCVN 2737:2020 7.4',
    suggestion: h > 21 ? 'Bo sung tinh tai gio dong (cap III+)' : undefined,
  });

  // 4. Tai trong tinh: san day chiu tai
  const slab = s?.slab_thickness_mm ?? 0;
  checks.push({
    name: 'San day >= 100mm chiu tinh tai',
    passed: slab >= 100,
    actual: slab,
    expected: 100,
    severity: 'high',
    tcvn_ref: 'TCVN 2737:2020 5.1',
    suggestion: slab < 100 ? 'Tang san den >=100mm' : undefined,
  });

  // 5. So tang phu hop voi nen mong (gia: <=4 tang khong can coc)
  const floors = l?.num_floors ?? 0;
  const noFoundationConstraint = floors <= 4;
  checks.push({
    name: 'So tang vs nen mong',
    passed: floors > 0 && (noFoundationConstraint || floors <= 6),
    actual: floors,
    expected: '<=6 tang neu khong coc',
    severity: 'medium',
    tcvn_ref: 'TCVN 2737:2020 7.2',
    suggestion: floors > 4 ? 'Yeu cau tinh coc khoan nhoi' : undefined,
  });

  // 6. Cot toi thieu chiu tai trong tap trung
  const col = s?.smallest_column_mm;
  const colArea = col ? col.w * col.h : 0;
  checks.push({
    name: 'Tiet dien cot >= 200x200 chiu tai',
    passed: colArea >= 200 * 200,
    actual: colArea,
    expected: '>=40000 mm2',
    severity: 'critical',
    tcvn_ref: 'TCVN 2737:2020 + TCVN 5574',
    suggestion: 'Tang tiet dien cot',
  });

  return finalize('G04', 'Tai trong (TCVN 2737:2020)', 'B4', checks, t0);
}
