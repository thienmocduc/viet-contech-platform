# BOQ Engine - Viet-Contech AI Design Platform

Engine Python + Node bridge boc khoi luong DXF → BOQ Excel chuan TT06/2021/TT-BXD.

## Cau truc

```
boq/
├── python/
│   ├── extract.py          # DXF -> quantities JSON (ezdxf reader)
│   ├── price_db.py         # 50+ vat lieu Q1-2026 (HN/SG)
│   ├── boq_generator.py    # quantities + price -> BOQ
│   ├── excel_export.py     # BOQ -> .xlsx (openpyxl, rose-gold theme)
│   └── test_extract.py     # End-to-end test (gen DXF + run all)
├── node-bridge/
│   ├── index.ts            # spawn Python subprocess + zod validate
│   ├── types.ts            # zod schemas (Quantities, BOQReport, ...)
│   ├── api.ts              # Hono routes /api/boq/*
│   ├── package.json
│   └── tsconfig.json
├── samples/                # Sample DXF + JSON outputs
├── exports/                # Generated Excel files
├── requirements.txt        # Python deps
└── README.md
```

## Setup

### Yeu cau
- Python 3.11+ 
- Node.js 20+

### Cai dat

```bash
# 1) Python deps
cd platform/backend/boq
pip install -r requirements.txt

# 2) Node deps (neu chua cai)
cd node-bridge
npm install
```

## Chay test (Python end-to-end)

```bash
cd platform/backend/boq/python
python test_extract.py
```

Output:
- Tao 2 sample DXF: `samples/sample-house-3T.dxf`, `samples/sample-villa-280m2.dxf`
- Extract -> `samples/*.quantities.json`
- Generate BOQ -> `samples/*.boq.json`
- Export Excel -> `exports/*.boq.xlsx`

Expected:
- Villa 280m² 3T: ~260 items, ~9.18 ty VND
- Nha pho 3T 80m²: ~110 items, ~2.57 ty VND

## API (Hono routes)

Mount trong main server:
```ts
import { boqRouter } from './boq/node-bridge/api.js';
app.route('/api/boq', boqRouter);
```

### Endpoints

| Method | Path                | Body                                                     | Response                          |
|--------|---------------------|----------------------------------------------------------|-----------------------------------|
| POST   | `/api/boq/extract`  | `{ dxf_url, project_id }`                                | `{ ok, quantities }`              |
| POST   | `/api/boq/generate` | `{ quantities, project_meta, materials_override? }`      | `{ ok, boq }`                     |
| POST   | `/api/boq/export`   | `{ project_id, revision_id?, format: 'xlsx', boq }`      | `{ ok, url, path, size_bytes }`   |
| GET    | `/api/boq/health`   | -                                                        | `{ ok, service, ... }`            |

### Env vars

```bash
PYTHON_BIN=python                # binary Python (default 'python')
BOQ_TIMEOUT_MS=60000             # timeout subprocess (default 60s)
BOQ_TMP_DIR=./data/boq-tmp       # tmp dir cho DXF download
BOQ_EXPORT_DIR=./data/boq-exports # noi luu Excel exported
PUBLIC_BASE_URL=https://...      # base URL cho file download URL
```

## LAYER convention chuan

DXF must use these LAYER names (case-insensitive, dau gach noi `-` hoac `_`):

### Phan tho
- `TUONG-220`, `TUONG-100`, `WALL`, `WALL-220`
- `COT-200X300`, `COT-300X400`, `COT-400X400`, `COLUMN`
- `DAM-220X400`, `DAM-300X500`, `BEAM`
- `SAN-BTCT-150`, `SAN-BTCT-100`, `SLAB`, `FLOOR`
- `MONG-COC`, `FOUNDATION`

### Hoan thien
- `GACH-LAT-SAN`, `FLOOR_TILE`, `FLOOR-TILE`
- `GACH-OP-WC`, `WALL_TILE`, `WALL-TILE`
- `DA-CARRARA`, `MARBLE`
- `SAN-GO-TEAK`, `SAN-GO-WALNUT`, `WOOD-FLOOR`
- `SON-TUONG`, `SON-TUONG-PHK`, `SON-NGOAI-TROI`, `PAINT`
- `TRAN-THACH-CAO`, `CEILING`
- `KINH`, `GLASS`
- `CUA-DI`, `CUA-DI-GO`, `DOOR`
- `CUA-SO`, `WINDOW`
- `LAN-CAN`, `RAILING`
- `CHONG-THAM`
- `MAI-TON`, `MAI-NGOI`

### MEP
- `DEN-LED-TRAN`, `DEN-LED`, `LIGHT`, `DEN`, `DEN-CHUM`, `CHANDELIER`, `DEN-LED-DAY`
- `OCAM-220`, `OCAM`, `SOCKET`
- `CONG-TAC`, `SWITCH`
- `DIEU-HOA`, `AC`, `AC-12K`, `AC-18K`
- `BINH-NONG-LANH`, `WATER-HEATER`
- `ONG-NUOC`, `PIPE-WATER`, `ONG-THOAT`, `PIPE-DRAIN`
- `TU-DIEN`, `ELECTRICAL-PANEL`
- `DAY-DIEN`, `WIRE`, `DAY-DIEN-4.0`
- `ONG-DIEN`, `CONDUIT`

### Noi that
- `TU-BEP`, `KITCHEN`
- `TU-AO`, `WARDROBE`
- `BAN-AN`, `SOFA`, `GIUONG-MASTER`, `GIUONG-CON`
- `BON-CAU`, `TOILET`, `LAVABO`, `BASIN`, `VOI-SEN`, `SHOWER`, `BON-TAM`, `BATHTUB`
- `REM-CUA`, `CURTAIN`, `THAM`, `CARPET`

## Rule extract

- **WALL**: closed/open polyline → length × thickness × height. Default height = 3000mm. Layer `TUONG-220` → thickness 220mm.
- **COLUMN**: count CIRCLE / INSERT, kich thuoc tu LAYER name (`COT-300X400` → 300×400mm × 3.5m).
- **BEAM**: length polyline × cross-section (220×400 default).
- **SLAB**: closed polyline → area × thickness (LAYER `SAN-BTCT-150` → 150mm).
- **DOOR/WINDOW**: count + area approx (door 1.98m², window 1.68m²).
- **PAINT**: m² walls (×2 mat) + tran → /6 = lit (1L = 6m² 2 lop).
- **TILE/MARBLE/WOOD**: closed polyline area = m².
- **LIGHT/SOCKET/SWITCH/AC**: count CIRCLE/INSERT/POINT/closed-poly.

## Wastage rate (TT06/2021/TT-BXD)

- BTCT, thep: 3%
- Gach AAC: 5%
- Gach lat/op, san go: 5%
- Vua xay: 7%
- Son: 8%
- Da Carrara/marble: 8%
- Chong tham: 10%
- Day dien, ong nuoc: 7-10%

## Cong thuc tinh tong

```
Direct cost (A) = sum(item.qty × (1 + wastage) × unit_price)
QLP 5% (B)      = A × 0.05
Du phong 10% (C) = A × 0.10
VAT 8% (D)      = A × 0.08
TONG CONG       = A + B + C + D
```

## Materials catalog

50+ items, gia thi truong Q1-2026 (HN/SG retail), bao gom:
- Phan tho: BTCT B25/B30, thep CB400/CB300, gach AAC, vua, xi mang, cat, da, mong coc.
- Hoan thien: gach Dong Tam, Viglacera, da Carrara, Vicostone, san go Tarkett/Kahrs, son Dulux, tran Vinh Tuong/Barrisol, kinh, cua nhom Xingfa, cua go An Cuong/HF, lan can inox, chong tham Sika, mai ton/ngoi.
- Noi that: tu bep An Cuong, tu ao build-in, ban an go xoan dao, sofa Italy, giuong Lien A, bon cau/lavabo INAX, voi TOTO, bon tam Toto Neorest, rem, tham Savonnerie.
- MEP: den LED Philips, den chum, ocam/cong tac Schneider, day Cadivi, ong PVC SP, dieu hoa Daikin Inverter, binh nong lanh Ariston, ong nuoc Tien Phong, tu dien.

## Roadmap

- [ ] PDF export (reportlab)
- [ ] Auto-detect floor levels tu Z-coord (3D DXF)
- [ ] Material price scraper (Hoa Phat, Cadivi, Dulux web)
- [ ] BIM IFC import (ifcopenshell)
- [ ] Compare 2 BOQ revisions (diff view)
