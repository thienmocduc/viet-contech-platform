"""
test_extract.py - Test BOQ Engine end-to-end
==============================================
- Tu sinh 2 sample DXF (nha 3T 80m² + biet thu 280m²) bang ezdxf
- Run extract_quantities -> in JSON
- Run generate_boq -> in summary
- Run export_boq_to_excel -> .xlsx
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import ezdxf
from ezdxf.enums import TextEntityAlignment

# Local imports
sys.path.insert(0, str(Path(__file__).parent))
from extract import extract_quantities  # noqa: E402
from boq_generator import generate_boq  # noqa: E402
from excel_export import export_boq_to_excel  # noqa: E402


SAMPLES_DIR = Path(__file__).parent.parent / "samples"
EXPORTS_DIR = Path(__file__).parent.parent / "exports"
SAMPLES_DIR.mkdir(exist_ok=True, parents=True)
EXPORTS_DIR.mkdir(exist_ok=True, parents=True)


# ============================================================
# DXF GENERATORS
# ============================================================
def setup_layers(doc):
    """Setup chuan layer cho project."""
    layers_def = [
        ("TUONG-220", 1),
        ("TUONG-100", 2),
        ("COT-200X300", 3),
        ("COT-300X400", 3),
        ("DAM-220X400", 4),
        ("SAN-BTCT-150", 5),
        ("CUA-DI", 6),
        ("CUA-SO", 7),
        ("KINH", 8),
        ("GACH-LAT-SAN", 9),
        ("GACH-OP-WC", 10),
        ("DA-CARRARA", 11),
        ("SAN-GO-TEAK", 12),
        ("SON-TUONG", 13),
        ("TRAN-THACH-CAO", 14),
        ("DEN-LED-TRAN", 15),
        ("OCAM-220", 16),
        ("CONG-TAC", 17),
        ("DIEU-HOA", 18),
        ("LAN-CAN", 19),
        ("MONG-COC", 20),
        ("MAI-NGOI", 21),
        ("CHONG-THAM", 22),
        ("AXIS", 250),
        ("TEXT", 251),
    ]
    for name, color in layers_def:
        if name not in doc.layers:
            doc.layers.add(name=name, color=color)


def gen_house_3t_80m2(path: Path) -> Path:
    """Sinh DXF nha 3 tang 80m² san — kich thuoc 8x10m."""
    doc = ezdxf.new(dxfversion="R2018", setup=True)
    doc.header["$INSUNITS"] = 4  # mm
    setup_layers(doc)
    msp = doc.modelspace()

    # Don vi mm. Nha 8000x10000mm, 3 tang -> 80m²/tang * 3 = 240m²
    W = 8000
    D = 10000
    floors = 3
    floor_h = 3500  # mm

    for floor in range(floors):
        offset_y = floor * (D + 2000)  # space cac tang ra cho de doc

        # ----- Tuong bao 220 (LWPOLYLINE kin) -----
        msp.add_lwpolyline(
            [(0, offset_y), (W, offset_y), (W, offset_y + D), (0, offset_y + D), (0, offset_y)],
            dxfattribs={"layer": "TUONG-220", "closed": True},
        )

        # ----- Tuong ngan trong 100 -----
        # Vach phong khach - bep
        msp.add_line(
            (3500, offset_y), (3500, offset_y + 4000),
            dxfattribs={"layer": "TUONG-100"},
        )
        # Vach phong ngu 1 - 2
        msp.add_line(
            (0, offset_y + 5500), (W, offset_y + 5500),
            dxfattribs={"layer": "TUONG-100"},
        )
        # Vach WC
        msp.add_line(
            (5500, offset_y + 5500), (5500, offset_y + 8000),
            dxfattribs={"layer": "TUONG-100"},
        )
        msp.add_line(
            (5500, offset_y + 8000), (W, offset_y + 8000),
            dxfattribs={"layer": "TUONG-100"},
        )

        # ----- 4 cot goc 200x300 + 2 cot giua -----
        for cx, cy in [
            (0, 0), (W, 0), (0, D), (W, D),
            (W / 2, 0), (W / 2, D),
        ]:
            msp.add_circle(
                (cx, offset_y + cy), 150,
                dxfattribs={"layer": "COT-200X300"},
            )

        # ----- Dam 220x400 chu vi + giua -----
        msp.add_lwpolyline(
            [(0, offset_y), (W, offset_y), (W, offset_y + D), (0, offset_y + D), (0, offset_y)],
            dxfattribs={"layer": "DAM-220X400", "closed": True},
        )
        msp.add_line(
            (0, offset_y + D / 2), (W, offset_y + D / 2),
            dxfattribs={"layer": "DAM-220X400"},
        )

        # ----- San BTCT 150 -----
        msp.add_lwpolyline(
            [(0, offset_y), (W, offset_y), (W, offset_y + D), (0, offset_y + D), (0, offset_y)],
            dxfattribs={"layer": "SAN-BTCT-150", "closed": True},
        )

        # ----- Cua di (4 cua) -----
        for cx, cy in [(2000, 0), (5000, 5500), (5500, 5500), (3000, 8000)]:
            msp.add_lwpolyline(
                [
                    (cx, offset_y + cy),
                    (cx + 900, offset_y + cy),
                    (cx + 900, offset_y + cy + 100),
                    (cx, offset_y + cy + 100),
                    (cx, offset_y + cy),
                ],
                dxfattribs={"layer": "CUA-DI", "closed": True},
            )

        # ----- Cua so (5 cua) -----
        for cx, cy in [
            (1000, 0), (6000, 0),
            (1000, D), (4500, D), (7000, D),
        ]:
            msp.add_lwpolyline(
                [
                    (cx, offset_y + cy),
                    (cx + 1200, offset_y + cy),
                    (cx + 1200, offset_y + cy + 100),
                    (cx, offset_y + cy + 100),
                    (cx, offset_y + cy),
                ],
                dxfattribs={"layer": "CUA-SO", "closed": True},
            )

        # ----- Gach lat san (60% area) -----
        msp.add_lwpolyline(
            [
                (200, offset_y + 200), (W - 200, offset_y + 200),
                (W - 200, offset_y + 5300), (200, offset_y + 5300),
                (200, offset_y + 200),
            ],
            dxfattribs={"layer": "GACH-LAT-SAN", "closed": True},
        )

        # ----- WC: gach op tuong + lat -----
        msp.add_lwpolyline(
            [
                (5500, offset_y + 5500), (W, offset_y + 5500),
                (W, offset_y + 8000), (5500, offset_y + 8000),
                (5500, offset_y + 5500),
            ],
            dxfattribs={"layer": "GACH-OP-WC", "closed": True},
        )

        # ----- Son tuong (toan bo san) -----
        msp.add_lwpolyline(
            [(0, offset_y), (W, offset_y), (W, offset_y + D), (0, offset_y + D), (0, offset_y)],
            dxfattribs={"layer": "SON-TUONG", "closed": True},
        )

        # ----- Tran thach cao -----
        msp.add_lwpolyline(
            [(200, offset_y + 200), (W - 200, offset_y + 200),
             (W - 200, offset_y + D - 200), (200, offset_y + D - 200),
             (200, offset_y + 200)],
            dxfattribs={"layer": "TRAN-THACH-CAO", "closed": True},
        )

        # ----- Den LED tran (8 cai/tang) -----
        for px in [1500, 3500, 5500, 7000]:
            for py in [2000, 7000]:
                msp.add_circle(
                    (px, offset_y + py), 80,
                    dxfattribs={"layer": "DEN-LED-TRAN"},
                )

        # ----- O cam 220 (6 cai/tang) -----
        for px, py in [(500, 1000), (W - 500, 1000),
                       (500, 4000), (W - 500, 4000),
                       (500, 7000), (W - 500, 7000)]:
            msp.add_circle(
                (px, offset_y + py), 50,
                dxfattribs={"layer": "OCAM-220"},
            )

        # ----- Cong tac (3 cai/tang) -----
        for px, py in [(2000, 100), (5000, 100), (4000, 5400)]:
            msp.add_circle(
                (px, offset_y + py), 50,
                dxfattribs={"layer": "CONG-TAC"},
            )

        # ----- Dieu hoa (3 may/tang) -----
        for px, py in [(2000, D - 200), (6000, D - 200), (4000, 5300)]:
            msp.add_lwpolyline(
                [(px, offset_y + py), (px + 800, offset_y + py),
                 (px + 800, offset_y + py + 200), (px, offset_y + py + 200),
                 (px, offset_y + py)],
                dxfattribs={"layer": "DIEU-HOA", "closed": True},
            )

        # ----- Lan can (cau thang/ban cong, 1 doan) -----
        msp.add_line(
            (W - 100, offset_y), (W - 100, offset_y + 3000),
            dxfattribs={"layer": "LAN-CAN"},
        )

        # ----- Floor label -----
        txt = msp.add_text(
            f"+{floor*3.5:.3f} TANG {floor+1}",
            dxfattribs={"layer": "TEXT", "height": 200},
        )
        txt.set_placement((W / 2, offset_y - 500))

    # Mong coc tang 1
    for cx, cy in [(0, 0), (W, 0), (0, D), (W, D),
                   (W / 2, 0), (W / 2, D)]:
        msp.add_line(
            (cx, cy - 200), (cx, cy - 12200),
            dxfattribs={"layer": "MONG-COC"},
        )

    # Mai ngoi
    msp.add_lwpolyline(
        [(0, floors * (D + 2000) + 500),
         (W, floors * (D + 2000) + 500),
         (W, floors * (D + 2000) + 500 + D),
         (0, floors * (D + 2000) + 500 + D),
         (0, floors * (D + 2000) + 500)],
        dxfattribs={"layer": "MAI-NGOI", "closed": True},
    )

    # Set extents
    doc.header["$EXTMIN"] = (-500, -13000, 0)
    doc.header["$EXTMAX"] = (W + 500, floors * (D + 2000) + 500 + D, 0)

    doc.saveas(str(path))
    return path


def gen_villa_280m2(path: Path) -> Path:
    """Biet thu 280m² san * 3 tang = 840m². 14x20m."""
    doc = ezdxf.new(dxfversion="R2018", setup=True)
    doc.header["$INSUNITS"] = 4
    setup_layers(doc)
    msp = doc.modelspace()

    W = 14000
    D = 20000
    floors = 3

    for floor in range(floors):
        offset_y = floor * (D + 3000)

        # Tuong bao
        msp.add_lwpolyline(
            [(0, offset_y), (W, offset_y), (W, offset_y + D), (0, offset_y + D), (0, offset_y)],
            dxfattribs={"layer": "TUONG-220", "closed": True},
        )

        # Vach ngan 100mm (cac phong)
        # Phong khach - bep
        msp.add_line((6000, offset_y), (6000, offset_y + 7000), dxfattribs={"layer": "TUONG-100"})
        # 3 phong ngu
        msp.add_line((0, offset_y + 10000), (W, offset_y + 10000), dxfattribs={"layer": "TUONG-100"})
        msp.add_line((4500, offset_y + 10000), (4500, offset_y + 16000), dxfattribs={"layer": "TUONG-100"})
        msp.add_line((9500, offset_y + 10000), (9500, offset_y + 16000), dxfattribs={"layer": "TUONG-100"})
        msp.add_line((0, offset_y + 16000), (W, offset_y + 16000), dxfattribs={"layer": "TUONG-100"})
        # WC trong tung phong
        msp.add_line((3000, offset_y + 14000), (4500, offset_y + 14000), dxfattribs={"layer": "TUONG-100"})
        msp.add_line((3000, offset_y + 14000), (3000, offset_y + 16000), dxfattribs={"layer": "TUONG-100"})
        msp.add_line((6000, offset_y + 14000), (9500, offset_y + 14000), dxfattribs={"layer": "TUONG-100"})
        msp.add_line((6000, offset_y + 14000), (6000, offset_y + 16000), dxfattribs={"layer": "TUONG-100"})

        # Cot 300x400 (10 cot)
        for cx, cy in [
            (0, 0), (W, 0), (0, D), (W, D),
            (W / 3, 0), (2 * W / 3, 0),
            (W / 3, D), (2 * W / 3, D),
            (0, D / 2), (W, D / 2),
        ]:
            msp.add_circle(
                (cx, offset_y + cy), 200,
                dxfattribs={"layer": "COT-300X400"},
            )

        # Dam chu vi + dam giua
        msp.add_lwpolyline(
            [(0, offset_y), (W, offset_y), (W, offset_y + D), (0, offset_y + D), (0, offset_y)],
            dxfattribs={"layer": "DAM-220X400", "closed": True},
        )
        msp.add_line((0, offset_y + D / 2), (W, offset_y + D / 2), dxfattribs={"layer": "DAM-220X400"})
        msp.add_line((W / 2, offset_y), (W / 2, offset_y + D), dxfattribs={"layer": "DAM-220X400"})

        # San BTCT 150
        msp.add_lwpolyline(
            [(0, offset_y), (W, offset_y), (W, offset_y + D), (0, offset_y + D), (0, offset_y)],
            dxfattribs={"layer": "SAN-BTCT-150", "closed": True},
        )

        # Cua di (8 cua)
        door_positions = [
            (3000, 0), (5000, 7000), (5800, 7000),
            (4000, 10000), (8000, 10000), (12000, 10000),
            (3000, 16000), (8000, 16000),
        ]
        for cx, cy in door_positions:
            msp.add_lwpolyline(
                [(cx, offset_y + cy), (cx + 900, offset_y + cy),
                 (cx + 900, offset_y + cy + 100), (cx, offset_y + cy + 100),
                 (cx, offset_y + cy)],
                dxfattribs={"layer": "CUA-DI", "closed": True},
            )

        # Cua so (12 cua)
        win_positions = [
            (1500, 0), (10000, 0),
            (0, 3000), (0, 13000), (0, 18000),
            (W, 3000), (W, 13000), (W, 18000),
            (2000, D), (6000, D), (10000, D), (12500, D),
        ]
        for cx, cy in win_positions:
            msp.add_lwpolyline(
                [(cx, offset_y + cy), (cx + 1500, offset_y + cy),
                 (cx + 1500, offset_y + cy + 100), (cx, offset_y + cy + 100),
                 (cx, offset_y + cy)],
                dxfattribs={"layer": "CUA-SO", "closed": True},
            )

        # Da Carrara (sanh chinh + phong khach)
        msp.add_lwpolyline(
            [(200, offset_y + 200), (W - 200, offset_y + 200),
             (W - 200, offset_y + 7000), (200, offset_y + 7000),
             (200, offset_y + 200)],
            dxfattribs={"layer": "DA-CARRARA", "closed": True},
        )

        # San go teak (cac phong ngu)
        for cx_start, cy_start, cx_end, cy_end in [
            (200, 10200, 4400, 16000),
            (4600, 10200, 9400, 16000),
            (9600, 10200, W - 200, 16000),
        ]:
            msp.add_lwpolyline(
                [(cx_start, offset_y + cy_start), (cx_end, offset_y + cy_start),
                 (cx_end, offset_y + cy_end), (cx_start, offset_y + cy_end),
                 (cx_start, offset_y + cy_start)],
                dxfattribs={"layer": "SAN-GO-TEAK", "closed": True},
            )

        # Gach lat (bep + sanh phu)
        msp.add_lwpolyline(
            [(6200, offset_y + 200), (W - 200, offset_y + 200),
             (W - 200, offset_y + 7000), (6200, offset_y + 7000),
             (6200, offset_y + 200)],
            dxfattribs={"layer": "GACH-LAT-SAN", "closed": True},
        )

        # WC: gach op
        for cx_start, cy_start, cx_end, cy_end in [
            (3000, 14000, 4500, 16000),
            (6000, 14000, 9500, 16000),
        ]:
            msp.add_lwpolyline(
                [(cx_start, offset_y + cy_start), (cx_end, offset_y + cy_start),
                 (cx_end, offset_y + cy_end), (cx_start, offset_y + cy_end),
                 (cx_start, offset_y + cy_start)],
                dxfattribs={"layer": "GACH-OP-WC", "closed": True},
            )

        # Son tuong
        msp.add_lwpolyline(
            [(0, offset_y), (W, offset_y), (W, offset_y + D), (0, offset_y + D), (0, offset_y)],
            dxfattribs={"layer": "SON-TUONG", "closed": True},
        )

        # Tran thach cao
        msp.add_lwpolyline(
            [(200, offset_y + 200), (W - 200, offset_y + 200),
             (W - 200, offset_y + D - 200), (200, offset_y + D - 200),
             (200, offset_y + 200)],
            dxfattribs={"layer": "TRAN-THACH-CAO", "closed": True},
        )

        # Den LED tran (24 cai/tang)
        for px in [1500, 4000, 6500, 9000, 11500, 13000]:
            for py in [2500, 5500, 12000, 17000]:
                msp.add_circle(
                    (px, offset_y + py), 80,
                    dxfattribs={"layer": "DEN-LED-TRAN"},
                )

        # O cam (16 cai/tang)
        for px in [500, 7000, W - 500]:
            for py in [1500, 5000, 8500, 13000, 17000]:
                msp.add_circle(
                    (px, offset_y + py), 50,
                    dxfattribs={"layer": "OCAM-220"},
                )

        # Cong tac (10 cai/tang)
        for px, py in [(3000, 200), (5800, 7000), (4000, 10200),
                       (8000, 10200), (12000, 10200), (3000, 16200),
                       (8000, 16200), (5500, 7100), (200, 5000), (W - 200, 5000)]:
            msp.add_circle(
                (px, offset_y + py), 50,
                dxfattribs={"layer": "CONG-TAC"},
            )

        # Dieu hoa (5 may/tang)
        for px, py in [(2000, D - 300), (8000, D - 300), (12000, D - 300),
                       (4000, 7000), (10000, 7000)]:
            msp.add_lwpolyline(
                [(px, offset_y + py), (px + 1000, offset_y + py),
                 (px + 1000, offset_y + py + 250), (px, offset_y + py + 250),
                 (px, offset_y + py)],
                dxfattribs={"layer": "DIEU-HOA", "closed": True},
            )

        # Lan can ban cong
        msp.add_line(
            (0, offset_y + D - 100), (W, offset_y + D - 100),
            dxfattribs={"layer": "LAN-CAN"},
        )

        # Kinh (mat dung)
        for cx_start, cy_start, cx_end, cy_end in [
            (3000, -100, 8000, 0),
            (3000, D, 8000, D + 100),
        ]:
            msp.add_lwpolyline(
                [(cx_start, offset_y + cy_start), (cx_end, offset_y + cy_start),
                 (cx_end, offset_y + cy_end), (cx_start, offset_y + cy_end),
                 (cx_start, offset_y + cy_start)],
                dxfattribs={"layer": "KINH", "closed": True},
            )

        # Floor label
        txt = msp.add_text(
            f"+{floor*3.5:.3f} TANG {floor+1}",
            dxfattribs={"layer": "TEXT", "height": 300},
        )
        txt.set_placement((W / 2, offset_y - 800))

    # Mong coc
    for cx, cy in [(0, 0), (W, 0), (0, D), (W, D),
                   (W / 3, 0), (2 * W / 3, 0),
                   (W / 3, D), (2 * W / 3, D),
                   (0, D / 2), (W, D / 2)]:
        msp.add_line(
            (cx, cy - 300), (cx, cy - 15300),
            dxfattribs={"layer": "MONG-COC"},
        )

    # Mai ngoi
    msp.add_lwpolyline(
        [(0, floors * (D + 3000) + 500),
         (W, floors * (D + 3000) + 500),
         (W, floors * (D + 3000) + 500 + D),
         (0, floors * (D + 3000) + 500 + D),
         (0, floors * (D + 3000) + 500)],
        dxfattribs={"layer": "MAI-NGOI", "closed": True},
    )

    doc.header["$EXTMIN"] = (-500, -16000, 0)
    doc.header["$EXTMAX"] = (W + 500, floors * (D + 3000) + 500 + D, 0)

    doc.saveas(str(path))
    return path


# ============================================================
# RUNNERS
# ============================================================
def run_test(name: str, dxf_path: Path, project_meta: dict) -> None:
    print(f"\n{'='*70}")
    print(f"TEST: {name}")
    print(f"{'='*70}")

    print(f"\n[1] Extracting quantities from {dxf_path.name}...")
    qty = extract_quantities(str(dxf_path))
    print(f"  - Floors detected: {qty['floors_detected']}")
    print(f"  - Total floor area: {qty['total_floor_area_m2']:.2f} m²")
    print(f"  - Layers: {len(qty['layers'])}")
    print(f"  - BBox: {qty['bbox']['width']:.2f}m x {qty['bbox']['depth']:.2f}m")

    # Save quantities
    qty_path = SAMPLES_DIR / f"{dxf_path.stem}.quantities.json"
    qty_path.write_text(
        json.dumps(qty, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    print(f"  Saved quantities: {qty_path.name}")

    # Top 5 layer
    print("\n  Top layer by quantity:")
    sorted_layers = sorted(
        qty["layers"].items(),
        key=lambda x: max(
            x[1].get("volume_m3", 0) * 100,
            x[1].get("area_m2", 0),
            x[1].get("count", 0),
            x[1].get("length_m", 0),
        ),
        reverse=True,
    )
    for ln, ld in sorted_layers[:8]:
        print(
            f"    {ln:30} | type={ld['entity_type']:10} | "
            f"count={ld['count']:4} | len={ld['length_m']:8.2f}m | "
            f"area={ld['area_m2']:8.2f}m² | vol={ld['volume_m3']:7.2f}m³"
        )

    print(f"\n[2] Generating BOQ...")
    boq = generate_boq(qty, project_meta)
    print(f"  - Total items: {boq['summary']['total_items']}")
    print(f"  - Sheets: {[s['name'] for s in boq['sheets']]}")
    print(f"  - Direct cost: {boq['summary']['direct_cost_vnd']:,} VND")
    print(f"  - VAT 8%:      {boq['summary']['vat_8pct_vnd']:,} VND")
    print(f"  - QLP 5%:      {boq['summary']['management_5pct_vnd']:,} VND")
    print(f"  - Du phong:    {boq['summary']['contingency_10pct_vnd']:,} VND")
    print(f"  - GRAND TOTAL: {boq['grand_total_vnd']:,} VND")

    boq_path = SAMPLES_DIR / f"{dxf_path.stem}.boq.json"
    boq_path.write_text(
        json.dumps(boq, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    print(f"  Saved BOQ JSON: {boq_path.name}")

    # Sample 3 row tu hoan thien
    print("\n  Sample BOQ row (Hoan thien sheet):")
    ht_sheet = next((s for s in boq["sheets"] if "Hoan thien" in s["name"]), None)
    if ht_sheet and ht_sheet["items"]:
        for it in ht_sheet["items"][:3]:
            print(
                f"    [{it['stt']:3}] {it['code']:25} | "
                f"qty={it['quantity']:8.2f} {it['unit']} | "
                f"hh={it['wastage_pct']}% | "
                f"price={it['unit_price_vnd']:,}/u | "
                f"total={it['total_vnd']:,} VND"
            )

    print(f"\n[3] Exporting Excel...")
    xlsx_path = EXPORTS_DIR / f"{dxf_path.stem}.boq.xlsx"
    out = export_boq_to_excel(boq, str(xlsx_path))
    print(f"  Excel saved: {out}")

    return qty, boq


def main():
    print("=" * 70)
    print("BOQ ENGINE - END-TO-END TEST")
    print("=" * 70)

    house_dxf = SAMPLES_DIR / "sample-house-3T.dxf"
    villa_dxf = SAMPLES_DIR / "sample-villa-280m2.dxf"

    print("\n[GEN] Tao DXF mau...")
    gen_house_3t_80m2(house_dxf)
    print(f"  Created: {house_dxf}")
    gen_villa_280m2(villa_dxf)
    print(f"  Created: {villa_dxf}")

    # Test 1: Nha 3T
    house_meta = {
        "project_id": "VCT-TEST-HOUSE-001",
        "project_name": "Nha pho 3 tang 80m²",
        "floors": 3,
        "total_floor_area_m2": 240.0,  # 80 * 3
        "style": "modern",
    }
    qty_h, boq_h = run_test("NHA PHO 3 TANG 80m²", house_dxf, house_meta)

    # Test 2: Biet thu
    villa_meta = {
        "project_id": "VCT-TEST-VILLA-001",
        "project_name": "Biet thu 3 tang 280m² san",
        "floors": 3,
        "total_floor_area_m2": 840.0,  # 280 * 3
        "style": "luxury",
    }
    qty_v, boq_v = run_test("BIET THU 280m² 3T", villa_dxf, villa_meta)

    print("\n" + "=" * 70)
    print("FINAL SUMMARY")
    print("=" * 70)
    print(f"Nha pho 3T 80m² :  Items={boq_h['summary']['total_items']:4} | "
          f"Total={boq_h['grand_total_vnd']:,} VND")
    print(f"Biet thu 280m² 3T: Items={boq_v['summary']['total_items']:4} | "
          f"Total={boq_v['grand_total_vnd']:,} VND")

    # Validate
    assert boq_v["summary"]["total_items"] >= 100, (
        f"Villa must have >=100 items, got {boq_v['summary']['total_items']}"
    )
    assert boq_v["grand_total_vnd"] > 500_000_000, "Villa total must > 500tr"
    print(f"\nAll assertions PASSED! "
          f"(Villa items={boq_v['summary']['total_items']}, "
          f"total={boq_v['grand_total_vnd']/1e9:.2f} ty VND)")


if __name__ == "__main__":
    main()
