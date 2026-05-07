"""
price_db.py - DB gia vat lieu xay dung Q1-2026 (HN/SG)
=========================================================
Hardcoded JSON 50+ vat lieu pho bien VN (cap nhat Q1-2026).
Wastage rate (hao hut) chuan nganh theo TT06/2021/TT-BXD.

Mapping LAYER (DXF) -> material_code:
- TUONG-220       -> GACH-AAC-220
- COT-200x300     -> BTCT-B25 (cot)
- SAN-BTCT-150    -> BTCT-B25 (san)
- DAM-BTCT        -> BTCT-B25 (dam)
- KINH            -> KINH-CL-8MM
- GACH-OP-WC      -> GACH-OP-WC-DT
- GACH-LAT-SAN    -> GACH-LAT-DT-600
- DA-CARRARA      -> DA-CARRARA-1.8
- SAN-GO-TEAK     -> SAN-GO-TEAK
- SON-TUONG       -> SON-DULUX-WT
- DEN-LED-TRAN    -> DEN-LED-PHILIPS-18W
- OCAM-220        -> OCAM-SCHN-220
- CUA-DI          -> CUA-NHOM-XINGFA
- CUA-SO          -> CUA-SO-NHOM-KINH
"""
from __future__ import annotations

from typing import TypedDict


class Material(TypedDict):
    code: str
    name: str
    category: str  # 'phan-tho' | 'hoan-thien' | 'noi-that' | 'mep'
    unit: str
    price_vnd: int
    supplier: str
    last_updated_quarter: str
    wastage_pct: float  # 0.05 = 5%


# ============================================================
# MATERIAL CATALOG - Q1-2026 (Ha Noi / Sai Gon retail price)
# ============================================================
MATERIALS: dict[str, Material] = {
    # ---------- PHAN THO (Structural / Shell) ----------
    "BTCT-B25": {
        "code": "BTCT-B25",
        "name": "Be tong cot thep B25 (M350) tron san",
        "category": "phan-tho",
        "unit": "m3",
        "price_vnd": 1_650_000,
        "supplier": "Vissai/Long Son ready-mix",
        "last_updated_quarter": "2026-Q1",
        "wastage_pct": 0.03,
    },
    "BTCT-B30": {
        "code": "BTCT-B30",
        "name": "Be tong cot thep B30 (M400) cho cot/dam chinh",
        "category": "phan-tho",
        "unit": "m3",
        "price_vnd": 1_820_000,
        "supplier": "Holcim/INSEE",
        "last_updated_quarter": "2026-Q1",
        "wastage_pct": 0.03,
    },
    "THEP-CB400": {
        "code": "THEP-CB400",
        "name": "Sat thep CB400-V D10-D32 (Hoa Phat)",
        "category": "phan-tho",
        "unit": "kg",
        "price_vnd": 17_000,
        "supplier": "Hoa Phat",
        "last_updated_quarter": "2026-Q1",
        "wastage_pct": 0.03,
    },
    "THEP-CB300": {
        "code": "THEP-CB300",
        "name": "Sat thep CB300-T D6-D8 (Vietnam Steel)",
        "category": "phan-tho",
        "unit": "kg",
        "price_vnd": 15_500,
        "supplier": "Hoa Phat/Vietnam Steel",
        "last_updated_quarter": "2026-Q1",
        "wastage_pct": 0.03,
    },
    "GACH-AAC-220": {
        "code": "GACH-AAC-220",
        "name": "Gach be tong khi chung ap AAC day 220mm",
        "category": "phan-tho",
        "unit": "m3",
        "price_vnd": 1_350_000,
        "supplier": "Viglacera AAC",
        "last_updated_quarter": "2026-Q1",
        "wastage_pct": 0.05,
    },
    "GACH-AAC-100": {
        "code": "GACH-AAC-100",
        "name": "Gach AAC day 100mm (vach ngan)",
        "category": "phan-tho",
        "unit": "m3",
        "price_vnd": 1_350_000,
        "supplier": "Viglacera AAC",
        "last_updated_quarter": "2026-Q1",
        "wastage_pct": 0.05,
    },
    "GACH-DAT-NUNG": {
        "code": "GACH-DAT-NUNG",
        "name": "Gach dat nung 6 lo Tuynel A1",
        "category": "phan-tho",
        "unit": "m3",
        "price_vnd": 1_150_000,
        "supplier": "Viglacera",
        "last_updated_quarter": "2026-Q1",
        "wastage_pct": 0.05,
    },
    "VUA-XM-M75": {
        "code": "VUA-XM-M75",
        "name": "Vua xi mang M75 xay/trat",
        "category": "phan-tho",
        "unit": "m3",
        "price_vnd": 1_280_000,
        "supplier": "Holcim/Long Son",
        "last_updated_quarter": "2026-Q1",
        "wastage_pct": 0.07,
    },
    "XIMANG-PCB40": {
        "code": "XIMANG-PCB40",
        "name": "Xi mang PCB40 (bao 50kg)",
        "category": "phan-tho",
        "unit": "tan",
        "price_vnd": 1_650_000,
        "supplier": "Vissai/Holcim",
        "last_updated_quarter": "2026-Q1",
        "wastage_pct": 0.03,
    },
    "CAT-VANG": {
        "code": "CAT-VANG",
        "name": "Cat vang xay dung (rua sach)",
        "category": "phan-tho",
        "unit": "m3",
        "price_vnd": 380_000,
        "supplier": "Local",
        "last_updated_quarter": "2026-Q1",
        "wastage_pct": 0.05,
    },
    "DA-1x2": {
        "code": "DA-1x2",
        "name": "Da 1x2 do be tong",
        "category": "phan-tho",
        "unit": "m3",
        "price_vnd": 320_000,
        "supplier": "Local",
        "last_updated_quarter": "2026-Q1",
        "wastage_pct": 0.05,
    },
    "MONG-COC-EP": {
        "code": "MONG-COC-EP",
        "name": "Coc be tong ep 250x250 (12-15m)",
        "category": "phan-tho",
        "unit": "m",
        "price_vnd": 280_000,
        "supplier": "Phan Vu",
        "last_updated_quarter": "2026-Q1",
        "wastage_pct": 0.02,
    },

    # ---------- HOAN THIEN (Finishing) ----------
    "GACH-LAT-DT-600": {
        "code": "GACH-LAT-DT-600",
        "name": "Gach lat nen Dong Tam 600x600 men kho",
        "category": "hoan-thien",
        "unit": "m2",
        "price_vnd": 320_000,
        "supplier": "Dong Tam",
        "last_updated_quarter": "2026-Q1",
        "wastage_pct": 0.05,
    },
    "GACH-LAT-VG-800": {
        "code": "GACH-LAT-VG-800",
        "name": "Gach lat Viglacera porcelain 800x800",
        "category": "hoan-thien",
        "unit": "m2",
        "price_vnd": 480_000,
        "supplier": "Viglacera",
        "last_updated_quarter": "2026-Q1",
        "wastage_pct": 0.05,
    },
    "GACH-OP-WC-DT": {
        "code": "GACH-OP-WC-DT",
        "name": "Gach op tuong WC Dong Tam 300x600",
        "category": "hoan-thien",
        "unit": "m2",
        "price_vnd": 280_000,
        "supplier": "Dong Tam",
        "last_updated_quarter": "2026-Q1",
        "wastage_pct": 0.05,
    },
    "DA-CARRARA-1.8": {
        "code": "DA-CARRARA-1.8",
        "name": "Da Marble Carrara Italy day 18mm",
        "category": "hoan-thien",
        "unit": "m2",
        "price_vnd": 1_200_000,
        "supplier": "Vinastone Italy",
        "last_updated_quarter": "2026-Q1",
        "wastage_pct": 0.08,
    },
    "DA-NHAN-TAO": {
        "code": "DA-NHAN-TAO",
        "name": "Da nhan tao Vicostone (mat bep/lavabo)",
        "category": "hoan-thien",
        "unit": "m2",
        "price_vnd": 1_800_000,
        "supplier": "Vicostone",
        "last_updated_quarter": "2026-Q1",
        "wastage_pct": 0.08,
    },
    "SAN-GO-TEAK": {
        "code": "SAN-GO-TEAK",
        "name": "San go cong nghiep teak Indo (laminate AC4 12mm)",
        "category": "hoan-thien",
        "unit": "m2",
        "price_vnd": 580_000,
        "supplier": "Tarkett/Inovar",
        "last_updated_quarter": "2026-Q1",
        "wastage_pct": 0.05,
    },
    "SAN-GO-WALNUT": {
        "code": "SAN-GO-WALNUT",
        "name": "San go thai Walnut tu nhien (engineered 15mm)",
        "category": "hoan-thien",
        "unit": "m2",
        "price_vnd": 1_650_000,
        "supplier": "Kahrs",
        "last_updated_quarter": "2026-Q1",
        "wastage_pct": 0.05,
    },
    "SON-DULUX-WT": {
        "code": "SON-DULUX-WT",
        "name": "Son Dulux Weathershield ngoai troi (lit)",
        "category": "hoan-thien",
        "unit": "lit",
        "price_vnd": 480_000,
        "supplier": "AkzoNobel",
        "last_updated_quarter": "2026-Q1",
        "wastage_pct": 0.08,
    },
    "SON-DULUX-IN": {
        "code": "SON-DULUX-IN",
        "name": "Son Dulux Easy Clean trong nha (lit)",
        "category": "hoan-thien",
        "unit": "lit",
        "price_vnd": 360_000,
        "supplier": "AkzoNobel",
        "last_updated_quarter": "2026-Q1",
        "wastage_pct": 0.08,
    },
    "SON-LOT": {
        "code": "SON-LOT",
        "name": "Son lot Maxilite chong kiem (lit)",
        "category": "hoan-thien",
        "unit": "lit",
        "price_vnd": 180_000,
        "supplier": "AkzoNobel",
        "last_updated_quarter": "2026-Q1",
        "wastage_pct": 0.08,
    },
    "MAT-TIT-TUONG": {
        "code": "MAT-TIT-TUONG",
        "name": "Bot ba mat tit tuong (40kg)",
        "category": "hoan-thien",
        "unit": "bao",
        "price_vnd": 220_000,
        "supplier": "Mykolor",
        "last_updated_quarter": "2026-Q1",
        "wastage_pct": 0.05,
    },
    "TRAN-THACH-CAO": {
        "code": "TRAN-THACH-CAO",
        "name": "Tran thach cao chim Vinh Tuong + tam Gyproc",
        "category": "hoan-thien",
        "unit": "m2",
        "price_vnd": 320_000,
        "supplier": "Vinh Tuong/Saint-Gobain",
        "last_updated_quarter": "2026-Q1",
        "wastage_pct": 0.06,
    },
    "TRAN-XUYEN-SANG": {
        "code": "TRAN-XUYEN-SANG",
        "name": "Tran xuyen sang Barrisol + LED day",
        "category": "hoan-thien",
        "unit": "m2",
        "price_vnd": 1_650_000,
        "supplier": "Barrisol VN",
        "last_updated_quarter": "2026-Q1",
        "wastage_pct": 0.05,
    },
    "KINH-CL-8MM": {
        "code": "KINH-CL-8MM",
        "name": "Kinh cuong luc 8mm (lan can/cua)",
        "category": "hoan-thien",
        "unit": "m2",
        "price_vnd": 850_000,
        "supplier": "Viglacera Glass",
        "last_updated_quarter": "2026-Q1",
        "wastage_pct": 0.07,
    },
    "KINH-HOPLOP": {
        "code": "KINH-HOPLOP",
        "name": "Kinh hop 2 lop 5+9A+5 cach am",
        "category": "hoan-thien",
        "unit": "m2",
        "price_vnd": 1_250_000,
        "supplier": "Viglacera Glass",
        "last_updated_quarter": "2026-Q1",
        "wastage_pct": 0.07,
    },
    "CUA-NHOM-XINGFA": {
        "code": "CUA-NHOM-XINGFA",
        "name": "Cua nhom Xingfa he 55 (kinh 6.38mm)",
        "category": "hoan-thien",
        "unit": "m2",
        "price_vnd": 2_400_000,
        "supplier": "Xingfa",
        "last_updated_quarter": "2026-Q1",
        "wastage_pct": 0.05,
    },
    "CUA-GO-CONGNGHIEP": {
        "code": "CUA-GO-CONGNGHIEP",
        "name": "Cua go cong nghiep MDF veneer xoan dao",
        "category": "hoan-thien",
        "unit": "m2",
        "price_vnd": 1_800_000,
        "supplier": "An Cuong",
        "last_updated_quarter": "2026-Q1",
        "wastage_pct": 0.04,
    },
    "CUA-GO-TUNHIEN": {
        "code": "CUA-GO-TUNHIEN",
        "name": "Cua go go do/cam lai tu nhien",
        "category": "hoan-thien",
        "unit": "m2",
        "price_vnd": 6_500_000,
        "supplier": "Hoa Phat Carpenter",
        "last_updated_quarter": "2026-Q1",
        "wastage_pct": 0.04,
    },
    "CUA-CUON": {
        "code": "CUA-CUON",
        "name": "Cua cuon Austdoor C70 (motor + dieu khien)",
        "category": "hoan-thien",
        "unit": "m2",
        "price_vnd": 1_350_000,
        "supplier": "Austdoor",
        "last_updated_quarter": "2026-Q1",
        "wastage_pct": 0.03,
    },
    "LAN-CAN-INOX": {
        "code": "LAN-CAN-INOX",
        "name": "Lan can inox 304 + kinh cuong luc 10mm",
        "category": "hoan-thien",
        "unit": "m",
        "price_vnd": 1_650_000,
        "supplier": "Local fabricator",
        "last_updated_quarter": "2026-Q1",
        "wastage_pct": 0.05,
    },
    "CHONG-THAM": {
        "code": "CHONG-THAM",
        "name": "Chong tham Sika Latex + lop xi mang",
        "category": "hoan-thien",
        "unit": "m2",
        "price_vnd": 220_000,
        "supplier": "Sika",
        "last_updated_quarter": "2026-Q1",
        "wastage_pct": 0.10,
    },
    "MAI-TON": {
        "code": "MAI-TON",
        "name": "Mai ton Hoa Sen 0.45mm + xa go thep",
        "category": "hoan-thien",
        "unit": "m2",
        "price_vnd": 380_000,
        "supplier": "Hoa Sen",
        "last_updated_quarter": "2026-Q1",
        "wastage_pct": 0.07,
    },
    "MAI-NGOI": {
        "code": "MAI-NGOI",
        "name": "Mai ngoi Viglacera + xa go go",
        "category": "hoan-thien",
        "unit": "m2",
        "price_vnd": 850_000,
        "supplier": "Viglacera",
        "last_updated_quarter": "2026-Q1",
        "wastage_pct": 0.07,
    },

    # ---------- NOI THAT (Furniture & Fixtures) ----------
    "TU-BEP-CONGNGHIEP": {
        "code": "TU-BEP-CONGNGHIEP",
        "name": "Tu bep An Cuong MFC chong am phu Acrylic",
        "category": "noi-that",
        "unit": "m",
        "price_vnd": 8_500_000,
        "supplier": "An Cuong",
        "last_updated_quarter": "2026-Q1",
        "wastage_pct": 0.03,
    },
    "TU-AO-BUILDIN": {
        "code": "TU-AO-BUILDIN",
        "name": "Tu quan ao am tuong (laminate + ban le Hafele)",
        "category": "noi-that",
        "unit": "m2",
        "price_vnd": 4_800_000,
        "supplier": "An Cuong/Hafele",
        "last_updated_quarter": "2026-Q1",
        "wastage_pct": 0.03,
    },
    "BAN-AN-GOTU": {
        "code": "BAN-AN-GOTU",
        "name": "Ban an go xoan dao 6 cho",
        "category": "noi-that",
        "unit": "bo",
        "price_vnd": 18_500_000,
        "supplier": "Nha Xinh",
        "last_updated_quarter": "2026-Q1",
        "wastage_pct": 0.0,
    },
    "SOFA-DA-7CHO": {
        "code": "SOFA-DA-7CHO",
        "name": "Sofa da bo Italy 7 cho L-shape",
        "category": "noi-that",
        "unit": "bo",
        "price_vnd": 65_000_000,
        "supplier": "Nha Xinh/Italconcept",
        "last_updated_quarter": "2026-Q1",
        "wastage_pct": 0.0,
    },
    "GIUONG-NGU-MASTER": {
        "code": "GIUONG-NGU-MASTER",
        "name": "Giuong ngu master 1m8x2m + dem Lien A",
        "category": "noi-that",
        "unit": "bo",
        "price_vnd": 28_500_000,
        "supplier": "Lien A",
        "last_updated_quarter": "2026-Q1",
        "wastage_pct": 0.0,
    },
    "GIUONG-NGU-CON": {
        "code": "GIUONG-NGU-CON",
        "name": "Giuong ngu phong con 1m6x2m",
        "category": "noi-that",
        "unit": "bo",
        "price_vnd": 12_500_000,
        "supplier": "Lien A",
        "last_updated_quarter": "2026-Q1",
        "wastage_pct": 0.0,
    },
    "BON-CAU-INAX": {
        "code": "BON-CAU-INAX",
        "name": "Bon cau Inax AC-1052 (1 khoi)",
        "category": "noi-that",
        "unit": "cai",
        "price_vnd": 8_500_000,
        "supplier": "INAX",
        "last_updated_quarter": "2026-Q1",
        "wastage_pct": 0.0,
    },
    "LAVABO-INAX": {
        "code": "LAVABO-INAX",
        "name": "Lavabo da Inax + voi Toto + guong",
        "category": "noi-that",
        "unit": "bo",
        "price_vnd": 6_800_000,
        "supplier": "INAX/TOTO",
        "last_updated_quarter": "2026-Q1",
        "wastage_pct": 0.0,
    },
    "VOI-SEN-CAYTAM": {
        "code": "VOI-SEN-CAYTAM",
        "name": "Voi sen cay TOTO TBW01402B + bat sen",
        "category": "noi-that",
        "unit": "bo",
        "price_vnd": 5_200_000,
        "supplier": "TOTO",
        "last_updated_quarter": "2026-Q1",
        "wastage_pct": 0.0,
    },
    "BON-TAM-MASSAGE": {
        "code": "BON-TAM-MASSAGE",
        "name": "Bon tam massage Toto Neorest 1.7m",
        "category": "noi-that",
        "unit": "cai",
        "price_vnd": 65_000_000,
        "supplier": "TOTO",
        "last_updated_quarter": "2026-Q1",
        "wastage_pct": 0.0,
    },
    "RIDEAUX-CAOCAP": {
        "code": "RIDEAUX-CAOCAP",
        "name": "Rem 2 lop voan + cao cap (m2 vai)",
        "category": "noi-that",
        "unit": "m2",
        "price_vnd": 850_000,
        "supplier": "Local fabric",
        "last_updated_quarter": "2026-Q1",
        "wastage_pct": 0.10,
    },
    "THAM-SAVONNERIE": {
        "code": "THAM-SAVONNERIE",
        "name": "Tham phong khach Savonnerie 2.4x3.4m",
        "category": "noi-that",
        "unit": "cai",
        "price_vnd": 18_500_000,
        "supplier": "Imported Persia",
        "last_updated_quarter": "2026-Q1",
        "wastage_pct": 0.0,
    },

    # ---------- MEP (Mechanical/Electrical/Plumbing) ----------
    "DEN-LED-PHILIPS-18W": {
        "code": "DEN-LED-PHILIPS-18W",
        "name": "Den LED am tran Philips 18W trang am",
        "category": "mep",
        "unit": "cai",
        "price_vnd": 480_000,
        "supplier": "Philips",
        "last_updated_quarter": "2026-Q1",
        "wastage_pct": 0.02,
    },
    "DEN-CHUM-PHA": {
        "code": "DEN-CHUM-PHA",
        "name": "Den chum pha le 12 bong (sanh chinh)",
        "category": "mep",
        "unit": "cai",
        "price_vnd": 18_500_000,
        "supplier": "Imported",
        "last_updated_quarter": "2026-Q1",
        "wastage_pct": 0.0,
    },
    "OCAM-SCHN-220": {
        "code": "OCAM-SCHN-220",
        "name": "O cam Schneider 3 chau 220V chong giat",
        "category": "mep",
        "unit": "cai",
        "price_vnd": 285_000,
        "supplier": "Schneider Electric",
        "last_updated_quarter": "2026-Q1",
        "wastage_pct": 0.02,
    },
    "CONG-TAC-SCHN": {
        "code": "CONG-TAC-SCHN",
        "name": "Cong tac Schneider Concept 1-3 phim",
        "category": "mep",
        "unit": "cai",
        "price_vnd": 195_000,
        "supplier": "Schneider Electric",
        "last_updated_quarter": "2026-Q1",
        "wastage_pct": 0.02,
    },
    "DAY-CADIVI-2.5": {
        "code": "DAY-CADIVI-2.5",
        "name": "Day dien Cadivi CV 2.5mm2 (cuon 100m)",
        "category": "mep",
        "unit": "m",
        "price_vnd": 18_500,
        "supplier": "Cadivi",
        "last_updated_quarter": "2026-Q1",
        "wastage_pct": 0.07,
    },
    "DAY-CADIVI-4.0": {
        "code": "DAY-CADIVI-4.0",
        "name": "Day dien Cadivi CV 4.0mm2 (truc dung)",
        "category": "mep",
        "unit": "m",
        "price_vnd": 28_500,
        "supplier": "Cadivi",
        "last_updated_quarter": "2026-Q1",
        "wastage_pct": 0.07,
    },
    "ONG-PVC-D27": {
        "code": "ONG-PVC-D27",
        "name": "Ong dien PVC SP D27 (cuon 30m)",
        "category": "mep",
        "unit": "m",
        "price_vnd": 12_500,
        "supplier": "SP",
        "last_updated_quarter": "2026-Q1",
        "wastage_pct": 0.10,
    },
    "DIEU-HOA-DAIKIN-12K": {
        "code": "DIEU-HOA-DAIKIN-12K",
        "name": "Dieu hoa Daikin Inverter 12000BTU + lap dat",
        "category": "mep",
        "unit": "bo",
        "price_vnd": 18_500_000,
        "supplier": "Daikin",
        "last_updated_quarter": "2026-Q1",
        "wastage_pct": 0.0,
    },
    "DIEU-HOA-DAIKIN-18K": {
        "code": "DIEU-HOA-DAIKIN-18K",
        "name": "Dieu hoa Daikin Inverter 18000BTU + lap dat",
        "category": "mep",
        "unit": "bo",
        "price_vnd": 28_500_000,
        "supplier": "Daikin",
        "last_updated_quarter": "2026-Q1",
        "wastage_pct": 0.0,
    },
    "BINH-NUOC-NONG": {
        "code": "BINH-NUOC-NONG",
        "name": "Binh nuoc nong Ariston 30L + tron lanh nong",
        "category": "mep",
        "unit": "cai",
        "price_vnd": 4_500_000,
        "supplier": "Ariston",
        "last_updated_quarter": "2026-Q1",
        "wastage_pct": 0.0,
    },
    "ONG-NUOC-PPR-25": {
        "code": "ONG-NUOC-PPR-25",
        "name": "Ong nuoc PPR D25 Tien Phong + co cut",
        "category": "mep",
        "unit": "m",
        "price_vnd": 32_500,
        "supplier": "Tien Phong",
        "last_updated_quarter": "2026-Q1",
        "wastage_pct": 0.10,
    },
    "ONG-NUOC-PVC-110": {
        "code": "ONG-NUOC-PVC-110",
        "name": "Ong thoat nuoc PVC D110 + co cut",
        "category": "mep",
        "unit": "m",
        "price_vnd": 65_000,
        "supplier": "Tien Phong",
        "last_updated_quarter": "2026-Q1",
        "wastage_pct": 0.10,
    },
    "TU-DIEN-AT": {
        "code": "TU-DIEN-AT",
        "name": "Tu dien tong + ATS Schneider 6 dao",
        "category": "mep",
        "unit": "cai",
        "price_vnd": 6_800_000,
        "supplier": "Schneider Electric",
        "last_updated_quarter": "2026-Q1",
        "wastage_pct": 0.0,
    },
    "DEN-LED-DAY": {
        "code": "DEN-LED-DAY",
        "name": "Den LED day 5050 30m + nguon",
        "category": "mep",
        "unit": "m",
        "price_vnd": 85_000,
        "supplier": "Rang Dong",
        "last_updated_quarter": "2026-Q1",
        "wastage_pct": 0.05,
    },
}


# ============================================================
# LAYER (DXF) -> material_code mapping
# Tu LAYER name suy ra material_code can dung
# ============================================================
LAYER_TO_MATERIAL: dict[str, str] = {
    # Phan tho
    "TUONG-220": "GACH-AAC-220",
    "TUONG-100": "GACH-AAC-100",
    "WALL": "GACH-AAC-220",
    "WALL-220": "GACH-AAC-220",
    "WALL-100": "GACH-AAC-100",
    "COT-200X300": "BTCT-B30",
    "COT-300X400": "BTCT-B30",
    "COT-400X400": "BTCT-B30",
    "COLUMN": "BTCT-B30",
    "DAM-220X400": "BTCT-B25",
    "DAM-300X500": "BTCT-B25",
    "BEAM": "BTCT-B25",
    "SAN-BTCT-150": "BTCT-B25",
    "SAN-BTCT-100": "BTCT-B25",
    "SLAB": "BTCT-B25",
    "MONG-COC": "MONG-COC-EP",
    "FOUNDATION": "MONG-COC-EP",
    # Hoan thien
    "GACH-LAT-SAN": "GACH-LAT-DT-600",
    "FLOOR_TILE": "GACH-LAT-DT-600",
    "FLOOR-TILE": "GACH-LAT-DT-600",
    "GACH-OP-WC": "GACH-OP-WC-DT",
    "WALL_TILE": "GACH-OP-WC-DT",
    "WALL-TILE": "GACH-OP-WC-DT",
    "DA-CARRARA": "DA-CARRARA-1.8",
    "MARBLE": "DA-CARRARA-1.8",
    "SAN-GO-TEAK": "SAN-GO-TEAK",
    "SAN-GO-WALNUT": "SAN-GO-WALNUT",
    "WOOD-FLOOR": "SAN-GO-TEAK",
    "SON-TUONG": "SON-DULUX-IN",
    "SON-TUONG-PHK": "SON-DULUX-IN",
    "SON-NGOAI-TROI": "SON-DULUX-WT",
    "PAINT": "SON-DULUX-IN",
    "TRAN-THACH-CAO": "TRAN-THACH-CAO",
    "CEILING": "TRAN-THACH-CAO",
    "KINH": "KINH-CL-8MM",
    "GLASS": "KINH-CL-8MM",
    "CUA-DI": "CUA-NHOM-XINGFA",
    "CUA-DI-GO": "CUA-GO-CONGNGHIEP",
    "DOOR": "CUA-NHOM-XINGFA",
    "CUA-SO": "CUA-NHOM-XINGFA",
    "WINDOW": "CUA-NHOM-XINGFA",
    "LAN-CAN": "LAN-CAN-INOX",
    "RAILING": "LAN-CAN-INOX",
    "CHONG-THAM": "CHONG-THAM",
    "MAI-TON": "MAI-TON",
    "MAI-NGOI": "MAI-NGOI",
    # Noi that
    "TU-BEP": "TU-BEP-CONGNGHIEP",
    "KITCHEN": "TU-BEP-CONGNGHIEP",
    "TU-AO": "TU-AO-BUILDIN",
    "WARDROBE": "TU-AO-BUILDIN",
    "BAN-AN": "BAN-AN-GOTU",
    "SOFA": "SOFA-DA-7CHO",
    "GIUONG-MASTER": "GIUONG-NGU-MASTER",
    "GIUONG-CON": "GIUONG-NGU-CON",
    "BON-CAU": "BON-CAU-INAX",
    "TOILET": "BON-CAU-INAX",
    "LAVABO": "LAVABO-INAX",
    "BASIN": "LAVABO-INAX",
    "VOI-SEN": "VOI-SEN-CAYTAM",
    "SHOWER": "VOI-SEN-CAYTAM",
    "BON-TAM": "BON-TAM-MASSAGE",
    "BATHTUB": "BON-TAM-MASSAGE",
    "REM-CUA": "RIDEAUX-CAOCAP",
    "CURTAIN": "RIDEAUX-CAOCAP",
    "THAM": "THAM-SAVONNERIE",
    "CARPET": "THAM-SAVONNERIE",
    # MEP
    "DEN-LED-TRAN": "DEN-LED-PHILIPS-18W",
    "DEN-LED": "DEN-LED-PHILIPS-18W",
    "LIGHT": "DEN-LED-PHILIPS-18W",
    "LIGHTING": "DEN-LED-PHILIPS-18W",
    "DEN": "DEN-LED-PHILIPS-18W",
    "DEN-CHUM": "DEN-CHUM-PHA",
    "CHANDELIER": "DEN-CHUM-PHA",
    "DEN-LED-DAY": "DEN-LED-DAY",
    "OCAM-220": "OCAM-SCHN-220",
    "OCAM": "OCAM-SCHN-220",
    "SOCKET": "OCAM-SCHN-220",
    "CONG-TAC": "CONG-TAC-SCHN",
    "SWITCH": "CONG-TAC-SCHN",
    "DIEU-HOA": "DIEU-HOA-DAIKIN-12K",
    "AC": "DIEU-HOA-DAIKIN-12K",
    "AC-12K": "DIEU-HOA-DAIKIN-12K",
    "AC-18K": "DIEU-HOA-DAIKIN-18K",
    "BINH-NONG-LANH": "BINH-NUOC-NONG",
    "WATER-HEATER": "BINH-NUOC-NONG",
    "ONG-NUOC": "ONG-NUOC-PPR-25",
    "PIPE-WATER": "ONG-NUOC-PPR-25",
    "ONG-THOAT": "ONG-NUOC-PVC-110",
    "PIPE-DRAIN": "ONG-NUOC-PVC-110",
    "TU-DIEN": "TU-DIEN-AT",
    "ELECTRICAL-PANEL": "TU-DIEN-AT",
    "DAY-DIEN": "DAY-CADIVI-2.5",
    "WIRE": "DAY-CADIVI-2.5",
    "DAY-DIEN-4.0": "DAY-CADIVI-4.0",
    "ONG-DIEN": "ONG-PVC-D27",
    "CONDUIT": "ONG-PVC-D27",
}


def get_material(code: str) -> Material | None:
    """Tra material theo code."""
    return MATERIALS.get(code)


def get_material_by_layer(layer: str) -> Material | None:
    """Tu LAYER DXF -> material. Normalize uppercase + match."""
    layer_norm = layer.upper().strip()
    code = LAYER_TO_MATERIAL.get(layer_norm)
    if not code:
        # Fuzzy: substring match
        for key, val in LAYER_TO_MATERIAL.items():
            if key in layer_norm or layer_norm in key:
                code = val
                break
    if not code:
        return None
    return MATERIALS.get(code)


def all_materials() -> list[Material]:
    """Tat ca vat lieu (de seed DB)."""
    return list(MATERIALS.values())


def materials_by_category(category: str) -> list[Material]:
    """Loc theo category: phan-tho|hoan-thien|noi-that|mep."""
    return [m for m in MATERIALS.values() if m["category"] == category]


if __name__ == "__main__":
    print(f"Total materials: {len(MATERIALS)}")
    print(f"Phan tho: {len(materials_by_category('phan-tho'))}")
    print(f"Hoan thien: {len(materials_by_category('hoan-thien'))}")
    print(f"Noi that: {len(materials_by_category('noi-that'))}")
    print(f"MEP: {len(materials_by_category('mep'))}")
    print(f"Layer mappings: {len(LAYER_TO_MATERIAL)}")
