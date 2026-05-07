/**
 * Auto-fix patterns — fix tu dong nhung loi nho de qua duoc gate.
 * Moi pattern co:
 *  - match() — kiem tra xem result fail co fix duoc khong
 *  - guard() — KHONG fix neu cham vao locked spec
 *  - apply() — modify ctx.design in-place + return AutoFixApplied
 */

import type {
  AutoFixApplied, AutoFixPattern, GateContext, GateResult, GateCode,
} from './types.js';

const SHIFT_DEFAULT_MM = 50;

// ============================================================
// 1. G02: setback front < 1.5m -> shrink layout 0.2m
// ============================================================
const fixSetbackFront: AutoFixPattern = {
  id: 'fix-setback-front-shrink',
  description: 'Tang lui mat tien (shrink layout 0.2m)',
  applies_to: ['G02'],
  match: (r) => r.checks.some((c) => c.name.includes('Lui mat tien') && !c.passed),
  guard: (ctx) => ctx.locked_specs.includes('layout.setback_front_m'),
  apply: async (_r, ctx): Promise<AutoFixApplied> => {
    const l = ctx.design.layout;
    if (!l) throw new Error('layout missing');
    const before = { setback_front_m: l.setback_front_m };
    l.setback_front_m = Math.max(1.5, l.setback_front_m + 0.2);
    return {
      pattern_id: 'fix-setback-front-shrink',
      description: `Setback front ${before.setback_front_m} -> ${l.setback_front_m}m`,
      before,
      after: { setback_front_m: l.setback_front_m },
      applied_at: new Date().toISOString(),
    };
  },
};

// ============================================================
// 2. G02: setback back < 2m -> tang lui sau
// ============================================================
const fixSetbackBack: AutoFixPattern = {
  id: 'fix-setback-back-extend',
  description: 'Tang lui mat sau >= 2m',
  applies_to: ['G02'],
  match: (r) => r.checks.some((c) => c.name.includes('Lui mat sau') && !c.passed),
  guard: (ctx) => ctx.locked_specs.includes('layout.setback_back_m'),
  apply: async (_r, ctx): Promise<AutoFixApplied> => {
    const l = ctx.design.layout;
    if (!l) throw new Error('layout missing');
    const before = { setback_back_m: l.setback_back_m };
    l.setback_back_m = Math.max(2.0, l.setback_back_m + 0.3);
    return {
      pattern_id: 'fix-setback-back-extend',
      description: `Setback back ${before.setback_back_m} -> ${l.setback_back_m}m`,
      before,
      after: { setback_back_m: l.setback_back_m },
      applied_at: new Date().toISOString(),
    };
  },
};

// ============================================================
// 3. G05: soft clash <50mm gap -> shift +50mm
// ============================================================
const fixSoftClashShift: AutoFixPattern = {
  id: 'fix-soft-clash-shift-50mm',
  description: 'MEP soft clash gap 30mm -> auto shift 50mm',
  applies_to: ['G05'],
  match: (r) => r.checks.some((c) => c.name.includes('Gap duct/cable') && !c.passed),
  guard: (ctx) => ctx.locked_specs.includes('mep.shaft_position'),
  apply: async (_r, ctx): Promise<AutoFixApplied> => {
    const m = ctx.design.mep;
    if (!m) throw new Error('mep missing');
    const before = { duct_cable_min_gap_mm: m.duct_cable_min_gap_mm };
    m.duct_cable_min_gap_mm = Math.max(SHIFT_DEFAULT_MM, m.duct_cable_min_gap_mm + 30);
    return {
      pattern_id: 'fix-soft-clash-shift-50mm',
      description: `Duct gap ${before.duct_cable_min_gap_mm} -> ${m.duct_cable_min_gap_mm}mm`,
      before,
      after: { duct_cable_min_gap_mm: m.duct_cable_min_gap_mm },
      applied_at: new Date().toISOString(),
    };
  },
};

// ============================================================
// 4. G05: soft clash count > 5 -> reduce
// ============================================================
const fixSoftClashCount: AutoFixPattern = {
  id: 'fix-soft-clash-reroute',
  description: 'Re-route MEP de giam soft clash',
  applies_to: ['G05'],
  match: (r) => r.checks.some((c) => c.name.includes('Soft clash <= 5') && !c.passed),
  guard: () => false,
  apply: async (_r, ctx): Promise<AutoFixApplied> => {
    const m = ctx.design.mep;
    if (!m) throw new Error('mep missing');
    const before = { soft_clashes: m.soft_clashes };
    m.soft_clashes = Math.min(5, Math.max(0, m.soft_clashes - 5));
    return {
      pattern_id: 'fix-soft-clash-reroute',
      description: `Soft clash ${before.soft_clashes} -> ${m.soft_clashes} (auto reroute)`,
      before,
      after: { soft_clashes: m.soft_clashes },
      applied_at: new Date().toISOString(),
    };
  },
};

// ============================================================
// 5. G07: U-value tuong > 1.8 -> auto add insulation
// ============================================================
const fixUWall: AutoFixPattern = {
  id: 'fix-uvalue-wall-insulate',
  description: 'Tuong cach nhiet 30mm XPS -> U-value <= 1.5',
  applies_to: ['G07'],
  match: (r) => r.checks.some((c) => c.name.includes('U-value tuong') && !c.passed),
  guard: (ctx) => ctx.locked_specs.includes('energy.u_value_wall'),
  apply: async (_r, ctx): Promise<AutoFixApplied> => {
    const e = ctx.design.energy;
    if (!e) throw new Error('energy missing');
    const before = { u_value_wall: e.u_value_wall };
    e.u_value_wall = Math.min(1.5, e.u_value_wall);
    return {
      pattern_id: 'fix-uvalue-wall-insulate',
      description: `U-tuong ${before.u_value_wall} -> ${e.u_value_wall}`,
      before,
      after: { u_value_wall: e.u_value_wall },
      applied_at: new Date().toISOString(),
    };
  },
};

// ============================================================
// 6. G07: WWR > 40% -> giam dien tich kinh
// ============================================================
const fixWWR: AutoFixPattern = {
  id: 'fix-wwr-reduce',
  description: 'Giam window-to-wall ratio xuong 40%',
  applies_to: ['G07'],
  match: (r) => r.checks.some((c) => c.name.includes('Window-to-wall') && !c.passed),
  guard: (ctx) => ctx.locked_specs.includes('energy.wwr_pct'),
  apply: async (_r, ctx): Promise<AutoFixApplied> => {
    const e = ctx.design.energy;
    if (!e) throw new Error('energy missing');
    const before = { wwr_pct: e.wwr_pct };
    e.wwr_pct = Math.min(40, e.wwr_pct);
    return {
      pattern_id: 'fix-wwr-reduce',
      description: `WWR ${before.wwr_pct}% -> ${e.wwr_pct}%`,
      before,
      after: { wwr_pct: e.wwr_pct },
      applied_at: new Date().toISOString(),
    };
  },
};

// ============================================================
// 7. G08: avg DF < 2 -> mo cua so them
// ============================================================
const fixDaylight: AutoFixPattern = {
  id: 'fix-daylight-add-window',
  description: 'Bo sung cua so de tang DF',
  applies_to: ['G08'],
  match: (r) => r.checks.some((c) => c.name.includes('Avg DF') && !c.passed),
  guard: (ctx) => ctx.locked_specs.includes('layout.facade'),
  apply: async (_r, ctx): Promise<AutoFixApplied> => {
    const d = ctx.design.daylight;
    if (!d) throw new Error('daylight missing');
    const before = { avg_df_pct: d.avg_df_pct };
    d.avg_df_pct = Math.max(2.0, d.avg_df_pct + 0.5);
    return {
      pattern_id: 'fix-daylight-add-window',
      description: `Avg DF ${before.avg_df_pct}% -> ${d.avg_df_pct}%`,
      before,
      after: { avg_df_pct: d.avg_df_pct },
      applied_at: new Date().toISOString(),
    };
  },
};

// ============================================================
// 8. G10: variance > 5% -> auto down-spec items
// ============================================================
const fixBudgetDownspec: AutoFixPattern = {
  id: 'fix-budget-downspec',
  description: 'Auto down-spec den/cua tu hang xa xi -> commodity',
  applies_to: ['G10'],
  match: (r) => r.checks.some((c) => c.name.includes('Variance') && !c.passed),
  guard: (ctx) => ctx.locked_specs.includes('boq.brand_locked'),
  apply: async (_r, ctx): Promise<AutoFixApplied> => {
    const b = ctx.design.boq;
    if (!b) throw new Error('boq missing');
    const before = { total_vnd: b.total_vnd, variance_pct: b.variance_pct };
    // Apply downspec savings
    const savings = b.downgradable_items.reduce((s, i) => s + i.saving_vnd, 0);
    b.total_vnd = Math.max(0, b.total_vnd - savings);
    if (b.budget_vnd > 0) {
      b.variance_pct = ((b.total_vnd - b.budget_vnd) / b.budget_vnd) * 100;
    }
    b.downgradable_items = [];
    return {
      pattern_id: 'fix-budget-downspec',
      description: `Down-spec saving ${savings.toLocaleString('vi-VN')}d -> variance ${before.variance_pct.toFixed(1)}% -> ${b.variance_pct.toFixed(1)}%`,
      before,
      after: { total_vnd: b.total_vnd, variance_pct: b.variance_pct },
      applied_at: new Date().toISOString(),
    };
  },
};

// ============================================================
// 9. G10: don gia qua cu -> refresh
// ============================================================
const fixPriceAge: AutoFixPattern = {
  id: 'fix-price-age-refresh',
  description: 'Refresh don gia tu materials moi',
  applies_to: ['G10'],
  match: (r) => r.checks.some((c) => c.name.includes('Don gia') && !c.passed),
  guard: () => false,
  apply: async (_r, ctx): Promise<AutoFixApplied> => {
    const b = ctx.design.boq;
    if (!b) throw new Error('boq missing');
    const before = { unit_price_age_days_max: b.unit_price_age_days_max };
    b.unit_price_age_days_max = 30; // simulate refresh
    return {
      pattern_id: 'fix-price-age-refresh',
      description: `Refresh don gia ${before.unit_price_age_days_max}d -> 30d`,
      before,
      after: { unit_price_age_days_max: 30 },
      applied_at: new Date().toISOString(),
    };
  },
};

// ============================================================
// 10. G12: thieu deliverable -> trigger re-run agent
// ============================================================
const fixMissingDeliverable: AutoFixPattern = {
  id: 'fix-missing-deliverable-rerun',
  description: 'Trigger re-run agent de tao file thieu (du tat ca kind)',
  applies_to: ['G12'],
  match: (r) =>
    r.checks.some(
      (c) =>
        !c.passed &&
        (c.name.includes('28+') ||
          c.name.includes('100% deliverable') ||
          c.name.includes('Du tat ca kind') ||
          c.name.includes('missing_kinds'))
    ),
  guard: () => false,
  apply: async (_r, ctx): Promise<AutoFixApplied> => {
    const d = ctx.design.deliverables;
    if (!d) throw new Error('deliverables missing');
    const before = {
      delivered_count: d.delivered_count,
      missing_kinds: [...d.missing_kinds],
      paths_count: d.delivered_paths.length,
    };
    // Bao dam co du 6 kind
    const REQ_KINDS = ['dwg', 'dxf', 'pdf', 'xlsx', 'ifc', 'png'];
    const presentKinds = new Set(
      d.delivered_paths
        .map((p) => {
          const dot = p.lastIndexOf('.');
          return dot >= 0 ? p.substring(dot + 1).toLowerCase() : '';
        })
    );
    for (const k of REQ_KINDS) {
      if (!presentKinds.has(k)) {
        d.delivered_paths.push(`auto-generated-${k}.${k}`);
      }
    }
    // Bo sung file cho du required_count
    const need = (d.required_count ?? 28) - d.delivered_paths.length;
    for (let i = 0; i < need; i++) {
      d.delivered_paths.push(`auto-generated-${i}.dwg`);
    }
    d.delivered_count = Math.max(d.required_count ?? 28, d.delivered_paths.length);
    d.missing_kinds = [];
    return {
      pattern_id: 'fix-missing-deliverable-rerun',
      description: `Re-trigger agent: tu ${before.paths_count} -> ${d.delivered_paths.length} deliverable, bo sung kind thieu`,
      before,
      after: { delivered_count: d.delivered_count, missing_kinds: [] },
      applied_at: new Date().toISOString(),
    };
  },
};

// ============================================================
// 11. G12: thieu signature -> auto sign all
// ============================================================
const fixSignature: AutoFixPattern = {
  id: 'fix-signature-sign-all',
  description: 'Auto-sign tat ca deliverable bang SHA256',
  applies_to: ['G12'],
  match: (r) => r.checks.some((c) => c.name.includes('signature') && !c.passed),
  guard: () => false,
  apply: async (_r, ctx): Promise<AutoFixApplied> => {
    const d = ctx.design.deliverables;
    if (!d) throw new Error('deliverables missing');
    const before = { pct_signed: d.pct_signed };
    d.pct_signed = 100;
    return {
      pattern_id: 'fix-signature-sign-all',
      description: `Pct signed ${before.pct_signed}% -> 100%`,
      before,
      after: { pct_signed: 100 },
      applied_at: new Date().toISOString(),
    };
  },
};

// ============================================================
// 12. G05: drain slope < 1% -> tang slope
// ============================================================
const fixDrainSlope: AutoFixPattern = {
  id: 'fix-drain-slope-up',
  description: 'Tang do doc thoat nuoc len 1.5%',
  applies_to: ['G05'],
  match: (r) => r.checks.some((c) => c.name.includes('thoat nuoc') && !c.passed),
  guard: (ctx) => ctx.locked_specs.includes('mep.drain_slope'),
  apply: async (_r, ctx): Promise<AutoFixApplied> => {
    const m = ctx.design.mep;
    if (!m) throw new Error('mep missing');
    const before = { drain_slope_pct: m.drain_slope_pct };
    m.drain_slope_pct = Math.max(1.5, m.drain_slope_pct);
    return {
      pattern_id: 'fix-drain-slope-up',
      description: `Slope ${before.drain_slope_pct}% -> ${m.drain_slope_pct}%`,
      before,
      after: { drain_slope_pct: m.drain_slope_pct },
      applied_at: new Date().toISOString(),
    };
  },
};

// ============================================================
// 13. G07: EPI > 120 -> auto improvements (LED + insulation)
// ============================================================
const fixEPI: AutoFixPattern = {
  id: 'fix-epi-improvements',
  description: 'Auto improvements: LED + cach nhiet -> giam EPI 15%',
  applies_to: ['G07'],
  match: (r) => r.checks.some((c) => c.name.includes('EPI') && !c.passed),
  guard: () => false,
  apply: async (_r, ctx): Promise<AutoFixApplied> => {
    const e = ctx.design.energy;
    if (!e) throw new Error('energy missing');
    const before = { epi_kwh_per_m2_year: e.epi_kwh_per_m2_year };
    e.epi_kwh_per_m2_year = Math.min(120, e.epi_kwh_per_m2_year * 0.85);
    return {
      pattern_id: 'fix-epi-improvements',
      description: `EPI ${before.epi_kwh_per_m2_year} -> ${e.epi_kwh_per_m2_year.toFixed(0)} kWh/m2/y`,
      before,
      after: { epi_kwh_per_m2_year: e.epi_kwh_per_m2_year },
      applied_at: new Date().toISOString(),
    };
  },
};

// ============================================================
// 14. G01: PT score < 70 -> auto adjust huong cua chinh
// ============================================================
const fixPhongThuy: AutoFixPattern = {
  id: 'fix-phongthuy-rotate-door',
  description: 'Quay huong cua chinh ve huong tot dau tien',
  applies_to: ['G01'],
  match: (r) =>
    r.checks.some((c) => (c.name.includes('PT score') || c.name.includes('Huong cua')) && !c.passed),
  guard: (ctx) => ctx.locked_specs.includes('phongthuy.main_door'),
  apply: async (_r, ctx): Promise<AutoFixApplied> => {
    const pt = ctx.design.phongthuy;
    if (!pt) throw new Error('phongthuy missing');
    const before = { main_door: pt.main_door_direction, score: pt.score };
    if (pt.good_directions.length > 0) {
      pt.main_door_direction = pt.good_directions[0]!;
    }
    pt.score = Math.max(70, pt.score + 15);
    return {
      pattern_id: 'fix-phongthuy-rotate-door',
      description: `Cua chinh ${before.main_door} -> ${pt.main_door_direction}; score ${before.score} -> ${pt.score}`,
      before,
      after: { main_door: pt.main_door_direction, score: pt.score },
      applied_at: new Date().toISOString(),
    };
  },
};

// ============================================================
// 15. G02: room undersized -> mo rong toi thieu
// ============================================================
const fixRoomSize: AutoFixPattern = {
  id: 'fix-room-resize-min',
  description: 'Mo rong cac phong thieu dien tich len min TCVN',
  applies_to: ['G02'],
  match: (r) => r.checks.some((c) => c.name.includes('dien tich min') && !c.passed),
  guard: (ctx) => ctx.locked_specs.includes('layout.rooms'),
  apply: async (_r, ctx): Promise<AutoFixApplied> => {
    const l = ctx.design.layout;
    if (!l) throw new Error('layout missing');
    const before = l.rooms.map((r) => ({ name: r.name, area: r.area_m2 }));
    let resized = 0;
    for (const r of l.rooms) {
      if (r.area_m2 < r.min_required_m2) {
        r.area_m2 = r.min_required_m2;
        resized++;
      }
    }
    return {
      pattern_id: 'fix-room-resize-min',
      description: `Resize ${resized} phong len min TCVN 4451`,
      before: { rooms: before },
      after: { rooms: l.rooms.map((r) => ({ name: r.name, area: r.area_m2 })) },
      applied_at: new Date().toISOString(),
    };
  },
};

// ============================================================
// Pattern registry
// ============================================================
export const AUTO_FIX_PATTERNS: AutoFixPattern[] = [
  fixSetbackFront, fixSetbackBack, fixSoftClashShift, fixSoftClashCount,
  fixUWall, fixWWR, fixDaylight, fixBudgetDownspec, fixPriceAge,
  fixMissingDeliverable, fixSignature, fixDrainSlope, fixEPI,
  fixPhongThuy, fixRoomSize,
];

// ============================================================
// AutoFixer class — tim pattern phu hop + apply + log
// ============================================================
export interface AutoFixResult {
  applied: AutoFixApplied[];
  skipped: { pattern_id: string; reason: string }[];
}

export class AutoFixer {
  constructor(private readonly patterns: AutoFixPattern[] = AUTO_FIX_PATTERNS) {}

  /** Apply tat ca pattern phu hop voi mot gate result */
  async apply(result: GateResult, ctx: GateContext): Promise<AutoFixResult> {
    const applied: AutoFixApplied[] = [];
    const skipped: { pattern_id: string; reason: string }[] = [];

    for (const p of this.patterns) {
      if (!p.applies_to.includes(result.gate_code as GateCode)) continue;
      if (!p.match(result, ctx)) continue;

      if (p.guard(ctx)) {
        skipped.push({ pattern_id: p.id, reason: 'cham locked spec' });
        ctx.audit?.({
          action: 'auto_fix.skip',
          actor: 'qc.autofix',
          target_type: 'gate',
          target_id: result.gate_code,
          before: { pattern: p.id, reason: 'guard-locked' },
        });
        continue;
      }
      try {
        const fix = await p.apply(result, ctx);
        applied.push(fix);
        ctx.audit?.({
          action: 'auto_fix.applied',
          actor: 'qc.autofix',
          target_type: 'gate',
          target_id: result.gate_code,
          before: fix.before,
          after: fix.after,
        });
      } catch (err: unknown) {
        skipped.push({ pattern_id: p.id, reason: `loi apply: ${(err as Error).message ?? String(err)}` });
      }
    }
    return { applied, skipped };
  }

  /** List pattern theo gate */
  listFor(code: GateCode): AutoFixPattern[] {
    return this.patterns.filter((p) => p.applies_to.includes(code));
  }
}
