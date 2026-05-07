"""
boq_generator.py - Tao BOQ tu quantities + price_db
====================================================
Tu output cua extract.py + price_db.py -> tao BOQ chuan TT06/2021/TT-BXD:
- 3 sheet: Phan tho / Hoan thien / Noi that (+ MEP gop noi that)
- Cot: STT, Ma, Mo ta, DVT, KL, Hao hut %, KL du toan, Don gia, Thanh tien
- Tong cong + VAT 8% + QLP 5% + Du phong 10%
"""
from __future__ import annotations

import json
import sys
from dataclasses import dataclass, field
from typing import Any, TypedDict

from price_db import (
    Material,
    MATERIALS,
    LAYER_TO_MATERIAL,
    get_material,
    get_material_by_layer,
    materials_by_category,
)


# ============================================================
# DATA TYPES
# ============================================================
class BOQItem(TypedDict):
    stt: int
    code: str
    description: str
    unit: str
    quantity: float
    wastage_pct: float
    quantity_with_wastage: float
    unit_price_vnd: int
    total_vnd: int
    material_id: str
    source_layer: str
    source_handles: list[str]


class BOQSheet(TypedDict):
    name: str  # 'Phan tho' | 'Hoan thien' | 'Noi that'
    category: str
    items: list[BOQItem]
    subtotal_vnd: int


class BOQReport(TypedDict):
    project_meta: dict[str, Any]
    sheets: list[BOQSheet]
    summary: dict[str, int]
    grand_total_vnd: int


# ============================================================
# QUANTITY CALCULATIONS PER LAYER
# ============================================================
def compute_quantity(layer_name: str, layer_data: dict, project_meta: dict) -> tuple[float, str]:
    """
    Tu LayerQuantity dict -> (quantity, unit) phu hop voi material.
    Convert: volume_m3, area_m2, length_m, count -> material unit.
    """
    etype = layer_data.get("entity_type", "other")
    count = layer_data.get("count", 0)
    length = layer_data.get("length_m", 0.0)
    area = layer_data.get("area_m2", 0.0)
    volume = layer_data.get("volume_m3", 0.0)
    meta = layer_data.get("meta", {})

    floors = max(1, project_meta.get("floors", 1))
    floor_area = max(1.0, project_meta.get("total_floor_area_m2", 0.0))

    if etype == "wall":
        # m3 cho gach AAC; neu khong co volume thi tinh tu length * 0.22 * 3
        if volume > 0:
            return volume, "m3"
        return length * 0.22 * 3.0, "m3"

    if etype == "column":
        if volume > 0:
            return volume, "m3"
        return count * 0.22 * 0.3 * 3.5, "m3"

    if etype == "beam":
        if volume > 0:
            return volume, "m3"
        return length * 0.22 * 0.4, "m3"

    if etype == "slab":
        # Reinforced concrete slab: m3
        if volume > 0:
            return volume, "m3"
        thickness = meta.get("thickness_mm", 150) / 1000.0
        return area * thickness, "m3"

    if etype == "foundation":
        # Coc ep -> m
        if length > 0:
            return length, "m"
        return count * 12.0, "m"  # 12m/coc default

    if etype in ("floor_tile", "wall_tile"):
        # m2 lat
        if area > 0:
            return area, "m2"
        # Estimate from total floor area (50% lat gach)
        return floor_area * 0.6, "m2"

    if etype == "paint":
        # Son: m2 -> lit (1 lit = 12m2 mot lop, 2 lop = 6m2/lit)
        if area > 0:
            m2 = area
        else:
            # Tuong x 2 mat + tran -> ~3 * floor_area
            m2 = floor_area * 3.0
        liters = m2 / 6.0
        return liters, "lit"

    if etype == "ceiling":
        if area > 0:
            return area, "m2"
        return floor_area * 0.85, "m2"

    if etype == "door":
        # m2 cua di (count * 1.98)
        return area if area > 0 else count * 1.98, "m2"

    if etype == "window":
        return area if area > 0 else count * 1.68, "m2"

    if etype == "glass":
        return area, "m2"

    if etype == "railing":
        return length, "m"

    if etype in ("light", "socket", "switch", "ac"):
        return float(count), "cai"

    if etype == "pipe":
        return length, "m"

    if etype == "wire":
        return length, "m"

    return 0.0, "cai"


# ============================================================
# AUX ITEMS - Khoi luong an: vua, thep, son lot, may dieu chinh, etc.
# ============================================================
def generate_aux_items(quantities: dict, project_meta: dict) -> list[dict]:
    """
    Sinh khoi luong an (auxiliary): thep cho BTCT, vua cho gach, son lot, ...
    Theo dinh muc TT06/2021.
    """
    aux: list[dict] = []
    layers = quantities.get("layers", {})

    total_btct_m3 = 0.0
    total_wall_m3 = 0.0
    total_paint_lit = 0.0

    for layer_name, ld in layers.items():
        etype = ld.get("entity_type")
        if etype in ("column", "beam", "slab", "foundation"):
            total_btct_m3 += ld.get("volume_m3", 0.0)
        elif etype == "wall":
            total_wall_m3 += ld.get("volume_m3", 0.0)
        elif etype == "paint":
            total_paint_lit += ld.get("area_m2", 0.0) / 6.0

    # 1 m3 BTCT can ~120kg thep (ham luong thep ~3%)
    if total_btct_m3 > 0:
        thep_kg = total_btct_m3 * 120.0
        aux.append({
            "material_code": "THEP-CB400",
            "quantity": thep_kg,
            "source_layer": "AUX-THEP-CB400",
            "handles": [],
        })
        # 1 m3 BTCT can ~3 kg thep dai (thep CB300)
        aux.append({
            "material_code": "THEP-CB300",
            "quantity": total_btct_m3 * 25.0,
            "source_layer": "AUX-THEP-CB300",
            "handles": [],
        })

    # 1 m3 gach AAC can ~0.05 m3 vua xay
    if total_wall_m3 > 0:
        aux.append({
            "material_code": "VUA-XM-M75",
            "quantity": total_wall_m3 * 0.05,
            "source_layer": "AUX-VUA-XAY",
            "handles": [],
        })

    # 1 lit son phu -> 0.5 lit son lot
    if total_paint_lit > 0:
        aux.append({
            "material_code": "SON-LOT",
            "quantity": total_paint_lit * 0.5,
            "source_layer": "AUX-SON-LOT",
            "handles": [],
        })
        # bot ba: 1 m2 = 0.05 bao 40kg
        aux.append({
            "material_code": "MAT-TIT-TUONG",
            "quantity": (total_paint_lit * 6.0) * 0.05,
            "source_layer": "AUX-BOT-BA",
            "handles": [],
        })

    return aux


# ============================================================
# MAIN GENERATOR
# ============================================================
def generate_boq(
    quantities: dict,
    project_meta: dict,
    materials_override: dict | None = None,
) -> dict:
    """
    Tu quantities (extract.py output) + project_meta -> BOQReport.

    project_meta: {
        "project_id": str,
        "project_name": str,
        "floors": int,
        "total_floor_area_m2": float,
        "style": str,  # 'luxury' | 'modern' | ...
    }
    """
    materials_override = materials_override or {}

    # Patch project_meta tu quantities neu thieu
    project_meta = dict(project_meta)
    project_meta.setdefault("floors", quantities.get("floors_detected", 1))
    project_meta.setdefault(
        "total_floor_area_m2", quantities.get("total_floor_area_m2", 0.0)
    )

    items_by_category: dict[str, list[BOQItem]] = {
        "phan-tho": [],
        "hoan-thien": [],
        "noi-that": [],
        "mep": [],
    }

    stt_counter = 1

    # ---- 1) Process LAYER quantities ----
    for layer_name, layer_data in quantities.get("layers", {}).items():
        material_code = materials_override.get(layer_name)
        if not material_code:
            mat = get_material_by_layer(layer_name)
        else:
            mat = get_material(material_code)

        if not mat:
            continue

        qty, qty_unit = compute_quantity(layer_name, layer_data, project_meta)
        if qty <= 0:
            continue

        # Khop don vi: neu qty_unit khac mat["unit"] -> skip hoac convert
        if qty_unit != mat["unit"]:
            # Chap nhan neu unit roi don gian (m2 vs m2, etc.)
            if qty_unit not in ("m", "m2", "m3", "cai", "lit"):
                continue

        wastage = mat["wastage_pct"]
        qty_with_wastage = qty * (1.0 + wastage)
        unit_price = mat["price_vnd"]
        total_vnd = int(round(qty_with_wastage * unit_price))

        item: BOQItem = {
            "stt": stt_counter,
            "code": mat["code"],
            "description": mat["name"],
            "unit": mat["unit"],
            "quantity": round(qty, 3),
            "wastage_pct": round(wastage * 100, 1),
            "quantity_with_wastage": round(qty_with_wastage, 3),
            "unit_price_vnd": unit_price,
            "total_vnd": total_vnd,
            "material_id": mat["code"],
            "source_layer": layer_name,
            "source_handles": layer_data.get("handles", [])[:10],
        }
        items_by_category[mat["category"]].append(item)
        stt_counter += 1

    # ---- 2) Aux items (thep, vua, son lot, bot ba) ----
    for aux in generate_aux_items(quantities, project_meta):
        mat = get_material(aux["material_code"])
        if not mat:
            continue
        qty = aux["quantity"]
        wastage = mat["wastage_pct"]
        qty_with_wastage = qty * (1.0 + wastage)
        total_vnd = int(round(qty_with_wastage * mat["price_vnd"]))

        item = {
            "stt": stt_counter,
            "code": mat["code"],
            "description": mat["name"] + " (sinh tu BTCT/tuong/son)",
            "unit": mat["unit"],
            "quantity": round(qty, 3),
            "wastage_pct": round(wastage * 100, 1),
            "quantity_with_wastage": round(qty_with_wastage, 3),
            "unit_price_vnd": mat["price_vnd"],
            "total_vnd": total_vnd,
            "material_id": mat["code"],
            "source_layer": aux["source_layer"],
            "source_handles": [],
        }
        items_by_category[mat["category"]].append(item)
        stt_counter += 1

    # ---- 3) Tach theo TANG: nhan voi floors de ra item rieng cho moi tang ----
    floor_area = project_meta["total_floor_area_m2"]
    floors = max(1, project_meta["floors"])
    style = project_meta.get("style", "modern")
    is_luxury = style in ("luxury", "neoclassic", "indochine")

    # Tach moi item phan tho/hoan thien hien co thanh N tang (chia deu)
    splitted_items: dict[str, list[BOQItem]] = {
        "phan-tho": [],
        "hoan-thien": [],
        "noi-that": [],
        "mep": [],
    }
    for cat, items in items_by_category.items():
        for it in items:
            # Item nay co the chia ra tung tang khong?
            if floors > 1 and it["unit"] in ("m3", "m2", "m", "lit"):
                per_floor_qty = it["quantity"] / floors
                per_floor_qty_w = it["quantity_with_wastage"] / floors
                per_floor_total = it["total_vnd"] // floors
                for f in range(1, floors + 1):
                    splitted_items[cat].append({
                        "stt": stt_counter,
                        "code": it["code"],
                        "description": f"{it['description']} - Tang {f}",
                        "unit": it["unit"],
                        "quantity": round(per_floor_qty, 3),
                        "wastage_pct": it["wastage_pct"],
                        "quantity_with_wastage": round(per_floor_qty_w, 3),
                        "unit_price_vnd": it["unit_price_vnd"],
                        "total_vnd": per_floor_total,
                        "material_id": it["material_id"],
                        "source_layer": f"{it['source_layer']}-T{f}",
                        "source_handles": it["source_handles"],
                    })
                    stt_counter += 1
            else:
                splitted_items[cat].append(it)

    items_by_category = splitted_items

    # ---- 4) Default items chi tiet (theo tang + theo phong) ----
    rooms_per_floor = max(3, int(floor_area / floors / 25))  # ~25m2/phong

    default_items: list[tuple[str, float, str]] = []
    # MEP — split theo tang
    for f in range(1, floors + 1):
        default_items.extend([
            ("DEN-LED-PHILIPS-18W", (floor_area / floors) * 0.25, f"Den LED am tran - Tang {f}"),
            ("OCAM-SCHN-220", (floor_area / floors) * 0.12, f"O cam Schneider - Tang {f}"),
            ("CONG-TAC-SCHN", (floor_area / floors) * 0.06, f"Cong tac - Tang {f}"),
            ("DAY-CADIVI-2.5", (floor_area / floors) * 4.0, f"Day dien CV2.5 - Tang {f}"),
            ("DAY-CADIVI-4.0", (floor_area / floors) * 0.8, f"Day dien CV4.0 truc dung - Tang {f}"),
            ("ONG-PVC-D27", (floor_area / floors) * 3.0, f"Ong dien PVC - Tang {f}"),
            ("ONG-NUOC-PPR-25", (floor_area / floors) * 0.6, f"Ong nuoc nong PPR25 - Tang {f}"),
            ("ONG-NUOC-PVC-110", (floor_area / floors) * 0.3, f"Ong thoat PVC110 - Tang {f}"),
            ("DIEU-HOA-DAIKIN-12K", float(rooms_per_floor), f"Dieu hoa 12K - Tang {f}"),
            ("BINH-NUOC-NONG", float(max(2, rooms_per_floor // 2)), f"Binh nong lanh - Tang {f}"),
            ("DEN-LED-DAY", (floor_area / floors) * 0.5, f"LED day haft tran - Tang {f}"),
        ])

    # Sanitary theo so phong WC (giå ~ 1 WC/2 phong)
    wc_count = max(2, rooms_per_floor // 2)
    for f in range(1, floors + 1):
        default_items.extend([
            ("BON-CAU-INAX", float(wc_count), f"Bon cau Inax - Tang {f}"),
            ("LAVABO-INAX", float(wc_count), f"Lavabo Inax - Tang {f}"),
            ("VOI-SEN-CAYTAM", float(wc_count), f"Voi sen TOTO - Tang {f}"),
        ])
    if is_luxury:
        default_items.append(("BON-TAM-MASSAGE", float(floors), "Bon tam massage Toto Neorest - master suite"))
        default_items.append(("DEN-CHUM-PHA", 1.0, "Den chum pha le sanh chinh"))
        default_items.append(("THAM-SAVONNERIE", float(floors), "Tham Savonnerie phong khach + master"))
        default_items.append(("SAN-GO-WALNUT", floor_area * 0.15, "San go walnut tu nhien - phong master"))

    # Noi that theo tang/phong
    for f in range(1, floors + 1):
        default_items.extend([
            ("TU-BEP-CONGNGHIEP", 6.0 if f == 1 else 4.0, f"Tu bep An Cuong - Tang {f}"),
            ("TU-AO-BUILDIN", float(rooms_per_floor) * 4.0, f"Tu ao build-in - Tang {f}"),
            ("GIUONG-NGU-MASTER" if f == floors else "GIUONG-NGU-CON",
             1.0 if f == floors else float(max(1, rooms_per_floor - 1)),
             f"Giuong - Tang {f}"),
            ("RIDEAUX-CAOCAP", (floor_area / floors) * 0.20, f"Rem cua - Tang {f}"),
        ])
    default_items.extend([
        ("BAN-AN-GOTU", 1.0, "Ban an go xoan dao 6 cho - phong an"),
        ("SOFA-DA-7CHO", 1.0, "Sofa da bo Italy 7 cho - phong khach"),
        ("TU-DIEN-AT", 1.0, "Tu dien tong + ATS"),
    ])

    # Hoan thien chi tiet
    default_items.extend([
        ("CHONG-THAM", floor_area * 0.25, "Chong tham WC + ban cong + mai"),
        ("MAI-NGOI", (floor_area / floors) * 1.2, "Mai ngoi Viglacera + xa go"),
        ("LAN-CAN-INOX", (floor_area / floors) * 0.15 * floors, "Lan can inox 304 + kinh"),
        ("KINH-HOPLOP", floor_area * 0.10, "Kinh hop cach am cua mat tien"),
        ("XIMANG-PCB40", floor_area * 0.06, "Xi mang PCB40"),
        ("CAT-VANG", floor_area * 0.10, "Cat vang xay tat"),
        ("DA-1x2", floor_area * 0.08, "Da 1x2 do BTCT"),
    ])

    if is_luxury:
        default_items.extend([
            ("DA-NHAN-TAO", floor_area * 0.05, "Da nhan tao Vicostone mat bep + lavabo"),
            ("CUA-GO-TUNHIEN", float(floors) * 4.0, "Cua go go do tu nhien - phong master"),
            ("TRAN-XUYEN-SANG", floor_area * 0.08, "Tran xuyen sang Barrisol sanh"),
        ])
        # Tach noi that theo phong (luxury chi tiet)
        for f in range(1, floors + 1):
            for r in range(1, rooms_per_floor + 1):
                default_items.extend([
                    ("DEN-LED-PHILIPS-18W", 6.0, f"Den downlight - Tang {f} Phong {r}"),
                    ("OCAM-SCHN-220", 4.0, f"O cam Schneider - Tang {f} Phong {r}"),
                    ("CONG-TAC-SCHN", 2.0, f"Cong tac - Tang {f} Phong {r}"),
                    ("RIDEAUX-CAOCAP", 8.0, f"Rem 2 lop - Tang {f} Phong {r}"),
                ])

    for code, qty, desc in default_items:
        if qty <= 0:
            continue
        mat = get_material(code)
        if not mat:
            continue
        wastage = mat["wastage_pct"]
        qty_with_wastage = qty * (1.0 + wastage)
        total_vnd = int(round(qty_with_wastage * mat["price_vnd"]))

        item = {
            "stt": stt_counter,
            "code": mat["code"],
            "description": desc,
            "unit": mat["unit"],
            "quantity": round(qty, 3),
            "wastage_pct": round(wastage * 100, 1),
            "quantity_with_wastage": round(qty_with_wastage, 3),
            "unit_price_vnd": mat["price_vnd"],
            "total_vnd": total_vnd,
            "material_id": mat["code"],
            "source_layer": "PRESET-VILLA",
            "source_handles": [],
        }
        items_by_category[mat["category"]].append(item)
        stt_counter += 1

    # ---- 4) Build sheets ----
    sheet_names = {
        "phan-tho": "Phan tho - Ket cau",
        "hoan-thien": "Hoan thien",
        "noi-that": "Noi that",
        "mep": "MEP - Dien Nuoc Dieu Hoa",
    }
    sheets: list[BOQSheet] = []

    # Gop MEP vao "Hoan thien" hay tach? -> tach sheet rieng nhung trong report 3 sheet chinh
    # 3 sheet chinh + MEP gop vao Hoan thien
    grouped: dict[str, list[BOQItem]] = {
        "phan-tho": items_by_category["phan-tho"],
        "hoan-thien": items_by_category["hoan-thien"] + items_by_category["mep"],
        "noi-that": items_by_category["noi-that"],
    }

    grand_total = 0
    for cat, items in grouped.items():
        # Re-number STT trong sheet
        for i, it in enumerate(items, start=1):
            it["stt"] = i
        subtotal = sum(it["total_vnd"] for it in items)
        grand_total += subtotal
        sheets.append({
            "name": sheet_names.get(cat, cat),
            "category": cat,
            "items": items,
            "subtotal_vnd": subtotal,
        })

    # ---- 5) Summary: VAT 8% + QLP 5% + Du phong 10% ----
    direct_cost = grand_total
    vat_8 = int(round(direct_cost * 0.08))
    qlp_5 = int(round(direct_cost * 0.05))
    duphong_10 = int(round(direct_cost * 0.10))
    final_total = direct_cost + vat_8 + qlp_5 + duphong_10

    summary = {
        "direct_cost_vnd": direct_cost,
        "vat_8pct_vnd": vat_8,
        "management_5pct_vnd": qlp_5,
        "contingency_10pct_vnd": duphong_10,
        "grand_total_vnd": final_total,
        "total_items": sum(len(s["items"]) for s in sheets),
    }

    return {
        "project_meta": project_meta,
        "sheets": sheets,
        "summary": summary,
        "grand_total_vnd": final_total,
    }


# ============================================================
# CLI
# ============================================================
if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python boq_generator.py <quantities.json> [project_id]")
        sys.exit(1)
    with open(sys.argv[1], "r", encoding="utf-8") as f:
        qty = json.load(f)
    pm = {
        "project_id": sys.argv[2] if len(sys.argv) > 2 else "TEST-001",
        "project_name": "Test Project",
        "floors": qty.get("floors_detected", 1),
        "total_floor_area_m2": qty.get("total_floor_area_m2", 0.0),
        "style": "luxury",
    }
    boq = generate_boq(qty, pm)
    print(json.dumps(boq, indent=2, ensure_ascii=False))
