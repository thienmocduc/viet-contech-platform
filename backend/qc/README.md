# Viet-Contech QC Gates Checkpoint System

12-gate Verification & Validation pyramid (NASA-grade) cho Viet-Contech AI Design Platform. Moi gate chay rule engine thuan TypeScript + TMR voting (3 voter song song) + auto-fix patterns + escalation theo severity.

## Cau truc

```
qc/
  src/
    types.ts                  # Tat ca types: QCGate, GateResult, VoteResult, QCReport, AutoFixPattern
    voting.ts                 # TMRVote class — 3 voter parallel, majority 2/3
    auto-fix.ts               # AutoFixer + 15 pattern (setback shrink, MEP shift, downspec, ...)
    escalation.ts             # EscalationEngine — severity -> action (log/warn/block/critical)
    qc-runner.ts              # QCRunner — chay all 12 hoac single gate
    api.ts                    # Hono routes /api/qc/run, /gate/:code, /report, /checklist
    gates/
      index.ts                # QC_GATES registry + GATE_RUNNERS map
      _finalize.ts            # Helper finalize 1 gate result tu danh sach checks
      g01-brief.ts            # Brief & Phong thuy compliance
      g02-layout.ts           # Layout & Quy hoach
      g03-structural.ts       # Ket cau BTCT (TCVN 5574:2018)
      g04-loads.ts            # Tai trong (TCVN 2737:2020)
      g05-mep.ts              # MEP routing khong clash
      g06-fire.ts             # PCCC (QCVN 06:2022)
      g07-energy.ts           # Nang luong (QCVN 09:2017)
      g08-daylight.ts         # Daylight + Acoustic
      g09-bim.ts              # BIM clash detection
      g10-boq.ts              # BOQ + Ngan sach (+/-5%)
      g11-legal.ts            # Phap ly & Ho so xin phep
      g12-completeness.ts     # Document completeness (28+ deliverable)
  tests/
    test-qc.ts                # E2E test 4 scenario
  package.json
  tsconfig.json
  README.md
```

## 12 QC Gates

### G01 — Brief & Phong Thuy compliance (Phase B1)
Muc dich: dam bao brief khach hang day du 13 truong, cung menh tinh chinh xac tu Bat Trach va PT score >= 70/100. **Voters**: g01_v1 (default), g01_v2_alt (lenient), g01_strict. **Auto-fix**: quay huong cua chinh ve huong tot dau tien khi PT score < 70.

### G02 — Layout & Quy hoach (Phase B3)
Muc dich: tuan thu QCXDVN 01:2021 va TCVN 4451:2012 — mat do <=80%, lui mat tien >=1.5m, sau >=2m, chieu cao <=21m, hanh lang >=0.9m, cac phong dat dien tich min. **Voters**: g02_v1, g02_v2_alt, g02_strict. **Auto-fix**: shrink setback +0.2m, mo rong phong undersized, lui sau +0.3m.

### G03 — Ket cau BTCT (TCVN 5574:2018) (Phase B4)
Muc dich: cap be tong B20+, cot thep CB300+, cot >=200x200mm, dam >=200x300mm, san >=100mm, ti le cot thep min 0.4%, do vong <=L/250. **Voters**: g03_v1, g03_v2_alt, g03_strict (TCVN-only). **Auto-fix**: KHONG (kien truc su phai duyet).

### G04 — Tai trong (TCVN 2737:2020) (Phase B4)
Muc dich: cross-check zone dong dat khai bao, tai gio theo chieu cao, tai tinh san, so tang vs nen mong, tiet dien chiu tai. **Voters**: g04_v1, g04_v2_alt, g04_strict. **Auto-fix**: KHONG.

### G05 — MEP routing khong clash (Phase B5)
Muc dich: tai dien VA/m2 trong [70,100], do doc thoat nuoc >=1%, HVAC >=400 Btu/m2, hard clash=0, soft <=5, gap duct/cable >=50mm, co truc dung shaft. **Voters**: g05_v1, g05_v2_alt, g05_strict. **Auto-fix**: shift line +50mm khi gap thieu, re-route reduce soft clash, tang slope thoat nuoc.

### G06 — PCCC (QCVN 06:2022) (Phase B5)
Muc dich: >=1 loi thoat hiem (>=2 cho nha >=8 tang), khoang cach toi exit <=25m, cua chong chay EI60+, dau bao chay du, sprinkler khi can. **Voters**: g06_v1, g06_v2_alt, g06_strict. **Auto-fix**: KHONG (lien quan an toan tinh mang).

### G07 — Nang luong (QCVN 09:2017) (Phase B5)
Muc dich: EPI <=120 kWh/m2/year, U-tuong <=1.8, U-mai <=1.0, WWR <=40%. **Voters**: g07_v1, g07_v2_alt, g07_strict. **Auto-fix**: bo sung cach nhiet tuong/mai (XPS 30mm), giam WWR, doi den LED, simulate EPI giam 15%.

### G08 — Daylight + Acoustic (Phase B5)
Muc dich: avg DF >=2%, min DF >=1% (phong toi nhat), STC tuong >=50dB, IIC san >=50dB. **Voters**: g08_v1, g08_v2_alt, g08_strict. **Auto-fix**: bo sung cua so / lay sang giua de tang DF.

### G09 — BIM clash detection (Phase B5)
Muc dich: total BIM >=100 element, hard clash=0, soft <=5, IFC export OK, sync MEP-BIM clash khop nhau. **Voters**: g09_v1, g09_v2_alt, g09_strict. **Auto-fix**: KHONG (re-run BIM agent).

### G10 — BOQ + Ngan sach (+/-5%) (Phase B7)
Muc dich: variance vs budget <=5%, >=95% items boc tu DXF, don gia <=90 ngay, items >=50, total>0, budget>0. **Voters**: g10_v1, g10_v2_alt, g10_strict. **Auto-fix**: down-spec items luxury -> commodity (Philips Hue -> LED, cua Vitraa -> MDF veneer), refresh don gia.

### G11 — Phap ly & Ho so xin phep (Phase B7)
Muc dich: co GCN QSDD, don xin GP xay dung, zoning match, mat do/chieu cao tuan thu, ho so xin phep day du 8+ doc. **Voters**: g11_v1, g11_v2_alt, g11_strict. **Auto-fix**: KHONG (legal phai do KTS chot).

### G12 — Document completeness (28+ deliverable) (Phase B7)
Muc dich: du 28+ deliverable, 100% required co mat, du 6 kind (dwg/dxf/pdf/xlsx/ifc/png), 100% co signature SHA256, co IFC. **Voters**: g12_v1, g12_v2_alt, g12_strict. **Auto-fix**: trigger re-run agent de bu file thieu, auto-sign tat ca deliverable.

## Architecture: TMR Voting

3 voter chay PARALLEL qua `Promise.all`. Moi voter co bias khac nhau:
- **v1 (default)**: chuan, pass khi `result.status === 'pass'`
- **v2_alt (lenient)**: pass khi khong co fail high/critical
- **strict**: pass khi result.status === 'pass' VA score >= 90

Majority 2/3 quyet dinh. Confidence = high/medium/low theo do dong thuan.

## Auto-Fix

15 pattern, moi pattern co `match()`, `guard()` (block khi cham locked spec), `apply()` (modify design in-place). AutoFixer chay tat ca pattern phu hop, log vao audit_log.

## Escalation Ladder

| Severity | Channels | Stop pipeline | Lock revision | KTS approval |
|----------|----------|----------------|----------------|---------------|
| low | log | NO | NO | NO |
| medium | log + notification | NO | NO | NO |
| high | log + notification + email | YES | NO | YES |
| critical | log + notification + email + SMS + Slack | YES | YES | YES |

## API Endpoints

```
POST /api/qc/run                                 # Run all 12 gates
POST /api/qc/gate/:code                          # Run single gate (G01-G12)
GET  /api/qc/report/:project_id/:revision_id     # Fetch cached report
GET  /api/qc/checklist/:project_id               # Live status 12 gate
GET  /api/qc/audit/:project_id                   # Debug audit entries
```

## Run Tests

```bash
cd platform/backend/qc
npm install
npm run typecheck   # 0 errors
npm test            # E2E 4 scenario, 20/20 assertions
```

## Test scenarios

1. **pass-all** — Design tot, 12/12 PASS, score 100/100
2. **structural-fail** — Cot 150x150 vi pham TCVN 5574 -> G03 fail critical -> STOP + LOCK revision
3. **budget-fail** — Variance 8% -> G10 auto-fix down-spec (Philips Hue -> LED) -> re-run pass
4. **completeness-fail** — Thieu 5 deliverable + signature 70% -> G12 auto-fix re-trigger -> re-run pass

## Tich hop voi DB

Module nay map 1-1 voi `qc_gates` table trong `db/migrations/001_init.sql`:
- `gate_code` (G01-G12)
- `status` (pending/passed/failed/auto_fixed)
- `voters_json` (TMR votes JSON)
- `auto_fix_applied` (0/1)
- `blocker_message` (chi co khi escalate)

Audit trails ghi vao `audit_log` (immutable, append-only).
