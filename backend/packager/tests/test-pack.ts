// ===============================================================
// E2E test cho OutputPackager.pack()
// ===============================================================
// Mock 28+ drawings, BOQ, IFC, renders → run pack() →
// verify: archive exists, metadata sha256 match, cover.pdf valid PDF
//
// Chạy: tsx tests/test-pack.ts
// ===============================================================

import { mkdir, writeFile, rm, readFile, stat } from 'node:fs/promises';
import { existsSync, createReadStream } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import AdmZip from 'adm-zip';
import { OutputPackager } from '../src/index.js';
import {
  buildIndustryName, parseIndustryName, isValidIndustryName, camelize,
} from '../src/naming-convention.js';
import {
  validatePackOpts, formatValidationReport,
} from '../src/validators.js';
import { PackOptsSchema, type PackOpts, type DrawingItem } from '../src/types.js';

// ----------------------------------------------------------------
// Paths
// ----------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const FIXTURE_DIR = join(ROOT, 'data', '_test-pack-fixtures');
const OUT_DIR = join(ROOT, 'data', 'output', 'pack-tests');

// ----------------------------------------------------------------
// Mock data — 28 drawings (đủ cho permit_submission)
// ----------------------------------------------------------------

const DRAWING_SPECS: { type: string; name: string; format: 'dwg' | 'pdf'; number?: string }[] = [
  // Kiến trúc (KT) — 11 drawings
  { type: 'KT', name: 'Mặt bằng tổng thể', format: 'dwg', number: '01' },
  { type: 'KT', name: 'Mặt bằng tầng 1', format: 'dwg', number: '02' },
  { type: 'KT', name: 'Mặt bằng tầng 2', format: 'dwg', number: '03' },
  { type: 'KT', name: 'Mặt bằng tầng 3', format: 'dwg', number: '04' },
  { type: 'KT', name: 'Mặt bằng mái', format: 'dwg', number: '05' },
  { type: 'KT', name: 'Mặt đứng chính', format: 'dwg', number: '06' },
  { type: 'KT', name: 'Mặt đứng bên trái', format: 'dwg', number: '07' },
  { type: 'KT', name: 'Mặt đứng bên phải', format: 'dwg', number: '08' },
  { type: 'KT', name: 'Mặt đứng sau', format: 'dwg', number: '09' },
  { type: 'KT', name: 'Mặt cắt A-A', format: 'dwg', number: '10' },
  { type: 'KT', name: 'Mặt cắt B-B', format: 'dwg', number: '11' },
  // Kết cấu (KC) — 4 drawings
  { type: 'KC', name: 'Mặt bằng cọc móng', format: 'dwg', number: '01' },
  { type: 'KC', name: 'Mặt bằng cột tầng', format: 'dwg', number: '02' },
  { type: 'KC', name: 'Mặt bằng dầm sàn', format: 'dwg', number: '03' },
  { type: 'KC', name: 'Báo cáo tính toán Etabs', format: 'pdf', number: '04' },
  // Điện (DT) — 2 drawings
  { type: 'DT', name: 'Mặt bằng điện chính', format: 'dwg', number: '01' },
  { type: 'DT', name: 'Sơ đồ nguyên lý điện', format: 'dwg', number: '02' },
  // Cấp thoát nước (CN) — 1 drawing
  { type: 'CN', name: 'Mặt bằng cấp thoát nước', format: 'dwg', number: '01' },
  // HVAC — 1 drawing
  { type: 'HVAC', name: 'Mặt bằng HVAC', format: 'dwg', number: '01' },
  // PCCC — 1 drawing
  { type: 'PCCC', name: 'Mặt bằng PCCC', format: 'dwg', number: '01' },
  // Nội thất (NT) — 3 drawings
  { type: 'NT', name: 'Mặt bằng nội thất', format: 'dwg', number: '01' },
  { type: 'NT', name: 'Mặt bằng trần', format: 'dwg', number: '02' },
  { type: 'NT', name: 'Chi tiết tủ kệ', format: 'dwg', number: '03' },
  // Thêm 5 drawings phụ để vượt 28
  { type: 'KT', name: 'Chi tiết cửa', format: 'dwg', number: '12' },
  { type: 'KT', name: 'Chi tiết cầu thang', format: 'dwg', number: '13' },
  { type: 'KC', name: 'Chi tiết móng cọc', format: 'pdf', number: '05' },
  { type: 'NT', name: 'Bảng vật liệu nội thất', format: 'pdf', number: '04' },
  { type: 'PCCC', name: 'Sơ đồ thoát hiểm', format: 'dwg', number: '02' },
];

// ----------------------------------------------------------------
// Setup fixtures
// ----------------------------------------------------------------

async function setupFixtures(): Promise<{
  drawings: DrawingItem[];
  boq: string;
  ifc: string;
  renders: string[];
  reports: { name: string; path: string }[];
}> {
  await rm(FIXTURE_DIR, { recursive: true, force: true });
  await mkdir(FIXTURE_DIR, { recursive: true });

  // Drawings
  const drawings: DrawingItem[] = [];
  for (let i = 0; i < DRAWING_SPECS.length; i++) {
    const s = DRAWING_SPECS[i]!;
    const fname = `mock_${s.type}_${s.number}.${s.format}`;
    const path = join(FIXTURE_DIR, fname);
    const sizeKb = s.format === 'pdf' ? 25 : 8;
    const content = Buffer.alloc(sizeKb * 1024, `MOCK-${s.type}-${s.number}-${i}\n`);
    await writeFile(path, content);
    drawings.push({
      type: s.type,
      name: s.name,
      number: s.number,
      format: s.format,
      path,
      code: `${s.type}-${s.number}`,
      phase: 'DD',
    });
  }

  // BOQ xlsx mock (4KB)
  const boq = join(FIXTURE_DIR, 'mock_boq.xlsx');
  await writeFile(boq, Buffer.alloc(4096, 'MOCK-BOQ-XLSX'));

  // IFC mock (50KB)
  const ifc = join(FIXTURE_DIR, 'mock_bim.ifc');
  await writeFile(
    ifc,
    `ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('ViewDefinition'),'2;1');\n${'/* mock */ '.repeat(2000)}\nENDSEC;\n`,
  );

  // Renders 12 PNGs (mock)
  const renders: string[] = [];
  for (let s = 1; s <= 3; s++) {
    for (let a = 1; a <= 4; a++) {
      const path = join(FIXTURE_DIR, `style${s}_angle${a}.png`);
      // Minimal valid PNG (1x1 transparent)
      const png = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89,
        0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54,
        0x78, 0x9c, 0x62, 0x00, 0x00, 0x00, 0x00, 0x05,
        0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4,
        0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
      ]);
      await writeFile(path, png);
      renders.push(path);
    }
  }

  // Reports (PDFs mock)
  const reportEtabs = join(FIXTURE_DIR, 'etabs_report.pdf');
  await writeFile(reportEtabs, Buffer.alloc(60_000, 'MOCK-ETABS-PDF'));
  const reportGeo = join(FIXTURE_DIR, 'khaosat_diachat.pdf');
  await writeFile(reportGeo, Buffer.alloc(40_000, 'MOCK-GEO-PDF'));

  return {
    drawings,
    boq,
    ifc,
    renders,
    reports: [
      { name: 'BaoCaoTinhKetCauEtabs', path: reportEtabs },
      { name: 'KhaoSatDiaChat', path: reportGeo },
    ],
  };
}

// ----------------------------------------------------------------
// Asserts
// ----------------------------------------------------------------

let passCount = 0;
let failCount = 0;

function assert(cond: unknown, msg: string): asserts cond {
  if (cond) {
    passCount++;
    console.log(`  ok: ${msg}`);
  } else {
    failCount++;
    console.error(`  FAIL: ${msg}`);
    process.exitCode = 1;
  }
}

// ----------------------------------------------------------------
// Test cases
// ----------------------------------------------------------------

async function testNamingConvention() {
  console.log('\n[1] Industry naming convention');
  const fname = buildIndustryName({
    projectCode: 'VCT-2026-001',
    phase: 'DD',
    discipline: 'KT',
    number: '01',
    description: 'Mặt bằng tầng 1',
    revision: 2,
    ext: 'dwg',
  });
  assert(fname === 'VCT-2026-001_DD_KT_01_MatBangTang1_R02.dwg',
    `naming: ${fname}`);
  assert(isValidIndustryName(fname), `valid format: ${fname}`);
  const parsed = parseIndustryName(fname);
  assert(parsed !== null, 'parser returns object');
  assert(parsed?.projectCode === 'VCT-2026-001', 'parsed projectCode');
  assert(parsed?.phase === 'DD', 'parsed phase');
  assert(parsed?.discipline === 'KT', 'parsed discipline');
  assert(parsed?.revision === 2, 'parsed revision');
  // Camelize
  assert(camelize('Mặt bằng tầng 1') === 'MatBangTang1', 'camelize basic');
  assert(camelize('Sơ đồ nguyên lý điện') === 'SoDoNguyenLyDien', 'camelize complex');
}

async function testValidatorPermit(fixtures: Awaited<ReturnType<typeof setupFixtures>>) {
  console.log('\n[2] Validator — permit_submission requires ≥28 drawings');
  // Tạo subset thiếu — chỉ 10 drawings
  const fewDrawings = fixtures.drawings.slice(0, 10);
  const result = await validatePackOpts({
    projectId: 'proj_test',
    revisionId: 'rev_1',
    packageType: 'permit_submission',
    deliverables: { drawings: fewDrawings },
    output_format: 'zip',
  });
  assert(!result.ok, 'fail when < 28 drawings');
  assert(
    result.errors.some(e => e.code === 'permit_drawings_insufficient'),
    'error code: permit_drawings_insufficient',
  );
}

async function testValidatorClientFull(fixtures: Awaited<ReturnType<typeof setupFixtures>>) {
  console.log('\n[3] Validator — client_full requires BOQ + IFC');
  // Thiếu BOQ + IFC
  const result = await validatePackOpts({
    projectId: 'proj_test',
    revisionId: 'rev_1',
    packageType: 'client_full',
    deliverables: { drawings: fixtures.drawings },
    output_format: 'zip',
  });
  assert(!result.ok, 'fail without BOQ + IFC');
  assert(
    result.errors.some(e => e.code === 'client_full_boq_required'),
    'BOQ required error',
  );
  assert(
    result.errors.some(e => e.code === 'client_full_ifc_required'),
    'IFC required error',
  );
}

async function testPackOptsSchema(fixtures: Awaited<ReturnType<typeof setupFixtures>>) {
  console.log('\n[4] PackOpts zod schema parses');
  const opts: PackOpts = {
    projectId: 'proj_test_uuid',
    revisionId: 'rev_2',
    packageType: 'client_full',
    deliverables: {
      drawings: fixtures.drawings,
      boq: fixtures.boq,
      ifc: fixtures.ifc,
      renders: fixtures.renders,
      reports: fixtures.reports,
    },
    project: {
      code: 'VCT-2026-001',
      name: 'Nhà phố ô. Nguyễn Văn A — Q.7 TPHCM',
      owner_name: 'Nguyễn Văn A',
      address: '456 Lê Văn Lương, P. Tân Phong, Q.7, TPHCM',
      phase: 'DD',
      designed_by: 'Việt-Contech Co., Ltd',
      signed_by_kts: 'KTS Trần Thị B',
      cert_no: 'CCHN-2025-0042',
    },
    branding: {
      company: 'VIET CONTECH',
      color: '#C4933A',
      tagline: 'Architecture & Construction',
      website: 'vietcontech.vn',
    },
    output_format: 'zip',
    online_review_url: 'https://vietcontech.vn/review/abc123',
  };
  const parsed = PackOptsSchema.safeParse(opts);
  assert(parsed.success, 'PackOpts.parse success');
}

async function testE2EPack(fixtures: Awaited<ReturnType<typeof setupFixtures>>): Promise<string> {
  console.log('\n[5] E2E pack() — client_full');
  await mkdir(OUT_DIR, { recursive: true });

  const packager = new OutputPackager({
    defaultOutDir: OUT_DIR,
    logger: () => { /* silent during test */ },
  });

  const start = Date.now();
  const result = await packager.pack({
    projectId: 'proj_test_e2e',
    revisionId: 'rev_2',
    packageType: 'client_full',
    deliverables: {
      drawings: fixtures.drawings,
      boq: fixtures.boq,
      ifc: fixtures.ifc,
      renders: fixtures.renders,
      reports: fixtures.reports,
    },
    project: {
      code: 'VCT-2026-001',
      name: 'Nhà phố ô. Nguyễn Văn A — Q.7 TPHCM',
      owner_name: 'Nguyễn Văn A',
      address: '456 Lê Văn Lương, P. Tân Phong, Q.7, TPHCM',
      phase: 'DD',
      designed_by: 'Việt-Contech Co., Ltd',
      signed_by_kts: 'KTS Trần Thị B',
      cert_no: 'CCHN-2025-0042',
    },
    branding: {
      company: 'VIET CONTECH',
      color: '#C4933A',
      tagline: 'Architecture & Construction',
      website: 'vietcontech.vn',
    },
    output_format: 'zip',
    online_review_url: 'https://vietcontech.vn/review/abc123',
  });
  const elapsed = Date.now() - start;

  console.log(`  build time: ${(elapsed / 1000).toFixed(2)}s`);
  console.log(`  archive: ${result.archive_path}`);
  console.log(`  size: ${(result.archive_size_bytes / 1024).toFixed(1)} KB`);
  console.log(`  files staged: ${result.total_files}`);
  console.log(`  archive sha256: ${result.archive_sha256.slice(0, 16)}...`);
  console.log(`  manifest signature: ${result.manifest_signature.slice(0, 16)}...`);
  console.log(`  warnings: ${result.warnings.length}`);

  assert(result.ok, 'pack ok');
  assert(existsSync(result.archive_path), 'archive file exists on disk');
  assert(result.archive_size_bytes > 10_000, `archive ≥ 10KB (got ${result.archive_size_bytes})`);
  assert(result.total_files >= fixtures.drawings.length, `≥ drawing count files`);
  assert(result.manifest_signature.length === 64, 'manifest sig SHA-256');
  assert(result.archive_sha256.length === 64, 'archive sha256');
  assert(result.counts.drawings === fixtures.drawings.length, 'drawing count match');
  assert(result.counts.boq === 1, 'boq count = 1');
  assert(result.counts.ifc === 1, 'ifc count = 1');
  assert(result.counts.renders === fixtures.renders.length, 'render count match');
  return result.archive_path;
}

async function testZipContents(archivePath: string) {
  console.log('\n[6] Verify ZIP contents');
  assert(existsSync(archivePath), 'archive file exists');

  const zip = new AdmZip(archivePath);
  const entries = zip.getEntries();
  console.log(`  zip entries: ${entries.length}`);

  // Top-level metadata files
  const names = entries.map(e => e.entryName);
  assert(names.some(n => n === '00_README.html'), '00_README.html exists');
  assert(names.some(n => n === '00_metadata.json'), '00_metadata.json exists');
  assert(names.some(n => n === '00_manifest.txt'), '00_manifest.txt exists');
  assert(names.some(n => n === '00_cover.pdf'), '00_cover.pdf exists');

  // Folder structure
  assert(names.some(n => n.startsWith('01_KienTruc/')), '01_KienTruc/ folder');
  assert(names.some(n => n.startsWith('02_KetCau/')), '02_KetCau/ folder');
  assert(names.some(n => n.startsWith('03_DienNuoc/')), '03_DienNuoc/ folder');
  assert(names.some(n => n.startsWith('04_HVAC_PCCC/')), '04_HVAC_PCCC/ folder');
  assert(names.some(n => n.startsWith('05_NoiThat/')), '05_NoiThat/ folder');
  assert(names.some(n => n.startsWith('06_Render/')), '06_Render/ folder');
  assert(names.some(n => n.startsWith('07_BOQ/')), '07_BOQ/ folder');
  assert(names.some(n => n.startsWith('08_BIM/')), '08_BIM/ folder');
  assert(names.some(n => n.startsWith('10_BaoCao/')), '10_BaoCao/ folder');

  // Naming convention check — sample 1 KT actual file (skip folder entries)
  const ktFile = names.find(n => n.startsWith('01_KienTruc/') && /\.[a-z0-9]+$/i.test(n));
  assert(ktFile !== undefined, 'has KT file');
  if (ktFile) {
    const fileName = ktFile.split('/').pop()!;
    assert(isValidIndustryName(fileName), `KT filename valid: ${fileName}`);
  }

  // Read metadata.json
  const metaEntry = zip.getEntry('00_metadata.json');
  assert(metaEntry !== null, 'metadata entry exists');
  const metaJson = JSON.parse(metaEntry!.getData().toString('utf-8'));
  assert(metaJson.schema_version === '2.0.0', 'schema version 2.0.0');
  assert(metaJson.package_id.startsWith('PKG-'), 'package_id starts with PKG-');
  assert(metaJson.manifest_signature.length === 64, 'metadata manifest_signature SHA-256');
  assert(Array.isArray(metaJson.files) && metaJson.files.length > 0, 'metadata has files array');

  // Verify SHA-256 của 1 file random từ ZIP match metadata
  const samp = metaJson.files[0]!;
  const sampEntry = zip.getEntry(samp.rel_path);
  assert(sampEntry !== null, `sample file exists: ${samp.rel_path}`);
  if (sampEntry) {
    const buf = sampEntry.getData();
    const computedSha = createHash('sha256').update(buf).digest('hex');
    assert(computedSha === samp.sha256, `sha256 match for ${samp.rel_path}`);
  }

  // Cover PDF — verify magic bytes
  const coverEntry = zip.getEntry('00_cover.pdf');
  assert(coverEntry !== null, 'cover entry exists');
  if (coverEntry) {
    const buf = coverEntry.getData();
    const head = buf.slice(0, 5).toString('ascii');
    assert(head === '%PDF-', `cover.pdf magic header: ${head}`);
    assert(buf.length > 1000, `cover.pdf size ≥ 1KB (got ${buf.length})`);
  }

  // README.html sanity
  const readmeEntry = zip.getEntry('00_README.html');
  if (readmeEntry) {
    const html = readmeEntry.getData().toString('utf-8');
    assert(html.includes('<!DOCTYPE html>'), 'README is HTML5');
    assert(html.includes('VIET CONTECH'), 'README brand');
    assert(html.includes('VCT-2026-001'), 'README project code');
  }
}

async function testPermitOnlyPack(fixtures: Awaited<ReturnType<typeof setupFixtures>>) {
  console.log('\n[7] Permit-only pack — 28 drawings min');
  const packager = new OutputPackager({
    defaultOutDir: OUT_DIR,
    logger: () => { },
  });

  const result = await packager.pack({
    projectId: 'proj_test_permit',
    revisionId: 'rev_1',
    packageType: 'permit_submission',
    deliverables: {
      drawings: fixtures.drawings, // 28 drawings
    },
    project: {
      code: 'VCT-2026-002',
      name: 'Nhà phố Quận 7 - Hồ sơ xin phép',
      owner_name: 'Lê Thị C',
      address: '789 Trần Não, P. Bình An, Q.2, TPHCM',
      phase: 'DD',
      designed_by: 'Viet-Contech Co., Ltd',
    },
    output_format: 'zip',
  });
  assert(result.ok, 'permit pack ok');
  assert(result.counts.drawings >= 28, `≥ 28 drawings (got ${result.counts.drawings})`);
}

async function testCommercialOnlyValidator(fixtures: Awaited<ReturnType<typeof setupFixtures>>) {
  console.log('\n[8] Validator — commercial_only requires BOQ + renders');
  const result = await validatePackOpts({
    projectId: 'proj_test',
    revisionId: 'rev_1',
    packageType: 'commercial_only',
    deliverables: {
      drawings: fixtures.drawings.slice(0, 5),
      // missing BOQ + renders
    },
    output_format: 'zip',
  });
  assert(!result.ok, 'fail without BOQ + renders');
  assert(
    result.errors.some(e => e.code === 'commercial_boq_required'),
    'BOQ required',
  );
  assert(
    result.errors.some(e => e.code === 'commercial_renders_required'),
    'renders required',
  );
}

// ----------------------------------------------------------------
// Main
// ----------------------------------------------------------------

async function main() {
  console.log('==============================================');
  console.log('OutputPackager — Pack E2E Tests');
  console.log('==============================================');

  await mkdir(OUT_DIR, { recursive: true });
  await testNamingConvention();
  console.log('\n[*] Setting up fixtures (28 drawings + boq + ifc + 12 renders + 2 reports)...');
  const fixtures = await setupFixtures();
  console.log(`    ${fixtures.drawings.length} drawings, ${fixtures.renders.length} renders, ${fixtures.reports.length} reports`);

  await testValidatorPermit(fixtures);
  await testValidatorClientFull(fixtures);
  await testCommercialOnlyValidator(fixtures);
  await testPackOptsSchema(fixtures);

  const archivePath = await testE2EPack(fixtures);
  await testZipContents(archivePath);
  await testPermitOnlyPack(fixtures);

  console.log('\n==============================================');
  console.log(`Pass: ${passCount} | Fail: ${failCount}`);
  if (failCount === 0) {
    console.log('ALL TESTS PASSED');
  } else {
    console.log('FAILED');
    process.exitCode = 1;
  }
  console.log('==============================================');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
