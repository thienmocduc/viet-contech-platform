/**
 * E2E test: routes electric/plumbing/camera against sample-layout.json.
 * Run:  tsx tests/test-routing.ts
 *
 * Asserts:
 *   Electric: ≥30 outlets, ≥15 lights, total cable 200-400m
 *   Plumbing: 6-8 fixtures, ≥1 m³ roof tank, ≥3 m³ septic
 *   Camera : 6-10 cams outdoor+entryway, coverage ≥85%
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

import { routeElectric } from '../src/routing/electric.js';
import { routePlumbing } from '../src/routing/plumbing.js';
import { placeCameras } from '../src/routing/camera.js';
import { computeCoverage } from '../src/routing/coverage.js';
import type { LayoutJSON } from '../src/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sample: LayoutJSON = JSON.parse(
  readFileSync(resolve(__dirname, 'sample-layout.json'), 'utf8'),
) as LayoutJSON;

let pass = 0;
let fail = 0;

function check(label: string, cond: boolean, detail?: string): void {
  const tag = cond ? 'PASS' : 'FAIL';
  console.log(`  [${tag}] ${label}${detail ? '  — ' + detail : ''}`);
  if (cond) pass++; else fail++;
}

// ============================================================
console.log('\n========== ELECTRIC ROUTING ==========');
const tE0 = performance.now();
const electric = routeElectric(sample);
const tE1 = performance.now();
console.log(`  outlets: ${electric.outlets.length}`);
console.log(`  lights : ${electric.lights.length}`);
console.log(`  switches: ${electric.switches.length}`);
console.log(`  circuits: ${electric.circuits.length}`);
console.log(`  total load: ${electric.total_load_kW.toFixed(2)} kW`);
console.log(`  main breaker: ${electric.cb_main_size_A} A`);
console.log(`  total cable: ${electric.total_cable_length_m} m`);
console.log(`  duration: ${(tE1 - tE0).toFixed(1)} ms`);

// Show first 2 routes as samples.
console.log('\n  Sample routes (first 2):');
for (const c of electric.circuits.slice(0, 2)) {
  console.log(`    - ${c.id}  type=${c.type}  load=${c.load_W}W  cable=${electric.cables.find(cb => cb.id === c.cable_id)?.size_mm2}mm²  len=${(c.route.total_cost_mm/1000).toFixed(1)}m  fixtures=${c.fixtures.length}`);
}

check('outlets ≥ 30', electric.outlets.length >= 30, `got ${electric.outlets.length}`);
check('lights ≥ 15', electric.lights.length >= 15, `got ${electric.lights.length}`);
check('cable in [200, 400] m', electric.total_cable_length_m >= 200 && electric.total_cable_length_m <= 400,
      `got ${electric.total_cable_length_m} m`);
check('main breaker ≥ 40 A', electric.cb_main_size_A >= 40, `got ${electric.cb_main_size_A} A`);
check('every circuit has cable size', electric.cables.every(c => c.size_mm2 >= 1.5));
check('voltage drop ≤ 5%', electric.cables.every(c => c.voltage_drop_pct <= 5));

// ============================================================
console.log('\n========== PLUMBING ROUTING ==========');
const tP0 = performance.now();
const plumbing = routePlumbing(sample);
const tP1 = performance.now();
console.log(`  fixtures: ${plumbing.fixtures.length}`);
console.log(`  fixture units: ${plumbing.fixture_units}`);
console.log(`  roof tank: ${plumbing.tanks.find(t => t.kind === 'roof')?.volume_m3} m³`);
console.log(`  septic   : ${plumbing.septic[0]?.volume_m3} m³ (${plumbing.septic[0]?.chambers}-chamber)`);
console.log(`  pumps    : ${plumbing.pumps.length}, total ${plumbing.pump_power_kW} kW`);
console.log(`  pipes    : cold ${plumbing.cold_pipes.length}, hot ${plumbing.hot_pipes.length}, drains ${plumbing.drains.length}`);
console.log(`  total pipe: ${plumbing.total_pipe_length_m.toFixed(1)} m`);
console.log(`  duration : ${(tP1 - tP0).toFixed(1)} ms`);

check('fixtures in [6, 12]', plumbing.fixtures.length >= 6 && plumbing.fixtures.length <= 12,
      `got ${plumbing.fixtures.length}`);
check('roof tank ≥ 1 m³', (plumbing.tanks.find(t => t.kind === 'roof')?.volume_m3 ?? 0) >= 1);
check('septic ≥ 3 m³', (plumbing.septic[0]?.volume_m3 ?? 0) >= 3);
check('septic 3-chamber', (plumbing.septic[0]?.chambers ?? 0) === 3);
check('every drain slope ≥ 1.5%', plumbing.drains.every(d => (d.slope_pct ?? 0) >= 1.5));
check('hot water heater present', plumbing.hot_water.length >= 1);

// ============================================================
console.log('\n========== CAMERA PLACEMENT ==========');
const tC0 = performance.now();
const cameras = placeCameras(sample, { fov_degrees: 112, max_range_mm: 8000 });
const coverage = computeCoverage(sample, cameras, 500);
const tC1 = performance.now();
console.log(`  cameras  : ${cameras.length}`);
console.log(`  by zone  : outdoor=${cameras.filter(c => c.zone === 'outdoor').length} entry=${cameras.filter(c => c.zone === 'entryway').length} corridor=${cameras.filter(c => c.zone === 'corridor').length}`);
console.log(`  coverage : ${coverage.coverage_pct}% overall, ${coverage.required_pct}% required`);
console.log(`  blind spots: ${coverage.blind_spots.length} cells`);
console.log(`  duration : ${(tC1 - tC0).toFixed(1)} ms`);

console.log('\n  Sample camera placements (first 3):');
for (const c of cameras.slice(0, 3)) {
  console.log(`    - ${c.id}  zone=${c.zone}  pos=(${c.position.x.toFixed(0)},${c.position.y.toFixed(0)})  yaw=${c.yaw_deg.toFixed(0)}°  fov=${c.fov_deg}°  cells=${c.covered_cells}`);
}

check('cameras in [6, 14]', cameras.length >= 6 && cameras.length <= 14, `got ${cameras.length}`);
check('coverage ≥ 85%', coverage.coverage_pct >= 85, `got ${coverage.coverage_pct}%`);
// Cameras placed at level 0; check vs level-0 private rooms only.
const cameraLevel = 0;
check('no camera in level-0 bedroom', cameras.every(c =>
  !sample.rooms.some(r =>
    r.level === cameraLevel && r.kind === 'bedroom' && pip(c.position, r.polygon),
  ),
));
check('no camera in level-0 bathroom', cameras.every(c =>
  !sample.rooms.some(r =>
    r.level === cameraLevel && r.kind === 'bathroom' && pip(c.position, r.polygon),
  ),
));
check('no camera in level-0 altar', cameras.every(c =>
  !sample.rooms.some(r =>
    r.level === cameraLevel && r.kind === 'altar' && pip(c.position, r.polygon),
  ),
));

// ============================================================
console.log('\n========== PERFORMANCE ==========');
const total = (tE1 - tE0) + (tP1 - tP0) + (tC1 - tC0);
console.log(`  total: ${total.toFixed(1)} ms`);
check('full MEP < 5000 ms', total < 5000, `got ${total.toFixed(1)} ms`);

// ============================================================
console.log(`\n========== SUMMARY ==========`);
console.log(`  PASS: ${pass}`);
console.log(`  FAIL: ${fail}`);
process.exit(fail === 0 ? 0 : 1);

// ----- helpers -----
function pip(p: { x: number; y: number }, poly: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    const intersect = ((a.y > p.y) !== (b.y > p.y)) &&
      (p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y + 1e-9) + a.x);
    if (intersect) inside = !inside;
  }
  return inside;
}
