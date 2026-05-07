/**
 * Auto routing for electrical system.
 *
 * Algorithm:
 *   1. Compute room loads using TCVN/IEC density tables.
 *   2. Auto-place outlets/switches/lights if not already provided
 *      (NEC 210.52: max 3.6m spacing along walls, GFCI in WC).
 *   3. Build a 100mm grid; mark walls impassable, "near-wall" cells
 *      preferred (cables run inside walls/conduits).
 *   4. From the main panel, run Dijkstra to each branch endpoint.
 *      Bundle wires that share the run (trunk topology).
 *   5. Size cables: I_B = P / (V * PF), I_Z = I_B * 1.25, then look up
 *      Cadivi PVC table; verify voltage drop ≤3%.
 *
 * Output: ElectricSystem with circuits, cables, and the equipment list.
 */

import { dijkstra } from './dijkstra.js';
import {
  bboxOf,
  euclidean,
  pointInPolygon,
  polygonCentroid,
  worldToGrid,
  gridToWorld,
  douglasPeucker,
} from '../algorithms/graph.js';
import type {
  Cable,
  CableSize,
  Circuit,
  ElectricSystem,
  GridCell,
  LayoutJSON,
  LightSpec,
  OutletSpec,
  Panel,
  Point,
  Room,
  RoomKind,
  SwitchSpec,
  Wall,
} from '../types.js';
import type { DijkstraGrid } from './dijkstra.js';

// ============================================================
// Load densities (W per m²) — derived from registry dna_prompt
// ============================================================

const LOAD_W_PER_M2: Record<RoomKind, number> = {
  living: 80,
  bedroom: 40,
  kitchen: 250,
  bathroom: 60,
  corridor: 30,
  stairs: 30,
  garage: 30,
  balcony: 20,
  storage: 20,
  utility: 50,
  altar: 30,
  study: 60,
  dining: 70,
  outdoor: 15,
  entryway: 40,
};

// Cadivi PVC ampacity table.
const CABLE_TABLE: Array<{ size: CableSize; iz_A: number }> = [
  { size: 1.5, iz_A: 15 },
  { size: 2.5, iz_A: 22 },
  { size: 4, iz_A: 30 },
  { size: 6, iz_A: 42 },
  { size: 10, iz_A: 58 },
  { size: 16, iz_A: 78 },
  { size: 25, iz_A: 100 },
];

// Voltage-drop reference: ρ_Cu * 2 * L * I / (S * V) (single-phase).
const RHO_CU = 0.0175;     // Ω·mm²/m
const VOLTAGE_V = 220;
const POWER_FACTOR = 0.85;
const MAX_VDROP_PCT = 3;

const CELL_MM = 100;       // 100mm × 100mm grid

// ============================================================
// Public entry point
// ============================================================

export function routeElectric(layout: LayoutJSON): ElectricSystem {
  // Multi-level: place equipment for every level, route trunk per-level from
  // the main panel projection. The main panel sits on level 0; each upper level
  // gets a sub-trunk dropped from the riser.
  const allRooms = layout.rooms;
  const rooms = allRooms.filter(r => r.level === 0);
  const walls = layout.walls.filter(w => w.level === 0);
  const doors = layout.doors.filter(d => d.level === 0);

  // 1) Auto-place equipment per level if user didn't provide.
  const outlets: OutletSpec[] = layout.outlets?.length
    ? [...layout.outlets]
    : autoPlaceAllLevels(allRooms, layout.walls, autoPlaceOutlets);
  const lights: LightSpec[] = layout.lights?.length
    ? [...layout.lights]
    : autoPlaceAllLevels(allRooms, layout.walls, (rs) => autoPlaceLights(rs)) ;
  const switches: SwitchSpec[] = layout.switches?.length
    ? [...layout.switches]
    : autoPlaceSwitchesAllLevels(allRooms, layout.doors, lights);

  // 2) Compute panel position.
  const panelPos: Point = layout.main_panel ?? pickPanelPosition(rooms, walls);

  // 3) Build routing grid for the level-0 footprint (used for trunk on T1).
  //    Upper-level branches use Manhattan estimates from the riser drop point.
  const grid = buildGrid(rooms, walls, doors);

  // 4) Group fixtures into circuits (lighting / outlets / kitchen / WC / AC).
  const circuits = groupIntoCircuits(allRooms, outlets, lights);

  // 5) For each circuit: route cable from panel, size cable, attach to a breaker.
  const panel: Panel = {
    id: 'PANEL-MAIN',
    position: panelPos,
    level: 0,
    main_breaker_A: 0,
    total_load_kW: 0,
    breakers: [],
  };

  const cables: Cable[] = [];
  const circuitsOut: Circuit[] = [];
  let totalCableLength_mm = 0;

  for (const c of circuits) {
    // Start of trunk = nearest fixture to panel.
    const fixtures = c.fixtures;
    if (fixtures.length === 0) continue;

    // Order fixtures by Manhattan distance to panel for trunk sequencing.
    fixtures.sort(
      (a, b) => euclidean(a.position, panelPos) - euclidean(b.position, panelPos),
    );

    const segments: GridCell[] = [];
    let trunkLen_mm = 0;
    let prev = panelPos;
    // Identify circuit's primary level: most-common level among fixtures.
    const fxLevels = fixtures.map(fx => fx.level);
    const circuitLevel = mostCommon(fxLevels);
    // Vertical riser is a SHARED bus, not per-circuit. We add a one-time riser
    // contribution after the loop based on max level reached.
    for (const f of fixtures) {
      const fxLevel = f.level;
      if (fxLevel === 0 && circuitLevel === 0) {
        // Same-floor Dijkstra trunk.
        const a = worldToGrid(prev, grid.origin, CELL_MM);
        const b = worldToGrid(f.position, grid.origin, CELL_MM);
        const r = dijkstra(grid, { x: a.gx, y: a.gy }, { x: b.gx, y: b.gy }, {
          prefer_along_walls: true,
          avoid_above_doors: true,
          min_corner_radius: 200,
        });
        if (r.path.length === 0 || r.total_cost_mm === Infinity) {
          trunkLen_mm += euclidean(prev, f.position);
        } else {
          segments.push(...r.path);
          // Length = cell count × cell size (excludes turn/door penalties).
          trunkLen_mm += Math.max(0, r.path.length - 1) * CELL_MM;
        }
        prev = f.position;
      } else {
        // Upper-level: trunk via Manhattan between consecutive fixtures.
        // For the first fixture on this branch, project to riser (panel x,y).
        const start: Point = (prev === panelPos)
          ? { x: panelPos.x, y: panelPos.y }
          : prev;
        const dist = Math.abs(f.position.x - start.x) + Math.abs(f.position.y - start.y);
        trunkLen_mm += dist;
        prev = f.position;
      }
    }

    // Simplify path with Douglas-Peucker for cleaner DXF output.
    const polyline = segments.map(cell =>
      gridToWorld(cell.x, cell.y, grid.origin, CELL_MM),
    );
    const simplified = douglasPeucker(polyline, 150);
    void simplified; // currently kept for output use; routes saved as cell arrays.

    // Size cable.
    const I_B = c.load_W / (VOLTAGE_V * POWER_FACTOR);
    const I_Z = I_B * 1.25;
    const cable = pickCable(I_Z, trunkLen_mm / 1000, I_B);

    // Breaker rating: round up I_B to next standard.
    const cbA = pickBreakerA(I_B);

    const circuitId = `CKT-${c.kind}-${circuitsOut.length + 1}`;
    const breakerId = `CB-${circuitId}`;
    const cableId = `CBL-${circuitId}`;

    panel.breakers.push({
      id: breakerId,
      panel_id: panel.id,
      rated_A: cbA,
      rcd: c.kind === 'branch_wc' || c.kind === 'branch_outlet',
      poles: 1,
      serves: [circuitId],
      type: c.kind,
    });

    cables.push({
      id: cableId,
      circuit_id: circuitId,
      size_mm2: cable.size,
      length_mm: Math.round(trunkLen_mm),
      voltage_drop_pct: cable.vdrop_pct,
      current_A: I_B,
    });

    circuitsOut.push({
      id: circuitId,
      panel_id: panel.id,
      breaker_id: breakerId,
      type: c.kind,
      load_W: c.load_W,
      current_A: I_B,
      cable_id: cableId,
      fixtures: fixtures.map(f => f.id),
      route: { path: segments, total_cost_mm: trunkLen_mm },
    });

    totalCableLength_mm += trunkLen_mm;
  }

  // 6) Sum load + main breaker.
  const totalLoad_W = circuitsOut.reduce((s, c) => s + c.load_W, 0);
  panel.total_load_kW = totalLoad_W / 1000;
  const I_main = totalLoad_W / (VOLTAGE_V * POWER_FACTOR);
  panel.main_breaker_A = pickBreakerA(I_main * 1.1);

  // 7) Add a single shared vertical riser (3-phase trunk feeder) for upper levels.
  const maxLevel = Math.max(0, ...allRooms.map(r => r.level));
  if (maxLevel > 0) {
    totalCableLength_mm += maxLevel * 3200;
  }

  return {
    panels: [panel],
    breakers: panel.breakers,
    circuits: circuitsOut,
    cables,
    outlets,
    switches,
    lights,
    total_load_kW: panel.total_load_kW,
    total_cable_length_m: Math.round(totalCableLength_mm / 1000),
    cb_main_size_A: panel.main_breaker_A,
  };
}

function mostCommon(values: number[]): number {
  if (values.length === 0) return 0;
  const counts = new Map<number, number>();
  let bestK = values[0]!;
  let bestC = 0;
  for (const v of values) {
    const c = (counts.get(v) ?? 0) + 1;
    counts.set(v, c);
    if (c > bestC) { bestC = c; bestK = v; }
  }
  return bestK;
}

function autoPlaceAllLevels<T>(
  rooms: Room[],
  walls: Wall[],
  fn: (rooms: Room[], walls: Wall[]) => T[],
): T[] {
  const levels = new Set(rooms.map(r => r.level));
  const out: T[] = [];
  for (const lv of levels) {
    out.push(...fn(rooms.filter(r => r.level === lv), walls.filter(w => w.level === lv)));
  }
  return out;
}

function autoPlaceSwitchesAllLevels(
  rooms: Room[],
  doors: { wall_id: string; center: Point; level: number }[],
  lights: LightSpec[],
): SwitchSpec[] {
  const levels = new Set(rooms.map(r => r.level));
  const out: SwitchSpec[] = [];
  for (const lv of levels) {
    const lvRooms = rooms.filter(r => r.level === lv);
    const lvLights = lights.filter(l => lvRooms.some(r => r.id === l.room_id));
    const lvDoors = doors.filter(d => d.level === lv);
    out.push(...autoPlaceSwitches(lvRooms, lvDoors, lvLights));
  }
  return out;
}

// ============================================================
// Auto-placement: outlets along walls (NEC 210.52)
// ============================================================

function autoPlaceOutlets(rooms: Room[], walls: Wall[]): OutletSpec[] {
  const out: OutletSpec[] = [];
  let i = 0;
  for (const room of rooms) {
    if (room.kind === 'corridor' || room.kind === 'stairs' || room.kind === 'outdoor') continue;
    const isWC = room.kind === 'bathroom';
    const isKitchen = room.kind === 'kitchen';

    // For each polygon edge, place outlets every 3.6m.
    const poly = room.polygon;
    for (let k = 0; k < poly.length; k++) {
      const a = poly[k]!;
      const b = poly[(k + 1) % poly.length]!;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 1500) continue;       // skip tiny edges
      const step = 3600;
      const inset = 300;              // 300mm from corner
      let d = inset;
      while (d < len - inset) {
        const t = d / len;
        // place outlet 100mm inside the room from the wall edge
        const nx = (b.x - a.x) / len;
        const ny = (b.y - a.y) / len;
        const inwardX = -ny;
        const inwardY = nx;
        const px = a.x + nx * d + inwardX * 150;
        const py = a.y + ny * d + inwardY * 150;
        const pos = { x: px, y: py };
        if (pointInPolygon(pos, poly)) {
          out.push({
            id: `OUT-${++i}`,
            room_id: room.id,
            position: pos,
            type: isWC ? 'gfci_wc' : isKitchen ? 'kitchen' : 'standard',
          });
        }
        d += step;
      }
    }
  }
  void walls; // walls used as soft hint only (polygon edges already imply walls)
  return out;
}

// ============================================================
// Auto-placement: lights at room centroid + extras for big rooms
// ============================================================

function autoPlaceLights(rooms: Room[]): LightSpec[] {
  const out: LightSpec[] = [];
  let i = 0;
  for (const room of rooms) {
    if (room.kind === 'outdoor') continue;
    const c = polygonCentroid(room.polygon);
    const watts = lightWattsFor(room);
    out.push({
      id: `LIGHT-${++i}`,
      room_id: room.id,
      position: c,
      watts,
      type: 'ceiling',
    });
    // Extra downlights for rooms ≥18 m².
    if (room.area_m2 >= 18) {
      const bb = bboxOf(room.polygon);
      const offsets = [
        { x: bb.min_x + (bb.max_x - bb.min_x) * 0.3, y: bb.min_y + (bb.max_y - bb.min_y) * 0.3 },
        { x: bb.min_x + (bb.max_x - bb.min_x) * 0.7, y: bb.min_y + (bb.max_y - bb.min_y) * 0.7 },
      ];
      for (const o of offsets) {
        if (pointInPolygon(o, room.polygon)) {
          out.push({
            id: `LIGHT-${++i}`,
            room_id: room.id,
            position: o,
            watts: 12,
            type: 'downlight',
          });
        }
      }
    }
  }
  return out;
}

function lightWattsFor(room: Room): number {
  switch (room.kind) {
    case 'living': return 36;
    case 'bedroom': return 24;
    case 'kitchen': return 30;
    case 'bathroom': return 18;
    case 'corridor': return 12;
    case 'altar': return 18;
    default: return 18;
  }
}

// ============================================================
// Auto-placement: switches at door-side, height 1.2m
// ============================================================

function autoPlaceSwitches(
  rooms: Room[],
  doors: { wall_id: string; center: Point }[],
  lights: LightSpec[],
): SwitchSpec[] {
  const out: SwitchSpec[] = [];
  let i = 0;
  for (const room of rooms) {
    const roomLights = lights.filter(l => l.room_id === room.id);
    if (roomLights.length === 0) continue;
    // Find a door whose center is within polygon (or near edge).
    const bb = bboxOf(room.polygon);
    const door = doors.find(d =>
      d.center.x >= bb.min_x - 200 && d.center.x <= bb.max_x + 200 &&
      d.center.y >= bb.min_y - 200 && d.center.y <= bb.max_y + 200,
    );
    const pos: Point = door
      ? { x: door.center.x + 200, y: door.center.y + 200 }
      : polygonCentroid(room.polygon);
    out.push({
      id: `SW-${++i}`,
      room_id: room.id,
      position: pos,
      controls: roomLights.map(l => l.id),
    });
  }
  return out;
}

// ============================================================
// Panel position: prefer utility room, else centroid of footprint
// ============================================================

function pickPanelPosition(rooms: Room[], walls: Wall[]): Point {
  void walls;
  const utility = rooms.find(r => r.kind === 'utility' || r.kind === 'storage');
  if (utility) return polygonCentroid(utility.polygon);
  const allPts = rooms.flatMap(r => r.polygon);
  const bb = bboxOf(allPts);
  return { x: bb.min_x + 500, y: bb.min_y + 500 };
}

// ============================================================
// Circuit grouping
// ============================================================

interface CircuitGroup {
  kind: 'branch_lighting' | 'branch_outlet' | 'branch_kitchen' | 'branch_ac' | 'branch_wc';
  fixtures: Array<{ id: string; position: Point; watts: number; level: number }>;
  load_W: number;
}

function groupIntoCircuits(
  rooms: Room[],
  outlets: OutletSpec[],
  lights: LightSpec[],
): CircuitGroup[] {
  const groups: CircuitGroup[] = [];
  const roomById = new Map<string, Room>();
  for (const r of rooms) roomById.set(r.id, r);

  // Per-room kitchen circuit (dedicated 32A).
  const kitchen = rooms.find(r => r.kind === 'kitchen');
  if (kitchen) {
    const kOutlets = outlets.filter(o => o.room_id === kitchen.id);
    const kLoad = kitchen.area_m2 * LOAD_W_PER_M2.kitchen;
    groups.push({
      kind: 'branch_kitchen',
      fixtures: kOutlets.map(o => ({ id: o.id, position: o.position, watts: 0, level: kitchen.level })),
      load_W: kLoad,
    });
  }

  // Per-WC circuit (dedicated GFCI 16A).
  for (const wc of rooms.filter(r => r.kind === 'bathroom')) {
    const wcOutlets = outlets.filter(o => o.room_id === wc.id);
    const wcLights = lights.filter(l => l.room_id === wc.id);
    const load = wc.area_m2 * LOAD_W_PER_M2.bathroom + wcLights.reduce((s, l) => s + l.watts, 0);
    groups.push({
      kind: 'branch_wc',
      fixtures: [
        ...wcOutlets.map(o => ({ id: o.id, position: o.position, watts: 0, level: wc.level })),
        ...wcLights.map(l => ({ id: l.id, position: l.position, watts: l.watts, level: wc.level })),
      ],
      load_W: load,
    });
  }

  // Lighting circuits per level (chunk by 12).
  const otherLights = lights.filter(l => {
    const r = roomById.get(l.room_id);
    return r ? r.kind !== 'bathroom' : true;
  });
  const byLevelLights = new Map<number, LightSpec[]>();
  for (const l of otherLights) {
    const r = roomById.get(l.room_id);
    const lv = r ? r.level : 0;
    if (!byLevelLights.has(lv)) byLevelLights.set(lv, []);
    byLevelLights.get(lv)!.push(l);
  }
  for (const [lv, list] of byLevelLights) {
    for (let i = 0; i < list.length; i += 12) {
      const chunk = list.slice(i, i + 12);
      const load = chunk.reduce((s, l) => s + l.watts, 0);
      groups.push({
        kind: 'branch_lighting',
        fixtures: chunk.map(l => ({ id: l.id, position: l.position, watts: l.watts, level: lv })),
        load_W: load,
      });
    }
  }

  // Outlet circuits per level (~8 per circuit).
  const otherOutlets = outlets.filter(o => {
    const r = roomById.get(o.room_id);
    return r ? r.kind !== 'kitchen' && r.kind !== 'bathroom' : true;
  });
  const byLevelOutlets = new Map<number, OutletSpec[]>();
  for (const o of otherOutlets) {
    const r = roomById.get(o.room_id);
    const lv = r ? r.level : 0;
    if (!byLevelOutlets.has(lv)) byLevelOutlets.set(lv, []);
    byLevelOutlets.get(lv)!.push(o);
  }
  for (const [lv, list] of byLevelOutlets) {
    for (let i = 0; i < list.length; i += 8) {
      const chunk = list.slice(i, i + 8);
      const load = chunk.length * 200;
      groups.push({
        kind: 'branch_outlet',
        fixtures: chunk.map(o => ({ id: o.id, position: o.position, watts: 200, level: lv })),
        load_W: load,
      });
    }
  }

  return groups;
}

// ============================================================
// Cable sizing with voltage drop check
// ============================================================

function pickCable(I_Z: number, length_m: number, I_B: number): { size: CableSize; vdrop_pct: number } {
  for (const c of CABLE_TABLE) {
    if (c.iz_A >= I_Z) {
      const vdrop_v = (2 * RHO_CU * length_m * I_B) / c.size;
      const vdrop_pct = (vdrop_v / VOLTAGE_V) * 100;
      if (vdrop_pct <= MAX_VDROP_PCT) return { size: c.size, vdrop_pct };
    }
  }
  // Fallback to largest size.
  const largest = CABLE_TABLE[CABLE_TABLE.length - 1]!;
  const vdrop_v = (2 * RHO_CU * length_m * I_B) / largest.size;
  return { size: largest.size, vdrop_pct: (vdrop_v / VOLTAGE_V) * 100 };
}

// ============================================================
// Standard breaker sizing
// ============================================================

const BREAKER_SIZES_A = [6, 10, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125];

function pickBreakerA(I: number): number {
  for (const a of BREAKER_SIZES_A) if (a >= I) return a;
  return BREAKER_SIZES_A[BREAKER_SIZES_A.length - 1]!;
}

// ============================================================
// Build 100mm grid, mark walls + doors + near-wall preference
// ============================================================

function buildGrid(rooms: Room[], walls: Wall[], doors: { center: Point; width_mm: number }[]): DijkstraGrid {
  if (rooms.length === 0) {
    return {
      cells: [],
      cell_mm: CELL_MM,
      origin: { x: 0, y: 0 },
      near_wall: [],
      door_zone: [],
    };
  }
  const allPts = rooms.flatMap(r => r.polygon);
  const bb = bboxOf(allPts);
  const pad = 1000;
  const origin: Point = { x: bb.min_x - pad, y: bb.min_y - pad };
  const cols = Math.ceil((bb.max_x - bb.min_x + 2 * pad) / CELL_MM);
  const rows = Math.ceil((bb.max_y - bb.min_y + 2 * pad) / CELL_MM);

  const cells: GridCell[][] = [];
  const near_wall: boolean[][] = [];
  const door_zone: boolean[][] = [];
  for (let y = 0; y < rows; y++) {
    cells[y] = [];
    near_wall[y] = [];
    door_zone[y] = [];
    for (let x = 0; x < cols; x++) {
      const wp: Point = { x: origin.x + x * CELL_MM + CELL_MM / 2, y: origin.y + y * CELL_MM + CELL_MM / 2 };
      const inAny = rooms.some(r => pointInPolygon(wp, r.polygon));
      cells[y]![x] = { x, y, passable: inAny, cost: 100 };
      near_wall[y]![x] = false;
      door_zone[y]![x] = false;
    }
  }

  // Mark cells within 300mm of any wall as "near wall" (cable preference).
  for (const w of walls) {
    const nx = w.b.x - w.a.x;
    const ny = w.b.y - w.a.y;
    const len = Math.hypot(nx, ny);
    if (len < 1) continue;
    const steps = Math.ceil(len / CELL_MM);
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const wx = w.a.x + nx * t;
      const wy = w.a.y + ny * t;
      const cx = Math.floor((wx - origin.x) / CELL_MM);
      const cy = Math.floor((wy - origin.y) / CELL_MM);
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          const xx = cx + dx;
          const yy = cy + dy;
          if (xx < 0 || yy < 0 || xx >= cols || yy >= rows) continue;
          near_wall[yy]![xx] = true;
        }
      }
    }
  }

  // Mark door swing zone (1m radius around door center) as avoid-zone.
  for (const d of doors) {
    const cx = Math.floor((d.center.x - origin.x) / CELL_MM);
    const cy = Math.floor((d.center.y - origin.y) / CELL_MM);
    const r = Math.ceil(d.width_mm / CELL_MM);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const xx = cx + dx, yy = cy + dy;
        if (xx < 0 || yy < 0 || xx >= cols || yy >= rows) continue;
        door_zone[yy]![xx] = true;
      }
    }
  }

  return { cells, cell_mm: CELL_MM, origin, near_wall, door_zone };
}
