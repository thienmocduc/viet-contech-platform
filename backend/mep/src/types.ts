/**
 * MEP Smart Routing — Types
 * Viet-Contech AI Design Platform
 *
 * UNITS: All distances in millimeters (mm) unless otherwise noted.
 * COORDS: Cartesian (x, y, z); z is height above floor.
 * LAYER convention: ENG-E (electric), ENG-P (plumbing), ENG-CAM (camera).
 */

// ============================================================
// Geometry primitives
// ============================================================

export interface Point {
  x: number;
  y: number;
  z?: number;
}

export interface Segment {
  a: Point;
  b: Point;
}

export interface Bbox {
  min_x: number;
  min_y: number;
  max_x: number;
  max_y: number;
}

// ============================================================
// Layout JSON (input from BIM/Architecture agent)
// ============================================================

export type RoomKind =
  | 'living'        // PHK
  | 'bedroom'       // PN
  | 'kitchen'       // bep
  | 'bathroom'      // WC
  | 'corridor'      // hanh lang
  | 'stairs'        // cau thang
  | 'garage'        // gara
  | 'balcony'       // ban cong
  | 'storage'       // kho
  | 'utility'       // ky thuat
  | 'altar'         // phong tho
  | 'study'         // phong lam viec
  | 'dining'        // phong an
  | 'outdoor'       // san vuon
  | 'entryway';     // sanh

export interface Room {
  id: string;
  kind: RoomKind;
  name?: string;
  level: number;            // floor index (0 = T1, 1 = T2, ...)
  polygon: Point[];         // CCW polygon in mm
  area_m2: number;
  height_mm: number;        // ceiling height
}

export interface Wall {
  id: string;
  level: number;
  a: Point;
  b: Point;
  thickness_mm: number;     // 100, 200, ...
  is_exterior: boolean;
}

export interface Door {
  id: string;
  level: number;
  wall_id: string;
  center: Point;
  width_mm: number;
  is_exterior: boolean;
}

export interface Window {
  id: string;
  level: number;
  wall_id: string;
  center: Point;
  width_mm: number;
  height_mm: number;
}

export interface OutletSpec {
  id: string;
  room_id: string;
  position: Point;
  type: 'standard' | 'kitchen' | 'gfci_wc' | 'high_power';
}

export interface SwitchSpec {
  id: string;
  room_id: string;
  position: Point;
  controls: string[];       // light ids
}

export interface LightSpec {
  id: string;
  room_id: string;
  position: Point;
  watts: number;
  type: 'downlight' | 'ceiling' | 'wall' | 'pendant';
}

export interface FixtureSpec {
  id: string;
  room_id: string;
  position: Point;
  type: 'wc' | 'lavabo' | 'shower' | 'sink' | 'washing_machine' | 'dishwasher';
}

export interface LayoutJSON {
  id: string;
  total_area_m2: number;
  occupants: number;
  levels: number;
  rooms: Room[];
  walls: Wall[];
  doors: Door[];
  windows?: Window[];
  // Optional pre-placed equipment; routing fills these if missing.
  outlets?: OutletSpec[];
  switches?: SwitchSpec[];
  lights?: LightSpec[];
  fixtures?: FixtureSpec[];
  // Main panel & water tank locations (if known)
  main_panel?: Point;
  water_tank_roof?: Point;
  septic_tank?: Point;
}

// ============================================================
// Routing graph (Dijkstra/A*)
// ============================================================

export interface GridCell {
  x: number;            // grid index (col)
  y: number;            // grid index (row)
  passable: boolean;
  cost: number;         // base traversal cost
}

export interface RouteOptions {
  prefer_along_walls: boolean;
  avoid_above_doors: boolean;
  min_corner_radius: number;   // mm
}

export interface Route {
  path: GridCell[];
  total_cost_mm: number;
}

// ============================================================
// Electric system
// ============================================================

export type CableSize = 1.5 | 2.5 | 4 | 6 | 10 | 16 | 25;

export interface Breaker {
  id: string;
  panel_id: string;
  rated_A: number;          // 16, 20, 32, 40 ...
  rcd: boolean;             // residual current device
  poles: 1 | 2 | 3;
  serves: string[];         // circuit ids
  type: 'main' | 'branch_lighting' | 'branch_outlet' | 'branch_kitchen' | 'branch_ac' | 'branch_wc';
}

export interface Panel {
  id: string;
  position: Point;
  level: number;
  main_breaker_A: number;
  total_load_kW: number;
  breakers: Breaker[];
}

export interface Cable {
  id: string;
  circuit_id: string;
  size_mm2: CableSize;
  length_mm: number;
  voltage_drop_pct: number;
  current_A: number;
}

export interface Circuit {
  id: string;
  panel_id: string;
  breaker_id: string;
  type: Breaker['type'];
  load_W: number;
  current_A: number;
  cable_id: string;
  fixtures: string[];        // outlet/light/switch ids
  route: Route;
}

export interface ElectricSystem {
  panels: Panel[];
  breakers: Breaker[];
  circuits: Circuit[];
  cables: Cable[];
  outlets: OutletSpec[];
  switches: SwitchSpec[];
  lights: LightSpec[];
  total_load_kW: number;
  total_cable_length_m: number;
  cb_main_size_A: number;
}

// ============================================================
// Plumbing system
// ============================================================

export interface WaterTank {
  id: string;
  kind: 'roof' | 'underground';
  position: Point;
  level: number;
  volume_m3: number;
}

export interface Pump {
  id: string;
  kind: 'transfer' | 'booster';
  position: Point;
  flow_lpm: number;
  head_m: number;
  power_kW: number;
}

export interface SepticTank {
  id: string;
  position: Point;
  volume_m3: number;
  chambers: 3;       // TCVN 4474:2012
}

export interface WaterHeater {
  id: string;
  position: Point;
  level: number;
  capacity_l: number;
  power_kW: number;
}

export interface Pipe {
  id: string;
  kind: 'cold' | 'hot' | 'drain' | 'vent';
  dn: number;           // DN mm: 15, 20, 25, 32, 50, 75, 100
  length_mm: number;
  slope_pct?: number;   // drains only
  from: Point;
  to: Point;
  serves?: string[];    // fixture ids
}

export interface PlumbingSystem {
  tanks: WaterTank[];
  pumps: Pump[];
  septic: SepticTank[];
  hot_water: WaterHeater[];
  cold_pipes: Pipe[];
  hot_pipes: Pipe[];
  drains: Pipe[];
  fixtures: FixtureSpec[];
  total_pipe_length_m: number;
  fixture_units: number;
  pump_power_kW: number;
}

// ============================================================
// Camera placement
// ============================================================

export interface CoverageCell {
  x: number;            // grid index
  y: number;
  world: Point;         // center in mm
  required: boolean;    // must be covered (entry/choke)
  priority: number;     // 1..3
}

export interface CameraPlacement {
  id: string;
  position: Point;      // x, y in mm; z height above floor
  yaw_deg: number;      // 0 = +X, CCW
  pitch_deg: number;    // downtilt (positive = down)
  fov_deg: number;
  range_mm: number;
  covered_cells: number;     // count
  covered_area_m2: number;
  zone: 'outdoor' | 'entryway' | 'corridor';
  model_hint?: string;
}

export interface CoverageMap {
  cell_size_mm: number;
  cols: number;
  rows: number;
  origin: Point;
  // 2D array of camera-counts per cell (0 = blind spot)
  cells: number[][];
  coverage_pct: number;
  blind_spots: Point[];
  required_pct: number;        // % of REQUIRED cells covered
}

export interface CameraOptions {
  fov_degrees?: number;
  max_range_mm?: number;
  prefer_corners?: boolean;
  avoid_zones?: RoomKind[];
  cell_size_mm?: number;
  min_overlap_at_entry?: number;
}

// ============================================================
// Combined MEP system
// ============================================================

export interface MEPSystem {
  electric: ElectricSystem;
  plumbing: PlumbingSystem;
  cameras: CameraPlacement[];
  coverage: CoverageMap;
}
