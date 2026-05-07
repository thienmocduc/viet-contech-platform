"""
ifc_generator.py — BIM 3D Generator cho Viet-Contech AI Design Platform
=======================================================================

Sinh file IFC 4 (ISO 16739-1:2018) tu cac tham so element (wall/column/slab/
door/window/stair). Dung `ifcopenshell` neu cai duoc, neu khong fallback
sang JSON-IFC (cung schema) de pipeline khong bi block.

API public (su dung tu `from_dxf.py`, `node-bridge`, hoac CLI):
    g = BIMGenerator(project_meta={"name": "Nha pho 80m2", ...})
    wall_guid = g.add_wall(x=0, y=0, z=0, length_mm=4000, height_mm=3300,
                           thickness_mm=200, material="brick_220")
    g.add_door(wall_guid, x_offset_mm=1500, w_mm=900, h_mm=2100, type="single")
    g.add_window(wall_guid, x_offset_mm=2700, w_mm=1200, h_mm=1500, sill_mm=900)
    g.add_column(...); g.add_slab(...); g.add_stair(...)
    out_path = g.export("/abs/path/output.ifc")

Moi element duoc gan UUID v4 GUID + IFC class chuan + material name +
geometry XYZ (mm). State noi bo luu vao `g.elements` (list[Element]) de
clash_detection.py va auto_resolve.py truy van mot cach toi gian.

Hard rules (theo dna_prompt bim_modeler):
    - Don vi MM (millimet) tuyet doi.
    - GUID UUID v4 — duy nhat trong file.
    - IFC 4 standard, KHONG dung IFC 2x3.
    - Khi fallback JSON-IFC: schema giu nguyen field name, viewer code 1 lan.
"""

from __future__ import annotations

import json
import os
import time
import uuid
from dataclasses import dataclass, field, asdict
from typing import Any, Optional

# Co gang import ifcopenshell, fallback ve JSON-IFC neu khong co
try:
    import ifcopenshell  # type: ignore
    import ifcopenshell.api  # type: ignore

    _IFCOS_AVAILABLE = True
except Exception:
    ifcopenshell = None  # type: ignore
    _IFCOS_AVAILABLE = False


# ============================================================
# Element model — dung cho ca real-IFC va JSON-IFC fallback
# ============================================================
@dataclass
class Element:
    """Mot phan tu BIM bat ky. Geometry don vi MM."""

    guid: str
    type: str  # wall|column|beam|slab|door|window|stair|roof|...
    ifc_class: str  # IfcWall|IfcColumn|IfcSlab|...
    name: str
    material: str
    geometry: dict[str, Any]
    parent_guid: Optional[str] = None
    properties: dict[str, Any] = field(default_factory=dict)


# ============================================================
# Helpers
# ============================================================
def _new_guid() -> str:
    """UUID v4 chuan, hex 32-char + dash. IFC chap nhan 22-char base64
    nhung pipeline cua minh dung dang co dau gach noi cho de debug."""
    return str(uuid.uuid4())


def _box_volume_mm3(w: float, d: float, h: float) -> float:
    return float(w) * float(d) * float(h)


# ============================================================
# BIMGenerator
# ============================================================
class BIMGenerator:
    """Sinh IFC 4 file tu API tuong minh.

    project_meta:
        name        : ten du an
        site        : ten cong truong (vd "Lo 12 KDT ABC")
        building    : ten toa nha (vd "Nha A")
        north_deg   : huong Bac so voi truc Y (mac dinh 0)
        creator     : agent code (mac dinh "bim_modeler")
    """

    def __init__(self, project_meta: dict[str, Any]) -> None:
        self.meta: dict[str, Any] = {
            "name": project_meta.get("name", "Untitled"),
            "site": project_meta.get("site", "Site-1"),
            "building": project_meta.get("building", "Building-1"),
            "north_deg": float(project_meta.get("north_deg", 0)),
            "creator": project_meta.get("creator", "bim_modeler"),
            "schema": "IFC4",
            "created_at_unix": int(time.time()),
        }
        self.elements: list[Element] = []
        # Storage cho real ifcopenshell
        self._model: Any = None
        self._ifc_classes_emitted = 0

        if _IFCOS_AVAILABLE:
            self._model = ifcopenshell.api.run("project.create_file", schema="IFC4")
            ifcopenshell.api.run(
                "root.create_entity",
                self._model,
                ifc_class="IfcProject",
                name=self.meta["name"],
            )

    # ------------------------------------------------------------
    # Wall (IfcWallStandardCase)
    # ------------------------------------------------------------
    def add_wall(
        self,
        x: float,
        y: float,
        z: float,
        length_mm: float,
        height_mm: float,
        thickness_mm: float,
        material: str,
        rotation_deg: float = 0.0,
        load_bearing: bool = False,
    ) -> str:
        """Them tuong. Goc duoi-trai = (x,y,z); rotation_deg quanh truc Z."""
        guid = _new_guid()
        elem = Element(
            guid=guid,
            type="wall",
            ifc_class="IfcWallStandardCase",
            name=f"WALL-{guid[:8]}",
            material=material,
            geometry={
                "x_mm": float(x),
                "y_mm": float(y),
                "z_mm": float(z),
                "length_mm": float(length_mm),
                "height_mm": float(height_mm),
                "thickness_mm": float(thickness_mm),
                "rotation_deg": float(rotation_deg),
            },
            properties={
                "load_bearing": bool(load_bearing),
                "volume_mm3": _box_volume_mm3(length_mm, thickness_mm, height_mm),
            },
        )
        self.elements.append(elem)
        return guid

    # ------------------------------------------------------------
    # Column (IfcColumn)
    # ------------------------------------------------------------
    def add_column(
        self,
        x: float,
        y: float,
        z: float,
        w_mm: float,
        d_mm: float,
        h_mm: float,
        material: str,
    ) -> str:
        """Cot. Tiet dien w_mm x d_mm, cao h_mm. Min 200x200 theo TCVN 5574."""
        if min(w_mm, d_mm) < 200:
            raise ValueError(
                f"Cot tiet dien {w_mm}x{d_mm}mm < 200mm vi pham TCVN 5574:2018"
            )
        guid = _new_guid()
        elem = Element(
            guid=guid,
            type="column",
            ifc_class="IfcColumn",
            name=f"COL-{guid[:8]}",
            material=material,
            geometry={
                "x_mm": float(x),
                "y_mm": float(y),
                "z_mm": float(z),
                "w_mm": float(w_mm),
                "d_mm": float(d_mm),
                "h_mm": float(h_mm),
            },
            properties={
                "load_bearing": True,
                "volume_mm3": _box_volume_mm3(w_mm, d_mm, h_mm),
                "section": f"{int(w_mm)}x{int(d_mm)}",
            },
        )
        self.elements.append(elem)
        return guid

    # ------------------------------------------------------------
    # Slab (IfcSlab)
    # ------------------------------------------------------------
    def add_slab(
        self,
        polygon_points_mm: list[tuple[float, float]],
        thickness_mm: float,
        level: int,
        material: str,
        z_offset_mm: float = 0.0,
    ) -> str:
        """San. polygon_points_mm = list (x,y) closed polygon, z = level*h."""
        if len(polygon_points_mm) < 3:
            raise ValueError("Slab can it nhat 3 dinh polygon")
        guid = _new_guid()
        # Tinh dien tich (Shoelace) de check + tinh khoi luong BTCT
        area_mm2 = 0.0
        n = len(polygon_points_mm)
        for i in range(n):
            x1, y1 = polygon_points_mm[i]
            x2, y2 = polygon_points_mm[(i + 1) % n]
            area_mm2 += x1 * y2 - x2 * y1
        area_mm2 = abs(area_mm2) / 2.0

        elem = Element(
            guid=guid,
            type="slab",
            ifc_class="IfcSlab",
            name=f"SLAB-L{level}-{guid[:6]}",
            material=material,
            geometry={
                "polygon_mm": [list(p) for p in polygon_points_mm],
                "thickness_mm": float(thickness_mm),
                "level": int(level),
                "z_offset_mm": float(z_offset_mm),
            },
            properties={
                "area_mm2": area_mm2,
                "volume_mm3": area_mm2 * thickness_mm,
            },
        )
        self.elements.append(elem)
        return guid

    # ------------------------------------------------------------
    # Door (IfcDoor) — phai gan vao 1 wall_guid
    # ------------------------------------------------------------
    def add_door(
        self,
        wall_guid: str,
        x_offset_mm: float,
        w_mm: float,
        h_mm: float,
        type: str = "single",
    ) -> str:
        """Cua di. x_offset_mm tu goc trai cua wall theo huong length."""
        wall = self._find(wall_guid)
        if not wall or wall.type != "wall":
            raise ValueError(f"wall_guid {wall_guid} khong ton tai")
        if w_mm < 700 or h_mm < 1900:
            raise ValueError(
                f"Cua {w_mm}x{h_mm} qua nho (chuan PN 900x2100, WC 800x2100)"
            )

        guid = _new_guid()
        elem = Element(
            guid=guid,
            type="door",
            ifc_class="IfcDoor",
            name=f"DOOR-{type}-{guid[:6]}",
            material="wood_oak" if type != "main" else "wood_oak_solid",
            parent_guid=wall_guid,
            geometry={
                "wall_guid": wall_guid,
                "x_offset_mm": float(x_offset_mm),
                "w_mm": float(w_mm),
                "h_mm": float(h_mm),
                "z_mm": float(wall.geometry["z_mm"]),  # cua mo tu san
            },
            properties={
                "door_type": type,  # single|double|sliding|main|wc
                "opening_volume_mm3": _box_volume_mm3(
                    w_mm, wall.geometry["thickness_mm"], h_mm
                ),
            },
        )
        self.elements.append(elem)
        return guid

    # ------------------------------------------------------------
    # Window (IfcWindow)
    # ------------------------------------------------------------
    def add_window(
        self,
        wall_guid: str,
        x_offset_mm: float,
        w_mm: float,
        h_mm: float,
        sill_mm: float = 900.0,
    ) -> str:
        """Cua so. sill_mm = chieu cao tu san den canh duoi cua so."""
        wall = self._find(wall_guid)
        if not wall or wall.type != "wall":
            raise ValueError(f"wall_guid {wall_guid} khong ton tai")
        guid = _new_guid()
        elem = Element(
            guid=guid,
            type="window",
            ifc_class="IfcWindow",
            name=f"WIN-{guid[:8]}",
            material="aluminum_glass",
            parent_guid=wall_guid,
            geometry={
                "wall_guid": wall_guid,
                "x_offset_mm": float(x_offset_mm),
                "w_mm": float(w_mm),
                "h_mm": float(h_mm),
                "sill_mm": float(sill_mm),
                "z_mm": float(wall.geometry["z_mm"]) + float(sill_mm),
            },
            properties={
                "opening_volume_mm3": _box_volume_mm3(
                    w_mm, wall.geometry["thickness_mm"], h_mm
                ),
            },
        )
        self.elements.append(elem)
        return guid

    # ------------------------------------------------------------
    # Stair (IfcStair)
    # ------------------------------------------------------------
    def add_stair(
        self,
        x: float,
        y: float,
        z: float,
        run_length_mm: float,
        width_mm: float,
        total_rise_mm: float,
        riser_count: int,
        material: str = "concrete_b25",
    ) -> str:
        """Cau thang 1 ve. TCVN 4451: 2h+b=600-630mm, h=150-180mm, b=270-300mm."""
        riser_h = total_rise_mm / max(riser_count, 1)
        tread_b = run_length_mm / max(riser_count - 1, 1)
        if not (150 <= riser_h <= 180):
            raise ValueError(f"Bac cau thang h={riser_h:.0f}mm vi pham TCVN 4451")
        if not (270 <= tread_b <= 300):
            raise ValueError(f"Bac cau thang b={tread_b:.0f}mm vi pham TCVN 4451")
        rule_2hb = 2 * riser_h + tread_b
        if not (600 <= rule_2hb <= 630):
            raise ValueError(f"2h+b={rule_2hb:.0f}mm vi pham TCVN 4451 [600-630]")

        guid = _new_guid()
        elem = Element(
            guid=guid,
            type="stair",
            ifc_class="IfcStair",
            name=f"STAIR-{guid[:8]}",
            material=material,
            geometry={
                "x_mm": float(x),
                "y_mm": float(y),
                "z_mm": float(z),
                "run_length_mm": float(run_length_mm),
                "width_mm": float(width_mm),
                "total_rise_mm": float(total_rise_mm),
                "riser_count": int(riser_count),
            },
            properties={
                "riser_h_mm": riser_h,
                "tread_b_mm": tread_b,
                "rule_2h_plus_b": rule_2hb,
                "volume_mm3": run_length_mm * width_mm * total_rise_mm * 0.5,
            },
        )
        self.elements.append(elem)
        return guid

    # ------------------------------------------------------------
    # Beam, MEP pipe (utility cho clash test)
    # ------------------------------------------------------------
    def add_beam(
        self,
        x: float,
        y: float,
        z: float,
        length_mm: float,
        w_mm: float,
        h_mm: float,
        material: str = "concrete_b25",
    ) -> str:
        guid = _new_guid()
        self.elements.append(
            Element(
                guid=guid,
                type="beam",
                ifc_class="IfcBeam",
                name=f"BEAM-{guid[:8]}",
                material=material,
                geometry={
                    "x_mm": float(x),
                    "y_mm": float(y),
                    "z_mm": float(z),
                    "length_mm": float(length_mm),
                    "w_mm": float(w_mm),
                    "h_mm": float(h_mm),
                },
                properties={
                    "load_bearing": True,
                    "volume_mm3": _box_volume_mm3(length_mm, w_mm, h_mm),
                },
            )
        )
        return guid

    def add_mep_pipe(
        self,
        x: float,
        y: float,
        z: float,
        length_mm: float,
        diameter_mm: float,
        material: str = "pvc",
        system: str = "water",
    ) -> str:
        """Ong MEP — dung de test clash voi cot/dam."""
        guid = _new_guid()
        self.elements.append(
            Element(
                guid=guid,
                type="other",
                ifc_class="IfcPipeSegment",
                name=f"PIPE-{system}-{guid[:6]}",
                material=material,
                geometry={
                    "x_mm": float(x),
                    "y_mm": float(y),
                    "z_mm": float(z),
                    "length_mm": float(length_mm),
                    "diameter_mm": float(diameter_mm),
                },
                properties={
                    "system": system,  # water|hvac|electrical|drainage
                    "install_phase": "before_concrete"
                    if system in ("water", "drainage")
                    else "after_concrete",
                    "volume_mm3": 3.14159
                    * (diameter_mm / 2.0) ** 2
                    * length_mm,
                },
            )
        )
        return guid

    # ------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------
    def _find(self, guid: str) -> Optional[Element]:
        for e in self.elements:
            if e.guid == guid:
                return e
        return None

    def count(self) -> int:
        return len(self.elements)

    def summary(self) -> dict[str, int]:
        out: dict[str, int] = {}
        for e in self.elements:
            out[e.type] = out.get(e.type, 0) + 1
        return out

    # ------------------------------------------------------------
    # Export — IFC4 file (real ifcopenshell hoac JSON-IFC fallback)
    # ------------------------------------------------------------
    def export(self, path: str) -> str:
        """Save .ifc file. Tra duong dan tuyet doi.
        Neu ifcopenshell co — dung IFC binary chuan.
        Neu khong — fallback JSON-IFC text format (cung schema, .ifc.json).
        """
        path = os.path.abspath(path)
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)

        if _IFCOS_AVAILABLE and self._model is not None:
            try:
                # Tao Site/Building/Storey co ban
                self._materialize_ifc()
                self._model.write(path)
                return path
            except Exception as e:
                # Neu loi runtime (vi du missing OCC), fallback
                print(f"[ifc_generator] ifcopenshell write loi: {e} -> fallback JSON")

        # Fallback: JSON-IFC
        json_path = path
        if not json_path.endswith(".json") and not json_path.endswith(".ifc.json"):
            json_path = path + ".json"
        payload: dict[str, Any] = {
            "schema": "IFC4-JSON-FALLBACK",
            "meta": self.meta,
            "elements": [asdict(e) for e in self.elements],
            "summary": self.summary(),
        }
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        return json_path

    def _materialize_ifc(self) -> None:
        """Phun cac element vao self._model dung ifcopenshell.api.
        Hien tai chi tao entity tag — geometric BREP de vong sau khi co OCC.
        """
        if not _IFCOS_AVAILABLE:
            return
        for e in self.elements:
            try:
                ifcopenshell.api.run(
                    "root.create_entity",
                    self._model,
                    ifc_class=e.ifc_class,
                    name=e.name,
                )
                self._ifc_classes_emitted += 1
            except Exception:
                # Mot so IFC class chua duoc ifcopenshell.api ho tro -> bo qua
                continue


# ============================================================
# CLI quick test: python ifc_generator.py
# ============================================================
if __name__ == "__main__":
    g = BIMGenerator({"name": "Smoke test 1 phong"})
    w1 = g.add_wall(0, 0, 0, 4000, 3300, 200, "brick_220")
    g.add_door(w1, 1500, 900, 2100, "single")
    g.add_window(w1, 2700, 1200, 1500, 900)
    g.add_column(0, 0, 0, 220, 220, 3300, "concrete_b25")
    g.add_slab([(0, 0), (4000, 0), (4000, 3000), (0, 3000)], 150, 1, "concrete_b25")
    out = g.export("./smoke_test.ifc")
    print(f"OK total={g.count()} summary={g.summary()} -> {out}")
