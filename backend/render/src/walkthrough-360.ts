/**
 * 360 walkthrough utilities — helpers cho RenderFarm.render360.
 *
 * Trach nhiem:
 *   - Build cubemap prompt 6 face seamless.
 *   - Stitch cubemap → equirectangular panorama (4096x2048).
 *   - Convert panorama → GLB (3D scene voi sphere mapping).
 *   - Convert panorama → USDZ (iOS AR Quick Look).
 *
 * Note: Zeni L3 hien chua co 360 native, dung "pseudo-360" qua 6 cubemap
 * face roi stitch. Production se swap sang sphere-from-multiview model
 * khi Zeni release.
 */

export type CubemapFace = 'front' | 'back' | 'left' | 'right' | 'up' | 'down';

export const CUBEMAP_FACES: CubemapFace[] = [
  'front', 'back', 'left', 'right', 'up', 'down',
];

// ============================================================
// Layout chung cua face trong equirectangular
// (just metadata — actual stitch o RenderFarm.stitchPanorama)
// ============================================================
export const PANORAMA_SPEC = {
  width: 4096,
  height: 2048,
  format: 'equirectangular' as const,
  // 4 face ngang phai map vao 4 dai dai theo chieu rong:
  // [0..1024]   = right
  // [1024..2048] = front
  // [2048..3072] = left
  // [3072..4096] = back
  // [up]   = vung tren (y < ~512)
  // [down] = vung duoi (y > ~1536)
  face_layout: {
    right: { x_start: 0, x_end: 1024 },
    front: { x_start: 1024, x_end: 2048 },
    left:  { x_start: 2048, x_end: 3072 },
    back:  { x_start: 3072, x_end: 4096 },
    up:    { y_start: 0, y_end: 512 },
    down:  { y_start: 1536, y_end: 2048 },
  },
};

// ============================================================
// Cost calculator cho 1 360 scene
// ============================================================
export interface Render360Cost {
  num_cubemap_faces: number;
  cost_per_face_usd: number;
  panorama_stitch_usd: number;
  glb_export_usd: number;
  usdz_export_usd: number;
  total_usd: number;
  total_vnd: number;
}

export function estimate360Cost(opts: {
  cost_per_face_usd: number;     // 0.04 preview, 0.08 production
  vnd_per_usd?: number;
}): Render360Cost {
  const vndPerUsd = opts.vnd_per_usd ?? 24500;
  const numFaces = 6;
  const cubemapCost = numFaces * opts.cost_per_face_usd;
  // Stitch / GLB / USDZ: chay local, khong tinh phi cloud
  const stitchUsd = 0;
  const glbUsd = 0;
  const usdzUsd = 0;
  const totalUsd = cubemapCost + stitchUsd + glbUsd + usdzUsd;
  return {
    num_cubemap_faces: numFaces,
    cost_per_face_usd: opts.cost_per_face_usd,
    panorama_stitch_usd: stitchUsd,
    glb_export_usd: glbUsd,
    usdz_export_usd: usdzUsd,
    total_usd: roundCurrency(totalUsd),
    total_vnd: Math.round(totalUsd * vndPerUsd),
  };
}

function roundCurrency(n: number): number {
  return Math.round(n * 100) / 100;
}

// ============================================================
// VR / AR readiness validation
// ============================================================
export function validate360Result(opts: {
  cubemap_count: number;
  has_panorama: boolean;
  has_glb: boolean;
  has_usdz: boolean;
}): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (opts.cubemap_count !== 6) {
    errors.push(`cubemap must be 6 faces, got ${opts.cubemap_count}`);
  }
  if (!opts.has_panorama) errors.push('missing equirectangular panorama');
  if (!opts.has_glb) errors.push('missing GLB (web/Quest VR)');
  if (!opts.has_usdz) errors.push('missing USDZ (iOS AR Quick Look)');
  return { ok: errors.length === 0, errors };
}
