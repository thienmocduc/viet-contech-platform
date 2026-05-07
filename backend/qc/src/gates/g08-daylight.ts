/**
 * G08 — Daylight + Acoustic.
 * Phase B5. Check daylight factor min trong phong o, acoustic STC tuong, IIC san.
 */

import type { CheckItem, GateContext, GateResult } from '../types.js';
import { finalize } from './_finalize.js';

const AVG_DF_MIN = 2.0;   // %
const MIN_DF_MIN = 1.0;   // %
const STC_MIN = 50;       // dB
const IIC_MIN = 50;       // dB

export async function runG08(ctx: GateContext): Promise<GateResult> {
  const t0 = Date.now();
  const checks: CheckItem[] = [];
  const d = ctx.design.daylight;
  const a = ctx.design.acoustic;

  // 1. Avg daylight factor >= 2%
  const avgDf = d?.avg_df_pct ?? 0;
  checks.push({
    name: `Avg DF >= ${AVG_DF_MIN}%`,
    passed: avgDf >= AVG_DF_MIN,
    actual: avgDf,
    expected: AVG_DF_MIN,
    severity: 'medium',
    tcvn_ref: 'TCVN 4451:2012',
    suggestion: avgDf < AVG_DF_MIN ? 'Mo rong cua so / lay sang giua' : undefined,
  });

  // 2. Min DF (phong toi nhat) >= 1%
  const minDf = d?.min_df_pct ?? 0;
  checks.push({
    name: `Min DF >= ${MIN_DF_MIN}% (phong toi nhat)`,
    passed: minDf >= MIN_DF_MIN,
    actual: minDf,
    expected: MIN_DF_MIN,
    severity: 'high',
    tcvn_ref: 'TCVN 4451:2012',
    suggestion: minDf < MIN_DF_MIN ? 'Bo sung gieng troi / cua nho cho phong tham' : undefined,
  });

  // 3. STC tuong >= 50 dB (giua phong o)
  const stc = a?.wall_stc_db ?? 0;
  checks.push({
    name: `STC tuong >= ${STC_MIN} dB`,
    passed: stc >= STC_MIN,
    actual: stc,
    expected: STC_MIN,
    severity: 'medium',
    tcvn_ref: 'TCVN 7878:2018',
    suggestion: stc < STC_MIN ? 'Tuong dau >=200mm + cach am' : undefined,
  });

  // 4. IIC san >= 50 dB (chong va dam)
  const iic = a?.floor_iic_db ?? 0;
  checks.push({
    name: `IIC san >= ${IIC_MIN} dB`,
    passed: iic >= IIC_MIN,
    actual: iic,
    expected: IIC_MIN,
    severity: 'medium',
    tcvn_ref: 'TCVN 7878:2018',
    suggestion: iic < IIC_MIN ? 'Lot floating floor / cao su' : undefined,
  });

  // 5. WWR khong qua thap (>=15% de co anh sang)
  const wwr = ctx.design.energy?.wwr_pct ?? 0;
  checks.push({
    name: 'WWR >= 15% (du anh sang)',
    passed: wwr >= 15,
    actual: wwr,
    expected: 15,
    severity: 'low',
    suggestion: wwr < 15 ? 'Tang dien tich kinh' : undefined,
  });

  // 6. Phong khach co cua so (giam thoi quen kin tu nhien)
  const hasLivingDaylight = avgDf >= 2.5;
  checks.push({
    name: 'Phong khach co lay sang tu nhien (DF >= 2.5%)',
    passed: hasLivingDaylight,
    actual: avgDf,
    expected: 2.5,
    severity: 'low',
    suggestion: !hasLivingDaylight ? 'Bo sung cua so phia phong khach' : undefined,
  });

  return finalize('G08', 'Daylight + Acoustic', 'B5', checks, t0);
}
