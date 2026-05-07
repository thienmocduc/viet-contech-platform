/**
 * test.ts - Smoke test cho Node bridge.
 * Gọi Python qua subprocess, validate zod schemas.
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  extractQuantities,
  generateBOQ,
  exportBOQExcel,
  runFullPipeline,
} from './index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const dxf = resolve(__dirname, '..', 'samples', 'sample-villa-280m2.dxf');
  console.log(`[1] Extract from ${dxf}`);
  const qty = await extractQuantities(dxf);
  console.log(`    floors=${qty.floors_detected}, layers=${Object.keys(qty.layers).length}, area=${qty.total_floor_area_m2}m²`);

  console.log('[2] Generate BOQ');
  const boq = await generateBOQ(qty, {
    project_id: 'NODE-BRIDGE-TEST',
    project_name: 'Smoke test villa',
    floors: qty.floors_detected,
    total_floor_area_m2: qty.total_floor_area_m2,
    style: 'luxury',
  });
  console.log(`    items=${boq.summary.total_items}, total=${(boq.grand_total_vnd / 1e9).toFixed(2)}ty VND`);

  console.log('[3] Export Excel');
  const out = resolve(__dirname, '..', 'exports', 'node-bridge-test.xlsx');
  const xlsxPath = await exportBOQExcel(boq, out);
  console.log(`    saved: ${xlsxPath}`);

  console.log('\nNode bridge: ALL OK');
}

main().catch((e) => {
  console.error('Node bridge FAIL:', e);
  process.exit(1);
});
