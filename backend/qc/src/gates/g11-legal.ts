/**
 * G11 — Phap ly & Ho so xin phep.
 * Phase B7. Check giay to dat, mat do, chieu cao, ho so xin phep day du.
 */

import type { CheckItem, GateContext, GateResult } from '../types.js';
import { finalize } from './_finalize.js';

export async function runG11(ctx: GateContext): Promise<GateResult> {
  const t0 = Date.now();
  const checks: CheckItem[] = [];
  const lg = ctx.design.legal;

  checks.push({
    name: 'Co Giay chung nhan QSDD',
    passed: !!lg?.has_land_use_cert,
    actual: lg?.has_land_use_cert ?? false,
    expected: true,
    severity: 'critical',
    tcvn_ref: 'Luat dat dai 2024',
    suggestion: 'Yeu cau khach cung cap so do',
  });

  checks.push({
    name: 'Co don xin GP xay dung (form)',
    passed: !!lg?.has_building_permit_form,
    actual: lg?.has_building_permit_form ?? false,
    expected: true,
    severity: 'high',
    tcvn_ref: 'Luat xay dung 2014',
    suggestion: 'Generate don xin GP tu agent legal_assistant',
  });

  checks.push({
    name: 'Phu hop quy hoach phan khu',
    passed: !!lg?.zoning_match,
    actual: lg?.zoning_match ?? false,
    expected: true,
    severity: 'critical',
    suggestion: 'Sai zoning -> KHONG xin duoc GP. Re-thiet ke',
  });

  checks.push({
    name: 'Mat do tuan thu quy hoach',
    passed: !!lg?.density_compliant,
    actual: lg?.density_compliant ?? false,
    expected: true,
    severity: 'critical',
    suggestion: 'Vi pham mat do — giam dien tich san',
  });

  checks.push({
    name: 'Chieu cao tuan thu QH',
    passed: !!lg?.height_compliant,
    actual: lg?.height_compliant ?? false,
    expected: true,
    severity: 'critical',
    suggestion: 'Vi pham chieu cao — giam tang',
  });

  checks.push({
    name: 'Ho so xin phep day du (8+ doc)',
    passed: !!lg?.permit_docs_complete,
    actual: lg?.permit_docs_complete ?? false,
    expected: true,
    severity: 'high',
    suggestion: 'Bo sung: ban ve KT/KC/MEP/PCCC/Thuyet minh',
  });

  return finalize('G11', 'Phap ly & Ho so xin phep', 'B7', checks, t0);
}
