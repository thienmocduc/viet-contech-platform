/**
 * E2E test 12 QC Gates — 4 scenario:
 *  1. pass-all: design tot, 12/12 PASS
 *  2. structural-fail: G03 fail vi cot 150x150 (qua nho) -> escalate critical
 *  3. budget-fail: G10 variance 8% -> auto-fix down-spec -> re-run pass
 *  4. completeness-fail: G12 thieu 5 deliverable -> auto-fix trigger re-run
 *
 * Khong dependencies test framework — chi assert thuan + console log.
 */

import { QCRunner } from '../src/qc-runner.js';
import type { AuditEntry, DesignSnapshot, GateContext, QCReport } from '../src/types.js';

// ============================================================
// Helpers
// ============================================================
let passed = 0;
let failed = 0;
const failures: string[] = [];

function assertEq<T>(actual: T, expected: T, label: string): void {
  if (actual === expected) {
    passed++;
    console.log(`  PASS  ${label}: ${String(actual)}`);
  } else {
    failed++;
    const msg = `FAIL  ${label}: expected=${String(expected)} got=${String(actual)}`;
    failures.push(msg);
    console.log(`  ${msg}`);
  }
}

function assertOneOf<T>(actual: T, expected: T[], label: string): void {
  if (expected.includes(actual)) {
    passed++;
    console.log(`  PASS  ${label}: ${String(actual)} in [${expected.join(',')}]`);
  } else {
    failed++;
    const msg = `FAIL  ${label}: expected one of [${expected.join(',')}] got=${String(actual)}`;
    failures.push(msg);
    console.log(`  ${msg}`);
  }
}

function assertGE(actual: number, threshold: number, label: string): void {
  if (actual >= threshold) {
    passed++;
    console.log(`  PASS  ${label}: ${actual} >= ${threshold}`);
  } else {
    failed++;
    const msg = `FAIL  ${label}: ${actual} < ${threshold}`;
    failures.push(msg);
    console.log(`  ${msg}`);
  }
}

// ============================================================
// Mock design generators
// ============================================================
function fullBriefFields(): string[] {
  return [
    'full_name','phone','year_born','gender','lot_width_m','lot_depth_m',
    'direction','budget_vnd','family_size','num_floors','lifestyle','address','goal',
  ];
}

function makeDesignPassAll(): DesignSnapshot {
  return {
    brief: {
      required_fields: fullBriefFields(),
      filled_fields: fullBriefFields(),
      client_year_born: 1985,
      cung_menh: 'Khon - Tay tu menh',
      budget_vnd: 5_000_000_000,
      family_size: 4,
      lifestyle: 'gia dinh tre',
    },
    phongthuy: {
      score: 88,
      main_door_direction: 'Tay-Bac',
      bep_huong: 'Dong-Nam',
      good_directions: ['Tay-Bac','Tay','Tay-Nam','Dong-Bac'],
      bad_directions: ['Dong','Dong-Nam','Nam','Bac'],
    },
    layout: {
      density_pct: 75,
      setback_front_m: 2.0,
      setback_back_m: 2.5,
      setback_side_m: 1.5,
      building_height_m: 18,
      num_floors: 4,
      corridor_width_min_m: 1.2,
      zoning_compliance: true,
      rooms: [
        { name: 'PN master', area_m2: 18, min_required_m2: 12 },
        { name: 'PN 1',      area_m2: 14, min_required_m2: 9 },
        { name: 'WC',         area_m2: 4,  min_required_m2: 3 },
      ],
    },
    structural: {
      concrete_grade: 'B25',
      rebar_grade: 'CB400-V',
      smallest_column_mm: { w: 250, h: 250 },
      smallest_beam_mm: { w: 220, h: 350 },
      slab_thickness_mm: 120,
      rebar_ratio_min: 0.6,
      deflection_ratio_max: 1 / 300,
      earthquake_zone: 'II.A',
    },
    mep: {
      electrical_load_va_per_m2: 85,
      drain_slope_pct: 1.5,
      hvac_btu_per_m2: 500,
      soft_clashes: 2,
      hard_clashes: 0,
      duct_cable_min_gap_mm: 80,
      vertical_shaft_count: 2,
    },
    boq: {
      total_vnd: 5_100_000_000,
      budget_vnd: 5_000_000_000,
      variance_pct: 2.0,
      pct_from_dxf: 98,
      items_count: 120,
      unit_price_age_days_max: 45,
      downgradable_items: [],
    },
    bim: {
      total_elements: 380,
      hard_clashes: 0,
      soft_clashes: 2,
      ifc_export_ok: true,
    },
    daylight: { avg_df_pct: 3.2, min_df_pct: 1.5 },
    acoustic: { wall_stc_db: 52, floor_iic_db: 53 },
    fire: {
      num_fire_exits: 2,
      exit_distance_max_m: 18,
      fireproof_door_rating_min_min: 90,
      smoke_detector_count: 12,
      smoke_detector_required: 12,
      sprinkler_required: false,
      sprinkler_installed: false,
    },
    energy: {
      epi_kwh_per_m2_year: 95,
      u_value_wall: 1.4,
      u_value_roof: 0.8,
      wwr_pct: 30,
    },
    legal: {
      has_land_use_cert: true,
      has_building_permit_form: true,
      zoning_match: true,
      density_compliant: true,
      height_compliant: true,
      permit_docs_complete: true,
    },
    deliverables: {
      required_count: 28,
      delivered_count: 30,
      delivered_paths: [
        ...Array.from({ length: 14 }, (_, i) => `A-${String(i+1).padStart(2,'0')}.dwg`),
        ...Array.from({ length: 4 }, (_, i) => `S-${String(i+1).padStart(2,'0')}.dxf`),
        ...Array.from({ length: 4 }, (_, i) => `M-${String(i+1).padStart(2,'0')}.pdf`),
        'BOQ.xlsx', 'BOQ-summary.xlsx',
        'project.ifc',
        'render-1.png','render-2.png','render-3.png',
        'submittal-1.pdf','submittal-2.pdf','submittal-3.pdf',
      ],
      missing_kinds: [],
      pct_signed: 100,
    },
  };
}

function makeDesignStructuralFail(): DesignSnapshot {
  const d = makeDesignPassAll();
  // G03 fail: cot 150x150 < 200x200 (CRITICAL)
  d.structural!.smallest_column_mm = { w: 150, h: 150 };
  d.structural!.smallest_beam_mm = { w: 150, h: 200 };
  d.structural!.concrete_grade = 'B15';
  return d;
}

function makeDesignBudgetFail(): DesignSnapshot {
  const d = makeDesignPassAll();
  // G10 fail: variance 8%, co downgradable
  d.boq!.total_vnd = 5_400_000_000;
  d.boq!.variance_pct = 8.0;
  d.boq!.downgradable_items = [
    { item_code: 'L-PHILIPS-HUE', current_unit_price: 4_500_000, alt_unit_price: 800_000,
      saving_vnd: 200_000_000, description: 'Doi den Philips Hue -> commodity LED' },
    { item_code: 'V-VITRAA-LUX', current_unit_price: 12_000_000, alt_unit_price: 3_500_000,
      saving_vnd: 200_000_000, description: 'Doi cua go cao cap -> MDF veneer' },
  ];
  return d;
}

function makeDesignCompletenessFail(): DesignSnapshot {
  const d = makeDesignPassAll();
  // G12 fail: thieu 5 ban ve mat cat + render
  d.deliverables!.delivered_count = 23;
  d.deliverables!.delivered_paths = d.deliverables!.delivered_paths.slice(0, 23);
  d.deliverables!.missing_kinds = ['png'];
  d.deliverables!.pct_signed = 70;
  return d;
}

// ============================================================
// Audit collector
// ============================================================
function newAuditCollector(): { entries: AuditEntry[]; cb: (e: AuditEntry) => void } {
  const entries: AuditEntry[] = [];
  const cb = (e: AuditEntry) => entries.push(e);
  return { entries, cb };
}

// ============================================================
// Print summary helper
// ============================================================
function printReport(label: string, r: QCReport): void {
  console.log(`\n--- REPORT [${label}] overall=${r.overall} score=${r.total_score} ` +
    `pass=${r.passed} fail=${r.failed} fixed=${r.auto_fixed} warn=${r.warnings} ` +
    `dur=${r.duration_ms}ms`);
  for (const g of r.results) {
    const tmr = g.vote ? ` TMR(${g.vote.majority}/${g.vote.confidence})` : '';
    const fix = g.auto_fix_applied ? ` [autofix x${g.auto_fixes?.length ?? 0}]` : '';
    console.log(`  ${g.gate_code} ${g.status.padEnd(10)} score=${String(g.score).padStart(3)} ${tmr}${fix} | ${g.gate_name}`);
  }
}

// ============================================================
// SCENARIO 1: pass-all
// ============================================================
async function scenario1_passAll(): Promise<void> {
  console.log('\n=== SCENARIO 1: pass-all (design tot 100%) ===');
  const audit = newAuditCollector();
  const ctx: GateContext = {
    project_id: 'VCT-T1-001',
    revision_id: 'rev-001',
    design: makeDesignPassAll(),
    locked_specs: [],
    audit: audit.cb,
  };
  const runner = new QCRunner();
  const r = await runner.runAll(ctx);
  printReport('pass-all', r);

  assertEq(r.overall, 'PASS', 'overall = PASS');
  assertEq(r.total_gates, 12, 'total_gates = 12');
  assertGE(r.passed, 11, 'passed >= 11');
  assertEq(r.failed, 0, 'failed = 0');
  assertGE(audit.entries.length, 12, 'audit_log >= 12 entries');
}

// ============================================================
// SCENARIO 2: structural-fail
// ============================================================
async function scenario2_structuralFail(): Promise<void> {
  console.log('\n=== SCENARIO 2: structural-fail (cot 150x150 vi pham) ===');
  const audit = newAuditCollector();
  const ctx: GateContext = {
    project_id: 'VCT-T2-002',
    revision_id: 'rev-002',
    design: makeDesignStructuralFail(),
    locked_specs: [],
    audit: audit.cb,
  };
  const runner = new QCRunner({ stop_on_critical: true });
  const r = await runner.runAll(ctx);
  printReport('structural-fail', r);

  const g03 = r.results.find((x) => x.gate_code === 'G03');
  assertEq(g03?.status, 'fail', 'G03 status = fail');
  assertEq(g03?.worst_severity, 'critical', 'G03 worst_severity = critical');

  const g03Esc = r.escalations.find((e) => e.detail.gate_code === 'G03');
  assertEq(g03Esc?.level, 'critical', 'G03 escalation level = critical');
  assertEq(g03Esc?.stop_pipeline, true, 'G03 stop_pipeline = true');
  assertEq(g03Esc?.lock_revision, true, 'G03 lock_revision = true');

  // Pipeline da stop -> nhung gate sau khong duoc chay (still PENDING/missing)
  assertOneOf(r.overall, ['FAIL', 'PARTIAL'], 'overall in [FAIL,PARTIAL]');
}

// ============================================================
// SCENARIO 3: budget-fail -> auto-fix -> re-run pass
// ============================================================
async function scenario3_budgetFix(): Promise<void> {
  console.log('\n=== SCENARIO 3: budget-fail (8% over) -> auto-fix down-spec ===');
  const audit = newAuditCollector();
  const ctx: GateContext = {
    project_id: 'VCT-T3-003',
    revision_id: 'rev-003',
    design: makeDesignBudgetFail(),
    locked_specs: [],
    audit: audit.cb,
  };
  const runner = new QCRunner();
  const r = await runner.runAll(ctx);
  printReport('budget-fix', r);

  const g10 = r.results.find((x) => x.gate_code === 'G10');
  // Auto-fix se chuyen variance 8% -> 0% (sau khi tru savings 400m vnd)
  // Tu fail -> auto_fixed (or pass)
  assertOneOf(g10?.status as string, ['auto_fixed', 'pass'], 'G10 status auto_fixed/pass');
  assertEq(g10?.auto_fix_applied, true, 'G10 auto_fix_applied = true');
  assertGE(g10?.auto_fixes?.length ?? 0, 1, 'G10 auto_fixes >= 1');

  // Audit log co entry auto_fix
  const fixEntries = audit.entries.filter((e) => e.action === 'auto_fix.applied');
  assertGE(fixEntries.length, 1, 'audit_log co auto_fix.applied');
}

// ============================================================
// SCENARIO 4: completeness-fail -> auto-fix re-trigger
// ============================================================
async function scenario4_completenessFix(): Promise<void> {
  console.log('\n=== SCENARIO 4: completeness-fail (thieu 5 deliverable) -> auto re-trigger ===');
  const audit = newAuditCollector();
  const ctx: GateContext = {
    project_id: 'VCT-T4-004',
    revision_id: 'rev-004',
    design: makeDesignCompletenessFail(),
    locked_specs: [],
    audit: audit.cb,
  };
  const runner = new QCRunner();
  const r = await runner.runAll(ctx);
  printReport('completeness-fix', r);

  const g12 = r.results.find((x) => x.gate_code === 'G12');
  assertOneOf(g12?.status as string, ['auto_fixed', 'pass'], 'G12 status auto_fixed/pass');
  assertEq(g12?.auto_fix_applied, true, 'G12 auto_fix_applied = true');

  // Sau auto-fix, deliverable count >= 28
  assertGE(ctx.design.deliverables?.delivered_count ?? 0, 28, 'deliverables count >= 28 sau fix');
  assertEq(ctx.design.deliverables?.pct_signed, 100, 'pct_signed = 100% sau fix');

  // Co audit re-trigger
  const fixEntries = audit.entries.filter((e) => e.action === 'auto_fix.applied');
  assertGE(fixEntries.length, 1, 'audit_log co auto_fix entries');
}

// ============================================================
// Main
// ============================================================
async function main(): Promise<void> {
  console.log('========================================');
  console.log('Viet-Contech QC Gates E2E Test');
  console.log('========================================');
  await scenario1_passAll();
  await scenario2_structuralFail();
  await scenario3_budgetFix();
  await scenario4_completenessFix();

  console.log('\n========================================');
  console.log(`SUMMARY: passed=${passed} failed=${failed} total=${passed + failed}`);
  if (failures.length > 0) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log(`  - ${f}`));
  }
  console.log('========================================');
  if (failed > 0) process.exit(1);
}

main().catch((e: unknown) => {
  console.error('FATAL', e);
  process.exit(1);
});
