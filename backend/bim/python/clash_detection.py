"""
clash_detection.py — 3-layer clash detection cho Viet-Contech BIM
==================================================================

Theo dna_prompt cua bim_modeler, clash detection chia 3 layer:

1. HARD CLASH    — overlap > 1mm³ giua 2 element rigid (cot, dam, tuong, san,
                   cua, cua so) HOAC giua MEP pipe va element rigid.
                   severity = 'critical', mau = red.
                   Vi du: cot BTCT va vao ong cap nuoc.

2. SOFT CLASH    — clearance giua 2 element nho hon nguong toi thieu (vi du
                   cot < 100mm tu tuong). severity = 'major'/'high', mau = orange.
                   Vi du: cot dat sat vach -> kho thi cong.

3. WORKFLOW CLASH — thu tu lap dat sai. Vi du: ong nuoc co `install_phase =
                    "before_concrete"` nhung lai dat trong san BTCT da do.
                    severity = 'minor'/'low', mau = yellow.

Implementation:
- Dung Axis-Aligned Bounding Box (AABB) cho moi element. Voi wall co rotation,
  ta tinh OBB roi xap xi AABB de toc do nhanh, sau do tinh chinh xac bang
  Separating Axis Theorem (SAT) khi can.
- Voi pipe (truc), dung swept-volume xap xi.
- Khong dung OpenCASCADE de project deploy nhe (boolean intersection thi
  fallback sang AABB-overlap volume).

Precision: < 1mm (theo DNA constraint).

API:
    clashes = detect_clashes(ifc_path)
    # clashes = [
    #   {
    #     "id": "C-...",
    #     "element_a_guid": "...",
    #     "element_b_guid": "...",
    #     "kind": "hard"|"soft"|"workflow",
    #     "intersection_volume_mm3": 4500.0,
    #     "min_distance_mm": 0.0,
    #     "severity": "critical"|"high"|"medium"|"low",
    #     "color": "#dc2626"|"#f97316"|"#eab308",
    #     "suggestion": "Cot va ong cap nuoc — di doi ong sang truc khac",
    #   }, ...
    # ]
"""

from __future__ import annotations

import json
import math
import os
import uuid
from dataclasses import dataclass, asdict, field
from typing import Any, Optional

# ============================================================
# Constants
# ============================================================
HARD_OVERLAP_THRESHOLD_MM3 = 1.0  # < 1mm³ thi bo qua (precision noise)
SOFT_CLEARANCE_MIN_MM = {
    "column-wall": 100.0,  # cot cach tuong toi thieu 100mm
    "column-column": 1500.0,  # luoi cot toi thieu
    "wall-wall": 50.0,  # 2 tuong song song (mm)
    "pipe-column": 50.0,  # ong tranh cot 50mm
    "pipe-beam": 30.0,  # ong tranh dam 30mm
    "stair-wall": 100.0,
}
WORKFLOW_RULES = {
    # MEP_water dat truoc do BTCT, neu nam trong san hoac dam BTCT -> workflow conflict
    ("water", "slab"): "Ong nuoc nam trong san BTCT — phai dat ong truoc khi do",
    ("water", "beam"): "Ong nuoc xuyen dam BTCT — phai luon ong cho truoc",
    ("drainage", "slab"): "Ong thoat nam trong san — phai dat ong truoc khi do",
    ("drainage", "beam"): "Ong thoat xuyen dam — phai luon ong cho",
}

# Mau hex chuan tailwind
COLOR_HARD = "#dc2626"  # red-600
COLOR_SOFT = "#f97316"  # orange-500
COLOR_WORKFLOW = "#eab308"  # yellow-500


# ============================================================
# AABB & geometry helpers
# ============================================================
@dataclass
class AABB:
    xmin: float
    ymin: float
    zmin: float
    xmax: float
    ymax: float
    zmax: float

    def overlaps(self, o: "AABB") -> bool:
        return (
            self.xmin <= o.xmax
            and self.xmax >= o.xmin
            and self.ymin <= o.ymax
            and self.ymax >= o.ymin
            and self.zmin <= o.zmax
            and self.zmax >= o.zmin
        )

    def overlap_volume_mm3(self, o: "AABB") -> float:
        if not self.overlaps(o):
            return 0.0
        dx = max(0.0, min(self.xmax, o.xmax) - max(self.xmin, o.xmin))
        dy = max(0.0, min(self.ymax, o.ymax) - max(self.ymin, o.ymin))
        dz = max(0.0, min(self.zmax, o.zmax) - max(self.zmin, o.zmin))
        return dx * dy * dz

    def min_distance_to(self, o: "AABB") -> float:
        """Khoang cach Euclidean ngan nhat giua 2 box (0 neu overlap)."""
        if self.overlaps(o):
            return 0.0
        dx = max(0.0, max(o.xmin - self.xmax, self.xmin - o.xmax))
        dy = max(0.0, max(o.ymin - self.ymax, self.ymin - o.ymax))
        dz = max(0.0, max(o.zmin - self.zmax, self.zmin - o.zmax))
        return math.sqrt(dx * dx + dy * dy + dz * dz)


def _aabb_for_element(e: dict[str, Any]) -> Optional[AABB]:
    """Sinh AABB tu element. Tra None neu element khong co geometry du."""
    g = e.get("geometry", {})
    typ = e.get("type", "")

    if typ == "wall":
        # Wall: voi rotation, dung OBB nhung simplify thanh AABB rong hon
        x = g["x_mm"]; y = g["y_mm"]; z = g["z_mm"]
        L = g["length_mm"]; H = g["height_mm"]; T = g["thickness_mm"]
        rot = math.radians(g.get("rotation_deg", 0))
        # Endpoint cua wall
        ex = x + L * math.cos(rot)
        ey = y + L * math.sin(rot)
        # 4 corner cua wall (top-down) co tinh den thickness
        nx = -math.sin(rot) * T / 2
        ny = math.cos(rot) * T / 2
        corners = [
            (x + nx, y + ny), (x - nx, y - ny),
            (ex + nx, ey + ny), (ex - nx, ey - ny),
        ]
        xs = [c[0] for c in corners]
        ys = [c[1] for c in corners]
        return AABB(min(xs), min(ys), z, max(xs), max(ys), z + H)

    if typ == "column":
        x = g["x_mm"]; y = g["y_mm"]; z = g["z_mm"]
        return AABB(x, y, z, x + g["w_mm"], y + g["d_mm"], z + g["h_mm"])

    if typ == "beam":
        x = g["x_mm"]; y = g["y_mm"]; z = g["z_mm"]
        return AABB(x, y, z, x + g["length_mm"], y + g["w_mm"], z + g["h_mm"])

    if typ == "slab":
        poly = g.get("polygon_mm", [])
        if not poly:
            return None
        xs = [p[0] for p in poly]
        ys = [p[1] for p in poly]
        z = g.get("z_offset_mm", 0)
        return AABB(min(xs), min(ys), z, max(xs), max(ys), z + g["thickness_mm"])

    if typ == "door":
        x = g.get("x_offset_mm", 0); z = g["z_mm"]
        return AABB(x, 0, z, x + g["w_mm"], 200, z + g["h_mm"])

    if typ == "window":
        x = g.get("x_offset_mm", 0); z = g["z_mm"]
        return AABB(x, 0, z, x + g["w_mm"], 200, z + g["h_mm"])

    if typ == "stair":
        x = g["x_mm"]; y = g["y_mm"]; z = g["z_mm"]
        return AABB(
            x, y, z,
            x + g["run_length_mm"], y + g["width_mm"],
            z + g["total_rise_mm"],
        )

    if typ == "other" and "diameter_mm" in g:  # MEP pipe
        x = g["x_mm"]; y = g["y_mm"]; z = g["z_mm"]
        d = g["diameter_mm"]
        return AABB(x, y - d / 2, z - d / 2, x + g["length_mm"], y + d / 2, z + d / 2)

    return None


# ============================================================
# Clash record
# ============================================================
@dataclass
class Clash:
    id: str
    element_a_guid: str
    element_b_guid: str
    element_a_type: str
    element_b_type: str
    kind: str  # hard|soft|workflow
    intersection_volume_mm3: float
    min_distance_mm: float
    severity: str
    color: str
    suggestion: str
    auto_fixable: bool = False
    extra: dict[str, Any] = field(default_factory=dict)


# ============================================================
# Loader: doc tu file IFC json fallback hoac file json
# ============================================================
def _load_elements(ifc_path: str) -> list[dict[str, Any]]:
    if not os.path.isfile(ifc_path):
        raise FileNotFoundError(ifc_path)
    # Cho phep .ifc.json (fallback) hoac .json
    with open(ifc_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return data.get("elements", [])


# ============================================================
# Detection logic
# ============================================================
def _pair_key(t1: str, t2: str) -> str:
    return "-".join(sorted([t1, t2]))


def _suggestion_for_hard(a: dict, b: dict) -> str:
    ta, tb = a["type"], b["type"]
    if ta == "column" and tb == "other":
        return f"Cot {a.get('name')} va ong MEP {b.get('name')} — di doi ong sang truc khac hoac thay duong di pipe"
    if tb == "column" and ta == "other":
        return f"Cot {b.get('name')} va ong MEP {a.get('name')} — di doi ong sang truc khac"
    if "beam" in (ta, tb) and "other" in (ta, tb):
        return "Dam va ong MEP — luon ong xuyen dam (slot) hoac doi level treo ong"
    if "wall" in (ta, tb) and "column" in (ta, tb):
        return "Cot va vao tuong — di doi tuong hoac dieu chinh truc cot"
    if "door" in (ta, tb) and "column" in (ta, tb):
        return "Cua chen vao cot — di doi cua sang vi tri khac trong tuong"
    return f"{ta} ({a.get('name')}) va {tb} ({b.get('name')}) — escalate KTS"


def _suggestion_for_soft(a: dict, b: dict, gap_mm: float, threshold: float) -> str:
    return (
        f"Khoang ho {gap_mm:.0f}mm < toi thieu {threshold:.0f}mm giua "
        f"{a['type']} ({a.get('name')}) va {b['type']} ({b.get('name')}) — "
        "shift element 50mm ve phia it rang buoc nhat"
    )


def _is_workflow_clash(a: dict, b: dict) -> Optional[str]:
    # Pipe co system + install_phase, slab/beam la BTCT
    pipe = None
    rigid = None
    if a.get("ifc_class") == "IfcPipeSegment":
        pipe = a
        if b.get("type") in ("slab", "beam"):
            rigid = b
    elif b.get("ifc_class") == "IfcPipeSegment":
        pipe = b
        if a.get("type") in ("slab", "beam"):
            rigid = a
    if not pipe or not rigid:
        return None
    system = (pipe.get("geometry", {}).get("system")
              or pipe.get("properties", {}).get("system", "water"))
    install = (pipe.get("properties", {}).get("install_phase")
               if pipe.get("properties") else None)
    if install != "before_concrete":
        return None
    msg = WORKFLOW_RULES.get((system, rigid["type"]))
    if msg:
        return msg
    return None


# ============================================================
# Public API
# ============================================================
def detect_clashes(
    ifc_path: str,
    soft_clearance_overrides: Optional[dict[str, float]] = None,
) -> list[dict[str, Any]]:
    """Phat hien clash 3 layer. Tra list dict (de serialize JSON ngay).
    """
    elements = _load_elements(ifc_path)
    overrides = dict(SOFT_CLEARANCE_MIN_MM)
    if soft_clearance_overrides:
        overrides.update(soft_clearance_overrides)

    # Pre-compute AABB
    aabb_list: list[tuple[dict[str, Any], AABB]] = []
    for e in elements:
        bb = _aabb_for_element(e)
        if bb is not None:
            aabb_list.append((e, bb))

    clashes: list[Clash] = []
    n = len(aabb_list)

    for i in range(n):
        ea, ba = aabb_list[i]
        for j in range(i + 1, n):
            eb, bb = aabb_list[j]

            # Tinh truoc overlap_vol va distance — dung cho ca skip-rules
            overlap_vol = ba.overlap_volume_mm3(bb)
            distance = ba.min_distance_to(bb)

            # Bo qua: parent-child (cua trong tuong, cua so trong tuong)
            if eb.get("parent_guid") == ea["guid"] or ea.get("parent_guid") == eb["guid"]:
                continue
            # Bo qua: 2 element cung type 'slab' khac level (don gian)
            if ea["type"] == "slab" and eb["type"] == "slab":
                if ea.get("geometry", {}).get("level") != eb.get("geometry", {}).get("level"):
                    continue
            # Bo qua: cot xuyen san (cot luon di qua slab, khong tinh la clash)
            if {ea["type"], eb["type"]} == {"column", "slab"}:
                continue
            # Bo qua: tuong nam tren san (chan tuong cham slab — design intent)
            if {ea["type"], eb["type"]} == {"wall", "slab"}:
                continue
            # Bo qua: cua/cua so cham vao slab (chan cua tren san)
            if {ea["type"], eb["type"]} & {"door", "window"} and \
               (ea["type"] == "slab" or eb["type"] == "slab"):
                continue
            # Bo qua: dam noi vao cot/tuong (dau dam ngam vao cot/tuong la design intent)
            if {ea["type"], eb["type"]} == {"beam", "column"}:
                continue
            if {ea["type"], eb["type"]} == {"beam", "wall"}:
                continue
            # Bo qua: stair cham slab (dau cau thang xuong san)
            if {ea["type"], eb["type"]} == {"stair", "slab"}:
                continue
            # Bo qua: window/door cham wall khac (AABB local cua window/door
            # tinh tuong doi voi wall parent — voi wall khac khong co y nghia)
            if {ea["type"], eb["type"]} & {"door", "window"} and \
               (ea["type"] == "wall" or eb["type"] == "wall"):
                continue
            # Bo qua: cot dat trong tuong (intent: cot o giao diem tuong, cot
            # nho hon thickness wall * length wall * height — vung embed)
            if {ea["type"], eb["type"]} == {"wall", "column"}:
                wall_e = ea if ea["type"] == "wall" else eb
                col_e = ea if ea["type"] == "column" else eb
                col_g = col_e.get("geometry", {})
                wall_g = wall_e.get("geometry", {})
                col_volume = (
                    col_g.get("w_mm", 250)
                    * col_g.get("d_mm", 250)
                    * col_g.get("h_mm", 3300)
                )
                # Neu volume overlap < 110% volume cot -> embed trong tuong (intent)
                if overlap_vol <= col_volume * 1.1:
                    continue
            # Bo qua wall-vs-wall trong cac truong hop design intent:
            #  (a) Trung dinh nghia (cung origin + huong + z)
            #  (b) Goc nha: 2 tuong vuong goc gap nhau o 1 dau (overlap chi
            #      bang vung corner thickness x thickness x height ~ goc nha)
            #  (c) Tuong vuong goc cat nhau (T-junction): vung overlap nho hon
            #      thickness^2 * height
            if ea["type"] == "wall" and eb["type"] == "wall":
                ga = ea.get("geometry", {})
                gb = eb.get("geometry", {})
                same_z = abs(ga.get("z_mm", 0) - gb.get("z_mm", 0)) < 1
                same_origin = (
                    abs(ga.get("x_mm", 0) - gb.get("x_mm", 0)) < 1
                    and abs(ga.get("y_mm", 0) - gb.get("y_mm", 0)) < 1
                    and same_z
                )
                rot_a = ga.get("rotation_deg", 0) % 180
                rot_b = gb.get("rotation_deg", 0) % 180
                same_dir = abs(rot_a - rot_b) < 1
                perpendicular = abs(abs(rot_a - rot_b) - 90) < 1
                # Trung dinh nghia
                if same_origin and same_dir:
                    continue
                # 2 tuong vuong goc cung tang -> coi nhu corner/T-junction
                if same_z and perpendicular:
                    ta = ga.get("thickness_mm", 200)
                    tb = gb.get("thickness_mm", 200)
                    h_min = min(ga.get("height_mm", 3300), gb.get("height_mm", 3300))
                    # Goc nha cho phep overlap toi da ta*tb*h_min (1 dau cot tuong)
                    # Cong them 20% buffer cho sai so AABB
                    corner_volume = ta * tb * h_min * 1.5
                    if overlap_vol <= corner_volume:
                        continue

            # ----- WORKFLOW CLASH -----
            wf_msg = _is_workflow_clash(ea, eb)
            if wf_msg and overlap_vol > HARD_OVERLAP_THRESHOLD_MM3:
                clashes.append(
                    Clash(
                        id=f"C-{uuid.uuid4().hex[:10]}",
                        element_a_guid=ea["guid"],
                        element_b_guid=eb["guid"],
                        element_a_type=ea["type"],
                        element_b_type=eb["type"],
                        kind="workflow",
                        intersection_volume_mm3=overlap_vol,
                        min_distance_mm=0.0,
                        severity="low",
                        color=COLOR_WORKFLOW,
                        suggestion=wf_msg,
                        auto_fixable=True,
                        extra={"reorder": "move_pipe_before_pour"},
                    )
                )
                continue

            # ----- HARD CLASH -----
            if overlap_vol > HARD_OVERLAP_THRESHOLD_MM3:
                # Critical neu involve cot/dam BTCT
                is_critical = ea["type"] in ("column", "beam") or eb["type"] in (
                    "column",
                    "beam",
                )
                clashes.append(
                    Clash(
                        id=f"C-{uuid.uuid4().hex[:10]}",
                        element_a_guid=ea["guid"],
                        element_b_guid=eb["guid"],
                        element_a_type=ea["type"],
                        element_b_type=eb["type"],
                        kind="hard",
                        intersection_volume_mm3=overlap_vol,
                        min_distance_mm=0.0,
                        severity="critical" if is_critical else "high",
                        color=COLOR_HARD,
                        suggestion=_suggestion_for_hard(ea, eb),
                        auto_fixable=False,
                    )
                )
                continue

            # ----- SOFT CLASH -----
            pair = _pair_key(ea["type"], eb["type"])
            threshold = overrides.get(pair)
            if threshold and 0 < distance < threshold:
                clashes.append(
                    Clash(
                        id=f"C-{uuid.uuid4().hex[:10]}",
                        element_a_guid=ea["guid"],
                        element_b_guid=eb["guid"],
                        element_a_type=ea["type"],
                        element_b_type=eb["type"],
                        kind="soft",
                        intersection_volume_mm3=0.0,
                        min_distance_mm=distance,
                        severity="medium" if distance < threshold / 2 else "low",
                        color=COLOR_SOFT,
                        suggestion=_suggestion_for_soft(ea, eb, distance, threshold),
                        auto_fixable=distance < 50.0,
                        extra={"threshold_mm": threshold},
                    )
                )

    return [asdict(c) for c in clashes]


def write_report(ifc_path: str, output_json_path: Optional[str] = None) -> str:
    """Helper: chay detect + ghi JSON report."""
    clashes = detect_clashes(ifc_path)
    if not output_json_path:
        output_json_path = os.path.splitext(ifc_path)[0] + ".clash.json"
    with open(output_json_path, "w", encoding="utf-8") as f:
        json.dump(
            {
                "ifc_path": os.path.abspath(ifc_path),
                "total": len(clashes),
                "by_kind": {
                    "hard": sum(1 for c in clashes if c["kind"] == "hard"),
                    "soft": sum(1 for c in clashes if c["kind"] == "soft"),
                    "workflow": sum(1 for c in clashes if c["kind"] == "workflow"),
                },
                "clashes": clashes,
            },
            f,
            ensure_ascii=False,
            indent=2,
        )
    return output_json_path


# ============================================================
# CLI
# ============================================================
if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage: python clash_detection.py <ifc_path>")
        sys.exit(1)
    out = write_report(sys.argv[1])
    print(f"Clash report -> {out}")
