/**
 * Auto routing for plumbing system (cấp + thoát + nóng).
 *
 * Standards:
 *   - TCVN 4474:2012 (drainage), TCVN 4513:1988 (supply), QCVN 02:2009 (water quality).
 *   - Hunter's Method for fixture units → DN sizing.
 *   - Septic tank: 3 chambers, V = 1.5 m³ per 4 occupants (registry rule).
 *   - Drainage slope ≥ 1.5%.
 *   - Roof tank: V = N × 250 L × 1.5 / 1000  (m³).
 */

import { bboxOf, polygonCentroid, euclidean } from '../algorithms/graph.js';
import type {
  FixtureSpec,
  LayoutJSON,
  Pipe,
  PlumbingSystem,
  Point,
  Pump,
  SepticTank,
  WaterHeater,
  WaterTank,
} from '../types.js';

// ============================================================
// Hunter fixture units (FU) — TCVN 4513
// ============================================================

const FU_TABLE: Record<FixtureSpec['type'], { fu: number; dn_branch: number; flow_lpm: number }> = {
  wc:               { fu: 6, dn_branch: 25, flow_lpm: 6 },
  lavabo:           { fu: 2, dn_branch: 15, flow_lpm: 4 },
  shower:           { fu: 3, dn_branch: 20, flow_lpm: 8 },
  sink:             { fu: 2, dn_branch: 20, flow_lpm: 6 },
  washing_machine:  { fu: 4, dn_branch: 20, flow_lpm: 10 },
  dishwasher:       { fu: 2, dn_branch: 20, flow_lpm: 8 },
};

// FU → main DN (TCVN 4513 simplified table).
function fuToMainDN(fu: number): number {
  if (fu <= 6) return 20;
  if (fu <= 14) return 25;
  if (fu <= 28) return 32;
  if (fu <= 50) return 40;
  if (fu <= 100) return 50;
  return 65;
}

// Drain DN by attached FU (TCVN 4474).
function fuToDrainDN(fu: number): number {
  if (fu <= 4) return 50;
  if (fu <= 12) return 75;
  if (fu <= 24) return 100;
  return 110;
}

// ============================================================
// Public entry point
// ============================================================

export function routePlumbing(layout: LayoutJSON): PlumbingSystem {
  // Auto-place fixtures if none provided based on bathroom + kitchen rooms.
  const fixtures: FixtureSpec[] = layout.fixtures?.length
    ? [...layout.fixtures]
    : autoPlaceFixtures(layout);

  // 1) Roof tank sizing.
  const occupants = layout.occupants > 0 ? layout.occupants : 4;
  const totalDailyL = occupants * 250 * 1.5; // 250 L/person/day, 1.5 reserve
  const roofTankVol_m3 = Math.max(1, Math.ceil((totalDailyL * 0.5) / 1000)); // 50% on roof
  const undergroundVol_m3 = Math.max(1, Math.ceil((totalDailyL * 0.5) / 1000));

  const allPts = layout.rooms.flatMap(r => r.polygon);
  const bb = bboxOf(allPts);

  const roofPos: Point =
    layout.water_tank_roof ?? { x: (bb.min_x + bb.max_x) / 2, y: bb.min_y + 1500, z: layout.levels * 3200 };
  const groundPos: Point = { x: bb.min_x + 800, y: bb.max_y + 800, z: -1500 };

  const tanks: WaterTank[] = [
    { id: 'TANK-ROOF', kind: 'roof', position: roofPos, level: layout.levels - 1, volume_m3: roofTankVol_m3 },
    { id: 'TANK-UND', kind: 'underground', position: groundPos, level: -1, volume_m3: undergroundVol_m3 },
  ];

  // 2) Pump sizing: P = ρgQH/η. Q sized for 30-min fill of roof tank.
  const Q_m3s = (roofTankVol_m3 / (30 * 60));
  const totalHeight_m = (layout.levels * 3.2) + 2;     // floor heights + 2m freeboard
  const headLoss_m = totalHeight_m * 0.3;              // simplified friction
  const H = totalHeight_m + headLoss_m + 5;            // residual at fixture
  const P_kW = Math.round(((1000 * 9.81 * Q_m3s * H) / 0.6 / 1000) * 100) / 100;
  const pumps: Pump[] = [
    {
      id: 'PUMP-T1',
      kind: 'transfer',
      position: { x: groundPos.x, y: groundPos.y - 500 },
      flow_lpm: Math.round(Q_m3s * 60 * 1000),
      head_m: Math.round(H),
      power_kW: Math.max(0.37, P_kW),
    },
  ];
  // Booster if pressure at top floor < 1.5 bar (rule of thumb).
  if (totalHeight_m > 9) {
    pumps.push({
      id: 'PUMP-B1',
      kind: 'booster',
      position: roofPos,
      flow_lpm: 60,
      head_m: 15,
      power_kW: 0.55,
    });
  }

  // 3) Septic tank: 1.5 m³ per 4 occupants, ≥3 m³.
  const septicVol = Math.max(3, Math.ceil((occupants / 4) * 1.5));
  const septic: SepticTank[] = [
    {
      id: 'SEPTIC-1',
      position: layout.septic_tank ?? { x: bb.max_x + 1500, y: bb.max_y + 1500, z: -2500 },
      volume_m3: septicVol,
      chambers: 3,
    },
  ];

  // 4) Hot water heater per bathroom group.
  const wcRooms = layout.rooms.filter(r => r.kind === 'bathroom');
  const hot_water: WaterHeater[] = wcRooms.map((r, i) => ({
    id: `WH-${i + 1}`,
    position: polygonCentroid(r.polygon),
    level: r.level,
    capacity_l: 30,
    power_kW: 2.5,
  }));

  // 5) Pipes: cold from roof tank → fixtures, hot from heater → fixture, drain → vertical stack → septic.
  const cold_pipes: Pipe[] = [];
  const hot_pipes: Pipe[] = [];
  const drains: Pipe[] = [];

  // Vertical riser from underground → roof tank (cold supply).
  cold_pipes.push({
    id: 'PIPE-COLD-RISER',
    kind: 'cold',
    dn: 32,
    length_mm: Math.round(euclidean(groundPos, roofPos) + Math.abs((roofPos.z ?? 0) - (groundPos.z ?? 0))),
    from: groundPos,
    to: roofPos,
  });

  let totalFU = 0;
  for (const f of fixtures) {
    const meta = FU_TABLE[f.type];
    if (!meta) continue;
    totalFU += meta.fu;

    // Cold pipe: from nearest cold trunk (roof tank vertical drop into the room) → fixture.
    const trunkDrop: Point = { x: f.position.x, y: f.position.y - 500 };
    cold_pipes.push({
      id: `PIPE-COLD-${f.id}`,
      kind: 'cold',
      dn: meta.dn_branch,
      length_mm: Math.round(euclidean(trunkDrop, f.position) + 800),
      from: trunkDrop,
      to: f.position,
      serves: [f.id],
    });

    // Hot pipe (lavabo, shower, sink only).
    if (f.type === 'lavabo' || f.type === 'shower' || f.type === 'sink') {
      const wh = hot_water[0];
      if (wh) {
        hot_pipes.push({
          id: `PIPE-HOT-${f.id}`,
          kind: 'hot',
          dn: meta.dn_branch,
          length_mm: Math.round(euclidean(wh.position, f.position)),
          from: wh.position,
          to: f.position,
          serves: [f.id],
        });
      }
    }

    // Drain → vertical stack at bbox corner → septic.
    const stack: Point = { x: bb.max_x - 600, y: bb.max_y - 600 };
    const drainLen = euclidean(f.position, stack);
    drains.push({
      id: `DRAIN-${f.id}`,
      kind: 'drain',
      dn: fuToDrainDN(meta.fu),
      length_mm: Math.round(drainLen),
      slope_pct: 1.5,
      from: f.position,
      to: stack,
      serves: [f.id],
    });
  }

  // Vertical drain stack → septic.
  const stack: Point = { x: bb.max_x - 600, y: bb.max_y - 600 };
  drains.push({
    id: 'DRAIN-STACK',
    kind: 'drain',
    dn: fuToDrainDN(totalFU),
    length_mm: Math.round(euclidean(stack, septic[0]!.position)),
    slope_pct: 2.0,
    from: stack,
    to: septic[0]!.position,
  });

  // Main cold trunk DN sized off totalFU.
  const mainDN = fuToMainDN(totalFU);
  if (cold_pipes[0]) {
    cold_pipes[0].dn = Math.max(cold_pipes[0].dn, mainDN);
  }

  const total_pipe_length_m =
    (cold_pipes.reduce((s, p) => s + p.length_mm, 0) +
      hot_pipes.reduce((s, p) => s + p.length_mm, 0) +
      drains.reduce((s, p) => s + p.length_mm, 0)) / 1000;

  return {
    tanks,
    pumps,
    septic,
    hot_water,
    cold_pipes,
    hot_pipes,
    drains,
    fixtures,
    total_pipe_length_m: Math.round(total_pipe_length_m * 10) / 10,
    fixture_units: totalFU,
    pump_power_kW: pumps.reduce((s, p) => s + p.power_kW, 0),
  };
}

// ============================================================
// Auto-place fixtures: WC + lavabo + shower per bathroom; sink in kitchen
// ============================================================

function autoPlaceFixtures(layout: LayoutJSON): FixtureSpec[] {
  const out: FixtureSpec[] = [];
  let i = 0;
  for (const room of layout.rooms) {
    if (room.kind === 'bathroom') {
      const c = polygonCentroid(room.polygon);
      const bb = bboxOf(room.polygon);
      out.push({ id: `FX-${++i}`, room_id: room.id, position: { x: bb.min_x + 700, y: bb.min_y + 700 }, type: 'wc' });
      out.push({ id: `FX-${++i}`, room_id: room.id, position: { x: bb.min_x + 700, y: c.y }, type: 'lavabo' });
      out.push({ id: `FX-${++i}`, room_id: room.id, position: { x: bb.max_x - 700, y: bb.max_y - 700 }, type: 'shower' });
    } else if (room.kind === 'kitchen') {
      const bb = bboxOf(room.polygon);
      out.push({ id: `FX-${++i}`, room_id: room.id, position: { x: bb.min_x + 800, y: bb.min_y + 800 }, type: 'sink' });
      out.push({ id: `FX-${++i}`, room_id: room.id, position: { x: bb.min_x + 800, y: bb.max_y - 800 }, type: 'dishwasher' });
    } else if (room.kind === 'utility') {
      const c = polygonCentroid(room.polygon);
      out.push({ id: `FX-${++i}`, room_id: room.id, position: c, type: 'washing_machine' });
    }
  }
  return out;
}
