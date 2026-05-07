/**
 * Camera placement via Greedy Set Cover.
 *
 * Algorithm:
 *   1. Build a 500mm × 500mm grid covering outdoor + entryway zones (the "to-cover" set).
 *   2. Generate candidate positions: corners of room polygons (perimeter inset 200mm).
 *   3. For each candidate, raycast a FOV polygon (FOV deg, range mm), respecting walls.
 *      Compute the set of cells covered.
 *   4. Greedy: pick the candidate covering the most UNCOVERED cells, mark them covered, repeat
 *      until ≥ 95% required coverage OR no further gain.
 *   5. Force overlap ≥2 at main entry doors and gates.
 *
 * Privacy: never place cameras inside bedroom / bathroom / altar.
 */

import {
  bboxOf,
  euclidean,
  pointInPolygon,
  segmentsIntersect,
  worldToGrid,
  gridToWorld,
} from '../algorithms/graph.js';
import type {
  CameraOptions,
  CameraPlacement,
  CoverageCell,
  LayoutJSON,
  Point,
  Room,
  RoomKind,
  Wall,
} from '../types.js';

const DEFAULTS: Required<CameraOptions> = {
  fov_degrees: 112,
  max_range_mm: 8000,
  prefer_corners: true,
  avoid_zones: ['bedroom', 'bathroom', 'altar'],
  cell_size_mm: 500,
  min_overlap_at_entry: 2,
};

const COVER_ZONES: RoomKind[] = ['outdoor', 'entryway', 'corridor', 'garage', 'living', 'stairs'];

interface Candidate {
  position: Point;
  yaw_deg: number;
  zone: CameraPlacement['zone'];
}

// ============================================================
// Public entry point
// ============================================================

export function placeCameras(
  layout: LayoutJSON,
  options: CameraOptions = {},
): CameraPlacement[] {
  const opts = { ...DEFAULTS, ...options };
  const level = 0;
  const rooms = layout.rooms.filter(r => r.level === level);
  const walls = layout.walls.filter(w => w.level === level);
  const doors = layout.doors.filter(d => d.level === level);

  // 1) Required coverage cells.
  const coverage = buildCoverageGrid(rooms, opts.cell_size_mm, opts.avoid_zones);
  if (coverage.cells.length === 0) return [];

  // 2) Candidate positions.
  const candidates = generateCandidates(rooms, doors, opts);

  // 3) Pre-compute coverage set per candidate.
  const candidateCoverage: number[][] = candidates.map(c =>
    computeFovCoverage(c, coverage.cells, walls, opts),
  );

  // 4) Greedy set cover.
  const requiredIdxs: number[] = coverage.cells
    .map((c, i) => (c.required ? i : -1))
    .filter(i => i >= 0);
  const covered = new Set<number>();
  const overlap = new Map<number, number>();

  const placements: CameraPlacement[] = [];
  const placedIdx = new Set<number>();

  // First pass: cover required cells until 95% reached.
  while (true) {
    const remaining = requiredIdxs.filter(i => !covered.has(i));
    if (remaining.length === 0) break;
    if (covered.size / requiredIdxs.length >= 0.95) break;

    let bestIdx = -1;
    let bestGain = 0;
    for (let ci = 0; ci < candidates.length; ci++) {
      if (placedIdx.has(ci)) continue;
      const cells = candidateCoverage[ci]!;
      let gain = 0;
      for (const cellIdx of cells) {
        if (!covered.has(cellIdx)) gain++;
      }
      if (gain > bestGain) {
        bestGain = gain;
        bestIdx = ci;
      }
    }
    if (bestIdx < 0 || bestGain === 0) break;
    placedIdx.add(bestIdx);
    const c = candidates[bestIdx]!;
    const cellsList = candidateCoverage[bestIdx]!;
    for (const idx of cellsList) {
      covered.add(idx);
      overlap.set(idx, (overlap.get(idx) ?? 0) + 1);
    }
    const coveredArea_m2 =
      cellsList.length * (opts.cell_size_mm * opts.cell_size_mm) / 1_000_000;
    placements.push({
      id: `CAM-${placements.length + 1}`,
      position: { x: c.position.x, y: c.position.y, z: 2800 },
      yaw_deg: c.yaw_deg,
      pitch_deg: 15,
      fov_deg: opts.fov_degrees,
      range_mm: opts.max_range_mm,
      covered_cells: cellsList.length,
      covered_area_m2: Math.round(coveredArea_m2 * 10) / 10,
      zone: c.zone,
      model_hint: c.zone === 'outdoor' ? 'Dahua DH-IPC-HFW2441S 4MP IP67' : 'Dahua DH-IPC-HDW1431T 4MP indoor',
    });
  }

  // 5) Enforce overlap at main entry: ensure each exterior door cell has ≥2 cameras.
  const minOverlap = opts.min_overlap_at_entry;
  if (minOverlap > 1) {
    const entryCellIdxs: number[] = [];
    for (let i = 0; i < coverage.cells.length; i++) {
      if (coverage.cells[i]!.priority >= 3) entryCellIdxs.push(i);
    }
    for (const ei of entryCellIdxs) {
      while ((overlap.get(ei) ?? 0) < minOverlap) {
        // Find best unused candidate that covers this cell.
        let bestIdx = -1;
        let bestGain = 0;
        for (let ci = 0; ci < candidates.length; ci++) {
          if (placedIdx.has(ci)) continue;
          const cells = candidateCoverage[ci]!;
          if (!cells.includes(ei)) continue;
          const gain = cells.length;
          if (gain > bestGain) {
            bestGain = gain;
            bestIdx = ci;
          }
        }
        if (bestIdx < 0) break;
        placedIdx.add(bestIdx);
        const c = candidates[bestIdx]!;
        const cellsList = candidateCoverage[bestIdx]!;
        for (const idx of cellsList) {
          covered.add(idx);
          overlap.set(idx, (overlap.get(idx) ?? 0) + 1);
        }
        const coveredArea_m2 =
          cellsList.length * (opts.cell_size_mm * opts.cell_size_mm) / 1_000_000;
        placements.push({
          id: `CAM-${placements.length + 1}`,
          position: { x: c.position.x, y: c.position.y, z: 2800 },
          yaw_deg: c.yaw_deg,
          pitch_deg: 15,
          fov_deg: opts.fov_degrees,
          range_mm: opts.max_range_mm,
          covered_cells: cellsList.length,
          covered_area_m2: Math.round(coveredArea_m2 * 10) / 10,
          zone: c.zone,
          model_hint: 'Dahua DH-IPC-HFW2441S 4MP IP67 (entry overlap)',
        });
      }
    }
  }

  return placements;
}

// ============================================================
// Coverage grid builder — required = entry + outdoor cells
// ============================================================

interface CoverageGrid {
  origin: Point;
  cell_mm: number;
  cols: number;
  rows: number;
  cells: CoverageCell[];   // flat
}

export function buildCoverageGrid(
  rooms: Room[],
  cell_mm: number,
  avoidZones: RoomKind[],
): CoverageGrid {
  const includedRooms = rooms.filter(r => COVER_ZONES.includes(r.kind) && !avoidZones.includes(r.kind));
  if (includedRooms.length === 0) {
    return { origin: { x: 0, y: 0 }, cell_mm, cols: 0, rows: 0, cells: [] };
  }
  const allPts = includedRooms.flatMap(r => r.polygon);
  const bb = bboxOf(allPts);
  const pad = 1500;
  const origin: Point = { x: bb.min_x - pad, y: bb.min_y - pad };
  const cols = Math.ceil((bb.max_x - bb.min_x + 2 * pad) / cell_mm);
  const rows = Math.ceil((bb.max_y - bb.min_y + 2 * pad) / cell_mm);

  const cells: CoverageCell[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const world: Point = {
        x: origin.x + x * cell_mm + cell_mm / 2,
        y: origin.y + y * cell_mm + cell_mm / 2,
      };
      const room = includedRooms.find(r => pointInPolygon(world, r.polygon));
      if (!room) continue;
      const isEntry = room.kind === 'entryway' || room.kind === 'outdoor';
      cells.push({
        x,
        y,
        world,
        required: true,
        priority: isEntry ? 3 : room.kind === 'corridor' ? 2 : 1,
      });
    }
  }
  return { origin, cell_mm, cols, rows, cells };
}

// ============================================================
// Candidate generation — corners + door-near positions
// ============================================================

function generateCandidates(rooms: Room[], doors: { center: Point }[], opts: Required<CameraOptions>): Candidate[] {
  const out: Candidate[] = [];
  for (const room of rooms) {
    if (opts.avoid_zones.includes(room.kind)) continue;
    if (!COVER_ZONES.includes(room.kind)) continue;
    const zone: CameraPlacement['zone'] =
      room.kind === 'outdoor' ? 'outdoor' :
      room.kind === 'entryway' ? 'entryway' : 'corridor';
    // Corner candidates: each polygon vertex inset 250mm into the room.
    const poly = room.polygon;
    for (let i = 0; i < poly.length; i++) {
      const cur = poly[i]!;
      const prev = poly[(i + poly.length - 1) % poly.length]!;
      const next = poly[(i + 1) % poly.length]!;
      // bisector inward.
      const v1 = norm({ x: prev.x - cur.x, y: prev.y - cur.y });
      const v2 = norm({ x: next.x - cur.x, y: next.y - cur.y });
      const bx = (v1.x + v2.x) / 2;
      const by = (v1.y + v2.y) / 2;
      const blen = Math.hypot(bx, by);
      if (blen < 1e-3) continue;
      const inset = 350;
      const candidate: Point = {
        x: cur.x + (bx / blen) * inset,
        y: cur.y + (by / blen) * inset,
      };
      if (!pointInPolygon(candidate, poly)) continue;
      // yaw points back toward room centroid for general coverage.
      const centroid = polyCentroidLocal(poly);
      const yaw = Math.atan2(centroid.y - candidate.y, centroid.x - candidate.x) * 180 / Math.PI;
      out.push({ position: candidate, yaw_deg: yaw, zone });
    }
  }
  // Add 1 candidate per exterior door from the inside of the entryway/outdoor side.
  for (const d of doors) {
    out.push({ position: { x: d.center.x + 500, y: d.center.y + 500 }, yaw_deg: 225, zone: 'outdoor' });
  }
  return out;
}

function norm(v: Point): Point {
  const len = Math.hypot(v.x, v.y);
  if (len < 1e-9) return { x: 0, y: 0 };
  return { x: v.x / len, y: v.y / len };
}

function polyCentroidLocal(poly: Point[]): Point {
  let sx = 0, sy = 0;
  for (const p of poly) { sx += p.x; sy += p.y; }
  return { x: sx / poly.length, y: sy / poly.length };
}

// ============================================================
// FOV coverage — raycast within angle, blocked by walls
// ============================================================

function computeFovCoverage(
  cand: Candidate,
  cells: CoverageCell[],
  walls: Wall[],
  opts: Required<CameraOptions>,
): number[] {
  const half = (opts.fov_degrees * Math.PI / 180) / 2;
  const yawRad = cand.yaw_deg * Math.PI / 180;
  const out: number[] = [];
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i]!;
    const dx = c.world.x - cand.position.x;
    const dy = c.world.y - cand.position.y;
    const dist = Math.hypot(dx, dy);
    if (dist > opts.max_range_mm) continue;
    const ang = Math.atan2(dy, dx);
    const diff = Math.atan2(Math.sin(ang - yawRad), Math.cos(ang - yawRad));
    if (Math.abs(diff) > half) continue;
    // Raycast: blocked by any non-exterior wall? (Exterior walls allowed since outdoor cams shoot into yard.)
    if (rayBlocked(cand.position, c.world, walls)) continue;
    out.push(i);
  }
  return out;
}

function rayBlocked(a: Point, b: Point, walls: Wall[]): boolean {
  for (const w of walls) {
    if (w.is_exterior) continue;
    if (segmentsIntersect(a, b, w.a, w.b)) return true;
  }
  return false;
}

// Re-export grid helpers for the API/coverage module to use.
export { worldToGrid, gridToWorld, euclidean };
