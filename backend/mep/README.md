# MEP Smart Routing — Viet-Contech AI Design Platform

Module dieu phoi tu dong he thong **Dien · Nuoc · Camera** tu `LayoutJSON` xuat boi BIM/Architecture agent.

## Cau truc thu muc

```
mep/
  src/
    types.ts                  # toan bo type chung
    api.ts                    # Hono routes + pure handlers
    algorithms/
      graph.ts                # MinHeap, Manhattan, Douglas-Peucker, polygon utils
    routing/
      dijkstra.ts             # Dijkstra + A* tren grid 100mm
      electric.ts             # routeElectric()
      plumbing.ts             # routePlumbing()  (Hunter Method, TCVN 4474/4513)
      camera.ts               # placeCameras()  (Greedy Set Cover + raycast FOV)
      coverage.ts             # computeCoverage() — 2D heatmap, blind spot
  tests/
    sample-layout.json        # nha 3T 80m², 4 PN, 1 PHK, 1 bep, 3 WC, garage
    test-routing.ts           # E2E test, kiem tra all assertions
```

## Algorithm

### 1. Dijkstra (electric)
- Build grid 100mm × 100mm tu polygon room.
- Cell `passable` neu nam trong room polygon.
- Flag `near_wall` = discount 0.7 (cap di trong tuong dep hon).
- Flag `door_zone` = penalty +5000mm (tranh cat qua khu vuc cua mo).
- Turn penalty = 30 × min_corner_radius / 200 mm de minh hoa "khong zigzag".
- Complexity: **O((V + E) log V)** voi V = cells, E = 4V.

### 2. Hunter Method (plumbing)
- Moi fixture co Fixture Unit (FU): WC=6, lavabo=2, shower=3, sink=2.
- Tong FU → tra bang DN (TCVN 4513:1988).
- Drain DN by FU (TCVN 4474:2012).
- Slope drain ≥ 1.5%.
- Be nuoc mai V = N × 250 L × 1.5 / 1000.
- Be tu hoai 3 ngan, V = max(3, N/4 × 1.5) m³.
- Bom: P_kW = ρgQH / η_pump (η = 0.6).

### 3. Greedy Set Cover (camera)
- Grid 500mm cells de "phu" — chi tinh outdoor + entryway + corridor.
- Candidate positions = goc phong (inset 250mm) + canh cua chinh.
- Voi moi candidate: raycast FOV polygon (112°, 8m) chan boi tuong noi that.
- Greedy: chon candidate phu nhieu cell **chua phu** nhat → cap nhat → lap.
- Dam bao overlap ≥2 tai cua chinh (priority 3 cells).
- **Privacy**: KHONG dat camera trong `bedroom` / `bathroom` / `altar`.

### Performance
- Layout 200m², level=0: routing < **2 giay** (Node 20).
- Da test voi sample 80m² × 3 tang: ~**1 giay**.

## Quy uoc LAYER (DXF output)

| Layer        | Noi dung                              |
|--------------|---------------------------------------|
| ENG-E-CABLE  | tuyen cap (polyline)                  |
| ENG-E-OUTLET | o cam + GFCI                          |
| ENG-E-LIGHT  | bong / downlight / pendant            |
| ENG-E-SW     | cong tac                              |
| ENG-E-PANEL  | tu dien                               |
| ENG-P-COLD   | ong cap nuoc lanh                     |
| ENG-P-HOT    | ong cap nuoc nong                     |
| ENG-P-DRAIN  | ong thoat                             |
| ENG-P-TANK   | be nuoc + be tu hoai                  |
| ENG-CAM      | camera (block) + FOV polygon          |
| ENG-CAM-CVR  | coverage heatmap (hatch)              |

## API

```ts
import { mepHandlers } from './src/api';

// Pure handlers (use anywhere):
const e = mepHandlers.electric(layout);
const p = mepHandlers.plumbing(layout);
const c = mepHandlers.camera(layout, { fov_degrees: 112, max_range_mm: 8000 });
const all = mepHandlers.all(layout);

// Hono router:
import { Hono } from 'hono';
import { registerMepRoutes } from './src/api';
const app = new Hono();
registerMepRoutes(app);
//   POST /api/mep/electric
//   POST /api/mep/plumbing
//   POST /api/mep/camera
//   POST /api/mep/all
```

## Test

```bash
cd platform/backend/mep
npm install
npm test    # → tsx tests/test-routing.ts
```

Expected output: `PASS: 14   FAIL: 0`.
