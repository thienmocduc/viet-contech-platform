// TCVN Rules Engine — Core
// Viet-Contech Design Platform
//
// validateDesign(design, rules) -> RuleResult[]
// loadRules() -> Rule[] from all 8 JSON ruleset files

import * as fs from 'fs';
import * as path from 'path';
import {
  Rule,
  RuleSet,
  RuleResult,
  RuleStatus,
  DesignInput,
  ValidationReport,
} from './types';

// Resolve module dir for both ESM (tsx --esm) and CJS environments.
// Strategy: __dirname when CJS; otherwise resolve from process.cwd() relative to this file's stable layout.
function moduleDir(): string {
  // @ts-ignore — __dirname only exists in CJS
  if (typeof __dirname !== 'undefined') return __dirname;
  // ESM fallback — assume tests run from repo root or tcvn/ dir.
  // Walk up from process.cwd() to find a folder containing rules/ + src/
  let cwd = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(cwd, 'platform', 'backend', 'tcvn', 'src');
    if (fs.existsSync(candidate)) return candidate;
    const local = path.join(cwd, 'src');
    if (fs.existsSync(path.join(cwd, 'rules')) && fs.existsSync(local)) return local;
    cwd = path.dirname(cwd);
  }
  return path.resolve('.');
}

const RULES_DIR = path.resolve(moduleDir(), '..', 'rules');

// ---------- LOAD RULES ----------

export interface LoadedRule extends Rule {
  category: string;
  standard: string;
}

export function loadRules(rulesDir: string = RULES_DIR): LoadedRule[] {
  const files = fs.readdirSync(rulesDir).filter((f) => f.endsWith('.json'));
  const all: LoadedRule[] = [];
  for (const file of files) {
    const fp = path.join(rulesDir, file);
    const raw = fs.readFileSync(fp, 'utf-8');
    const set = JSON.parse(raw) as RuleSet;
    for (const r of set.rules) {
      all.push({ ...r, category: set.category, standard: set.standard });
    }
  }
  return all;
}

// ---------- HELPERS ----------

function gradeRank(grade: string): number {
  const order = ['B15', 'B20', 'B25', 'B30', 'B40', 'B50', 'B60'];
  return order.indexOf(grade);
}

function lpsRank(cls: string): number {
  const order = ['NONE', 'IV', 'III', 'II', 'I'];
  return order.indexOf(cls);
}

function fireRank(R: string): number {
  // R30, R45, R60, R90, R120
  const m = R?.match?.(/R(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return 'n/a';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function buildResult(
  rule: LoadedRule,
  status: RuleStatus,
  actual: unknown,
  expected: unknown,
  message?: string,
  suggestion?: string
): RuleResult {
  return {
    rule_code: rule.code,
    category: rule.category,
    standard: rule.standard,
    status,
    severity: rule.severity,
    actual,
    expected,
    statement_vi: rule.statement_vi,
    message,
    suggestion,
  };
}

// ---------- RULE EVALUATORS ----------
// Implements per-code logic. Each evaluator returns one RuleResult.

type Evaluator = (rule: LoadedRule, d: DesignInput) => RuleResult;

const evaluators: Record<string, Evaluator> = {
  // ===== CONCRETE — TCVN 5574:2018 =====
  C001: (r, d) => {
    if (d.concrete_grade === undefined) return buildResult(r, 'skip', null, r.expected);
    const ok = gradeRank(d.concrete_grade) >= gradeRank('B20');
    return buildResult(r, ok ? 'pass' : 'fail', d.concrete_grade, 'B20',
      ok ? undefined : `Mac BT ${d.concrete_grade} < B20`,
      ok ? undefined : 'Nang mac be tong len it nhat B20 cho nha o dan dung');
  },
  C002: (r, d) => buildResult(r, 'pass', d.concrete_grade ?? null, r.expected),
  C003: (r, d) => {
    if (d.cover_mm === undefined) return buildResult(r, 'skip', null, r.expected);
    const ok = d.cover_mm >= 20;
    return buildResult(r, ok ? 'pass' : 'fail', d.cover_mm, 20,
      ok ? undefined : `Lop bao ve ${d.cover_mm}mm < 20mm`,
      ok ? undefined : 'Tang lop bao ve cot thep len 20mm cho dam/cot');
  },
  C004: (r, d) => {
    if (d.cover_outdoor_mm === undefined) return buildResult(r, 'skip', null, r.expected);
    const ok = d.cover_outdoor_mm >= 25;
    return buildResult(r, ok ? 'pass' : 'fail', d.cover_outdoor_mm, 25,
      ok ? undefined : `Lop bao ve ngoai troi ${d.cover_outdoor_mm}mm < 25mm`,
      ok ? undefined : 'Tang lop bao ve ngoai troi len 25mm');
  },
  C005: (r, d) => {
    if (d.cover_slab_mm === undefined) return buildResult(r, 'skip', null, r.expected);
    const ok = d.cover_slab_mm >= 15;
    return buildResult(r, ok ? 'pass' : 'fail', d.cover_slab_mm, 15);
  },
  C006: (r, d) => {
    if (d.phi_long_column_mm === undefined) return buildResult(r, 'skip', null, r.expected);
    const ok = d.phi_long_column_mm >= 12;
    return buildResult(r, ok ? 'pass' : 'fail', d.phi_long_column_mm, 12,
      ok ? undefined : 'Phi thep doc cot < 12mm', ok ? undefined : 'Dung thep doc cot >= Phi 12');
  },
  C007: (r, d) => {
    if (d.phi_long_beam_mm === undefined) return buildResult(r, 'skip', null, r.expected);
    const ok = d.phi_long_beam_mm >= 10;
    return buildResult(r, ok ? 'pass' : 'fail', d.phi_long_beam_mm, 10);
  },
  C008: (r, d) => {
    if (d.phi_stirrup_mm === undefined) return buildResult(r, 'skip', null, r.expected);
    const ok = d.phi_stirrup_mm >= 6;
    return buildResult(r, ok ? 'pass' : 'fail', d.phi_stirrup_mm, 6);
  },
  C009: (r, d) => {
    if (d.mu_column_pct === undefined) return buildResult(r, 'skip', null, r.expected);
    const ok = d.mu_column_pct >= 0.4;
    return buildResult(r, ok ? 'pass' : 'fail', d.mu_column_pct, 0.4,
      ok ? undefined : `Ty le thep cot ${d.mu_column_pct}% < 0.4%`,
      ok ? undefined : 'Tang ty le thep cot toi thieu 0.4%');
  },
  C010: (r, d) => {
    if (d.mu_column_pct === undefined) return buildResult(r, 'skip', null, r.expected);
    const ok = d.mu_column_pct <= 6;
    return buildResult(r, ok ? 'pass' : 'fail', d.mu_column_pct, 6);
  },
  C011: (r, d) => {
    if (d.spacing_stirrup_mm === undefined || d.phi_long_column_mm === undefined)
      return buildResult(r, 'skip', null, r.expected);
    const limit = Math.min(15 * d.phi_long_column_mm, 500);
    const ok = d.spacing_stirrup_mm <= limit;
    return buildResult(r, ok ? 'pass' : 'fail', d.spacing_stirrup_mm, limit,
      ok ? undefined : `Khoang cach dai cot ${d.spacing_stirrup_mm}mm > ${limit}mm`,
      ok ? undefined : `Giam khoang cach dai cot xuong <= ${limit}mm`);
  },
  C012: (r, d) => {
    if (d.deflection_live_mm === undefined || d.span_beam_mm === undefined)
      return buildResult(r, 'skip', null, r.expected);
    const limit = d.span_beam_mm / 250;
    const ok = d.deflection_live_mm <= limit;
    return buildResult(r, ok ? 'pass' : 'fail', d.deflection_live_mm, `L/250 = ${limit.toFixed(1)}mm`);
  },
  C013: (r, d) => {
    if (d.deflection_total_mm === undefined || d.span_beam_mm === undefined)
      return buildResult(r, 'skip', null, r.expected);
    const limit = d.span_beam_mm / 150;
    const ok = d.deflection_total_mm <= limit;
    return buildResult(r, ok ? 'pass' : 'fail', d.deflection_total_mm, `L/150 = ${limit.toFixed(1)}mm`);
  },
  C014: (r, d) => {
    if (d.span_beam_mm === undefined) return buildResult(r, 'skip', null, r.expected);
    const ok = d.span_beam_mm <= 8000;
    return buildResult(r, ok ? 'pass' : 'warn', d.span_beam_mm, 8000,
      ok ? undefined : 'Nhip dam > 8m: nen xet dam du ung luc');
  },
  C015: (r, d) => {
    if (d.column_b_mm === undefined || d.column_h_mm === undefined || d.num_floors === undefined)
      return buildResult(r, 'skip', null, r.expected);
    if (d.num_floors > 3) return buildResult(r, 'skip', null, r.expected);
    const area = d.column_b_mm * d.column_h_mm;
    const ok = area >= 200 * 200;
    return buildResult(r, ok ? 'pass' : 'fail', `${d.column_b_mm}x${d.column_h_mm}`, '200x200');
  },
  C016: (r, d) => {
    if (d.column_b_mm === undefined || d.column_h_mm === undefined || d.num_floors === undefined)
      return buildResult(r, 'skip', null, r.expected);
    if (d.num_floors < 4 || d.num_floors > 5) return buildResult(r, 'skip', null, r.expected);
    const area = d.column_b_mm * d.column_h_mm;
    const ok = area >= 220 * 220;
    return buildResult(r, ok ? 'pass' : 'fail', `${d.column_b_mm}x${d.column_h_mm}`, '220x220',
      ok ? undefined : `Cot ${d.column_b_mm}x${d.column_h_mm} qua nho cho nha ${d.num_floors}T`,
      ok ? undefined : 'Tang tiet dien cot toi thieu 220x220mm cho nha 4-5 tang');
  },
  C017: (r, d) => {
    if (d.column_b_mm === undefined || d.column_h_mm === undefined || d.num_floors === undefined)
      return buildResult(r, 'skip', null, r.expected);
    if (d.num_floors < 6) return buildResult(r, 'skip', null, r.expected);
    const area = d.column_b_mm * d.column_h_mm;
    const ok = area >= 250 * 250;
    return buildResult(r, ok ? 'pass' : 'fail', `${d.column_b_mm}x${d.column_h_mm}`, '250x250');
  },
  C018: (r, d) => {
    if (d.slab_thickness_mm === undefined) return buildResult(r, 'skip', null, r.expected);
    const ok = d.slab_thickness_mm >= 80;
    return buildResult(r, ok ? 'pass' : 'fail', d.slab_thickness_mm, 80);
  },
  C019: (r, d) => {
    if (d.slab_thickness_mm === undefined) return buildResult(r, 'skip', null, r.expected);
    const ok = d.slab_thickness_mm >= 100;
    return buildResult(r, ok ? 'pass' : 'warn', d.slab_thickness_mm, 100);
  },
  C020: (r, d) => {
    if (d.rebar_spacing_slab_mm === undefined) return buildResult(r, 'skip', null, r.expected);
    const ok = d.rebar_spacing_slab_mm <= 200;
    return buildResult(r, ok ? 'pass' : 'fail', d.rebar_spacing_slab_mm, 200);
  },
  C021: (r, d) => {
    if (d.concrete_grade === undefined) return buildResult(r, 'skip', null, r.expected);
    const ok = gradeRank(d.concrete_grade) >= gradeRank('B20');
    return buildResult(r, ok ? 'pass' : 'fail', d.concrete_grade, 'B20');
  },
  C022: (r) => buildResult(r, 'pass', null, r.expected),
  C023: (r) => buildResult(r, 'pass', null, r.expected),
  C024: (r, d) => {
    if (d.spacing_stirrup_mm === undefined) return buildResult(r, 'skip', null, r.expected);
    const ok = d.spacing_stirrup_mm <= 150;
    return buildResult(r, ok ? 'pass' : 'fail', d.spacing_stirrup_mm, 150);
  },
  C025: (r) => buildResult(r, 'pass', null, r.expected),
  C026: (r) => buildResult(r, 'pass', null, r.expected),
  C027: (r) => buildResult(r, 'pass', null, r.expected),

  // ===== LOADS — TCVN 2737:2020 =====
  L001: (r, d) => {
    if (d.building_type !== 'residential' || d.live_load_kn_m2 === undefined)
      return buildResult(r, 'skip', null, r.expected);
    const ok = Math.abs(d.live_load_kn_m2 - 1.5) < 0.01 || d.live_load_kn_m2 >= 1.5;
    return buildResult(r, ok ? 'pass' : 'fail', d.live_load_kn_m2, 1.5);
  },
  L002: (r) => buildResult(r, 'pass', null, r.expected),
  L003: (r) => buildResult(r, 'pass', null, r.expected),
  L004: (r) => buildResult(r, 'pass', null, r.expected),
  L005: (r) => buildResult(r, 'pass', null, r.expected),
  L006: (r) => buildResult(r, 'pass', null, r.expected),
  L007: (r) => buildResult(r, 'pass', null, r.expected),
  L008: (r) => buildResult(r, 'pass', null, r.expected),
  L009: (r) => buildResult(r, 'pass', null, r.expected),
  L010: (r) => buildResult(r, 'pass', null, r.expected),
  L011: (r, d) => {
    if (d.wind_zone !== 'IIB' || d.W0_kn_m2 === undefined)
      return buildResult(r, 'skip', null, r.expected);
    const ok = Math.abs(d.W0_kn_m2 - 0.95) < 0.05;
    return buildResult(r, ok ? 'pass' : 'fail', d.W0_kn_m2, 0.95);
  },
  L012: (r, d) => {
    if (d.wind_zone !== 'IIA' || d.W0_kn_m2 === undefined)
      return buildResult(r, 'skip', null, r.expected);
    const ok = Math.abs(d.W0_kn_m2 - 0.83) < 0.05;
    return buildResult(r, ok ? 'pass' : 'fail', d.W0_kn_m2, 0.83);
  },
  L013: (r) => buildResult(r, 'pass', null, r.expected),
  L014: (r, d) => {
    if (d.gamma_DL === undefined) return buildResult(r, 'skip', null, r.expected);
    const ok = Math.abs(d.gamma_DL - 1.1) < 0.01;
    return buildResult(r, ok ? 'pass' : 'fail', d.gamma_DL, 1.1);
  },
  L015: (r, d) => {
    if (d.gamma_LL === undefined) return buildResult(r, 'skip', null, r.expected);
    const ok = Math.abs(d.gamma_LL - 1.2) < 0.01;
    return buildResult(r, ok ? 'pass' : 'fail', d.gamma_LL, 1.2);
  },
  L016: (r) => buildResult(r, 'pass', null, r.expected),
  L017: (r) => buildResult(r, 'pass', null, r.expected),

  // ===== FIRE — QCVN 06:2022 =====
  F001: (r, d) => {
    if (d.max_distance_to_exit_m === undefined) return buildResult(r, 'skip', null, r.expected);
    const ok = d.max_distance_to_exit_m <= 30;
    return buildResult(r, ok ? 'pass' : 'fail', d.max_distance_to_exit_m, 30,
      ok ? undefined : 'Khoang cach toi loi thoat > 30m', ok ? undefined : 'Bo tri them loi thoat hiem');
  },
  F002: (r, d) => {
    if (d.exit_door_width_m === undefined) return buildResult(r, 'skip', null, r.expected);
    const ok = d.exit_door_width_m >= 1.2;
    return buildResult(r, ok ? 'pass' : 'fail', d.exit_door_width_m, 1.2);
  },
  F003: (r, d) => {
    if (d.corridor_width_m === undefined) return buildResult(r, 'skip', null, r.expected);
    const ok = d.corridor_width_m >= 1.4;
    return buildResult(r, ok ? 'pass' : 'fail', d.corridor_width_m, 1.4);
  },
  F004: (r, d) => {
    if (d.occupants_per_floor === undefined || d.num_exits === undefined)
      return buildResult(r, 'skip', null, r.expected);
    if (d.occupants_per_floor <= 25) return buildResult(r, 'pass', d.num_exits, 1);
    const ok = d.num_exits >= 2;
    return buildResult(r, ok ? 'pass' : 'fail', d.num_exits, 2);
  },
  F005: (r, d) => {
    if (d.num_floors === undefined || d.column_fire_resistance_R === undefined)
      return buildResult(r, 'skip', null, r.expected);
    if (d.num_floors > 7) return buildResult(r, 'skip', null, r.expected);
    const ok = fireRank(d.column_fire_resistance_R) >= 60;
    return buildResult(r, ok ? 'pass' : 'fail', d.column_fire_resistance_R, 'R60');
  },
  F006: (r, d) => {
    if (d.num_floors === undefined || d.beam_fire_resistance_R === undefined)
      return buildResult(r, 'skip', null, r.expected);
    if (d.num_floors > 7) return buildResult(r, 'skip', null, r.expected);
    const ok = fireRank(d.beam_fire_resistance_R) >= 45;
    return buildResult(r, ok ? 'pass' : 'fail', d.beam_fire_resistance_R, 'R45');
  },
  F007: (r, d) => {
    if (d.num_floors === undefined) return buildResult(r, 'skip', null, r.expected);
    if (d.num_floors <= 5) return buildResult(r, 'pass', d.has_sprinkler ?? false, true);
    const ok = d.has_sprinkler === true;
    return buildResult(r, ok ? 'pass' : 'fail', d.has_sprinkler ?? false, true,
      ok ? undefined : 'Nha >5T can sprinkler', ok ? undefined : 'Lap he thong sprinkler tu dong');
  },
  F008: (r, d) => {
    if (d.num_floors === undefined) return buildResult(r, 'skip', null, r.expected);
    if (d.num_floors < 3) return buildResult(r, 'pass', d.has_fire_alarm ?? false, true);
    const ok = d.has_fire_alarm === true;
    return buildResult(r, ok ? 'pass' : 'fail', d.has_fire_alarm ?? false, true);
  },
  F009: (r, d) => {
    if (d.exit_door_opens_outward === undefined) return buildResult(r, 'skip', null, r.expected);
    const ok = d.exit_door_opens_outward === true;
    return buildResult(r, ok ? 'pass' : 'fail', d.exit_door_opens_outward, true);
  },
  F010: (r, d) => {
    if (d.exit_clear_height_m === undefined) return buildResult(r, 'skip', null, r.expected);
    const ok = d.exit_clear_height_m >= 2;
    return buildResult(r, ok ? 'pass' : 'fail', d.exit_clear_height_m, 2);
  },
  F011: (r) => buildResult(r, 'pass', null, r.expected),
  F012: (r, d) => {
    if (d.emergency_lighting === undefined) return buildResult(r, 'skip', null, r.expected);
    const ok = d.emergency_lighting === true;
    return buildResult(r, ok ? 'pass' : 'fail', d.emergency_lighting, true);
  },
  F013: (r, d) => {
    if (d.num_floors === undefined) return buildResult(r, 'skip', null, r.expected);
    if (d.num_floors <= 7) return buildResult(r, 'pass', d.has_fire_water_supply ?? false, true);
    const ok = d.has_fire_water_supply === true;
    return buildResult(r, ok ? 'pass' : 'fail', d.has_fire_water_supply ?? false, true);
  },

  // ===== ENERGY — QCVN 09:2017 =====
  E001: (r, d) => {
    if (d.EUI_kwh_m2_year === undefined) return buildResult(r, 'skip', null, r.expected);
    const ok = d.EUI_kwh_m2_year <= 120;
    return buildResult(r, ok ? 'pass' : 'fail', d.EUI_kwh_m2_year, 120);
  },
  E002: (r, d) => {
    if (d.U_wall_w_m2_k === undefined) return buildResult(r, 'skip', null, r.expected);
    const ok = d.U_wall_w_m2_k <= 2.4;
    return buildResult(r, ok ? 'pass' : 'fail', d.U_wall_w_m2_k, 2.4);
  },
  E003: (r, d) => {
    if (d.U_roof_w_m2_k === undefined) return buildResult(r, 'skip', null, r.expected);
    const ok = d.U_roof_w_m2_k <= 1.0;
    return buildResult(r, ok ? 'pass' : 'fail', d.U_roof_w_m2_k, 1.0);
  },
  E004: (r, d) => {
    if (d.SHGC_south === undefined) return buildResult(r, 'skip', null, r.expected);
    const ok = d.SHGC_south <= 0.4;
    return buildResult(r, ok ? 'pass' : 'fail', d.SHGC_south, 0.4);
  },
  E005: (r, d) => {
    if (d.WWR_pct === undefined) return buildResult(r, 'skip', null, r.expected);
    const ok = d.WWR_pct <= 30;
    return buildResult(r, ok ? 'pass' : 'fail', d.WWR_pct, 30);
  },
  E006: (r, d) => {
    if (d.LED_lm_w === undefined) return buildResult(r, 'skip', null, r.expected);
    const ok = d.LED_lm_w >= 80;
    return buildResult(r, ok ? 'pass' : 'fail', d.LED_lm_w, 80);
  },
  E007: (r, d) => {
    if (d.AC_COP === undefined) return buildResult(r, 'skip', null, r.expected);
    const ok = d.AC_COP >= 3.2;
    return buildResult(r, ok ? 'pass' : 'fail', d.AC_COP, 3.2);
  },
  E008: (r) => buildResult(r, 'pass', null, r.expected),
  E009: (r, d) => {
    if (d.LPD_w_m2 === undefined) return buildResult(r, 'skip', null, r.expected);
    const ok = d.LPD_w_m2 <= 8;
    return buildResult(r, ok ? 'pass' : 'fail', d.LPD_w_m2, 8);
  },
  E010: (r) => buildResult(r, 'pass', null, r.expected),

  // ===== PLANNING — QCXDVN 01:2021 =====
  P001: (r, d) => {
    if (d.lot_area_m2 === undefined || d.coverage_pct === undefined)
      return buildResult(r, 'skip', null, r.expected);
    if (d.lot_area_m2 >= 100) return buildResult(r, 'skip', null, r.expected);
    const ok = d.coverage_pct <= 80;
    return buildResult(r, ok ? 'pass' : 'fail', d.coverage_pct, 80,
      ok ? undefined : `Mat do XD ${d.coverage_pct}% > 80% (lo ${d.lot_area_m2}m2)`,
      ok ? undefined : 'Giam mat do xay dung xuong toi da 80%');
  },
  P002: (r, d) => {
    if (d.lot_area_m2 === undefined || d.coverage_pct === undefined)
      return buildResult(r, 'skip', null, r.expected);
    if (d.lot_area_m2 < 100 || d.lot_area_m2 > 300) return buildResult(r, 'skip', null, r.expected);
    const ok = d.coverage_pct <= 70;
    return buildResult(r, ok ? 'pass' : 'fail', d.coverage_pct, 70,
      ok ? undefined : `Mat do XD ${d.coverage_pct}% > 70% (lo ${d.lot_area_m2}m2)`,
      ok ? undefined : 'Giam mat do xay dung xuong toi da 70%');
  },
  P003: (r, d) => {
    if (d.lot_area_m2 === undefined || d.coverage_pct === undefined)
      return buildResult(r, 'skip', null, r.expected);
    if (d.lot_area_m2 <= 300) return buildResult(r, 'skip', null, r.expected);
    const ok = d.coverage_pct <= 60;
    return buildResult(r, ok ? 'pass' : 'fail', d.coverage_pct, 60);
  },
  P004: (r, d) => {
    if (d.front_setback_m === undefined) return buildResult(r, 'skip', null, r.expected);
    const ok = d.front_setback_m >= 1.5;
    return buildResult(r, ok ? 'pass' : 'fail', d.front_setback_m, 1.5);
  },
  P005: (r, d) => {
    if (d.rear_setback_m === undefined) return buildResult(r, 'skip', null, r.expected);
    const ok = d.rear_setback_m >= 2;
    return buildResult(r, ok ? 'pass' : 'fail', d.rear_setback_m, 2);
  },
  P006: (r, d) => {
    if (d.side_setback_m === undefined) return buildResult(r, 'skip', null, r.expected);
    const ok = d.side_setback_m >= 1;
    return buildResult(r, ok ? 'pass' : 'warn', d.side_setback_m, 1);
  },
  P007: (r, d) => {
    if (d.building_height_m === undefined) return buildResult(r, 'skip', null, r.expected);
    const ok = d.building_height_m <= 17;
    return buildResult(r, ok ? 'pass' : 'fail', d.building_height_m, 17);
  },
  P008: (r, d) => {
    if (d.green_ratio_pct === undefined) return buildResult(r, 'skip', null, r.expected);
    const ok = d.green_ratio_pct >= 10;
    return buildResult(r, ok ? 'pass' : 'fail', d.green_ratio_pct, 10);
  },
  P009: (r) => buildResult(r, 'pass', null, r.expected),

  // ===== HOUSING — TCVN 4451:2012 =====
  H001: (r, d) => {
    if (d.ceiling_main_room_m === undefined) return buildResult(r, 'skip', null, r.expected);
    const ok = d.ceiling_main_room_m >= 2.7;
    return buildResult(r, ok ? 'pass' : 'fail', d.ceiling_main_room_m, 2.7);
  },
  H002: (r, d) => {
    if (d.ceiling_aux_room_m === undefined) return buildResult(r, 'skip', null, r.expected);
    const ok = d.ceiling_aux_room_m >= 2.4;
    return buildResult(r, ok ? 'pass' : 'fail', d.ceiling_aux_room_m, 2.4);
  },
  H003: (r, d) => {
    if (d.window_area_m2 === undefined || d.floor_area_m2 === undefined)
      return buildResult(r, 'skip', null, r.expected);
    const need = d.floor_area_m2 / 8;
    const ok = d.window_area_m2 >= need;
    return buildResult(r, ok ? 'pass' : 'fail', d.window_area_m2, `>= ${need.toFixed(2)}m2`);
  },
  H004: (r, d) => {
    if (d.master_bedroom_m2 === undefined) return buildResult(r, 'skip', null, r.expected);
    const ok = d.master_bedroom_m2 >= 12;
    return buildResult(r, ok ? 'pass' : 'fail', d.master_bedroom_m2, 12);
  },
  H005: (r, d) => {
    if (d.secondary_bedroom_m2 === undefined) return buildResult(r, 'skip', null, r.expected);
    const ok = d.secondary_bedroom_m2 >= 9;
    return buildResult(r, ok ? 'pass' : 'fail', d.secondary_bedroom_m2, 9);
  },
  H006: (r, d) => {
    if (d.kitchen_area_m2 === undefined) return buildResult(r, 'skip', null, r.expected);
    const ok = d.kitchen_area_m2 >= 6;
    return buildResult(r, ok ? 'pass' : 'fail', d.kitchen_area_m2, 6);
  },
  H007: (r, d) => {
    if (d.kitchen_ventilation === undefined) return buildResult(r, 'skip', null, r.expected);
    const ok = d.kitchen_ventilation === true;
    return buildResult(r, ok ? 'pass' : 'fail', d.kitchen_ventilation, true);
  },
  H008: (r, d) => {
    if (d.master_wc_m2 === undefined) return buildResult(r, 'skip', null, r.expected);
    const ok = d.master_wc_m2 >= 4;
    return buildResult(r, ok ? 'pass' : 'fail', d.master_wc_m2, 4);
  },
  H009: (r, d) => {
    if (d.aux_wc_m2 === undefined) return buildResult(r, 'skip', null, r.expected);
    const ok = d.aux_wc_m2 >= 2;
    return buildResult(r, ok ? 'pass' : 'fail', d.aux_wc_m2, 2);
  },
  H010: (r, d) => {
    if (d.living_room_m2 === undefined) return buildResult(r, 'skip', null, r.expected);
    const ok = d.living_room_m2 >= 12;
    return buildResult(r, ok ? 'pass' : 'warn', d.living_room_m2, 12);
  },
  H011: (r, d) => {
    if (d.internal_door_width_m === undefined) return buildResult(r, 'skip', null, r.expected);
    const ok = d.internal_door_width_m >= 0.8;
    return buildResult(r, ok ? 'pass' : 'fail', d.internal_door_width_m, 0.8);
  },

  // ===== LIGHTNING — TCVN 9385:2012 =====
  LT001: (r, d) => {
    if (d.building_height_m === undefined) return buildResult(r, 'skip', null, r.expected);
    if (d.building_height_m <= 20) return buildResult(r, 'pass', d.LPS_class ?? 'NONE', '-');
    const cls = d.LPS_class ?? 'NONE';
    const ok = lpsRank(cls) >= lpsRank('III');
    return buildResult(r, ok ? 'pass' : 'fail', cls, 'III',
      ok ? undefined : `Nha cao ${d.building_height_m}m can LPS Class III`,
      ok ? undefined : 'Lap he thong chong set Class III');
  },
  LT002: (r, d) => {
    if (d.air_terminal_distance_m === undefined) return buildResult(r, 'skip', null, r.expected);
    const ok = d.air_terminal_distance_m <= 10;
    return buildResult(r, ok ? 'pass' : 'fail', d.air_terminal_distance_m, 10);
  },
  LT003: (r, d) => {
    if (d.earth_electrode_spacing_m === undefined) return buildResult(r, 'skip', null, r.expected);
    const ok = d.earth_electrode_spacing_m >= 5;
    return buildResult(r, ok ? 'pass' : 'fail', d.earth_electrode_spacing_m, 5);
  },
  LT004: (r, d) => {
    if (d.earth_resistance_ohm === undefined) return buildResult(r, 'skip', null, r.expected);
    const ok = d.earth_resistance_ohm <= 10;
    return buildResult(r, ok ? 'pass' : 'fail', d.earth_resistance_ohm, 10,
      ok ? undefined : `R = ${d.earth_resistance_ohm}Ohm > 10Ohm`,
      ok ? undefined : 'Bo sung coc tiep dia de R <= 10 Ohm');
  },
  LT005: (r, d) => {
    if (d.num_down_conductors === undefined) return buildResult(r, 'skip', null, r.expected);
    const ok = d.num_down_conductors >= 2;
    return buildResult(r, ok ? 'pass' : 'fail', d.num_down_conductors, 2);
  },
  LT006: (r, d) => {
    if (d.down_conductor_section_mm2 === undefined) return buildResult(r, 'skip', null, r.expected);
    const ok = d.down_conductor_section_mm2 >= 50;
    return buildResult(r, ok ? 'pass' : 'fail', d.down_conductor_section_mm2, 50);
  },
};

// ---------- VALIDATION ----------

export function validateDesign(design: DesignInput, rules: LoadedRule[]): RuleResult[] {
  const out: RuleResult[] = [];
  for (const rule of rules) {
    const fn = evaluators[rule.code];
    if (!fn) {
      out.push(buildResult(rule, 'skip', null, rule.expected, 'no evaluator'));
      continue;
    }
    try {
      out.push(fn(rule, design));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      out.push(buildResult(rule, 'skip', null, rule.expected, `eval error: ${msg}`));
    }
  }
  return out;
}

export function summarize(results: RuleResult[]): ValidationReport {
  const r: ValidationReport = {
    total_rules: results.length,
    passed: 0,
    failed: 0,
    warnings: 0,
    skipped: 0,
    results,
  };
  for (const x of results) {
    if (x.status === 'pass') r.passed++;
    else if (x.status === 'fail') r.failed++;
    else if (x.status === 'warn') r.warnings++;
    else r.skipped++;
  }
  return r;
}

// ---------- ENTRYPOINT (CLI sanity check) ----------
// Note: in ESM, require.main is undefined; CLI sanity-check is in tests/run-tests.ts.

