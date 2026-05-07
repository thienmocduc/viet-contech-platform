/**
 * Dijkstra shortest path on a 2D grid for cable/pipe routing.
 *
 * Complexity: O((V + E) log V) where V = cells, E = 4*V → O(N log N).
 * For a 200 m² floor at 100 mm cells: V ≈ 20k → ~ms.
 *
 * Options model:
 *   - prefer_along_walls: cells adjacent to walls receive a cost discount
 *   - avoid_above_doors  : cells in door swings get heavy penalty
 *   - min_corner_radius   : turn penalty discourages tight zigzags
 */

import { MinHeap, neighbors4 } from '../algorithms/graph.js';
import type { GridCell, Point, Route, RouteOptions } from '../types.js';

const TURN_PENALTY = 30;          // mm-equivalent per 90° turn
const DOOR_AVOID_COST = 5000;     // mm penalty for cells flagged as door zone

export interface DijkstraGrid {
  cells: GridCell[][];
  cell_mm: number;
  origin: Point;
  // Optional flags overlaid on the grid:
  near_wall?: boolean[][];        // discount if true
  door_zone?: boolean[][];        // penalty if true
}

export function dijkstra(
  grid: GridCell[][] | DijkstraGrid,
  start: Point,         // grid indices (x = col, y = row)
  end: Point,
  options: Partial<RouteOptions> = {},
): Route {
  const opts: RouteOptions = {
    prefer_along_walls: options.prefer_along_walls ?? true,
    avoid_above_doors: options.avoid_above_doors ?? true,
    min_corner_radius: options.min_corner_radius ?? 200,
  };

  const cells = Array.isArray(grid) ? grid : grid.cells;
  const dg: DijkstraGrid | null = Array.isArray(grid) ? null : grid;

  const rows = cells.length;
  if (rows === 0) return { path: [], total_cost_mm: 0 };
  const cols = cells[0]!.length;

  const sx = clamp(Math.round(start.x), 0, cols - 1);
  const sy = clamp(Math.round(start.y), 0, rows - 1);
  const ex = clamp(Math.round(end.x), 0, cols - 1);
  const ey = clamp(Math.round(end.y), 0, rows - 1);

  const startCell = cells[sy]![sx]!;
  const endCell = cells[ey]![ex]!;
  if (!startCell.passable || !endCell.passable) {
    return { path: [], total_cost_mm: Infinity };
  }

  const dist = new Array<number>(rows * cols).fill(Infinity);
  const prev = new Array<number>(rows * cols).fill(-1);
  const prevDir = new Array<number>(rows * cols).fill(-1);   // 0=L,1=R,2=U,3=D
  const visited = new Array<boolean>(rows * cols).fill(false);

  const idx = (cx: number, cy: number) => cy * cols + cx;
  dist[idx(sx, sy)] = 0;

  const heap = new MinHeap<{ x: number; y: number }>();
  heap.push({ x: sx, y: sy }, 0);

  while (heap.size > 0) {
    const cur = heap.pop()!;
    const ci = idx(cur.x, cur.y);
    if (visited[ci]) continue;
    visited[ci] = true;
    if (cur.x === ex && cur.y === ey) break;

    const curCell = cells[cur.y]![cur.x]!;
    for (const nb of neighbors4(cells, cur.x, cur.y)) {
      if (!nb.passable) continue;
      const ni = idx(nb.x, nb.y);
      if (visited[ni]) continue;

      // Base step cost: cell base + neighbor base, scaled by cell size if known.
      let stepCost = (curCell.cost + nb.cost) / 2;
      if (dg) stepCost *= dg.cell_mm / 100;   // normalize to mm

      // Wall preference discount.
      if (opts.prefer_along_walls && dg?.near_wall?.[nb.y]?.[nb.x]) {
        stepCost *= 0.7;
      }
      // Door zone penalty.
      if (opts.avoid_above_doors && dg?.door_zone?.[nb.y]?.[nb.x]) {
        stepCost += DOOR_AVOID_COST;
      }
      // Turn penalty.
      const dir = directionOf(cur.x, cur.y, nb.x, nb.y);
      const pdir = prevDir[ci];
      if (pdir >= 0 && pdir !== dir) {
        // 90° turn — add penalty proportional to min_corner_radius.
        stepCost += (TURN_PENALTY * opts.min_corner_radius) / 200;
      }

      const alt = dist[ci]! + stepCost;
      if (alt < dist[ni]!) {
        dist[ni] = alt;
        prev[ni] = ci;
        prevDir[ni] = dir;
        heap.push({ x: nb.x, y: nb.y }, alt);
      }
    }
  }

  const ei = idx(ex, ey);
  if (dist[ei] === Infinity) return { path: [], total_cost_mm: Infinity };

  // Reconstruct path.
  const path: GridCell[] = [];
  let curIdx = ei;
  while (curIdx !== -1) {
    const cy = Math.floor(curIdx / cols);
    const cx = curIdx % cols;
    path.push(cells[cy]![cx]!);
    if (curIdx === idx(sx, sy)) break;
    curIdx = prev[curIdx]!;
  }
  path.reverse();
  return { path, total_cost_mm: dist[ei]! };
}

function directionOf(ax: number, ay: number, bx: number, by: number): number {
  if (bx < ax) return 0;
  if (bx > ax) return 1;
  if (by < ay) return 2;
  return 3;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// ============================================================
// A* alternative — same signature, faster when goal is far.
// h(n) = manhattan(n, goal)
// ============================================================

export function astar(
  grid: DijkstraGrid,
  start: Point,
  end: Point,
  options: Partial<RouteOptions> = {},
): Route {
  const opts: RouteOptions = {
    prefer_along_walls: options.prefer_along_walls ?? true,
    avoid_above_doors: options.avoid_above_doors ?? true,
    min_corner_radius: options.min_corner_radius ?? 200,
  };
  const cells = grid.cells;
  const rows = cells.length;
  if (rows === 0) return { path: [], total_cost_mm: 0 };
  const cols = cells[0]!.length;

  const sx = Math.round(start.x), sy = Math.round(start.y);
  const ex = Math.round(end.x), ey = Math.round(end.y);
  const startCell = cells[sy]?.[sx];
  const endCell = cells[ey]?.[ex];
  if (!startCell || !endCell || !startCell.passable || !endCell.passable) {
    return { path: [], total_cost_mm: Infinity };
  }

  const idx = (cx: number, cy: number) => cy * cols + cx;
  const g = new Array<number>(rows * cols).fill(Infinity);
  const prev = new Array<number>(rows * cols).fill(-1);
  const prevDir = new Array<number>(rows * cols).fill(-1);
  const closed = new Array<boolean>(rows * cols).fill(false);

  g[idx(sx, sy)] = 0;
  const open = new MinHeap<{ x: number; y: number }>();
  open.push({ x: sx, y: sy }, heuristic(sx, sy, ex, ey, grid.cell_mm));

  while (open.size > 0) {
    const cur = open.pop()!;
    const ci = idx(cur.x, cur.y);
    if (closed[ci]) continue;
    closed[ci] = true;
    if (cur.x === ex && cur.y === ey) break;
    const curCell = cells[cur.y]![cur.x]!;
    for (const nb of neighbors4(cells, cur.x, cur.y)) {
      if (!nb.passable) continue;
      const ni = idx(nb.x, nb.y);
      if (closed[ni]) continue;
      let stepCost = ((curCell.cost + nb.cost) / 2) * (grid.cell_mm / 100);
      if (opts.prefer_along_walls && grid.near_wall?.[nb.y]?.[nb.x]) stepCost *= 0.7;
      if (opts.avoid_above_doors && grid.door_zone?.[nb.y]?.[nb.x]) stepCost += DOOR_AVOID_COST;
      const dir = directionOf(cur.x, cur.y, nb.x, nb.y);
      if (prevDir[ci] >= 0 && prevDir[ci] !== dir) {
        stepCost += (TURN_PENALTY * opts.min_corner_radius) / 200;
      }
      const tentative = g[ci]! + stepCost;
      if (tentative < g[ni]!) {
        g[ni] = tentative;
        prev[ni] = ci;
        prevDir[ni] = dir;
        const f = tentative + heuristic(nb.x, nb.y, ex, ey, grid.cell_mm);
        open.push({ x: nb.x, y: nb.y }, f);
      }
    }
  }

  const ei = idx(ex, ey);
  if (g[ei] === Infinity) return { path: [], total_cost_mm: Infinity };
  const path: GridCell[] = [];
  let cidx = ei;
  while (cidx !== -1) {
    const cy = Math.floor(cidx / cols);
    const cx = cidx % cols;
    path.push(cells[cy]![cx]!);
    if (cidx === idx(sx, sy)) break;
    cidx = prev[cidx]!;
  }
  path.reverse();
  return { path, total_cost_mm: g[ei]! };
}

function heuristic(ax: number, ay: number, bx: number, by: number, cell_mm: number): number {
  return (Math.abs(ax - bx) + Math.abs(ay - by)) * cell_mm;
}
