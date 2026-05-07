/**
 * G01 — Brief & Phong Thuy compliance.
 * Phase B1. Check brief day du + cung menh + PT score >= 70 + huong tot.
 */

import type { CheckItem, GateContext, GateResult } from '../types.js';
import { finalize } from './_finalize.js';

const REQUIRED_BRIEF_FIELDS = [
  'full_name', 'phone', 'year_born', 'gender',
  'lot_width_m', 'lot_depth_m', 'direction',
  'budget_vnd', 'family_size', 'num_floors',
  'lifestyle', 'address', 'goal',
];

const PT_THRESHOLD = 70;

export async function runG01(ctx: GateContext): Promise<GateResult> {
  const t0 = Date.now();
  const checks: CheckItem[] = [];
  const brief = ctx.design.brief;
  const pt = ctx.design.phongthuy;

  const filled = new Set(brief?.filled_fields ?? []);
  const missing = REQUIRED_BRIEF_FIELDS.filter((f) => !filled.has(f));
  checks.push({
    name: 'Brief 13 truong day du',
    passed: missing.length === 0,
    actual: filled.size,
    expected: REQUIRED_BRIEF_FIELDS.length,
    severity: 'high',
    suggestion: missing.length > 0
      ? `Bo sung field: ${missing.slice(0, 5).join(', ')}`
      : undefined,
  });

  const yob = brief?.client_year_born ?? null;
  checks.push({
    name: 'Year born trong khoang 1900-2030',
    passed: yob !== null && yob >= 1900 && yob <= 2030,
    actual: yob,
    expected: '1900..2030',
    severity: 'high',
    suggestion: 'Yeu cau khach cung cap nam sinh chinh xac',
  });

  checks.push({
    name: 'Cung menh tinh tu Bat Trach',
    passed: !!brief?.cung_menh,
    actual: brief?.cung_menh ?? null,
    expected: 'Duong/Am cung',
    severity: 'medium',
    tcvn_ref: 'Phong thuy Bat Trach',
    suggestion: 'Chay agent brief_analyst de tinh cung menh',
  });

  const ptScore = pt?.score ?? 0;
  checks.push({
    name: 'PT score >= 70/100',
    passed: ptScore >= PT_THRESHOLD,
    actual: ptScore,
    expected: PT_THRESHOLD,
    severity: 'high',
    suggestion: ptScore < PT_THRESHOLD
      ? 'Sua huong chinh / vi tri bep / phong ngu de tang score'
      : undefined,
  });

  const inGood = !!(pt && pt.good_directions.includes(pt.main_door_direction));
  checks.push({
    name: 'Huong cua chinh trong 4 huong tot',
    passed: inGood,
    actual: pt?.main_door_direction ?? null,
    expected: pt?.good_directions?.join('/') ?? '4 huong tot',
    severity: 'critical',
    tcvn_ref: 'Bat Trach',
    suggestion: 'Quay huong cua chinh ve 1 trong 4 huong tot cua cung menh',
  });

  const bepInBad = !!(pt && pt.bad_directions.includes(pt.bep_huong));
  checks.push({
    name: 'Bep dat huong xau (toa Hung)',
    passed: bepInBad,
    actual: pt?.bep_huong ?? null,
    expected: pt?.bad_directions?.join('/') ?? 'huong xau',
    severity: 'medium',
    tcvn_ref: 'Toa Hung huong Cat',
    suggestion: 'Bep nen toa Hung — di chuyen den tuong huong xau',
  });

  const budget = brief?.budget_vnd ?? 0;
  checks.push({
    name: 'Budget khai bao > 0',
    passed: budget > 0,
    actual: budget,
    expected: '> 0',
    severity: 'medium',
    suggestion: 'KH chua khai bao ngan sach — chay form thu thap lai',
  });

  return finalize('G01', 'Brief & Phong thuy compliance', 'B1', checks, t0);
}
