"""
extract.py - DXF Quantity Extractor cho Viet-Contech BOQ Engine
================================================================
Doc DXF (AutoCAD/Revit export) -> boc khoi luong theo LAYER.

LAYER convention chuan (mapping trong price_db.py):
- TUONG-220 / WALL       : tuong xay (m3 = area * height - door_area)
- COT-200X300 / COLUMN   : cot BTCT (count + dimension -> m3)
- DAM / BEAM             : dam BTCT (length * cross_section)
- SAN-BTCT-150 / SLAB    : san BTCT (area * thickness)
- CUA-DI / DOOR          : cua di (count + area)
- CUA-SO / WINDOW        : cua so (count + area)
- KINH / GLASS           : kinh op (m2)
- GACH-LAT-SAN / FLOOR_TILE : gach lat nen (m2)
- GACH-OP-WC / WALL_TILE : gach op tuong (m2)
- DA-CARRARA / MARBLE    : da op (m2)
- SAN-GO-TEAK / WOOD-FLOOR : san go (m2)
- SON-TUONG / PAINT      : son (m2 quy doi -> lit)
- TRAN-THACH-CAO / CEILING : tran thach cao (m2)
- DEN-LED-TRAN / LIGHT   : den (count)
- OCAM-220 / SOCKET      : o cam (count)
- CONG-TAC / SWITCH      : cong tac (count)
- DIEU-HOA / AC          : dieu hoa (count + BTU)
"""
from __future__ import annotations

import json
import math
import sys
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any

import ezdxf
from ezdxf.document import Drawing
from ezdxf.entities import DXFEntity, LWPolyline, Polyline, Line, Circle, Insert
from ezdxf.math import Vec3, BoundingBox


# ============================================================
# DATA CLASSES
# ============================================================
@dataclass
class LayerQuantity:
    """Khoi luong moc cho 1 layer."""
    layer: str
    entity_type: str  # 'wall' | 'column' | 'beam' | 'slab' | 'door' | 'window' | 'tile' | 'paint' | 'light' | 'socket' | 'switch' | 'ac' | 'other'
    count: int = 0
    length_m: float = 0.0
    area_m2: float = 0.0
    volume_m3: float = 0.0
    handles: list[str] = field(default_factory=list)
    meta: dict[str, Any] = field(default_factory=dict)


@dataclass
class ExtractResult:
    """Ket qua extract toan project."""
    dxf_file: str
    units: str  # 'mm' | 'm'
    total_floor_area_m2: float
    floors_detected: int
    layers: dict[str, LayerQuantity]
    warnings: list[str]
    bbox: dict[str, float]  # {min_x, min_y, max_x, max_y, width, depth}

    def to_dict(self) -> dict:
        return {
            "dxf_file": self.dxf_file,
            "units": self.units,
            "total_floor_area_m2": round(self.total_floor_area_m2, 2),
            "floors_detected": self.floors_detected,
            "bbox": {k: round(v, 2) for k, v in self.bbox.items()},
            "layers": {
                k: {
                    "layer": v.layer,
                    "entity_type": v.entity_type,
                    "count": v.count,
                    "length_m": round(v.length_m, 2),
                    "area_m2": round(v.area_m2, 2),
                    "volume_m3": round(v.volume_m3, 3),
                    "handles": v.handles[:20],
                    "meta": v.meta,
                }
                for k, v in self.layers.items()
            },
            "warnings": self.warnings,
        }


# ============================================================
# HELPERS
# ============================================================
WALL_LAYERS = ("TUONG", "WALL")
COLUMN_LAYERS = ("COT", "COLUMN")
BEAM_LAYERS = ("DAM", "BEAM")
SLAB_LAYERS = ("SAN", "SLAB", "FLOOR")
DOOR_LAYERS = ("CUA-DI", "DOOR")
WINDOW_LAYERS = ("CUA-SO", "WINDOW")
TILE_FLOOR_LAYERS = ("GACH-LAT", "FLOOR_TILE", "FLOOR-TILE", "DA-CARRARA", "MARBLE", "SAN-GO", "WOOD-FLOOR")
TILE_WALL_LAYERS = ("GACH-OP", "WALL_TILE", "WALL-TILE")
PAINT_LAYERS = ("SON", "PAINT")
CEILING_LAYERS = ("TRAN", "CEILING")
LIGHT_LAYERS = ("DEN", "LIGHT", "LIGHTING")
SOCKET_LAYERS = ("OCAM", "SOCKET")
SWITCH_LAYERS = ("CONG-TAC", "SWITCH")
AC_LAYERS = ("DIEU-HOA", "AC", "MAY-LANH")
PIPE_LAYERS = ("ONG-NUOC", "PIPE")
WIRE_LAYERS = ("DAY-DIEN", "WIRE")
GLASS_LAYERS = ("KINH", "GLASS")
RAILING_LAYERS = ("LAN-CAN", "RAILING")
FOUNDATION_LAYERS = ("MONG", "FOUNDATION")


def classify_layer(layer_name: str) -> str:
    """Phan loai layer -> entity_type."""
    name = layer_name.upper().strip()
    if any(p in name for p in WALL_LAYERS):
        return "wall"
    if any(p in name for p in COLUMN_LAYERS):
        return "column"
    if any(p in name for p in BEAM_LAYERS):
        return "beam"
    if any(p in name for p in DOOR_LAYERS):
        return "door"
    if any(p in name for p in WINDOW_LAYERS):
        return "window"
    if any(p in name for p in SLAB_LAYERS):
        return "slab"
    if any(p in name for p in TILE_FLOOR_LAYERS):
        return "floor_tile"
    if any(p in name for p in TILE_WALL_LAYERS):
        return "wall_tile"
    if any(p in name for p in PAINT_LAYERS):
        return "paint"
    if any(p in name for p in CEILING_LAYERS):
        return "ceiling"
    if any(p in name for p in LIGHT_LAYERS):
        return "light"
    if any(p in name for p in SOCKET_LAYERS):
        return "socket"
    if any(p in name for p in SWITCH_LAYERS):
        return "switch"
    if any(p in name for p in AC_LAYERS):
        return "ac"
    if any(p in name for p in PIPE_LAYERS):
        return "pipe"
    if any(p in name for p in WIRE_LAYERS):
        return "wire"
    if any(p in name for p in GLASS_LAYERS):
        return "glass"
    if any(p in name for p in RAILING_LAYERS):
        return "railing"
    if any(p in name for p in FOUNDATION_LAYERS):
        return "foundation"
    return "other"


def parse_column_size(layer_name: str) -> tuple[float, float]:
    """Lay kich thuoc cot tu LAYER name 'COT-200X300' -> (200, 300) mm."""
    import re
    m = re.search(r"(\d+)X(\d+)", layer_name.upper())
    if m:
        return float(m.group(1)), float(m.group(2))
    return 220.0, 220.0  # default


def parse_wall_thickness(layer_name: str) -> float:
    """Lay do day tuong tu 'TUONG-220' -> 220 mm."""
    import re
    m = re.search(r"(\d{2,4})\b", layer_name.upper())
    if m:
        return float(m.group(1))
    return 220.0  # default


def parse_slab_thickness(layer_name: str) -> float:
    """Do day san tu 'SAN-BTCT-150' -> 150 mm."""
    import re
    m = re.search(r"(\d{2,4})", layer_name.upper())
    if m:
        return float(m.group(1))
    return 150.0


def polyline_length(entity: DXFEntity) -> float:
    """Chieu dai polyline (mm)."""
    if isinstance(entity, LWPolyline):
        pts = list(entity.vertices())
        return sum(
            math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])
            for i in range(len(pts) - 1)
        )
    if isinstance(entity, Polyline):
        pts = [v.dxf.location for v in entity.vertices]
        return sum(
            math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y)
            for i in range(len(pts) - 1)
        )
    if isinstance(entity, Line):
        s = entity.dxf.start
        e = entity.dxf.end
        return math.hypot(e.x - s.x, e.y - s.y)
    return 0.0


def polyline_area(entity: DXFEntity) -> float:
    """Dien tich polyline kin (mm^2). Shoelace."""
    pts: list[tuple[float, float]] = []
    if isinstance(entity, LWPolyline):
        if not entity.is_closed:
            return 0.0
        pts = [(p[0], p[1]) for p in entity.vertices()]
    elif isinstance(entity, Polyline):
        if not entity.is_closed:
            return 0.0
        pts = [(v.dxf.location.x, v.dxf.location.y) for v in entity.vertices]
    if len(pts) < 3:
        return 0.0
    n = len(pts)
    area = 0.0
    for i in range(n):
        j = (i + 1) % n
        area += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1]
    return abs(area) / 2.0


def detect_units(doc: Drawing) -> str:
    """Detect units. DXF $INSUNITS: 1=inch, 4=mm, 6=m, default mm."""
    try:
        units = doc.header.get("$INSUNITS", 4)
        return "m" if units == 6 else "mm"
    except Exception:
        return "mm"


def to_meters(val: float, units: str) -> float:
    return val if units == "m" else val / 1000.0


# ============================================================
# MAIN EXTRACTOR
# ============================================================
def extract_quantities(dxf_path: str) -> dict:
    """
    Boc khoi luong tu DXF -> dict (JSON serializable).

    Returns:
        {
            "dxf_file": str,
            "units": "mm" | "m",
            "total_floor_area_m2": float,
            "floors_detected": int,
            "bbox": {...},
            "layers": {
                "TUONG-220": {entity_type, count, length_m, area_m2, volume_m3, ...},
                ...
            },
            "warnings": [...]
        }
    """
    p = Path(dxf_path)
    if not p.exists():
        raise FileNotFoundError(f"DXF khong ton tai: {dxf_path}")

    doc = ezdxf.readfile(str(p))
    units = detect_units(doc)
    msp = doc.modelspace()

    layers: dict[str, LayerQuantity] = {}
    warnings: list[str] = []

    # BBOX toan model — compute tu entities (header $EXTMIN co the chua reset)
    min_x, min_y, max_x, max_y = float("inf"), float("inf"), float("-inf"), float("-inf")
    for entity in msp:
        try:
            etype = entity.dxftype()
            if etype == "LWPOLYLINE":
                for v in entity.vertices():
                    min_x = min(min_x, v[0])
                    min_y = min(min_y, v[1])
                    max_x = max(max_x, v[0])
                    max_y = max(max_y, v[1])
            elif etype == "LINE":
                s = entity.dxf.start
                e = entity.dxf.end
                min_x = min(min_x, s.x, e.x)
                min_y = min(min_y, s.y, e.y)
                max_x = max(max_x, s.x, e.x)
                max_y = max(max_y, s.y, e.y)
            elif etype == "CIRCLE":
                c = entity.dxf.center
                r = entity.dxf.radius
                min_x = min(min_x, c.x - r)
                min_y = min(min_y, c.y - r)
                max_x = max(max_x, c.x + r)
                max_y = max(max_y, c.y + r)
            elif etype == "POLYLINE":
                for v in entity.vertices:
                    p = v.dxf.location
                    min_x = min(min_x, p.x)
                    min_y = min(min_y, p.y)
                    max_x = max(max_x, p.x)
                    max_y = max(max_y, p.y)
        except Exception:
            pass

    if min_x == float("inf"):
        min_x = min_y = max_x = max_y = 0.0

    bbox = {
        "min_x": to_meters(min_x, units),
        "min_y": to_meters(min_y, units),
        "max_x": to_meters(max_x, units),
        "max_y": to_meters(max_y, units),
        "width": to_meters(max_x - min_x, units),
        "depth": to_meters(max_y - min_y, units),
    }

    # Detect floor count via text labels TANG 1, TANG 2, ...
    import re as _re
    floors_set: set[int] = set()
    for ent in msp.query("TEXT MTEXT"):
        try:
            txt = ent.dxf.text if ent.dxftype() == "TEXT" else ent.text
            m = _re.search(r"TANG\s*(\d+)", txt.upper())
            if m:
                floors_set.add(int(m.group(1)))
        except Exception:
            pass
    floors_detected = max(1, len(floors_set))

    # Extract per-layer
    total_floor_area = 0.0

    for entity in msp:
        try:
            layer_name = entity.dxf.layer
            etype = classify_layer(layer_name)

            if layer_name not in layers:
                layers[layer_name] = LayerQuantity(
                    layer=layer_name,
                    entity_type=etype,
                )

            lq = layers[layer_name]
            handle = entity.dxf.handle
            dxftype = entity.dxftype()

            # ----- WALL: tinh chu vi -> volume = perimeter * thickness * height -----
            if etype == "wall":
                length = polyline_length(entity)
                if length > 0:
                    lq.length_m += to_meters(length, units)
                    thickness = parse_wall_thickness(layer_name)
                    height = 3000.0  # default 3m, user override
                    vol = (
                        to_meters(length, units)
                        * (thickness / 1000.0)
                        * (height / 1000.0)
                    )
                    lq.volume_m3 += vol
                    lq.meta["thickness_mm"] = thickness
                    lq.meta["assumed_height_mm"] = height
                lq.handles.append(handle)

            # ----- COLUMN: count INSERT/CIRCLE/closed-poly -----
            elif etype == "column":
                lq.count += 1
                w_mm, d_mm = parse_column_size(layer_name)
                # Assumed floor height 3.5m
                vol = (w_mm / 1000.0) * (d_mm / 1000.0) * 3.5
                lq.volume_m3 += vol
                lq.meta["section_w_mm"] = w_mm
                lq.meta["section_d_mm"] = d_mm
                lq.meta["assumed_height_m"] = 3.5
                lq.handles.append(handle)

            # ----- BEAM: line/poly -> length * cross-section -----
            elif etype == "beam":
                length = polyline_length(entity)
                if length > 0:
                    lq.length_m += to_meters(length, units)
                    w_mm, d_mm = 220.0, 400.0  # default
                    if "X" in layer_name.upper():
                        w_mm, d_mm = parse_column_size(layer_name)
                    vol = (
                        to_meters(length, units)
                        * (w_mm / 1000.0)
                        * (d_mm / 1000.0)
                    )
                    lq.volume_m3 += vol
                    lq.meta.setdefault("section_w_mm", w_mm)
                    lq.meta.setdefault("section_d_mm", d_mm)
                lq.handles.append(handle)

            # ----- SLAB: closed polyline -> area * thickness -----
            elif etype == "slab":
                area = polyline_area(entity)
                if area > 0:
                    a_m2 = (
                        area / 1_000_000.0 if units == "mm" else area
                    )
                    lq.area_m2 += a_m2
                    thickness = parse_slab_thickness(layer_name)
                    lq.volume_m3 += a_m2 * (thickness / 1000.0)
                    lq.meta["thickness_mm"] = thickness
                    total_floor_area += a_m2
                lq.handles.append(handle)

            # ----- FLOOR/WALL TILE, MARBLE, WOOD, PAINT, CEILING -> AREA -----
            elif etype in ("floor_tile", "wall_tile", "paint", "ceiling"):
                area = polyline_area(entity)
                if area > 0:
                    a_m2 = (
                        area / 1_000_000.0 if units == "mm" else area
                    )
                    lq.area_m2 += a_m2
                lq.handles.append(handle)

            # ----- DOOR / WINDOW: count + estimate area -----
            elif etype in ("door", "window"):
                lq.count += 1
                # Assume door 0.9x2.2 = 1.98m2, window 1.2x1.4 = 1.68m2
                if etype == "door":
                    lq.area_m2 += 1.98
                else:
                    lq.area_m2 += 1.68
                lq.handles.append(handle)

            # ----- LIGHT / SOCKET / SWITCH / AC -> count INSERT/POINT -----
            elif etype in ("light", "socket", "switch", "ac"):
                if dxftype in ("INSERT", "POINT", "CIRCLE"):
                    lq.count += 1
                else:
                    # Polyline -> approximate by points
                    lq.count += 1
                lq.handles.append(handle)

            # ----- PIPE / WIRE -> length -----
            elif etype in ("pipe", "wire"):
                length = polyline_length(entity)
                if length > 0:
                    lq.length_m += to_meters(length, units)
                lq.handles.append(handle)

            # ----- GLASS / RAILING -> area or length -----
            elif etype == "glass":
                area = polyline_area(entity)
                if area > 0:
                    a_m2 = (
                        area / 1_000_000.0 if units == "mm" else area
                    )
                    lq.area_m2 += a_m2
                lq.handles.append(handle)

            elif etype == "railing":
                length = polyline_length(entity)
                if length > 0:
                    lq.length_m += to_meters(length, units)
                lq.handles.append(handle)

            elif etype == "foundation":
                lq.count += 1
                length = polyline_length(entity)
                if length > 0:
                    lq.length_m += to_meters(length, units)
                lq.handles.append(handle)

            else:
                # Other layers -> just count
                lq.handles.append(handle)

        except Exception as ex:
            warnings.append(
                f"Skip entity {getattr(entity, 'dxftype', lambda: '?')()} "
                f"on layer {getattr(entity.dxf, 'layer', '?')}: {ex}"
            )

    # Total floor area: neu khong detect duoc tu SLAB -> uoc tinh tu bbox * floors
    if total_floor_area < 1.0:
        total_floor_area = bbox["width"] * bbox["depth"] * floors_detected * 0.7

    # Subtract door/window area tu wall volume
    door_window_area = 0.0
    for lq in layers.values():
        if lq.entity_type in ("door", "window"):
            door_window_area += lq.area_m2

    if door_window_area > 0:
        for lq in layers.values():
            if lq.entity_type == "wall" and lq.volume_m3 > 0:
                # Approximate: tru ~5% the tich tuong cho cua/o thoang
                deduction = min(lq.volume_m3 * 0.10, door_window_area * 0.22)
                lq.volume_m3 = max(0.0, lq.volume_m3 - deduction)
                lq.meta["door_window_deduction_m3"] = round(deduction, 3)

    result = ExtractResult(
        dxf_file=str(p.absolute()),
        units=units,
        total_floor_area_m2=total_floor_area,
        floors_detected=floors_detected,
        layers=layers,
        warnings=warnings,
        bbox=bbox,
    )
    return result.to_dict()


# ============================================================
# CLI
# ============================================================
if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python extract.py <path/to/file.dxf>")
        sys.exit(1)
    out = extract_quantities(sys.argv[1])
    print(json.dumps(out, indent=2, ensure_ascii=False))
