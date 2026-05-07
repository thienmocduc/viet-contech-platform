/**
 * Coverage map computation for camera visualization.
 *
 * Produces:
 *   - 2D array (rows × cols) of integers: number of cameras covering each cell
 *   - Coverage % overall and per-zone
 *   - List of blind spot positions (cells with 0 cameras)
 */

import { bboxOf, pointInPolygon, segmentsIntersect } from '../algorithms/graph.js';
import { buildCoverageGrid } from './camera.js';
import type {
  CameraPlacement,
  CoverageMap,
  LayoutJSON,
  Point,
  RoomKind,
  Wall,
} from '../types.js';

const DEFAULT_AVOID: RoomKind[] = ['bedroom', 'bathroom', 'altar'];

export function computeCoverage(
  layout: LayoutJSON,
  cameras: CameraPlacement[],
  cell_mm = 500,
): CoverageMap {
  const level = 0;
  const rooms = layout.rooms.filter(r => r.level === level);
  const walls = layout.walls.filter(w => w.level === level);

  const grid = buildCoverageGrid(rooms, cell_mm, DEFAULT_AVOID);
  if (grid.cells.length === 0) {
    return {
      cell_size_mm: cell_mm,
      cols: 0,
      rows: 0,
      origin: { x: 0, y: 0 },
      cells: [],
      coverage_pct: 0,
      blind_spots: [],
      required_pct: 0,
    };
  }

  // Build 2D matrix initialized to -1 (cell not in covered zone).
  const matrix: number[][] = [];
  for (let y = 0; y < grid.rows; y++) {
    matrix[y] = [];
    for (let x = 0; x < grid.cols; x++) matrix[y]![x] = -1;
  }
  for (const c of grid.cells) matrix[c.y]![c.x] = 0;

  // Tally each camera.
  for (const cam of cameras) {
    const half = (cam.fov_deg * Math.PI / 180) / 2;
    const yawRad = cam.yaw_deg * Math.PI / 180;
    for (const c of grid.cells) {
      const dx = c.world.x - cam.position.x;
      const dy = c.world.y - cam.position.y;
      const dist = Math.hypot(dx, dy);
      if (dist > cam.range_mm) continue;
      const ang = Math.atan2(dy, dx);
      const diff = Math.atan2(Math.sin(ang - yawRad), Math.cos(ang - yawRad));
      if (Math.abs(diff) > half) continue;
      if (rayBlocked(cam.position, c.world, walls)) continue;
      matrix[c.y]![c.x] = (matrix[c.y]![c.x] ?? 0) + 1;
    }
  }

  // Compute statistics.
  let totalCells = 0;
  let coveredCells = 0;
  let requiredCells = 0;
  let requiredCovered = 0;
  const blind: Point[] = [];
  for (const c of grid.cells) {
    totalCells++;
    const v = matrix[c.y]![c.x] ?? 0;
    if (v > 0) coveredCells++;
    if (c.required) {
      requiredCells++;
      if (v > 0) requiredCovered++;
    }
    if (v === 0) blind.push(c.world);
  }

  return {
    cell_size_mm: cell_mm,
    cols: grid.cols,
    rows: grid.rows,
    origin: grid.origin,
    cells: matrix,
    coverage_pct: totalCells > 0 ? Math.round((coveredCells / totalCells) * 1000) / 10 : 0,
    blind_spots: blind,
    required_pct: requiredCells > 0 ? Math.round((requiredCovered / requiredCells) * 1000) / 10 : 0,
  };
}

function rayBlocked(a: Point, b: Point, walls: Wall[]): boolean {
  for (const w of walls) {
    if (w.is_exterior) continue;
    if (segmentsIntersect(a, b, w.a, w.b)) return true;
  }
  return false;
}

void bboxOf;
void pointInPolygon;
