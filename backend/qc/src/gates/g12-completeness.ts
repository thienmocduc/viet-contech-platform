/**
 * G12 — Document completeness (28+ deliverable).
 * Phase B7. Check ho so dau ra du 28 ban ve + BOQ + render + IFC.
 */

import type { CheckItem, GateContext, GateResult } from '../types.js';
import { finalize } from './_finalize.js';

const REQUIRED_TOTAL = 28;
const REQUIRED_KINDS = ['dwg', 'dxf', 'pdf', 'xlsx', 'ifc', 'png'];

export async function runG12(ctx: GateContext): Promise<GateResult> {
  const t0 = Date.now();
  const checks: CheckItem[] = [];
  const d = ctx.design.deliverables;

  const delivered = d?.delivered_count ?? 0;
  checks.push({
    name: `Du ${REQUIRED_TOTAL}+ deliverable`,
    passed: delivered >= REQUIRED_TOTAL,
    actual: delivered,
    expected: REQUIRED_TOTAL,
    severity: 'critical',
    suggestion: delivered < REQUIRED_TOTAL ? `Thieu ${REQUIRED_TOTAL - delivered} ban ve` : undefined,
  });

  const required = d?.required_count ?? REQUIRED_TOTAL;
  const ratio = required > 0 ? (delivered / required) * 100 : 0;
  checks.push({
    name: '100% deliverable required co mat',
    passed: ratio >= 100,
    actual: `${ratio.toFixed(1)}%`,
    expected: '100%',
    severity: 'critical',
    suggestion: ratio < 100 ? 'Thieu file — chay agent missing' : undefined,
  });

  // Kind coverage
  const paths = d?.delivered_paths ?? [];
  const kindsPresent = new Set(
    paths.map((p) => {
      const dot = p.lastIndexOf('.');
      return dot >= 0 ? p.substring(dot + 1).toLowerCase() : '';
    })
  );
  const missingKinds = REQUIRED_KINDS.filter((k) => !kindsPresent.has(k));
  checks.push({
    name: 'Du tat ca kind: dwg/dxf/pdf/xlsx/ifc/png',
    passed: missingKinds.length === 0,
    actual: Array.from(kindsPresent).sort().join(','),
    expected: REQUIRED_KINDS.join(','),
    severity: 'critical',
    suggestion: missingKinds.length > 0 ? `Thieu kind: ${missingKinds.join(',')}` : undefined,
  });

  // Missing kinds tu DB cross-check
  const dbMissing = d?.missing_kinds ?? [];
  checks.push({
    name: 'Khong co missing_kinds tu DB',
    passed: dbMissing.length === 0,
    actual: dbMissing.length,
    expected: 0,
    severity: 'high',
    suggestion: dbMissing.length > 0 ? `Re-run agents: ${dbMissing.join(',')}` : undefined,
  });

  // Signature coverage
  const pctSigned = d?.pct_signed ?? 0;
  checks.push({
    name: '100% deliverable co signature SHA256',
    passed: pctSigned >= 100,
    actual: pctSigned,
    expected: 100,
    severity: 'high',
    suggestion: pctSigned < 100 ? 'Re-sign cac file thieu signature' : undefined,
  });

  // Co IFC for BIM handoff
  const hasIfc = paths.some((p) => p.toLowerCase().endsWith('.ifc'));
  checks.push({
    name: 'Co file IFC cho BIM handoff',
    passed: hasIfc,
    actual: hasIfc,
    expected: true,
    severity: 'high',
    suggestion: !hasIfc ? 'Export IFC tu BIM model' : undefined,
  });

  return finalize('G12', 'Document completeness (28+)', 'B7', checks, t0);
}
