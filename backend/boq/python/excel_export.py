"""
excel_export.py - Xuat BOQ ra Excel chuan nganh
=================================================
Format:
- Sheet 1: Tong hop (3 phan + VAT/QLP/Du phong)
- Sheet 2: Phan tho
- Sheet 3: Hoan thien
- Sheet 4: Noi that
- Font Arial 11, header rose-gold, borders, freeze pane, auto-width
- Cell formula: thanh_tien = qty_du_toan * don_gia
"""
from __future__ import annotations

import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

from openpyxl import Workbook
from openpyxl.styles import (
    Alignment,
    Border,
    Font,
    PatternFill,
    Side,
)
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.worksheet import Worksheet


# ============================================================
# STYLES
# ============================================================
ROSE_GOLD = "B76E79"
ROSE_GOLD_LIGHT = "F4D5CB"
DARK_TEXT = "2D2D2D"
SUBTLE_BG = "FAF7F5"
BORDER_GRAY = "C8B8AE"

HEADER_FONT = Font(name="Arial", size=12, bold=True, color="FFFFFF")
TITLE_FONT = Font(name="Arial", size=16, bold=True, color=DARK_TEXT)
SUBTITLE_FONT = Font(name="Arial", size=11, italic=True, color="6B5D52")
BODY_FONT = Font(name="Arial", size=11, color=DARK_TEXT)
BODY_BOLD = Font(name="Arial", size=11, bold=True, color=DARK_TEXT)
TOTAL_FONT = Font(name="Arial", size=12, bold=True, color="9B2D5C")

HEADER_FILL = PatternFill("solid", fgColor=ROSE_GOLD)
SECTION_FILL = PatternFill("solid", fgColor=ROSE_GOLD_LIGHT)
SUBTLE_FILL = PatternFill("solid", fgColor=SUBTLE_BG)
TOTAL_FILL = PatternFill("solid", fgColor="FFF4E6")

THIN = Side(border_style="thin", color=BORDER_GRAY)
MEDIUM = Side(border_style="medium", color=ROSE_GOLD)
ALL_BORDER = Border(top=THIN, bottom=THIN, left=THIN, right=THIN)
HEADER_BORDER = Border(top=MEDIUM, bottom=MEDIUM, left=THIN, right=THIN)

CENTER = Alignment(horizontal="center", vertical="center", wrap_text=True)
LEFT = Alignment(horizontal="left", vertical="center", wrap_text=True)
RIGHT = Alignment(horizontal="right", vertical="center", wrap_text=True)


# ============================================================
# COLUMN SPEC
# ============================================================
COLS = [
    ("STT", 6),
    ("Ma", 22),
    ("Mo ta", 50),
    ("DVT", 8),
    ("KL", 12),
    ("Hao hut %", 11),
    ("KL du toan", 12),
    ("Don gia (VND)", 16),
    ("Thanh tien (VND)", 18),
]


# ============================================================
# FORMAT HELPER
# ============================================================
def fmt_vnd(amount: int) -> str:
    return f"{amount:,}".replace(",", ".") + " d"


def style_header_row(ws: Worksheet, row: int, ncols: int) -> None:
    for c in range(1, ncols + 1):
        cell = ws.cell(row=row, column=c)
        cell.font = HEADER_FONT
        cell.fill = HEADER_FILL
        cell.alignment = CENTER
        cell.border = HEADER_BORDER


def write_sheet_header(ws: Worksheet, project_meta: dict, sheet_title: str) -> int:
    """Viet header chung tren cung. Tra ve row index sau header."""
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=9)
    title = ws.cell(row=1, column=1, value="BANG KHOI LUONG VA DU TOAN (BOQ)")
    title.font = TITLE_FONT
    title.alignment = CENTER

    ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=9)
    subtitle = ws.cell(
        row=2, column=1,
        value=f"Du an: {project_meta.get('project_name', 'N/A')}  |  Ma: {project_meta.get('project_id', 'N/A')}",
    )
    subtitle.font = SUBTITLE_FONT
    subtitle.alignment = CENTER

    ws.merge_cells(start_row=3, start_column=1, end_row=3, end_column=9)
    info = ws.cell(
        row=3, column=1,
        value=(
            f"Dien tich san: {project_meta.get('total_floor_area_m2', 0):.2f} m²  |  "
            f"So tang: {project_meta.get('floors', 1)}  |  "
            f"Phong cach: {project_meta.get('style', 'N/A')}  |  "
            f"Lap: {datetime.now().strftime('%d/%m/%Y')}"
        ),
    )
    info.font = BODY_FONT
    info.alignment = CENTER

    ws.merge_cells(start_row=5, start_column=1, end_row=5, end_column=9)
    sect = ws.cell(row=5, column=1, value=sheet_title)
    sect.font = HEADER_FONT
    sect.fill = HEADER_FILL
    sect.alignment = CENTER

    # Column header
    for i, (name, _) in enumerate(COLS, start=1):
        cell = ws.cell(row=7, column=i, value=name)
        cell.font = HEADER_FONT
        cell.fill = HEADER_FILL
        cell.alignment = CENTER
        cell.border = HEADER_BORDER

    return 8  # Data starts at row 8


def write_items(ws: Worksheet, start_row: int, items: list[dict]) -> int:
    """Viet items vao sheet. Tra ve row tiep theo."""
    row = start_row
    for it in items:
        ws.cell(row=row, column=1, value=it["stt"]).alignment = CENTER
        ws.cell(row=row, column=2, value=it["code"]).alignment = LEFT
        ws.cell(row=row, column=3, value=it["description"]).alignment = LEFT
        ws.cell(row=row, column=4, value=it["unit"]).alignment = CENTER
        ws.cell(row=row, column=5, value=it["quantity"]).alignment = RIGHT
        ws.cell(row=row, column=6, value=it["wastage_pct"]).alignment = RIGHT

        # KL du toan = KL * (1 + hao_hut/100) — formula
        ws.cell(
            row=row, column=7,
            value=f"=E{row}*(1+F{row}/100)",
        ).alignment = RIGHT

        ws.cell(row=row, column=8, value=it["unit_price_vnd"]).alignment = RIGHT
        # Thanh tien = G * H (formula)
        ws.cell(
            row=row, column=9,
            value=f"=G{row}*H{row}",
        ).alignment = RIGHT

        # Format so cho cot 5,6,7,8,9
        ws.cell(row=row, column=5).number_format = "#,##0.000"
        ws.cell(row=row, column=6).number_format = "0.0"
        ws.cell(row=row, column=7).number_format = "#,##0.000"
        ws.cell(row=row, column=8).number_format = "#,##0"
        ws.cell(row=row, column=9).number_format = "#,##0"

        # Border + zebra fill
        for c in range(1, 10):
            cell = ws.cell(row=row, column=c)
            cell.border = ALL_BORDER
            cell.font = BODY_FONT
            if row % 2 == 0:
                cell.fill = SUBTLE_FILL

        row += 1
    return row


def write_subtotal(ws: Worksheet, row: int, items_count: int, label: str) -> int:
    """Viet subtotal. items_count = so dong items vua viet."""
    if items_count == 0:
        return row + 1

    start_data = row - items_count
    ws.merge_cells(
        start_row=row, start_column=1, end_row=row, end_column=8,
    )
    cell = ws.cell(row=row, column=1, value=label)
    cell.font = TOTAL_FONT
    cell.alignment = RIGHT
    cell.fill = TOTAL_FILL

    sum_cell = ws.cell(
        row=row, column=9,
        value=f"=SUM(I{start_data}:I{row-1})",
    )
    sum_cell.font = TOTAL_FONT
    sum_cell.fill = TOTAL_FILL
    sum_cell.alignment = RIGHT
    sum_cell.number_format = "#,##0"

    for c in range(1, 10):
        ws.cell(row=row, column=c).border = HEADER_BORDER

    return row + 1


def setup_column_widths(ws: Worksheet) -> None:
    for i, (_, width) in enumerate(COLS, start=1):
        ws.column_dimensions[get_column_letter(i)].width = width


def freeze_header(ws: Worksheet) -> None:
    ws.freeze_panes = "A8"


# ============================================================
# SUMMARY SHEET
# ============================================================
def build_summary_sheet(ws: Worksheet, boq: dict) -> None:
    """Sheet dau: tong hop 3 phan + VAT/QLP/Du phong."""
    pm = boq["project_meta"]
    summary = boq["summary"]
    sheets = boq["sheets"]

    ws.merge_cells("A1:F1")
    t = ws.cell(row=1, column=1, value="BANG TONG HOP DU TOAN")
    t.font = TITLE_FONT
    t.alignment = CENTER

    ws.merge_cells("A2:F2")
    s = ws.cell(
        row=2, column=1,
        value=f"Du an: {pm.get('project_name', 'N/A')}  |  Ma: {pm.get('project_id', 'N/A')}",
    )
    s.font = SUBTITLE_FONT
    s.alignment = CENTER

    ws.merge_cells("A3:F3")
    info = ws.cell(
        row=3, column=1,
        value=(
            f"Dien tich san: {pm.get('total_floor_area_m2', 0):.2f} m²   "
            f"So tang: {pm.get('floors', 1)}   "
            f"Phong cach: {pm.get('style', 'N/A')}   "
            f"Lap: {datetime.now().strftime('%d/%m/%Y')}"
        ),
    )
    info.font = BODY_FONT
    info.alignment = CENTER

    # Header row 5
    headers = ["STT", "Hang muc", "DVT", "Khoi luong items", "Thanh tien (VND)", "Ti le %"]
    for i, h in enumerate(headers, start=1):
        c = ws.cell(row=5, column=i, value=h)
        c.font = HEADER_FONT
        c.fill = HEADER_FILL
        c.alignment = CENTER
        c.border = HEADER_BORDER

    direct_cost = summary["direct_cost_vnd"]
    row = 6
    for idx, sh in enumerate(sheets, start=1):
        ws.cell(row=row, column=1, value=idx).alignment = CENTER
        ws.cell(row=row, column=2, value=sh["name"]).alignment = LEFT
        ws.cell(row=row, column=3, value="VND").alignment = CENTER
        ws.cell(row=row, column=4, value=len(sh["items"])).alignment = RIGHT
        ws.cell(row=row, column=5, value=sh["subtotal_vnd"]).alignment = RIGHT
        ws.cell(row=row, column=5).number_format = "#,##0"

        pct = (sh["subtotal_vnd"] / direct_cost * 100) if direct_cost > 0 else 0
        ws.cell(row=row, column=6, value=pct).alignment = RIGHT
        ws.cell(row=row, column=6).number_format = "0.0\\%"

        for c in range(1, 7):
            cell = ws.cell(row=row, column=c)
            cell.border = ALL_BORDER
            cell.font = BODY_FONT
        row += 1

    # Cong truc tiep
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=4)
    cell = ws.cell(row=row, column=1, value="CONG TRUC TIEP (A)")
    cell.font = BODY_BOLD
    cell.alignment = RIGHT
    cell.fill = SECTION_FILL
    ws.cell(row=row, column=5, value=direct_cost).number_format = "#,##0"
    ws.cell(row=row, column=5).font = BODY_BOLD
    ws.cell(row=row, column=5).fill = SECTION_FILL
    ws.cell(row=row, column=5).alignment = RIGHT
    ws.cell(row=row, column=6, value=100.0).number_format = "0.0\\%"
    ws.cell(row=row, column=6).font = BODY_BOLD
    ws.cell(row=row, column=6).fill = SECTION_FILL
    ws.cell(row=row, column=6).alignment = RIGHT
    for c in range(1, 7):
        ws.cell(row=row, column=c).border = HEADER_BORDER
    row += 2

    # Cac chi phi them
    extras = [
        ("Quan ly phi 5% (B)", summary["management_5pct_vnd"]),
        ("Du phong 10% (C)", summary["contingency_10pct_vnd"]),
        ("Thue VAT 8% (D)", summary["vat_8pct_vnd"]),
    ]
    for label, val in extras:
        ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=4)
        cell = ws.cell(row=row, column=1, value=label)
        cell.font = BODY_FONT
        cell.alignment = RIGHT
        ws.cell(row=row, column=5, value=val).number_format = "#,##0"
        ws.cell(row=row, column=5).font = BODY_FONT
        ws.cell(row=row, column=5).alignment = RIGHT

        pct = (val / direct_cost * 100) if direct_cost > 0 else 0
        ws.cell(row=row, column=6, value=pct).number_format = "0.0\\%"
        ws.cell(row=row, column=6).font = BODY_FONT
        ws.cell(row=row, column=6).alignment = RIGHT
        for c in range(1, 7):
            ws.cell(row=row, column=c).border = ALL_BORDER
        row += 1

    # Tong cong
    grand = summary["grand_total_vnd"]
    row += 1
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=4)
    cell = ws.cell(row=row, column=1, value="TONG CONG (A+B+C+D)")
    cell.font = TOTAL_FONT
    cell.alignment = RIGHT
    cell.fill = TOTAL_FILL
    cell.border = HEADER_BORDER

    tot_cell = ws.cell(row=row, column=5, value=grand)
    tot_cell.number_format = "#,##0"
    tot_cell.font = TOTAL_FONT
    tot_cell.fill = TOTAL_FILL
    tot_cell.alignment = RIGHT
    tot_cell.border = HEADER_BORDER

    ws.cell(row=row, column=6, value="").fill = TOTAL_FILL
    ws.cell(row=row, column=6).border = HEADER_BORDER

    # Ghi chu
    row += 2
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=6)
    note = ws.cell(
        row=row, column=1,
        value=(
            "Ghi chu: Bao gia da bao gom hao hut chuan TT06/2021/TT-BXD. "
            "Don gia thi truong Q1-2026 HN/SG. Thoi han bao gia 30 ngay. "
            "Khong bao gom: thi cong nha tho, mong dac biet, dia chat phuc tap."
        ),
    )
    note.font = SUBTITLE_FONT
    note.alignment = LEFT

    # Column widths
    widths = [6, 32, 8, 14, 22, 10]
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w


# ============================================================
# MAIN
# ============================================================
def export_boq_to_excel(boq: dict, output_path: str) -> str:
    """Xuat BOQ ra .xlsx. Tra ve duong dan file."""
    wb = Workbook()
    wb.remove(wb.active)

    # Sheet 1: Tong hop
    ws_summary = wb.create_sheet("Tong hop", 0)
    build_summary_sheet(ws_summary, boq)

    # Sheet 2,3,4: tung phan
    for sheet_data in boq["sheets"]:
        name = sheet_data["name"][:31]  # Excel limit
        ws = wb.create_sheet(name)
        next_row = write_sheet_header(ws, boq["project_meta"], sheet_data["name"])
        end_row = write_items(ws, next_row, sheet_data["items"])
        write_subtotal(
            ws, end_row,
            len(sheet_data["items"]),
            f"CONG {sheet_data['name'].upper()}",
        )
        setup_column_widths(ws)
        freeze_header(ws)

    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    wb.save(str(out))
    return str(out.absolute())


# ============================================================
# CLI
# ============================================================
if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python excel_export.py <boq.json> <output.xlsx>")
        sys.exit(1)
    with open(sys.argv[1], "r", encoding="utf-8") as f:
        boq = json.load(f)
    path = export_boq_to_excel(boq, sys.argv[2])
    print(f"Excel saved to: {path}")
