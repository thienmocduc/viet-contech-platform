"""
from_dxf.py — Convert DXF mat bang 2D -> IFC 3D
=================================================

Doc DXF mat bang theo LAYER convention chuan AIA:
    - WALL          -> IfcWall (extrude theo height_mm)
    - COLUMN        -> IfcColumn
    - SLAB          -> IfcSlab (cao do = level dinh)
    - DOOR          -> opening trong wall lien quan
    - WINDOW        -> opening trong wall lien quan
    - STAIR         -> IfcStair
    - MEP-WATER     -> IfcPipeSegment (system="water")
    - MEP-HVAC      -> IfcPipeSegment (system="hvac")

Ket qua: file IFC 4 + list element JSON. Pipeline goi tu node-bridge.

Neu khong co `ezdxf` (DXF parser) — fallback de doc dang `dxf-json`
(layer = key, entities = list line/polyline). Truong hop khan cap (vi du
DXF chua co), accept dxf_layout dang dict {layers: {...}} — pipeline cua
minh thuong sinh ra dang nay tu A-01.dxf cua agent kien_truc_detail.

API public:
    out = dxf_to_ifc(
        dxf_path="/abs/path/A-01.dxf",  # hoac path .json fallback
        level_height_mm=3300,
        num_levels=3,
        output_path="/abs/path/out.ifc",
    )
    # out = {"ifc_path": "...", "elements": [...], "count": N}
"""

from __future__ import annotations

import json
import math
import os
from typing import Any, Optional

from ifc_generator import BIMGenerator

try:
    import ezdxf  # type: ignore
    from ezdxf.document import Drawing  # type: ignore

    _EZDXF_AVAILABLE = True
except Exception:
    ezdxf = None  # type: ignore
    Drawing = None  # type: ignore
    _EZDXF_AVAILABLE = False


# ============================================================
# Layer convention
# ============================================================
WALL_LAYERS = {"WALL", "A_WALL_EXT", "A_WALL_INT", "WALLS"}
COLUMN_LAYERS = {"COLUMN", "S_COLUMN", "COLUMNS"}
SLAB_LAYERS = {"SLAB", "S_SLAB", "FLOOR"}
DOOR_LAYERS = {"DOOR", "A_DOOR", "DOORS"}
WINDOW_LAYERS = {"WINDOW", "A_WINDOW", "WINDOWS"}
STAIR_LAYERS = {"STAIR", "A_STAIR", "STAIRS"}
MEP_WATER_LAYERS = {"MEP-WATER", "M_WATER", "PIPE_WATER"}
MEP_HVAC_LAYERS = {"MEP-HVAC", "M_HVAC", "DUCT"}


# ============================================================
# DXF parser — wrapper cho ezdxf hoac fallback JSON
# ============================================================
def _load_dxf(dxf_path: str) -> dict[str, list[dict[str, Any]]]:
    """Tra ve dict {layer_name: [entity_dict, ...]}.
    entity_dict co cac field: type, points (mm), props (dict).
    """
    if dxf_path.endswith(".json"):
        with open(dxf_path, "r", encoding="utf-8") as f:
            return json.load(f).get("layers", {})

    if not _EZDXF_AVAILABLE:
        raise RuntimeError(
            "ezdxf chua cai. `pip install ezdxf` hoac dung file .json fallback "
            "(format: {layers: {LAYER_NAME: [entities]}})."
        )

    doc: Any = ezdxf.readfile(dxf_path)  # type: ignore
    msp = doc.modelspace()
    layers: dict[str, list[dict[str, Any]]] = {}

    for ent in msp:
        layer = (ent.dxf.layer or "").upper()
        layers.setdefault(layer, [])
        etype = ent.dxftype()
        if etype == "LINE":
            layers[layer].append(
                {
                    "type": "LINE",
                    "points": [
                        [float(ent.dxf.start.x), float(ent.dxf.start.y)],
                        [float(ent.dxf.end.x), float(ent.dxf.end.y)],
                    ],
                    "props": {},
                }
            )
        elif etype in ("LWPOLYLINE", "POLYLINE"):
            pts = [[float(p[0]), float(p[1])] for p in ent.get_points()]  # type: ignore
            layers[layer].append({"type": "POLYLINE", "points": pts, "props": {}})
        elif etype == "CIRCLE":
            layers[layer].append(
                {
                    "type": "CIRCLE",
                    "points": [[float(ent.dxf.center.x), float(ent.dxf.center.y)]],
                    "props": {"radius": float(ent.dxf.radius)},
                }
            )
        elif etype == "INSERT":
            # Block reference — vi du cua/cua so duoc dat bang block
            layers[layer].append(
                {
                    "type": "INSERT",
                    "points": [[float(ent.dxf.insert.x), float(ent.dxf.insert.y)]],
                    "props": {
                        "block": ent.dxf.name,
                        "rotation": float(getattr(ent.dxf, "rotation", 0.0)),
                    },
                }
            )
    return layers


# ============================================================
# Helpers
# ============================================================
def _line_length_and_angle(p1: list[float], p2: list[float]) -> tuple[float, float]:
    dx = p2[0] - p1[0]
    dy = p2[1] - p1[1]
    return math.hypot(dx, dy), math.degrees(math.atan2(dy, dx))


def _layer_match(layer: str, candidates: set[str]) -> bool:
    layer_u = layer.upper()
    return layer_u in candidates


# ============================================================
# Main converter
# ============================================================
def dxf_to_ifc(
    dxf_path: str,
    level_height_mm: int = 3300,
    num_levels: int = 3,
    output_path: Optional[str] = None,
    project_meta: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """
    Doc DXF mat bang -> sinh IFC 3D.

    Mat bang la 1 tang dien hinh, extrude `num_levels` lan voi
    `level_height_mm`. Slab moi level. Cot xuyen suot all level.

    Returns:
        {"ifc_path": str, "elements": list, "count": int, "summary": dict}
    """
    layers = _load_dxf(dxf_path)
    g = BIMGenerator(
        project_meta or {"name": os.path.basename(dxf_path), "creator": "bim_modeler"}
    )

    # ------ Walls ------
    wall_guids_by_segment: list[tuple[str, list[float], list[float]]] = []
    wall_thickness_default = 200.0
    for layer, entities in layers.items():
        if not _layer_match(layer, WALL_LAYERS):
            continue
        for ent in entities:
            if ent["type"] not in ("LINE", "POLYLINE"):
                continue
            pts = ent["points"]
            for i in range(len(pts) - 1):
                p1, p2 = pts[i], pts[i + 1]
                length, angle = _line_length_and_angle(p1, p2)
                if length < 100:  # bo doan rat ngan
                    continue
                # Extrude tat ca level
                for lvl in range(num_levels):
                    z = lvl * level_height_mm
                    guid = g.add_wall(
                        x=p1[0],
                        y=p1[1],
                        z=z,
                        length_mm=length,
                        height_mm=level_height_mm,
                        thickness_mm=wall_thickness_default,
                        material="brick_220",
                        rotation_deg=angle,
                        load_bearing=False,
                    )
                    wall_guids_by_segment.append((guid, p1, p2))

    # ------ Columns ------
    for layer, entities in layers.items():
        if not _layer_match(layer, COLUMN_LAYERS):
            continue
        for ent in entities:
            cx, cy = (ent["points"][0] if ent["points"] else [0, 0])
            w = float(ent.get("props", {}).get("w", 250))
            d = float(ent.get("props", {}).get("d", 250))
            for lvl in range(num_levels):
                z = lvl * level_height_mm
                g.add_column(
                    x=cx, y=cy, z=z,
                    w_mm=w, d_mm=d,
                    h_mm=level_height_mm,
                    material="concrete_b25",
                )

    # ------ Slabs (1 san cho moi level + san mai) ------
    slab_polygon: list[tuple[float, float]] = []
    for layer, entities in layers.items():
        if not _layer_match(layer, SLAB_LAYERS):
            continue
        for ent in entities:
            if ent["type"] == "POLYLINE":
                slab_polygon = [(p[0], p[1]) for p in ent["points"]]
                break
        if slab_polygon:
            break

    if not slab_polygon:
        # Fallback: tu suy bbox tu walls
        all_pts: list[list[float]] = []
        for _, p1, p2 in wall_guids_by_segment:
            all_pts.extend([p1, p2])
        if all_pts:
            xs = [p[0] for p in all_pts]
            ys = [p[1] for p in all_pts]
            slab_polygon = [
                (min(xs), min(ys)),
                (max(xs), min(ys)),
                (max(xs), max(ys)),
                (min(xs), max(ys)),
            ]

    if slab_polygon:
        for lvl in range(num_levels + 1):  # +1 = mai
            g.add_slab(
                polygon_points_mm=slab_polygon,
                thickness_mm=150 if lvl == 0 else 120,
                level=lvl,
                material="concrete_b25",
                z_offset_mm=lvl * level_height_mm,
            )

    # ------ Doors / Windows ------
    # Cua/cua so chi tao o tang 1 (bot trung) + suy ra wall_guid gan nhat
    def _nearest_wall_at_z0(point: list[float]) -> Optional[str]:
        best_guid: Optional[str] = None
        best_dist = float("inf")
        for guid, p1, p2 in wall_guids_by_segment:
            wall_elem = next((e for e in g.elements if e.guid == guid), None)
            if not wall_elem or wall_elem.geometry.get("z_mm", 0) > 1:
                continue
            # Khoang cach tu point den line p1-p2
            x0, y0 = point
            x1, y1 = p1
            x2, y2 = p2
            dx, dy = x2 - x1, y2 - y1
            den = dx * dx + dy * dy or 1
            t = max(0, min(1, ((x0 - x1) * dx + (y0 - y1) * dy) / den))
            px, py = x1 + t * dx, y1 + t * dy
            dist = math.hypot(x0 - px, y0 - py)
            if dist < best_dist:
                best_dist = dist
                best_guid = guid
        return best_guid

    for layer, entities in layers.items():
        if _layer_match(layer, DOOR_LAYERS):
            for ent in entities:
                pt = ent["points"][0]
                wall_guid = _nearest_wall_at_z0(pt)
                if not wall_guid:
                    continue
                w = float(ent.get("props", {}).get("w", 900))
                h = float(ent.get("props", {}).get("h", 2100))
                dtype = ent.get("props", {}).get("type", "single")
                try:
                    g.add_door(wall_guid, x_offset_mm=300, w_mm=w, h_mm=h, type=dtype)
                except Exception as e:
                    print(f"[from_dxf] skip door: {e}")
        elif _layer_match(layer, WINDOW_LAYERS):
            for ent in entities:
                pt = ent["points"][0]
                wall_guid = _nearest_wall_at_z0(pt)
                if not wall_guid:
                    continue
                w = float(ent.get("props", {}).get("w", 1200))
                h = float(ent.get("props", {}).get("h", 1500))
                sill = float(ent.get("props", {}).get("sill", 900))
                try:
                    g.add_window(
                        wall_guid, x_offset_mm=300, w_mm=w, h_mm=h, sill_mm=sill
                    )
                except Exception as e:
                    print(f"[from_dxf] skip window: {e}")

    # ------ Stairs ------
    for layer, entities in layers.items():
        if not _layer_match(layer, STAIR_LAYERS):
            continue
        for ent in entities:
            pt = ent["points"][0]
            try:
                g.add_stair(
                    x=pt[0],
                    y=pt[1],
                    z=0,
                    run_length_mm=3000,
                    width_mm=1100,
                    total_rise_mm=level_height_mm,
                    riser_count=int(level_height_mm / 165),
                )
            except Exception as e:
                print(f"[from_dxf] skip stair: {e}")

    # ------ MEP pipes (water + hvac) ------
    for layer, entities in layers.items():
        is_water = _layer_match(layer, MEP_WATER_LAYERS)
        is_hvac = _layer_match(layer, MEP_HVAC_LAYERS)
        if not (is_water or is_hvac):
            continue
        for ent in entities:
            if ent["type"] not in ("LINE", "POLYLINE"):
                continue
            pts = ent["points"]
            for i in range(len(pts) - 1):
                p1, p2 = pts[i], pts[i + 1]
                length, _ = _line_length_and_angle(p1, p2)
                g.add_mep_pipe(
                    x=p1[0],
                    y=p1[1],
                    z=2800,  # treo tran
                    length_mm=length,
                    diameter_mm=110 if is_water else 200,
                    material="pvc" if is_water else "galvanized_steel",
                    system="water" if is_water else "hvac",
                )

    # ------ Export ------
    if not output_path:
        output_path = os.path.splitext(dxf_path)[0] + ".ifc"
    ifc_path = g.export(output_path)

    return {
        "ifc_path": ifc_path,
        "elements": [
            {
                "guid": e.guid,
                "type": e.type,
                "ifc_class": e.ifc_class,
                "name": e.name,
                "material": e.material,
                "geometry": e.geometry,
                "parent_guid": e.parent_guid,
            }
            for e in g.elements
        ],
        "count": g.count(),
        "summary": g.summary(),
    }


# ============================================================
# CLI: python from_dxf.py <dxf_path> [num_levels]
# ============================================================
if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage: python from_dxf.py <dxf_path|json_layers> [num_levels=3]")
        sys.exit(1)
    path = sys.argv[1]
    levels = int(sys.argv[2]) if len(sys.argv) > 2 else 3
    res = dxf_to_ifc(path, num_levels=levels)
    print(
        f"OK count={res['count']} summary={res['summary']} -> {res['ifc_path']}"
    )
