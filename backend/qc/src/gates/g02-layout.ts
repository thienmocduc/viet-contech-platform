/**
 * G02 — Layout & Quy hoach.
 * Phase B3. Check mat do, lui mat tiend, chieu cao, phong dien tich min, hanh lang.
 * Refer: QCXDVN 01:2021/BXD, TCVN 4451:2012.
 */

import type { CheckItem, GateContext, GateResult } from '../types.js';
import { finalize } from './_finalize.js';

export async function runG02(ctx: GateContext): Promise<GateResult> {
  const t0 = Date.now();
  const checks: CheckItem[] = [];
  const l = ctx.design.layout;

  // 1. Mat do xay dung <= 80%
  checks.push({
    name: 'Mat do xay dung <= 80%',
    passed: !!l && l.density_pct <= 80,
    actual: l?.density_pct ?? 0,
    expected: '<=80',
    severity: 'high',
    tcvn_ref: 'QCXDVN 01:2021',
    suggestion: 'Giam dien tich san phu hop voi quy chuan',
  });

  // 2. Lui mat tien (front setback) >= 1.5m
  const front = l?.setback_front_m ?? 0;
  checks.push({
    name: 'Lui mat tien >= 1.5m',
    passed: front >= 1.5,
    actual: front,
    expected: 1.5,
    severity: 'medium',
    tcvn_ref: 'QCXDVN 01:2021',
    suggestion: front < 1.5 ? `Tang lui them ${(1.5 - front).toFixed(2)}m` : undefined,
  });

  // 3. Lui mat sau >= 2m (cho thong gio)
  const back = l?.setback_back_m ?? 0;
  checks.push({
    name: 'Lui mat sau >= 2m',
    passed: back >= 2.0,
    actual: back,
    expected: 2.0,
    severity: 'medium',
    suggestion: back < 2.0 ? `Tang lui sau them ${(2.0 - back).toFixed(2)}m` : undefined,
  });

  // 4. Chieu cao <= 21m (max nha o lien ke khu pho)
  const h = l?.building_height_m ?? 0;
  checks.push({
    name: 'Chieu cao <= 21m',
    passed: h <= 21,
    actual: h,
    expected: '<=21m',
    severity: 'high',
    tcvn_ref: 'QCXDVN 01:2021',
    suggestion: h > 21 ? 'Giam tang hoac giam chieu cao trang phong' : undefined,
  });

  // 5. Hanh lang >= 0.9m
  const corridor = l?.corridor_width_min_m ?? 0;
  checks.push({
    name: 'Hanh lang >= 0.9m',
    passed: corridor >= 0.9,
    actual: corridor,
    expected: 0.9,
    severity: 'medium',
    tcvn_ref: 'TCVN 4451:2012',
    suggestion: corridor < 0.9 ? 'Mo rong hanh lang' : undefined,
  });

  // 6. Zoning compliance
  checks.push({
    name: 'Phu hop quy hoach phan khu',
    passed: !!l?.zoning_compliance,
    actual: l?.zoning_compliance ?? false,
    expected: true,
    severity: 'critical',
    tcvn_ref: 'Quy hoach phan khu',
    suggestion: 'Kiem tra giay phep quy hoach voi UBND xa/phuong',
  });

  // 7. Tat ca phong dat dien tich min
  const rooms = l?.rooms ?? [];
  const undersized = rooms.filter((r) => r.area_m2 < r.min_required_m2);
  checks.push({
    name: 'Phong dat dien tich min TCVN 4451',
    passed: undersized.length === 0,
    actual: `${rooms.length - undersized.length}/${rooms.length}`,
    expected: 'tat ca phong dat min',
    severity: 'high',
    tcvn_ref: 'TCVN 4451:2012',
    suggestion: undersized.length > 0
      ? `Mo rong: ${undersized.slice(0, 3).map((r) => r.name).join(', ')}`
      : undefined,
  });

  return finalize('G02', 'Layout & Quy hoach', 'B3', checks, t0);
}
