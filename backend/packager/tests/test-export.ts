// ===============================================================
// E2E test: build sample project ZIP với 30 deliverables.
// Chạy: tsx tests/test-export.ts
// ===============================================================

import { mkdir, writeFile, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DELIVERABLE_MANIFEST, TOTAL_DELIVERABLES, reconcileManifest,
} from '../src/manifest-builder.js';
import { sanitizeVi, slugify, buildDeliverableFileName, buildZipFileName } from '../src/file-naming.js';
import { sha256Buffer, buildChecksumManifest, sha256File } from '../src/checksum.js';
import { buildPermitPackage } from '../src/permit-builder.js';
import { buildZipPackage } from '../src/zip-builder.js';
import { buildEmbedMetadata, buildDwgTitleBlock, buildPdfInfoDict } from '../src/metadata-embed.js';
import type { DeliverableRecord, ProjectInfo } from '../src/types.js';

// Resolve test fixture paths relative to this file
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const FIXTURE_DIR = join(ROOT, 'data', '_test-fixtures');
const OUT_DIR = join(ROOT, 'data', 'output', 'tests');

// ----------------------------------------------------------------
// Fixture builder — tạo file giả cho 30 deliverables
// ----------------------------------------------------------------

const SAMPLE_PROJECT: ProjectInfo = {
  id: 'proj_test_001',
  code: 'VCT-2026-001',
  name: 'Nhà phố ô. Nguyễn Văn A — Q.7 TPHCM',
  owner: {
    full_name: 'Nguyễn Văn A',
    id_card: '079123456789',
    id_issued_date: '2018-05-01',
    id_issued_place: 'Cục CS QLHC về TTXH',
    permanent_address: '123 Đường Nguyễn Thị Thập, P. Tân Phú, Q.7, TPHCM',
    phone: '0901234567',
    email: 'nguyenvana@example.com',
  },
  lot: {
    address: '456 Đường Lê Văn Lương',
    ward: 'P. Tân Phong',
    district: 'Q.7',
    city: 'TPHCM',
    cert_no: 'BĐ123456',
    cert_date: '2020-03-15',
    area_m2: 80,
    setback: { front: 3, back: 0, left: 0, right: 0 },
    limits: { density_max: 0.8, height_max_m: 16, gfa_coef_max: 4 },
  },
  scale: { gfa_m2: 280, floors: 3, lot_area_m2: 80 },
  designer: {
    company: 'Việt-Contech Co., Ltd',
    cert_no: 'CCHN-2025-0042',
    director_name: 'Trần Thị B',
    contact_phone: '0287654321',
    contact_email: 'design@vietcontech.vn',
  },
  created_at: '2026-04-01T00:00:00Z',
  revision_id: 'rev_3_test',
  revision_num: 3,
};

async function buildFixtures(): Promise<DeliverableRecord[]> {
  await rm(FIXTURE_DIR, { recursive: true, force: true });
  await mkdir(FIXTURE_DIR, { recursive: true });
  const records: DeliverableRecord[] = [];

  for (const spec of DELIVERABLE_MANIFEST) {
    // Skip A-04 (chỉ 3 tầng yêu cầu — sample = 3 tầng giữ nguyên)
    if (spec.code === 'R-01') {
      // Tạo 72 file mock cho render
      for (let s = 0; s < 9; s++) {
        for (let a = 0; a < 8; a++) {
          const idx = s * 8 + a;
          const fname = `style${s + 1}_angle${a + 1}.${spec.kind}`;
          const abs = join(FIXTURE_DIR, fname);
          // Mock content — random bytes để có size variance
          const content = Buffer.from(`MOCK-RENDER-S${s + 1}-A${a + 1}-`.repeat(200));
          await writeFile(abs, content);
          const { sha256, size } = await sha256File(abs);
          records.push({
            id: `del_${spec.code}_${idx}`,
            spec, abs_path: abs, size_bytes: size, sha256,
            version: 1, created_at: new Date().toISOString(), locked: false,
          });
        }
      }
      continue;
    }

    const fname = `${spec.code}.${spec.kind}`;
    const abs = join(FIXTURE_DIR, fname);
    const mockSize = spec.kind === 'ifc' ? 50_000 :
                     spec.kind === 'pdf' ? 30_000 :
                     spec.kind === 'xlsx' ? 15_000 :
                     spec.kind === 'glb' ? 80_000 : 8_000;
    const content = Buffer.alloc(mockSize, `MOCK-${spec.code}-${spec.name}\n`);
    await writeFile(abs, content);
    const { sha256, size } = await sha256File(abs);
    records.push({
      id: `del_${spec.code}`,
      spec, abs_path: abs, size_bytes: size, sha256,
      version: 1, created_at: new Date().toISOString(), locked: false,
    });
  }

  return records;
}

// ----------------------------------------------------------------
// Assertions
// ----------------------------------------------------------------

function assert(cond: any, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exitCode = 1;
    throw new Error(msg);
  } else {
    console.log(`  ok: ${msg}`);
  }
}

// ----------------------------------------------------------------
// Tests
// ----------------------------------------------------------------

async function testManifest() {
  console.log('\n[1] Manifest spec coverage');
  assert(DELIVERABLE_MANIFEST.length >= 28, `manifest có ${DELIVERABLE_MANIFEST.length} ≥ 28`);
  assert(DELIVERABLE_MANIFEST.length <= 32, `manifest có ${DELIVERABLE_MANIFEST.length} ≤ 32`);
  const requiredCount = DELIVERABLE_MANIFEST.filter(d => d.required).length;
  assert(requiredCount >= 25, `≥ 25 required (got ${requiredCount})`);
  // codes unique
  const codes = new Set(DELIVERABLE_MANIFEST.map(d => d.code));
  assert(codes.size === DELIVERABLE_MANIFEST.length, 'codes unique');
  // mandatory ones
  for (const c of ['A-01', 'A-06', 'S-01', 'F-01', 'L-01', 'M-01', 'R-01', 'B-01']) {
    assert(codes.has(c), `${c} present`);
  }
}

async function testFileNaming() {
  console.log('\n[2] File naming + Vietnamese sanitization');
  assert(sanitizeVi('Mặt bằng tầng 1') === 'Mat bang tang 1', 'sanitize basic');
  assert(sanitizeVi('Đường Nguyễn Thị Thập') === 'Duong Nguyen Thi Thap', 'sanitize đ Đ ạ ậ');
  assert(slugify('Mặt bằng tầng 1') === 'Mat-bang-tang-1', 'slugify Vietnamese');
  const fname = buildDeliverableFileName(DELIVERABLE_MANIFEST[1]!, SAMPLE_PROJECT);
  assert(fname.startsWith('VCT-2026-001_B3_A-02_'), `filename starts correctly: ${fname}`);
  assert(fname.endsWith('.dwg'), `ext ok: ${fname}`);
  assert(!/[^A-Za-z0-9._-]/.test(fname), `filename ascii-safe: ${fname}`);
  const zipName = buildZipFileName(SAMPLE_PROJECT, 'full');
  assert(zipName.startsWith('VCT-2026-001-rev3-full-'), `zip name: ${zipName}`);
  assert(zipName.endsWith('.zip'), 'zip ext');
}

async function testChecksum() {
  console.log('\n[3] Checksum SHA-256');
  const a = sha256Buffer('hello');
  const b = sha256Buffer('hello');
  const c = sha256Buffer('hellp');
  assert(a === b, 'deterministic');
  assert(a !== c, 'sensitive to 1 char');
  assert(a.length === 64, 'hex 64 chars');

  const manifest = buildChecksumManifest({
    package_id: 'PKG-TEST',
    entries: [
      { rel_path: '00-OVERVIEW/README.md', size_bytes: 100, sha256: 'aa', kind: 'md' },
      { rel_path: '01-ARCHITECTURE/A-01.dwg', size_bytes: 8000, sha256: 'bb', kind: 'dwg', code: 'A-01' },
    ],
  });
  assert(manifest.total_files === 2, 'manifest counts');
  assert(manifest.manifest_signature.length === 64, 'signature SHA-256');
}

async function testReconcile(records: DeliverableRecord[]) {
  console.log('\n[4] Reconciliation');
  const recon = reconcileManifest(records, { floors: SAMPLE_PROJECT.scale.floors });
  assert(recon.total_specs === TOTAL_DELIVERABLES, 'total specs match');
  assert(recon.missing_required.length === 0, `no required missing (got ${recon.missing_required.length})`);
  assert(recon.ready_for_pack === true, 'ready_for_pack');
  // R-01 phải match nhiều records
  const r01 = recon.matched.find(m => m.spec.code === 'R-01');
  assert(r01 !== undefined && r01.records.length === 72, `R-01 has 72 records (got ${r01?.records.length})`);
}

async function testPermit(records: DeliverableRecord[]) {
  console.log('\n[5] Permit package');
  const out = join(OUT_DIR, 'permit-only');
  const result = await buildPermitPackage({ outDir: out, project: SAMPLE_PROJECT, records });
  assert(result.documents.length === 8, '8 documents');
  assert(result.files_written.length >= 8, '≥ 8 files written');
  assert(result.placeholders.length === 2, '2 placeholders (GCN + geo)');
}

async function testEmbedMetadata() {
  console.log('\n[6] Metadata embedding');
  const meta = buildEmbedMetadata(DELIVERABLE_MANIFEST[1]!, SAMPLE_PROJECT);
  assert(meta.drawing_code === 'A-02', 'drawing code');
  assert(meta.title_ascii.includes('A-02'), 'title ascii');
  const dwgTb = buildDwgTitleBlock(meta);
  assert(dwgTb.DRAWING_NUMBER === 'A-02', 'dwg titleblock');
  assert(/^[A-Za-z0-9 ._\-:/]+$/.test(dwgTb.PROJECT_NAME), 'titleblock ascii-safe');
  const pdfDict = buildPdfInfoDict(meta);
  assert(pdfDict.Title.includes('A-02'), 'pdf dict');
  assert(pdfDict.Producer.includes('Viet-Contech'), 'pdf producer');
}

async function testE2EZipBuild(records: DeliverableRecord[]) {
  console.log('\n[7] E2E ZIP build');
  const start = Date.now();
  const result = await buildZipPackage({
    outDir: OUT_DIR,
    project: SAMPLE_PROJECT,
    records,
    kind: 'full',
    includePreviews: false, // tránh blow-up trong test
    decisionsMd: '# Decisions\n- 100+ decisions logged',
    qcReport: '# QC Report\n12/12 gates PASS',
    agentRunsCsv: 'agent,run_id,status\narchitect,run_1,success\n',
    qcPassRate: 1.0,
    qcGatesPassed: 12,
    qcGatesTotal: 12,
  });
  const elapsedSec = (Date.now() - start) / 1000;
  console.log(`  build time: ${elapsedSec.toFixed(2)}s`);
  console.log(`  zip path: ${result.zip_path}`);
  console.log(`  zip size: ${(result.zip_size_bytes / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  files: ${result.files_added}`);
  console.log(`  signature: ${result.checksum_signature.slice(0, 16)}...`);
  console.log(`  warnings: ${result.warnings.length}`);

  assert(existsSync(result.zip_path), 'zip exists on disk');
  assert(elapsedSec < 30, `build < 30s (got ${elapsedSec.toFixed(2)}s)`);
  assert(result.files_added >= 100, `≥ 100 files (got ${result.files_added}) — 30 records + 72 render + overview/audit/legal`);
  assert(result.zip_size_bytes >= 100_000, `zip ≥ 100KB (got ${result.zip_size_bytes})`);
  assert(result.package_metadata.required_missing.length === 0, 'no required missing');
  assert(result.package_metadata.qc_gates_passed === 12, 'QC 12/12');
  assert(result.checksum_signature.length === 64, 'signature SHA-256');
}

async function main() {
  console.log('==============================================');
  console.log('Viet-Contech Output Packager — E2E Tests');
  console.log('==============================================');

  await mkdir(OUT_DIR, { recursive: true });

  await testManifest();
  await testFileNaming();
  await testChecksum();

  console.log('\n[*] Building fixtures (30 specs, 102 files)...');
  const records = await buildFixtures();
  console.log(`    ${records.length} records`);

  await testReconcile(records);
  await testEmbedMetadata();
  await testPermit(records);
  await testE2EZipBuild(records);

  console.log('\n==============================================');
  if (process.exitCode === 1) {
    console.log('FAILED');
  } else {
    console.log('ALL TESTS PASSED');
  }
  console.log('==============================================');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
