/**
 * Reusable graph + geometry utilities.
 * Manhattan distance, Douglas-Peucker simplification, polygon helpers.
 */

import type { Bbox, GridCell, Point, Wall } from '../types.js';

// ============================================================
// Min-heap priority queue (binary heap)
// ============================================================

export class MinHeap<T> {
  private data: { key: number; value: T }[] = [];

  get size(): number {
    return this.data.length;
  }

  push(value: T, key: number): void {
    this.data.push({ key, value });
    this.bubbleUp(this.data.length - 1);
  }

  pop(): T | undefined {
    if (this.data.length === 0) return undefined;
    const top = this.data[0]!;
    const last = this.data.pop()!;
    if (this.data.length > 0) {
      this.data[0] = last;
      this.bubbleDown(0);
    }
    return top.value;
  }

  private bubbleUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.data[i]!.key < this.data[parent]!.key) {
        [this.data[i], this.data[parent]] = [this.data[parent]!, this.data[i]!];
        i = parent;
      } else break;
    }
  }

  private bubbleDown(i: number): void {
    const n = this.data.length;
    while (true) {
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      let smallest = i;
      if (l < n && this.data[l]!.key < this.data[smallest]!.key) smallest = l;
      if (r < n && this.data[r]!.key < this.data[smallest]!.key) smallest = r;
      if (smallest !== i) {
        [this.data[i], this.data[smallest]] = [this.data[smallest]!, this.data[i]!];
        i = smallest;
      } else break;
    }
  }
}

// ============================================================
// Distances
// ============================================================

export function manhattan(a: Point, b: Point): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function euclidean(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function chebyshev(a: Point, b: Point): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

// ============================================================
// 2D adjacency for grids (4-connected)
// ============================================================

export function neighbors4(grid: GridCell[][], x: number, y: number): GridCell[] {
  const out: GridCell[] = [];
  const rows = grid.length;
  if (rows === 0) return out;
  const cols = grid[0]!.length;
  if (x > 0) out.push(grid[y]![x - 1]!);
  if (x < cols - 1) out.push(grid[y]![x + 1]!);
  if (y > 0) out.push(grid[y - 1]![x]!);
  if (y < rows - 1) out.push(grid[y + 1]![x]!);
  return out;
}

// ============================================================
// Polygon utilities
// ============================================================

export function bboxOf(points: Point[]): Bbox {
  if (points.length === 0) return { min_x: 0, min_y: 0, max_x: 0, max_y: 0 };
  let min_x = Infinity, min_y = Infinity, max_x = -Infinity, max_y = -Infinity;
  for (const p of points) {
    if (p.x < min_x) min_x = p.x;
    if (p.y < min_y) min_y = p.y;
    if (p.x > max_x) max_x = p.x;
    if (p.y > max_y) max_y = p.y;
  }
  return { min_x, min_y, max_x, max_y };
}

export function pointInPolygon(p: Point, poly: Point[]): boolean {
  // Ray casting algorithm.
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

export function polygonCentroid(poly: Point[]): Point {
  let cx = 0, cy = 0, a = 0;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % n]!;
    const cross = p.x * q.y - q.x * p.y;
    a += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  if (Math.abs(a) < 1e-9) {
    // Degenerate: average of vertices.
    return {
      x: poly.reduce((s, p) => s + p.x, 0) / n,
      y: poly.reduce((s, p) => s + p.y, 0) / n,
    };
  }
  a *= 0.5;
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

// ============================================================
// Segment intersection (for line-of-sight + wall blocking)
// ============================================================

export function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const d1 = orient(c, d, a);
  const d2 = orient(c, d, b);
  const d3 = orient(a, b, c);
  const d4 = orient(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  return false;
}

function orient(p: Point, q: Point, r: Point): number {
  return (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
}

export function segmentBlockedByWalls(a: Point, b: Point, walls: Wall[], level: number): boolean {
  for (const w of walls) {
    if (w.level !== level) continue;
    if (w.is_exterior) continue;       // we treat exterior walls as room boundaries we may cross via doors
    if (segmentsIntersect(a, b, w.a, w.b)) return true;
  }
  return false;
}

// ============================================================
// Douglas-Peucker simplification
// Useful for cleaning up Dijkstra paths into straight runs.
// ============================================================

export function douglasPeucker(points: Point[], epsilon_mm: number): Point[] {
  if (points.length < 3) return points.slice();
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  dpRecur(points, 0, points.length - 1, epsilon_mm, keep);
  const out: Point[] = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]!);
  return out;
}

function dpRecur(pts: Point[], lo: number, hi: number, eps: number, keep: boolean[]): void {
  if (hi - lo < 2) return;
  let maxD = -1;
  let maxI = lo;
  const a = pts[lo]!;
  const b = pts[hi]!;
  for (let i = lo + 1; i < hi; i++) {
    const d = perpDist(pts[i]!, a, b);
    if (d > maxD) {
      maxD = d;
      maxI = i;
    }
  }
  if (maxD > eps) {
    keep[maxI] = true;
    dpRecur(pts, lo, maxI, eps, keep);
    dpRecur(pts, maxI, hi, eps, keep);
  }
}

function perpDist(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-9) return euclidean(p, a);
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  const tt = Math.max(0, Math.min(1, t));
  const projX = a.x + tt * dx;
  const projY = a.y + tt * dy;
  return Math.sqrt((p.x - projX) ** 2 + (p.y - projY) ** 2);
}

// ============================================================
// World <-> grid coordinate helpers
// ============================================================

export function worldToGrid(world: Point, origin: Point, cell_mm: number): { gx: number; gy: number } {
  return {
    gx: Math.floor((world.x - origin.x) / cell_mm),
    gy: Math.floor((world.y - origin.y) / cell_mm),
  };
}

export function gridToWorld(gx: number, gy: number, origin: Point, cell_mm: number): Point {
  return {
    x: origin.x + gx * cell_mm + cell_mm / 2,
    y: origin.y + gy * cell_mm + cell_mm / 2,
  };
}
