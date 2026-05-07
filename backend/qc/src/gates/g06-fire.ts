/**
 * G06 — PCCC (QCVN 06:2022/BXD).
 * Phase B5. Check loi thoat hiem, khoang cach, cua chong chay, dau bao chay, sprinkler.
 */

import type { CheckItem, GateContext, GateResult } from '../types.js';
import { finalize } from './_finalize.js';

export async function runG06(ctx: GateContext): Promise<GateResult> {
  const t0 = Date.now();
  const checks: CheckItem[] = [];
  const f = ctx.design.fire;
  const l = ctx.design.layout;

  // 1. Co toi thieu 1 loi thoat hiem (nha o lien ke)
  // Voi nha cao tang (>=8 tang) — yeu cau 2 loi
  const floors = l?.num_floors ?? 0;
  const requiredExits = floors >= 8 ? 2 : 1;
  const exits = f?.num_fire_exits ?? 0;
  checks.push({
    name: `Co >= ${requiredExits} loi thoat hiem`,
    passed: exits >= requiredExits,
    actual: exits,
    expected: requiredExits,
    severity: 'critical',
    tcvn_ref: 'QCVN 06:2022 6.1',
    suggestion: exits < requiredExits ? `Bo sung ${requiredExits - exits} loi thoat hiem` : undefined,
  });

  // 2. Khoang cach den loi thoat <= 25m
  const dist = f?.exit_distance_max_m ?? 999;
  checks.push({
    name: 'Distance to exit <= 25m',
    passed: dist <= 25,
    actual: dist,
    expected: 25,
    severity: 'high',
    tcvn_ref: 'QCVN 06:2022 6.3',
    suggestion: dist > 25 ? 'Bo sung loi thoat trung gian' : undefined,
  });

  // 3. Cua chong chay >=60 phut (EI 60)
  const fpr = f?.fireproof_door_rating_min_min ?? 0;
  checks.push({
    name: 'Cua chong chay >= EI 60',
    passed: fpr >= 60,
    actual: fpr,
    expected: 60,
    severity: 'high',
    tcvn_ref: 'QCVN 06:2022 4.6',
    suggestion: fpr < 60 ? 'Doi cua chong chay EI 60+' : undefined,
  });

  // 4. Du dau bao chay
  const installed = f?.smoke_detector_count ?? 0;
  const required = f?.smoke_detector_required ?? 0;
  checks.push({
    name: 'Du dau bao chay',
    passed: required > 0 && installed >= required,
    actual: installed,
    expected: required,
    severity: 'high',
    tcvn_ref: 'QCVN 06:2022 8.4',
    suggestion: installed < required ? `Bo sung ${required - installed} dau bao chay` : undefined,
  });

  // 5. Sprinkler khi can (nha >=8 tang)
  const needs = f?.sprinkler_required ?? false;
  const has = f?.sprinkler_installed ?? false;
  checks.push({
    name: 'Sprinkler installed neu can',
    passed: !needs || has,
    actual: has,
    expected: needs ? true : 'optional',
    severity: needs ? 'critical' : 'low',
    tcvn_ref: 'QCVN 06:2022 8.7',
    suggestion: needs && !has ? 'Bat buoc lap sprinkler cho nha >=8 tang' : undefined,
  });

  // 6. Hanh lang thoat hiem >= 1.2m (nha >=4 tang)
  const corridorMin = floors >= 4 ? 1.2 : 0.9;
  const corridor = l?.corridor_width_min_m ?? 0;
  checks.push({
    name: `Hanh lang thoat >= ${corridorMin}m`,
    passed: corridor >= corridorMin,
    actual: corridor,
    expected: corridorMin,
    severity: 'high',
    tcvn_ref: 'QCVN 06:2022 6.6',
    suggestion: corridor < corridorMin ? `Mo rong hanh lang den ${corridorMin}m` : undefined,
  });

  return finalize('G06', 'PCCC (QCVN 06:2022)', 'B5', checks, t0);
}
