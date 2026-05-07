"""
auto_resolve.py — Auto-fix clash nho, escalate clash lon
=========================================================

Quy tac (theo dna_prompt bim_modeler):

- WORKFLOW CLASH    -> auto-fix bang re-order sequence (move ong truoc do
                       BTCT). Tra lai action "reorder" + new install_phase.
- SOFT CLASH        -> neu gap < 50mm, shift element 50mm ve phia it rang
                       buoc nhat (heuristic: huong khong co element khac).
                       Lon hon -> escalate.
- HARD CLASH        -> KHONG bao gio auto-fix. Escalate KTS chinh, tao
                       conflict record severity=critical.

Output: { "fixed": [...], "escalated": [...], "actions": [...] }
"""

from __future__ import annotations

import json
import math
import os
import uuid
from typing import Any, Optional


SHIFT_DEFAULT_MM = 50.0


# ============================================================
# Helpers
# ============================================================
def _load_ifc_json(ifc_path: str) -> dict[str, Any]:
    with open(ifc_path, "r", encoding="utf-8") as f:
        return json.load(f)


def _save_ifc_json(payload: dict[str, Any], path: str) -> str:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    return path


def _find_element(elements: list[dict[str, Any]], guid: str) -> Optional[dict[str, Any]]:
    for e in elements:
        if e["guid"] == guid:
            return e
    return None


def _shift_element(elem: dict[str, Any], dx: float, dy: float, dz: float = 0.0) -> None:
    """Dich element theo (dx, dy, dz) mm. Mutate in-place."""
    g = elem.setdefault("geometry", {})
    if "x_mm" in g:
        g["x_mm"] = float(g["x_mm"]) + dx
    if "y_mm" in g:
        g["y_mm"] = float(g["y_mm"]) + dy
    if "z_mm" in g:
        g["z_mm"] = float(g["z_mm"]) + dz
    if "polygon_mm" in g:
        g["polygon_mm"] = [[p[0] + dx, p[1] + dy] for p in g["polygon_mm"]]


def _least_constrained_direction(
    elem: dict[str, Any], all_elements: list[dict[str, Any]]
) -> tuple[float, float]:
    """Tra (dx, dy) chuan hoa, huong it rang buoc nhat. Heuristic:
    dem so element trong 4 huong (bot 4 boi cot/tuong) -> chon huong it nhat.
    """
    g = elem.get("geometry", {})
    cx = g.get("x_mm", 0)
    cy = g.get("y_mm", 0)
    counts = {"+x": 0, "-x": 0, "+y": 0, "-y": 0}
    for other in all_elements:
        if other["guid"] == elem["guid"]:
            continue
        og = other.get("geometry", {})
        ox = og.get("x_mm")
        oy = og.get("y_mm")
        if ox is None or oy is None:
            continue
        if abs(ox - cx) > abs(oy - cy):
            counts["+x" if ox > cx else "-x"] += 1
        else:
            counts["+y" if oy > cy else "-y"] += 1
    best = min(counts, key=lambda k: counts[k])
    return {"+x": (1.0, 0.0), "-x": (-1.0, 0.0), "+y": (0.0, 1.0), "-y": (0.0, -1.0)}[best]


# ============================================================
# Resolvers
# ============================================================
def resolve_workflow(
    clash: dict[str, Any], elements: list[dict[str, Any]]
) -> Optional[dict[str, Any]]:
    """Re-order: doi install_phase cua pipe sang 'before_concrete' va danh
    dau sequence step. Tra action dict.
    """
    pipe = (
        _find_element(elements, clash["element_a_guid"])
        if (
            _find_element(elements, clash["element_a_guid"])
            and _find_element(elements, clash["element_a_guid"]).get("ifc_class")
            == "IfcPipeSegment"
        )
        else _find_element(elements, clash["element_b_guid"])
    )
    if not pipe:
        return None
    pipe.setdefault("properties", {})
    pipe["properties"]["install_phase"] = "before_concrete"
    pipe["properties"]["sequence_step"] = "MEP-pour-prepare"
    return {
        "action": "reorder_workflow",
        "clash_id": clash["id"],
        "pipe_guid": pipe["guid"],
        "set_install_phase": "before_concrete",
        "note": clash["suggestion"],
    }


def resolve_soft(
    clash: dict[str, Any], elements: list[dict[str, Any]]
) -> Optional[dict[str, Any]]:
    """Shift element 50mm ve phia it rang buoc nhat. Tra action dict."""
    if not clash.get("auto_fixable"):
        return None
    a = _find_element(elements, clash["element_a_guid"])
    b = _find_element(elements, clash["element_b_guid"])
    if not a or not b:
        return None

    # Chon element it quan trong de shift: pipe > door > window > wall > beam > column > slab
    priority = {
        "other": 1,
        "door": 2,
        "window": 3,
        "wall": 4,
        "stair": 5,
        "beam": 6,
        "column": 7,
        "slab": 8,
    }
    if priority.get(a["type"], 0) <= priority.get(b["type"], 0):
        target, partner = a, b
    else:
        target, partner = b, a

    dx_unit, dy_unit = _least_constrained_direction(target, elements)
    shift = SHIFT_DEFAULT_MM
    _shift_element(target, dx_unit * shift, dy_unit * shift, 0)
    return {
        "action": "shift_element",
        "clash_id": clash["id"],
        "target_guid": target["guid"],
        "shift_mm": [dx_unit * shift, dy_unit * shift, 0],
        "partner_guid": partner["guid"],
        "note": clash["suggestion"],
    }


def escalate_hard(clash: dict[str, Any]) -> dict[str, Any]:
    """Khong fix, tao conflict escalation cho KTS chinh."""
    return {
        "action": "escalate_kts",
        "clash_id": clash["id"],
        "severity": "critical",
        "reason": "Hard clash giua element rigid (cot/dam/tuong) — can quyet dinh KTS",
        "ticket_id": f"KTS-{uuid.uuid4().hex[:8]}",
        "note": clash["suggestion"],
    }


# ============================================================
# Main resolver
# ============================================================
def auto_resolve(
    ifc_path: str,
    clashes: list[dict[str, Any]],
    output_ifc_path: Optional[str] = None,
) -> dict[str, Any]:
    """
    Duyet list clash, fix tu dong cai nao co the, escalate cai nao khong.
    Ghi file IFC moi (sau khi shift element).

    Returns:
        {
          "fixed": [actions...],
          "escalated": [actions...],
          "ifc_path_after": "...",
        }
    """
    payload = _load_ifc_json(ifc_path)
    elements = payload.get("elements", [])

    fixed: list[dict[str, Any]] = []
    escalated: list[dict[str, Any]] = []

    for c in clashes:
        kind = c.get("kind")
        if kind == "workflow":
            act = resolve_workflow(c, elements)
            if act:
                fixed.append(act)
            else:
                escalated.append(escalate_hard(c))
        elif kind == "soft":
            act = resolve_soft(c, elements)
            if act:
                fixed.append(act)
            else:
                escalated.append(
                    {
                        "action": "escalate_kts",
                        "clash_id": c["id"],
                        "severity": c.get("severity", "medium"),
                        "reason": "Soft clash voi gap >= 50mm — can review thu cong",
                        "note": c.get("suggestion", ""),
                    }
                )
        elif kind == "hard":
            escalated.append(escalate_hard(c))
        else:
            escalated.append(
                {
                    "action": "unknown_clash",
                    "clash_id": c.get("id"),
                    "raw": c,
                }
            )

    # Ghi file IFC sau khi fix
    out_path = output_ifc_path or os.path.splitext(ifc_path)[0] + ".resolved.json"
    _save_ifc_json(payload, out_path)

    return {
        "fixed": fixed,
        "escalated": escalated,
        "ifc_path_after": out_path,
        "total_fixed": len(fixed),
        "total_escalated": len(escalated),
    }


# ============================================================
# CLI: python auto_resolve.py <ifc_path> <clash_report_path>
# ============================================================
if __name__ == "__main__":
    import sys

    if len(sys.argv) < 3:
        print("Usage: python auto_resolve.py <ifc_path> <clash_report.json>")
        sys.exit(1)
    ifc = sys.argv[1]
    with open(sys.argv[2], "r", encoding="utf-8") as f:
        report = json.load(f)
    res = auto_resolve(ifc, report.get("clashes", []))
    print(
        f"Auto-resolve: fixed={res['total_fixed']} escalated={res['total_escalated']}"
        f" -> {res['ifc_path_after']}"
    )
