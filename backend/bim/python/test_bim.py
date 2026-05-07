"""
test_bim.py — End-to-end smoke test cho BIM module
====================================================

Workflow:
  1. Sinh DXF mau (JSON-layers fallback) cho nha pho 3 tang.
  2. Run from_dxf -> IFC. Expect >= 40 elements (walls, columns, slabs,
     doors, windows, stair, MEP pipes).
  3. Run clash_detection -> expect >= 1 clash test (chu y co cot doi MEP).
  4. Run auto_resolve -> expect workflow/soft fixed, hard escalated.

Chay:
    python test_bim.py
Exit code 0 neu pass tat ca, !=0 neu fail.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile

# Bao dam imports lam viec khi chay tu thu muc khac
HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

from ifc_generator import BIMGenerator
from clash_detection import detect_clashes, write_report
from auto_resolve import auto_resolve


# ============================================================
# Build sample BIM truc tiep tu BIMGenerator
# (de tranh phu thuoc DXF parser, em build truc tiep nhung
# se viet 1 sample DXF JSON song song de demo from_dxf.py)
# ============================================================
def build_sample_house() -> tuple[str, dict]:
    """Sinh nha pho 3 tang 4m x 12m, expected >= 40 elements."""
    g = BIMGenerator(
        {
            "name": "Sample-Townhouse-3F",
            "site": "Lot 12 - Q9",
            "building": "Nha A",
            "creator": "test_bim",
        }
    )

    width = 4000.0
    depth = 12000.0
    h_lvl = 3300
    levels = 3

    # ----- Tuong bao quanh: lvl 0 = sau + 2 ben (front_wall tao rieng o duoi
    # de gan cua/cua so, tranh trung dinh nghia), lvl 1+ = du 4 mat -----
    for lvl in range(levels):
        z = lvl * h_lvl
        # Tuong sau (theo X)
        g.add_wall(0, width, z, depth, h_lvl, 200, "brick_220", rotation_deg=0)
        # Hai ben (theo Y)
        g.add_wall(0, 0, z, width, h_lvl, 200, "brick_220", rotation_deg=90)
        g.add_wall(depth, 0, z, width, h_lvl, 200, "brick_220", rotation_deg=90)
        # Vach ngan trong tang (1 vach giua, mong hon)
        g.add_wall(depth / 2, 0, z, width, h_lvl, 100, "gypsum_100", rotation_deg=90)

    # ----- 6 cot luoi 4m x 6m -----
    grid_x = [0, depth / 2, depth]
    grid_y = [0, width]
    for lvl in range(levels):
        z = lvl * h_lvl
        for gx in grid_x:
            for gy in grid_y:
                g.add_column(gx, gy, z, 250, 250, h_lvl, "concrete_b25")

    # ----- San moi tang + san mai -----
    poly = [(0.0, 0.0), (depth, 0.0), (depth, width), (0.0, width)]
    for lvl in range(levels + 1):
        g.add_slab(
            polygon_points_mm=poly,
            thickness_mm=150 if lvl == 0 else 120,
            level=lvl,
            material="concrete_b25",
            z_offset_mm=lvl * h_lvl,
        )

    # ----- Tuong mat tien (front) cho moi tang — co cua/cua so -----
    front_wall_l1 = g.add_wall(0, 0, 0, depth, h_lvl, 200, "brick_220")
    g.add_door(front_wall_l1, x_offset_mm=2000, w_mm=1200, h_mm=2300, type="main")
    g.add_door(front_wall_l1, x_offset_mm=8000, w_mm=900, h_mm=2100, type="single")
    g.add_window(front_wall_l1, x_offset_mm=4000, w_mm=2000, h_mm=1500, sill_mm=900)
    g.add_window(front_wall_l1, x_offset_mm=10000, w_mm=1500, h_mm=1500, sill_mm=900)

    front_wall_l2 = g.add_wall(0, 0, h_lvl, depth, h_lvl, 200, "brick_220")
    g.add_window(front_wall_l2, x_offset_mm=2000, w_mm=1500, h_mm=1500, sill_mm=900)
    g.add_window(front_wall_l2, x_offset_mm=6000, w_mm=1500, h_mm=1500, sill_mm=900)
    g.add_window(front_wall_l2, x_offset_mm=10000, w_mm=1500, h_mm=1500, sill_mm=900)

    front_wall_l3 = g.add_wall(0, 0, 2 * h_lvl, depth, h_lvl, 200, "brick_220")
    g.add_window(front_wall_l3, x_offset_mm=2000, w_mm=1500, h_mm=1500, sill_mm=900)
    g.add_window(front_wall_l3, x_offset_mm=10000, w_mm=1500, h_mm=1500, sill_mm=900)

    # ----- Cau thang (1 ve, tu tang 1 len tang 2) -----
    # TCVN 4451: h=150-180mm, b=270-300mm, 2h+b=600-630
    # Chon h=165, b=290 -> 2h+b=620 OK; rise 3300 -> n_riser=20 -> run = 19*290 = 5510mm
    # Dat trong nha (y=400-1500) khong giao tuong front (y=0-200) hay back (y=3800-4000)
    g.add_stair(
        x=4000,
        y=1400,
        z=0,
        run_length_mm=5510,
        width_mm=1100,
        total_rise_mm=3300,
        riser_count=20,
    )

    # ----- Dam ngang giua (tao chance clash voi MEP) -----
    for lvl in range(1, levels + 1):
        z = lvl * h_lvl - 400
        g.add_beam(
            x=0, y=width / 2, z=z,
            length_mm=depth, w_mm=200, h_mm=400,
            material="concrete_b25",
        )

    # ----- MEP pipes — chu dich tao 1-2 hard clash voi cot va beam -----
    # Pipe nuoc xuyen qua cot luoi tai grid_x[1] (clash voi cot z=0)
    g.add_mep_pipe(
        x=depth / 2 - 100,  # vi tri co cot
        y=width / 2,
        z=200,  # gan san
        length_mm=300,  # ngang qua cot 250mm
        diameter_mm=110,
        material="pvc",
        system="water",
    )
    # Pipe HVAC chay duoi dam tang 2 (workflow ok, treo duoi)
    g.add_mep_pipe(
        x=2000, y=width / 2 - 100, z=h_lvl - 600,
        length_mm=8000, diameter_mm=200,
        material="galvanized_steel", system="hvac",
    )
    # Pipe drainage xuyen san tang 1 (workflow clash: xuyen slab BTCT)
    g.add_mep_pipe(
        x=10000, y=width - 500, z=140,  # nam trong san day 150
        length_mm=400, diameter_mm=110,
        material="pvc", system="drainage",
    )

    workdir = tempfile.mkdtemp(prefix="vct_bim_test_")
    out = g.export(os.path.join(workdir, "townhouse.ifc"))
    return out, {
        "workdir": workdir,
        "count": g.count(),
        "summary": g.summary(),
    }


# ============================================================
# Sample DXF JSON (de demo from_dxf.py)
# ============================================================
def write_sample_dxf_json(workdir: str) -> str:
    """Sinh file DXF JSON fallback voi vai layer co ban."""
    layers = {
        "WALL": [
            {"type": "POLYLINE",
             "points": [[0, 0], [12000, 0], [12000, 4000], [0, 4000], [0, 0]]},
            {"type": "LINE", "points": [[6000, 0], [6000, 4000]]},
        ],
        "COLUMN": [
            {"type": "INSERT", "points": [[0, 0]], "props": {"w": 250, "d": 250}},
            {"type": "INSERT", "points": [[6000, 0]], "props": {"w": 250, "d": 250}},
            {"type": "INSERT", "points": [[12000, 0]], "props": {"w": 250, "d": 250}},
            {"type": "INSERT", "points": [[0, 4000]], "props": {"w": 250, "d": 250}},
            {"type": "INSERT", "points": [[6000, 4000]], "props": {"w": 250, "d": 250}},
            {"type": "INSERT", "points": [[12000, 4000]], "props": {"w": 250, "d": 250}},
        ],
        "SLAB": [
            {"type": "POLYLINE",
             "points": [[0, 0], [12000, 0], [12000, 4000], [0, 4000]]},
        ],
        "DOOR": [
            {"type": "INSERT", "points": [[2000, 0]],
             "props": {"w": 1200, "h": 2300, "type": "main"}},
        ],
        "WINDOW": [
            {"type": "INSERT", "points": [[5000, 0]],
             "props": {"w": 2000, "h": 1500, "sill": 900}},
        ],
        "STAIR": [
            {"type": "INSERT", "points": [[5000, 1000]]},
        ],
        "MEP-WATER": [
            {"type": "LINE", "points": [[5800, 2000], [6300, 2000]]},
        ],
    }
    out = os.path.join(workdir, "sample-floor.dxf.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump({"layers": layers}, f, ensure_ascii=False, indent=2)
    return out


# ============================================================
# Test runner
# ============================================================
def assert_truthy(cond: bool, msg: str) -> None:
    if not cond:
        print(f"  FAIL: {msg}")
        raise AssertionError(msg)
    print(f"  PASS: {msg}")


def run() -> int:
    print("=" * 60)
    print("VIET-CONTECH BIM E2E TEST")
    print("=" * 60)

    # ---- 1. Build sample IFC ----
    print("\n[1] Build sample IFC tu BIMGenerator API...")
    ifc_path, info = build_sample_house()
    print(f"    -> {ifc_path}")
    print(f"    -> count={info['count']} summary={info['summary']}")
    assert_truthy(info["count"] >= 40, f"Expected >=40 elements, got {info['count']}")

    # ---- 2. DXF -> IFC test ----
    print("\n[2] Test from_dxf.py voi sample DXF JSON...")
    dxf_json = write_sample_dxf_json(info["workdir"])
    from from_dxf import dxf_to_ifc

    res = dxf_to_ifc(dxf_json, num_levels=3, output_path=os.path.join(info["workdir"], "from_dxf.ifc"))
    print(f"    -> dxf_to_ifc count={res['count']} summary={res['summary']}")
    assert_truthy(res["count"] >= 20, f"DXF->IFC expected >=20 elements, got {res['count']}")

    # ---- 3. Clash detection ----
    print("\n[3] Run clash detection tren sample IFC...")
    clashes = detect_clashes(ifc_path)
    by_kind = {"hard": 0, "soft": 0, "workflow": 0}
    for c in clashes:
        by_kind[c["kind"]] = by_kind.get(c["kind"], 0) + 1
    print(f"    -> total={len(clashes)} by_kind={by_kind}")
    assert_truthy(len(clashes) >= 1, f"Expected >=1 clash, got {len(clashes)}")
    assert_truthy(
        by_kind["hard"] + by_kind["workflow"] >= 1,
        "Expected at least 1 hard or workflow clash (sample co MEP xuyen cot/san)",
    )

    # In sample 3 clash dau de log
    print("\n    Sample 3 clash dau:")
    for c in clashes[:3]:
        print(
            f"      [{c['kind']}/{c['severity']}] {c['element_a_type']} x {c['element_b_type']}"
            f" volume={c['intersection_volume_mm3']:.1f}mm3 gap={c['min_distance_mm']:.1f}mm"
        )
        print(f"         -> {c['suggestion']}")

    report_path = write_report(ifc_path)
    print(f"    -> Report: {report_path}")

    # ---- 4. Auto-resolve ----
    print("\n[4] Run auto-resolve...")
    res = auto_resolve(ifc_path, clashes)
    print(f"    -> fixed={res['total_fixed']} escalated={res['total_escalated']}")
    print(f"    -> ifc after: {res['ifc_path_after']}")
    # Khong yeu cau hard fail nhung neu co workflow thi nen co fixed
    if by_kind["workflow"] > 0:
        assert_truthy(
            res["total_fixed"] >= 1, "Workflow clash phai duoc auto-fixed"
        )

    print("\n" + "=" * 60)
    print("ALL TESTS PASSED")
    print("=" * 60)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(run())
    except AssertionError as e:
        print(f"\nTEST FAILED: {e}")
        sys.exit(1)
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"\nTEST CRASHED: {e}")
        sys.exit(2)
