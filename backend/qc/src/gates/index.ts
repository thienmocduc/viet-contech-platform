/**
 * Definition cua 12 QC Gates Checkpoint System.
 * Mapping gate_code -> gate definition + voters list + run function.
 *
 * Voters la 3 chien luoc khac biet de TMR (Triple Modular Redundancy):
 * - <code>_v1: agent v1 default (chuan)
 * - <code>_v2_alt: agent v2 alternative (lenient — chap nhan warn medium)
 * - <code>_strict: agent strict (chi check theo TCVN, score >= 90 moi pass)
 */

import type { GateCode, GateContext, GateResult, QCGate } from '../types.js';
import { runG01 } from './g01-brief.js';
import { runG02 } from './g02-layout.js';
import { runG03 } from './g03-structural.js';
import { runG04 } from './g04-loads.js';
import { runG05 } from './g05-mep.js';
import { runG06 } from './g06-fire.js';
import { runG07 } from './g07-energy.js';
import { runG08 } from './g08-daylight.js';
import { runG09 } from './g09-bim.js';
import { runG10 } from './g10-boq.js';
import { runG11 } from './g11-legal.js';
import { runG12 } from './g12-completeness.js';

/** Helper sinh 3-tuple voter id chuan tu gate code */
function voterTriple(code: GateCode): [string, string, string] {
  const k = code.toLowerCase();
  return [`${k}_v1`, `${k}_v2_alt`, `${k}_strict`];
}

export const QC_GATES: QCGate[] = [
  {
    code: 'G01',
    name: 'Brief & Phong Thuy compliance',
    phase: 'B1',
    voters: voterTriple('G01'),
    description:
      'Kiem tra 13 truong brief day du, cung menh tinh dung tu Bat Trach, PT score >= 70/100, huong cua chinh trong nhom 4 huong tot.',
    pass_threshold: 70,
    auto_fixable: true,
    severity_on_fail: 'high',
    tcvn_refs: ['Phong thuy Bat Trach'],
    run: runG01,
  },
  {
    code: 'G02',
    name: 'Layout & Quy hoach',
    phase: 'B3',
    voters: voterTriple('G02'),
    description:
      'Kiem tra mat do <=80%, lui mat tien >=1.5m, lui sau >=2m, chieu cao <=21m, hanh lang >=0.9m, phong dat dien tich min TCVN 4451.',
    pass_threshold: 70,
    auto_fixable: true,
    severity_on_fail: 'high',
    tcvn_refs: ['QCXDVN 01:2021', 'TCVN 4451:2012'],
    run: runG02,
  },
  {
    code: 'G03',
    name: 'Ket cau BTCT (TCVN 5574:2018)',
    phase: 'B4',
    voters: voterTriple('G03'),
    description:
      'Kiem tra cap be tong B20+, cot thep CB300+, cot >=200x200, dam >=200x300, san >=100mm, ti le cot thep min 0.4%, do vong <=L/250.',
    pass_threshold: 80,
    auto_fixable: false,
    severity_on_fail: 'critical',
    tcvn_refs: ['TCVN 5574:2018'],
    run: runG03,
  },
  {
    code: 'G04',
    name: 'Tai trong (TCVN 2737:2020)',
    phase: 'B4',
    voters: voterTriple('G04'),
    description:
      'Cross-check zone dong dat khai bao, tai gio theo chieu cao, tai tinh san, so tang vs nen mong, tiet dien chiu tai.',
    pass_threshold: 75,
    auto_fixable: false,
    severity_on_fail: 'critical',
    tcvn_refs: ['TCVN 2737:2020', 'TCVN 9386:2012'],
    run: runG04,
  },
  {
    code: 'G05',
    name: 'MEP routing khong clash',
    phase: 'B5',
    voters: voterTriple('G05'),
    description:
      'Tai dien VA/m2 [70,100], do doc thoat nuoc >=1%, HVAC >=400 Btu/m2, hard clash=0, soft clash<=5, gap duct/cable >=50mm.',
    pass_threshold: 75,
    auto_fixable: true,
    severity_on_fail: 'high',
    tcvn_refs: ['TCVN 7447', 'TCVN 4513:1988', 'TCVN 9385'],
    run: runG05,
  },
  {
    code: 'G06',
    name: 'PCCC (QCVN 06:2022)',
    phase: 'B5',
    voters: voterTriple('G06'),
    description:
      '>=1 loi thoat hiem (>=2 cho nha cao), exit dist <=25m, cua chong chay EI60+, dau bao chay du, sprinkler >=8 tang.',
    pass_threshold: 80,
    auto_fixable: false,
    severity_on_fail: 'critical',
    tcvn_refs: ['QCVN 06:2022'],
    run: runG06,
  },
  {
    code: 'G07',
    name: 'Nang luong (QCVN 09:2017)',
    phase: 'B5',
    voters: voterTriple('G07'),
    description:
      'EPI <=120 kWh/m2/year, U-tuong <=1.8, U-mai <=1.0, WWR <=40%, co cach nhiet tuong/mai.',
    pass_threshold: 70,
    auto_fixable: true,
    severity_on_fail: 'high',
    tcvn_refs: ['QCVN 09:2017'],
    run: runG07,
  },
  {
    code: 'G08',
    name: 'Daylight + Acoustic',
    phase: 'B5',
    voters: voterTriple('G08'),
    description:
      'Avg DF >=2%, Min DF >=1% (phong toi nhat), STC tuong >=50dB, IIC san >=50dB.',
    pass_threshold: 70,
    auto_fixable: true,
    severity_on_fail: 'medium',
    tcvn_refs: ['TCVN 4451:2012', 'TCVN 7878:2018'],
    run: runG08,
  },
  {
    code: 'G09',
    name: 'BIM clash detection',
    phase: 'B5',
    voters: voterTriple('G09'),
    description:
      'Total BIM >=100, hard clash=0, soft <=5, IFC export OK, sync MEP-BIM clash khop nhau.',
    pass_threshold: 80,
    auto_fixable: false,
    severity_on_fail: 'critical',
    tcvn_refs: ['ISO 19650', 'IFC 4.3'],
    run: runG09,
  },
  {
    code: 'G10',
    name: 'BOQ + Ngan sach (+/-5%)',
    phase: 'B7',
    voters: voterTriple('G10'),
    description:
      'Variance <=5%, >=95% boc tu DXF, don gia <=90 ngay, items >=50, total>0, budget>0.',
    pass_threshold: 80,
    auto_fixable: true,
    severity_on_fail: 'high',
    tcvn_refs: ['Don gia xay dung 2026'],
    run: runG10,
  },
  {
    code: 'G11',
    name: 'Phap ly & Ho so xin phep',
    phase: 'B7',
    voters: voterTriple('G11'),
    description:
      'Co GCN QSDD, don xin GP, zoning match, mat do/chieu cao tuan thu, ho so xin phep day du 8+ doc.',
    pass_threshold: 90,
    auto_fixable: false,
    severity_on_fail: 'critical',
    tcvn_refs: ['Luat dat dai 2024', 'Luat xay dung 2014'],
    run: runG11,
  },
  {
    code: 'G12',
    name: 'Document completeness (28+ deliverable)',
    phase: 'B7',
    voters: voterTriple('G12'),
    description:
      'Du 28+ deliverable, 100% required co mat, du 6 kind (dwg/dxf/pdf/xlsx/ifc/png), 100% co signature SHA256, co IFC.',
    pass_threshold: 95,
    auto_fixable: true,
    severity_on_fail: 'high',
    tcvn_refs: ['ISO 9001:2015'],
    run: runG12,
  },
];

/** Helper get gate by code */
export function getGate(code: GateCode): QCGate | undefined {
  return QC_GATES.find((g) => g.code === code);
}

/** Map code -> runner function (de bootstrap voter pool) */
export const GATE_RUNNERS: Record<GateCode, (ctx: GateContext) => Promise<GateResult>> = {
  G01: runG01, G02: runG02, G03: runG03, G04: runG04, G05: runG05, G06: runG06,
  G07: runG07, G08: runG08, G09: runG09, G10: runG10, G11: runG11, G12: runG12,
};
