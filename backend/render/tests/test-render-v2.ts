/**
 * E2E test SPEC v2 — RenderFarm.submitJob batch pipeline.
 *
 * Cases:
 *   1. submitJob 5 scenes x 3 styles x 4 angles = 60 renders → 60 PNG + 60 JPEG preview
 *   2. Watermark applied khi watermark:true
 *   3. Manifest.json valid schema
 *   4. getStatus / getResults work
 *   5. Concurrent limit + retry
 *   6. zod schema validates / rejects bad input
 *   7. Total time < 30s
 */

import { strict as assert } from 'assert';
import { existsSync, statSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { rm, mkdir, readFile } from 'fs/promises';
import { randomUUID } from 'crypto';

import {
  RenderFarm, MockProvider, RenderJobOptsSchema,
  applyWatermark, hasWatermark, resizeForPreview, getDimensions, OutputFolder,
} from '../src/index.js';
import type { RenderJobOpts } from '../src/index.js';

// ============================================================
// Setup
// ============================================================
const TEST_BASE = join(tmpdir(), 'vct-render-v2-' + Date.now());

async function setup(): Promise<RenderFarm> {
  if (existsSync(TEST_BASE)) {
    await rm(TEST_BASE, { recursive: true, force: true });
  }
  await mkdir(TEST_BASE, { recursive: true });
  return new RenderFarm({
    provider: new MockProvider({ delay_ms: 30 }),
    baseDir: TEST_BASE,
    concurrent: 8,           // boost cho test
    maxRetries: 2,
    retryBackoffMs: 50,
  });
}

async function teardown(): Promise<void> {
  if (existsSync(TEST_BASE)) {
    await rm(TEST_BASE, { recursive: true, force: true });
  }
}

let pass = 0, fail = 0;
async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
    pass++;
  } catch (e) {
    console.error(`  FAIL  ${name}\n        ${e instanceof Error ? e.message : e}`);
    if (e instanceof Error && e.stack) {
      console.error(e.stack.split('\n').slice(1, 4).join('\n'));
    }
    fail++;
  }
}

async function waitForJob(farm: RenderFarm, jobId: string, timeoutMs = 60_000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const s = await farm.getStatus(jobId);
    if (s.status === 'done' || s.status === 'failed' || s.status === 'cancelled') return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`job ${jobId} did not finish in ${timeoutMs}ms`);
}

function dirSize(dir: string): { count: number; bytes: number } {
  if (!existsSync(dir)) return { count: 0, bytes: 0 };
  let count = 0, bytes = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = dirSize(p);
      count += sub.count;
      bytes += sub.bytes;
    } else if (entry.isFile()) {
      count++;
      bytes += statSync(p).size;
    }
  }
  return { count, bytes };
}

// ============================================================
// MAIN
// ============================================================
async function main(): Promise<void> {
  console.log('Render Farm Orchestrator v2 — E2E mock tests');
  console.log('============================================\n');

  // ------------------------------------------------------------
  console.log('[1] Zod schema validation');
  // ------------------------------------------------------------
  await test('valid input parses correctly', async () => {
    const v = RenderJobOptsSchema.parse({
      projectId: randomUUID(),
      scenes: [{
        roomCode: 'living', roomName: 'Phong khach',
        cungMenh: 'Khảm', nguHanh: 'Thủy',
        layout: { area: 30 },
        angles: ['front', 'iso_high'],
      }],
      styles: ['luxury', 'modern'],
      resolution: '4k',
    });
    assert.equal(v.resolution, '4k');
    assert.equal(v.hdr, true);          // default
    assert.equal(v.priority, 'normal'); // default
    assert.equal(v.watermark, true);    // default
  });

  await test('bad uuid rejected', async () => {
    const r = RenderJobOptsSchema.safeParse({
      projectId: 'not-a-uuid',
      scenes: [{ roomCode: 'a', roomName: 'a', cungMenh: 'a', nguHanh: 'Kim', angles: ['front'] }],
      styles: ['luxury'],
    });
    assert.equal(r.success, false);
  });

  await test('bad style rejected', async () => {
    const r = RenderJobOptsSchema.safeParse({
      projectId: randomUUID(),
      scenes: [{ roomCode: 'a', roomName: 'a', cungMenh: 'a', nguHanh: 'Kim', angles: ['front'] }],
      styles: ['art-deco'],   // not in enum
    });
    assert.equal(r.success, false);
  });

  // ------------------------------------------------------------
  console.log('\n[2] Watermark + Resize');
  // ------------------------------------------------------------
  await test('applyWatermark transforms PNG bytes', async () => {
    const provider = new MockProvider({ delay_ms: 0 });
    const r = await provider.generate({
      prompt: 'test', negative_prompt: '', resolution: 'preview', label: 'test',
    });
    const watermarked = await applyWatermark(r.bytes, { text: 'VIET CONTECH' });
    assert.ok(watermarked.length > 0);
    assert.notEqual(watermarked.toString('hex'), r.bytes.toString('hex'),
      'watermarked bytes differ from original');
    const sig = await hasWatermark(watermarked);
    assert.ok(sig, 'watermark detected');
  });

  await test('resizeForPreview produces JPEG bytes', async () => {
    const provider = new MockProvider({ delay_ms: 0 });
    const r = await provider.generate({
      prompt: 'test', negative_prompt: '', resolution: 'preview', label: 'test',
    });
    const jpeg = await resizeForPreview(r.bytes, { width: 1024, format: 'jpeg', quality: 80 });
    // JPEG SOI marker FFD8FF
    assert.equal(jpeg[0], 0xff);
    assert.equal(jpeg[1], 0xd8);
    assert.equal(jpeg[2], 0xff);
  });

  // ------------------------------------------------------------
  console.log('\n[3] submitJob — small smoke (1 scene 1 style 2 angles = 2 renders)');
  // ------------------------------------------------------------
  await test('submitJob returns jobId + estimatedSec', async () => {
    const farm = await setup();
    const opts: RenderJobOpts = RenderJobOptsSchema.parse({
      projectId: randomUUID(),
      scenes: [{
        roomCode: 'living', roomName: 'Phong khach',
        cungMenh: 'Khảm', nguHanh: 'Thủy',
        layout: {}, angles: ['front', 'iso_high'],
      }],
      styles: ['luxury'],
      resolution: 'preview',  // mock fast
      generatePreview: true,
    });
    const { jobId, estimatedSec } = await farm.submitJob(opts);
    assert.ok(jobId.startsWith('rj_'));
    assert.ok(estimatedSec >= 0);
    await waitForJob(farm, jobId);
    const status = await farm.getStatus(jobId);
    assert.equal(status.status, 'done');
    assert.equal(status.completed, 2);
    assert.equal(status.failed, 0);
    await teardown();
  });

  // ------------------------------------------------------------
  console.log('\n[4] CORE — 5 scenes x 3 styles x 4 angles = 60 renders');
  // ------------------------------------------------------------
  let coreReport = { jobId: '', count: 0, totalBytes: 0, durationMs: 0 };
  await test('60 mock renders complete < 30s with watermark + preview', async () => {
    const farm = await setup();
    const projectId = randomUUID();

    const scenes = [
      { code: 'living',         name: 'Phong khach',     cm: 'Khảm', nh: 'Thủy' as const },
      { code: 'master_bedroom', name: 'Phong ngu chinh', cm: 'Khôn', nh: 'Thổ' as const },
      { code: 'kitchen',        name: 'Bep',             cm: 'Ly',   nh: 'Hỏa' as const },
      { code: 'office',         name: 'Phong lam viec',  cm: 'Chấn', nh: 'Mộc' as const },
      { code: 'foyer',          name: 'Sanh chinh',      cm: 'Đoài', nh: 'Kim' as const },
    ];

    const opts: RenderJobOpts = RenderJobOptsSchema.parse({
      projectId,
      revisionId: 'rev-001',
      scenes: scenes.map((s) => ({
        roomCode: s.code,
        roomName: s.name,
        cungMenh: s.cm,
        nguHanh: s.nh,
        layout: { area_m2: 25, walls: [] },
        angles: ['front', 'iso_high', 'iso_low', 'detail'],
      })),
      styles: ['luxury', 'indochine', 'modern'],
      resolution: 'preview',     // mock fast
      hdr: true,
      priority: 'high',
      watermark: true,
      generatePreview: true,
    });

    const startedAt = Date.now();
    const { jobId, estimatedSec } = await farm.submitJob(opts);
    coreReport.jobId = jobId;
    console.log(`        jobId=${jobId} estimatedSec=${estimatedSec}`);

    await waitForJob(farm, jobId, 60_000);
    coreReport.durationMs = Date.now() - startedAt;
    console.log(`        elapsed=${coreReport.durationMs}ms`);

    const status = await farm.getStatus(jobId);
    assert.equal(status.totalRenders, 60, 'expect 60 renders');
    assert.equal(status.completed, 60, `expect 60 completed, got ${status.completed} (failed=${status.failed})`);
    assert.equal(status.failed, 0);
    assert.equal(status.status, 'done');

    const results = await farm.getResults(jobId);
    assert.equal(results.length, 60);

    // Verify file system
    const folder = new OutputFolder({
      baseDir: TEST_BASE,
      projectId,
      revisionId: 'rev-001',
      resolutionFolder: 'preview-only',
    });
    const fullDirSize = dirSize(folder.fullDir);
    const previewDirSize = dirSize(folder.previewDir);
    assert.equal(fullDirSize.count, 60, `expect 60 PNGs in fullDir, got ${fullDirSize.count}`);
    assert.equal(previewDirSize.count, 60, `expect 60 JPEGs in previewDir, got ${previewDirSize.count}`);
    coreReport.count = fullDirSize.count + previewDirSize.count;
    coreReport.totalBytes = fullDirSize.bytes + previewDirSize.bytes;

    // Verify all results have valid paths
    for (const r of results) {
      assert.ok(existsSync(r.paths.full), `full path exists: ${r.paths.full}`);
      assert.ok(r.paths.preview && existsSync(r.paths.preview), `preview path exists: ${r.paths.preview}`);
      assert.ok(r.hash.length === 64, 'sha256 hash');
      assert.ok(r.costUsd > 0);
      assert.equal(r.watermark, true);
    }

    // Verify manifest
    const manifest = await readFile(folder.manifestPath, 'utf-8');
    const m = JSON.parse(manifest);
    assert.equal(m.jobId, jobId);
    assert.equal(m.totalRenders, 60);
    assert.equal(m.completed, 60);
    assert.equal(m.renders.length, 60);
    assert.equal(m.watermark, true);
    assert.equal(m.resolution, 'preview');

    // Pick 1 random preview JPEG and verify it's smaller / different format
    const onePreview = results.find((r) => r.paths.preview)!.paths.preview!;
    const previewBuf = await readFile(onePreview);
    assert.equal(previewBuf[0], 0xff);
    assert.equal(previewBuf[1], 0xd8);

    // Verify dimension <= 1024
    const dims = await getDimensions(previewBuf);
    assert.ok(dims.width <= 1024, `preview width <= 1024 (got ${dims.width})`);

    assert.ok(coreReport.durationMs < 30_000, `60 renders < 30s (got ${coreReport.durationMs}ms)`);
    await teardown();
  });

  // ------------------------------------------------------------
  console.log('\n[5] Watermark off → no watermark');
  // ------------------------------------------------------------
  await test('watermark:false leaves bytes unwatermarked', async () => {
    const farm = await setup();
    const opts: RenderJobOpts = RenderJobOptsSchema.parse({
      projectId: randomUUID(),
      scenes: [{
        roomCode: 'living', roomName: 'Phong khach',
        cungMenh: 'Khảm', nguHanh: 'Thủy',
        layout: {}, angles: ['front'],
      }],
      styles: ['minimalism'],
      resolution: 'preview',
      watermark: false,
      generatePreview: false,
    });
    const { jobId } = await farm.submitJob(opts);
    await waitForJob(farm, jobId);
    const r = (await farm.getResults(jobId))[0];
    assert.equal(r.watermark, false);
    assert.equal(r.paths.preview, undefined, 'no preview when generatePreview:false');
    await teardown();
  });

  // ------------------------------------------------------------
  console.log('\n[6] getStatus / getResults error on bad jobId');
  // ------------------------------------------------------------
  await test('getStatus throws on missing jobId', async () => {
    const farm = await setup();
    let threw = false;
    try {
      await farm.getStatus('rj_nonexistent');
    } catch {
      threw = true;
    }
    assert.ok(threw);
    await teardown();
  });

  // ------------------------------------------------------------
  console.log('\n=========================================');
  console.log(`Results:  PASS ${pass}  FAIL ${fail}`);
  if (coreReport.count > 0) {
    console.log('');
    console.log('Core 60-render report:');
    console.log(`  jobId       : ${coreReport.jobId}`);
    console.log(`  total files : ${coreReport.count} (60 PNG + 60 JPEG)`);
    console.log(`  total size  : ${(coreReport.totalBytes / 1024).toFixed(1)} KB`);
    console.log(`  duration    : ${coreReport.durationMs}ms`);
    console.log(`  per render  : ${(coreReport.durationMs / 60).toFixed(1)}ms avg`);
  }
  console.log('=========================================');
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
