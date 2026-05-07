# BIM 3D Generator + Clash Detection — Viet-Contech

Module thuc thi cua agent **`bim_modeler`** trong pipeline 7-phase.
Phase B8: chuyen tu cac DXF (kien truc + ket cau + MEP) thanh model 3D
IFC 4 (ISO 16739-1:2018), sau do detect clash 3-layer va auto-fix.

## Cau truc thu muc

```
bim/
├── python/
│   ├── ifc_generator.py    # API class BIMGenerator — sinh element IFC 4
│   ├── from_dxf.py         # DXF mat bang -> IFC 3D (extrude theo level)
│   ├── clash_detection.py  # 3-layer: hard / soft / workflow
│   ├── auto_resolve.py     # Auto-fix workflow + soft, escalate hard
│   └── test_bim.py         # E2E test (>=40 elements, >=1 clash)
├── node-bridge/
│   ├── api.ts              # Hono routes (/api/bim/*)
│   └── viewer.tsx          # React component (xeokit/three.js placeholder)
├── requirements.txt        # Python deps (ifcopenshell + ezdxf optional)
└── README.md               # File nay
```

## Cai dat

```bash
# Backend Python (optional, co fallback)
cd platform/backend/bim
pip install -r requirements.txt

# Backend Node (DB layer)
cd platform/backend
npm install
```

## Chay test E2E

```bash
cd platform/backend/bim/python
python test_bim.py
```

Expect output:

```
[1] Build sample IFC -> count=53 summary={...}
  PASS: Expected >=40 elements
[2] Test from_dxf.py -> count=40
  PASS
[3] Run clash detection -> total>=1
  PASS
[4] Auto-resolve -> fixed/escalated
  PASS
ALL TESTS PASSED
```

## LAYER convention (DXF input)

`from_dxf.py` doc DXF theo cac layer chuan AIA:

| Layer name (any case) | IFC class       | Ghi chu                            |
|-----------------------|-----------------|------------------------------------|
| `WALL`, `A_WALL_*`    | IfcWall         | Extrude theo `level_height_mm`     |
| `COLUMN`, `S_COLUMN`  | IfcColumn       | Tiet dien tu props w/d, default 250|
| `SLAB`, `S_SLAB`      | IfcSlab         | Polygon -> sinh san moi level + mai|
| `DOOR`, `A_DOOR`      | IfcDoor         | Tu dong gan vao wall gan nhat      |
| `WINDOW`, `A_WINDOW`  | IfcWindow       | sill_mm tu props (default 900)     |
| `STAIR`, `A_STAIR`    | IfcStair        | Validate TCVN 4451 (h, b, 2h+b)    |
| `MEP-WATER`, `M_WATER`| IfcPipeSegment  | system="water", install before pour|
| `MEP-HVAC`, `M_HVAC`  | IfcPipeSegment  | system="hvac", treo tran           |

DXF JSON fallback (khi `ezdxf` chua cai):

```json
{
  "layers": {
    "WALL": [{"type":"LINE","points":[[0,0],[4000,0]]}],
    "COLUMN": [{"type":"INSERT","points":[[0,0]],"props":{"w":250,"d":250}}]
  }
}
```

## API HTTP

### `POST /api/bim/generate`

```json
// Request
{
  "project_id": "P-...",
  "revision_id": "R-...",
  "dxf_layout": "/abs/path/A-01.dxf",
  "options": { "level_height_mm": 3300, "num_levels": 3 }
}
// Response
{
  "ok": true,
  "ifc_url": "/abs/path/out.ifc.json",
  "element_count": 53,
  "summary": { "wall": 15, "column": 18, ... },
  "inserted_db": 53
}
```

### `POST /api/bim/clash`

```json
// Request
{ "project_id": "P-...", "revision_id": "R-...", "ifc_url": "..." }
// Response
{
  "ok": true,
  "total": 9,
  "by_kind": { "hard": 7, "soft": 0, "workflow": 2 },
  "clashes": [...],
  "inserted_db": 9
}
```

### `POST /api/bim/resolve`

```json
{ "project_id":"P-...", "revision_id":"R-...", "ifc_url":"...", "clash_id":"CL-..." }
// Optional clash_id; bo qua = resolve all open clashes cua revision
```

### `GET /api/bim/elements?project_id=P-1&type=wall&revision_id=R-1`

Tra list `bim_elements` row tu DB, filter theo `type` (wall/column/...).

## Sample output

### Sample IFC element JSON (1 wall)

```json
{
  "guid": "e8c3a7f1-4b29-4d51-8a0e-12c9f3b6ce42",
  "type": "wall",
  "ifc_class": "IfcWallStandardCase",
  "name": "WALL-e8c3a7f1",
  "material": "brick_220",
  "geometry": {
    "x_mm": 0, "y_mm": 0, "z_mm": 0,
    "length_mm": 12000, "height_mm": 3300,
    "thickness_mm": 200, "rotation_deg": 0
  },
  "properties": { "load_bearing": false, "volume_mm3": 7920000000 }
}
```

### Sample clash report (1 hard clash)

```json
{
  "id": "C-3a7d9f2c81",
  "element_a_guid": "...col-grid-1...",
  "element_b_guid": "...pipe-water-...",
  "element_a_type": "column",
  "element_b_type": "other",
  "kind": "hard",
  "intersection_volume_mm3": 1210000,
  "min_distance_mm": 0,
  "severity": "critical",
  "color": "#dc2626",
  "suggestion": "Cot va ong MEP — di doi ong sang truc khac",
  "auto_fixable": false
}
```

## 3-layer Clash logic

| Layer    | Detect            | Severity           | Color   | Auto-fix |
|----------|-------------------|--------------------|---------|----------|
| Hard     | overlap > 1mm³    | critical/high      | #dc2626 | No (escalate KTS) |
| Soft     | gap < threshold   | medium/low         | #f97316 | Yes (shift 50mm)  |
| Workflow | sequence vi pham  | low                | #eab308 | Yes (re-order)    |

Clearance mac dinh (chinh sua qua `soft_clearance_overrides`):

```python
{
  "column-wall": 100,    # mm
  "column-column": 1500,
  "wall-wall": 50,
  "pipe-column": 50,
  "pipe-beam": 30,
  "stair-wall": 100,
}
```

## Design intent skips

Clash detection bo qua cac truong hop sau (la design intent, khong phai loi):

- Parent-child: cua/cua so trong tuong cha
- Cot xuyen san (column tu nen len mai)
- Tuong dat tren san (chan tuong cham slab)
- Dam noi vao cot/tuong (dau dam ngam vao)
- Cau thang dat tren san
- Cot dat trong tuong (vung embed)
- 2 tuong vuong goc tai goc nha (corner overlap)

## Tich hop voi pipeline

`bim_modeler` agent run sau phase B7-mep, truoc B9-boq:

1. CTO Mission Planner goi `/api/bim/generate` voi DXF list tu A-01..A-08
2. Insert vao `bim_elements` theo `revision_id`
3. Chay `/api/bim/clash` -> insert vao `clash_detections`
4. Neu co clash critical -> `qc_gates.G06` fail -> CTO escalate KTS
5. Neu auto-fixable -> chay `/api/bim/resolve` -> update status

## Limitations

- Khi `ifcopenshell` chua cai: export `.ifc.json` (cung schema, viewer code 1 lan)
- AABB collision detection co the over-detect voi wall xoay khong vuong goc
  (45deg) — khi can chinh xac, swap qua OBB-SAT (Separating Axis Theorem)
- Khong tu sinh hose duong cong (MEP quanh co) — chi line segment
- Khong tinh thermal/acoustic clash — chi geometry
