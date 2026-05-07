/**
 * E2E test cho Render Farm Orchestrator (mock mode).
 *
 * Cases:
 *   1. renderRoom: 1 room luxury 8 angles → 8 PNG paths < 30s
 *   2. renderAll9Styles: 9 styles 1 room 1 angle → 9 PNGs
 *   3. render360: 1 GLB + 1 USDZ + 6 cubemap + 1 panorama
 *   4. Cost calc: 280m² 6 rooms 9 styles preview ~$17
 *   5. Job registry tracks progress correctly
 *   6. Prompt builder differentiates cung menh / style / angle
 */

import { strict as assert } from 'assert';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, sep } from 'path';
import { rm, mkdir } from 'fs/promises';

import { RenderFarm } from '../src/render-farm.js';
import { ZeniL3Client } from '../src/zeni-l3-client.js';
import { LocalStorageAdapter } from '../src/storage.js';
import { JobRegistry } from '../src/queue.js';
import { buildPrompt, NEGATIVE_PROMPT, nguHanhFor } from '../src/prompt-builder.js';
import { ALL_STYLES, ALL_ANGLES, QUALITY_PRESETS, VND_PER_USD } from '../src/types.js';
import { estimate360Cost, validate360Result } from '../src/walkthrough-360.js';
import { createRenderApp } from '../src/api.js';

// ============================================================
// Setup: temp dir
// ============================================================
const TEST_DIR = join(tmpdir(), 'vct-render-test-' + Date.now());

async function setup(): Promise<{ farm: RenderFarm; storage: LocalStorageAdapter; registry: JobRegistry }> {
  if (existsSync(TEST_DIR)) {
    await rm(TEST_DIR, { recursive: true, force: true });
  }
  await mkdir(TEST_DIR, { recursive: true });

  const storage = new LocalStorageAdapter(TEST_DIR);
  const client = new ZeniL3Client({ mock: true });
  const registry = new JobRegistry();
  const farm = new RenderFarm({ client, storage, registry, concurrent: 5 });
  return { farm, storage, registry };
}

async function teardown(): Promise<void> {
  if (existsSync(TEST_DIR)) {
    await rm(TEST_DIR, { recursive: true, force: true });
  }
}

let pass = 0;
let fail = 0;
async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
    pass++;
  } catch (e) {
    console.error(`  FAIL  ${name}\n        ${e instanceof Error ? e.message : e}`);
    fail++;
  }
}

// ============================================================
// MAIN
// ============================================================
async function main(): Promise<void> {
  console.log('Render Farm Orchestrator — E2E mock tests\n');

  // ------------------------------------------------------------
  console.log('[1] Prompt builder');
  // ------------------------------------------------------------
  await test('luxury bedroom front cung menh kham → unique prompt', async () => {
    const a = buildPrompt({
      style: 'luxury', roomType: 'bedroom', angle: 'front',
      cungMenh: 'kham', quality: 'preview', watermark: true,
    });
    assert.ok(a.prompt.includes('Marble Carrara'), 'style DNA in prompt');
    assert.ok(a.prompt.includes('master bedroom'), 'room layout in prompt');
    assert.ok(a.prompt.includes('front-facing'), 'angle in prompt');
    assert.ok(a.prompt.includes('midnight blue') || a.prompt.includes('water-blue'),
      'cung menh kham → thuy → blue colors');
    assert.ok(a.prompt.includes('VCT watermark'), 'watermark in prompt');
    assert.equal(a.negative_prompt, NEGATIVE_PROMPT);
  });

  await test('different cung menh → different colors', async () => {
    const a = buildPrompt({ style: 'modern', roomType: 'living', angle: 'front',
      cungMenh: 'ly', quality: 'preview', watermark: false });
    const b = buildPrompt({ style: 'modern', roomType: 'living', angle: 'front',
      cungMenh: 'kham', quality: 'preview', watermark: false });
    assert.notEqual(a.prompt, b.prompt);
    assert.equal(nguHanhFor('ly'), 'hoa');
    assert.equal(nguHanhFor('kham'), 'thuy');
  });

  await test('all 9 styles produce distinct prompts', async () => {
    const seen = new Set<string>();
    for (const s of ALL_STYLES) {
      const p = buildPrompt({ style: s, roomType: 'living', angle: 'front',
        cungMenh: 'unknown', quality: 'preview', watermark: false });
      assert.ok(!seen.has(p.prompt), `style ${s} prompt unique`);
      seen.add(p.prompt);
    }
    assert.equal(seen.size, 9);
  });

  // ------------------------------------------------------------
  console.log('\n[2] renderRoom (1 room luxury 8 angles)');
  // ------------------------------------------------------------
  await test('luxury bedroom 8 angles < 30s, all 8 PNGs created', async () => {
    const { farm } = await setup();
    const startedAt = Date.now();
    const result = await farm.renderRoom({
      projectId: 'p001',
      roomType: 'bedroom',
      style: 'luxury',
      layout_2d_path: 'mock/layout.dxf',
      cung_menh: 'kham',
      num_angles: 8,
      quality: 'preview',
    });
    const elapsed = Date.now() - startedAt;
    assert.ok(elapsed < 30_000, `render time ${elapsed}ms must be < 30000ms`);
    assert.equal(result.render_count, 8);
    assert.equal(result.frames.length, 8);
    for (const f of result.frames) {
      const localPath = f.url.replace('file:///', '').replace(/\//g, sep);
      assert.ok(existsSync(localPath), `file exists: ${f.url}`);
      assert.ok(f.hash.length === 64, 'sha256 hash');
      assert.ok(f.cost_vnd > 0, 'cost vnd > 0');
    }
    // 8 angles all distinct
    const angles = new Set(result.frames.map((f) => f.angle));
    assert.equal(angles.size, 8);
    await teardown();
  });

  await test('renderRoom watermark count = num angles', async () => {
    const { farm } = await setup();
    const r = await farm.renderRoom({
      projectId: 'p002', roomType: 'living', style: 'japandi',
      layout_2d_path: '', cung_menh: 'unknown',
      num_angles: 4, quality: 'preview', watermark: true,
    });
    assert.equal(r.watermark_count, 4);
    await teardown();
  });

  // ------------------------------------------------------------
  console.log('\n[3] renderAll9Styles (9 styles 1 room 1 angle)');
  // ------------------------------------------------------------
  await test('9 styles 1 room 1 angle → 9 PNGs', async () => {
    const { farm } = await setup();
    const result = await farm.renderAll9Styles({
      projectId: 'p003', roomType: 'living',
      layout_2d_path: '', cung_menh: 'kham',
      num_angles: 1, quality: 'preview',
    });
    const styles = Object.keys(result);
    assert.equal(styles.length, 9);
    let totalFrames = 0;
    for (const s of styles) {
      assert.ok(result[s as keyof typeof result].frames.length === 1, `style ${s} has 1 frame`);
      totalFrames += result[s as keyof typeof result].frames.length;
    }
    assert.equal(totalFrames, 9);
    await teardown();
  });

  // ------------------------------------------------------------
  console.log('\n[4] render360');
  // ------------------------------------------------------------
  await test('360 panorama → 1 GLB + 1 USDZ + 6 cubemap + 1 pano', async () => {
    const { farm } = await setup();
    const r = await farm.render360({
      projectId: 'p004', roomType: 'living', style: 'modern',
      cung_menh: 'kham', quality: 'preview',
    });
    assert.equal(r.cubemap_faces.length, 6);
    assert.ok(r.glb_path.endsWith('.glb'));
    assert.ok(r.usdz_path.endsWith('.usdz'));
    assert.ok(r.panorama_equirectangular_path.endsWith('.png'));
    for (const f of r.cubemap_faces) assert.ok(existsSync(f), `cubemap exists: ${f}`);
    assert.ok(existsSync(r.glb_path));
    assert.ok(existsSync(r.usdz_path));

    const v = validate360Result({
      cubemap_count: r.cubemap_faces.length,
      has_panorama: existsSync(r.panorama_equirectangular_path),
      has_glb: existsSync(r.glb_path),
      has_usdz: existsSync(r.usdz_path),
    });
    assert.ok(v.ok, v.errors.join(', '));
    await teardown();
  });

  // ------------------------------------------------------------
  console.log('\n[5] Cost calculation');
  // ------------------------------------------------------------
  await test('1 image preview ≈ 980 VND ($0.04)', async () => {
    const { farm } = await setup();
    const r = await farm.renderRoom({
      projectId: 'p005', roomType: 'kitchen', style: 'minimalism',
      layout_2d_path: '', cung_menh: 'unknown',
      num_angles: 1, quality: 'preview',
    });
    const f = r.frames[0];
    assert.equal(f.cost_usd, 0.04);
    assert.equal(f.cost_vnd, 980);  // 0.04 * 24500 = 980
    await teardown();
  });

  await test('Project 80m² 1 room luxury 8 angles preview ≈ $0.32', async () => {
    const { farm } = await setup();
    const r = await farm.renderRoom({
      projectId: 'p006-80m2', roomType: 'living', style: 'luxury',
      layout_2d_path: '', cung_menh: 'kham',
      num_angles: 8, quality: 'preview',
    });
    assert.equal(r.cost_usd_total, 0.32); // 8 * 0.04
    assert.equal(r.cost_vnd_total, 7840); // 8 * 980
    await teardown();
  });

  await test('Project 280m² 6 rooms 9 styles 8 angles preview ~ $17', async () => {
    // Khong run render that (qua lau), chi tinh cost theo cong thuc
    const numFrames = 6 * 9 * 8; // 432
    const costUsd = numFrames * QUALITY_PRESETS.preview.cost_usd;
    assert.equal(numFrames, 432);
    assert.equal(costUsd, 17.28);
    const costVnd = costUsd * VND_PER_USD;
    assert.equal(costVnd, 423_360);
  });

  await test('360 walkthrough cost ~ $0.24 preview, $0.48 production', async () => {
    const cP = estimate360Cost({ cost_per_face_usd: 0.04 });
    assert.equal(cP.total_usd, 0.24);
    assert.equal(cP.total_vnd, 5880); // 0.24 * 24500
    const cProd = estimate360Cost({ cost_per_face_usd: 0.08 });
    assert.equal(cProd.total_usd, 0.48);
  });

  // ------------------------------------------------------------
  console.log('\n[6] Job registry progress tracking');
  // ------------------------------------------------------------
  await test('job progresses 0% → 100% across 8 frames', async () => {
    const { farm, registry } = await setup();
    const events: number[] = [];
    // Run render
    const promise = farm.renderRoom({
      projectId: 'p007', roomType: 'bedroom', style: 'walnut',
      layout_2d_path: '', cung_menh: 'unknown',
      num_angles: 8, quality: 'preview',
    });
    const r = await promise;
    // After render, find the job
    const jobs = registry.listByProject('p007');
    assert.ok(jobs.length >= 1);
    const job = jobs[0];
    assert.equal(job.status, 'done');
    assert.equal(job.progress_pct, 100);
    assert.equal(job.frames_done, 8);
    assert.equal(job.cost_vnd_so_far, 8 * 980);
    assert.equal(r.frames.length, 8);
    await teardown();
  });

  // ------------------------------------------------------------
  console.log('\n[7] API smoke test');
  // ------------------------------------------------------------
  await test('Hono createRenderApp returns app', async () => {
    const app = createRenderApp();
    assert.ok(typeof app.fetch === 'function');
  });

  await test('GET /api/render/cost-estimate 280m² project', async () => {
    const app = createRenderApp();
    const res = await app.fetch(new Request(
      'http://x/api/render/cost-estimate?num_rooms=6&num_styles=9&num_angles=8&quality=preview&include_360=false',
    ));
    assert.equal(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assert.equal(body.total_images, 432);
    assert.equal(body.total_usd, 17.28);
  });

  await test('GET /api/render/cost-estimate 280m² + 360', async () => {
    const app = createRenderApp();
    const res = await app.fetch(new Request(
      'http://x/api/render/cost-estimate?num_rooms=6&num_styles=9&num_angles=8&quality=preview&include_360=true',
    ));
    const body = await res.json() as Record<string, unknown>;
    // 432 + 6*6 = 468 images, total = 17.28 + 1.44 = 18.72
    assert.equal(body.total_images, 468);
    assert.equal(body.total_usd, 18.72);
  });

  // ------------------------------------------------------------
  console.log('\n=========================================');
  console.log(`Results:  PASS ${pass}  FAIL ${fail}`);
  console.log('=========================================');
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
