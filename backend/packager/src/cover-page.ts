// ===============================================================
// Cover Page — PDF cover với pdf-lib + qrcode
// ===============================================================
// Layout luxury (rose gold + Noto Serif fallback):
//   - Logo Viet-Contech ở góc trên trái
//   - Tên dự án + địa chỉ ở giữa, font lớn
//   - Block thông tin: chủ đầu tư / phase / revision / date
//   - Table of contents (danh sách bản vẽ)
//   - QR code → online review URL
//   - Khu ký tên KTS + đóng dấu công ty
// ===============================================================

import { PDFDocument, rgb, StandardFonts, PDFFont, PDFPage, PDFImage } from 'pdf-lib';
import QRCode from 'qrcode';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { PackProjectInfo, Branding, DrawingItem, PackageType } from './types.js';
import { sanitizeVi } from './file-naming.js';

// ----------------------------------------------------------------
// Cover input
// ----------------------------------------------------------------

export interface CoverPageInput {
  project: PackProjectInfo;
  packageType: PackageType;
  revision: number;
  drawings: DrawingItem[];
  branding: Branding;
  online_review_url?: string;
  /** Tổng dự toán (VND) — hiển thị nếu có */
  boq_total_vnd?: number;
  /** Số file render */
  render_count?: number;
  /** Có IFC không */
  has_ifc?: boolean;
  /** Date override (ISO) — default now */
  generated_at?: string;
}

// ----------------------------------------------------------------
// Color helpers
// ----------------------------------------------------------------

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = hex.match(/^#?([0-9a-f]{6})$/i);
  if (!m) return { r: 0.769, g: 0.576, b: 0.227 }; // C4933A fallback
  const n = parseInt(m[1]!, 16);
  return {
    r: ((n >> 16) & 0xff) / 255,
    g: ((n >> 8) & 0xff) / 255,
    b: (n & 0xff) / 255,
  };
}

// ASCII-safe variant for pdf-lib StandardFonts (chỉ Latin1)
function safe(s: string): string {
  return sanitizeVi(s).replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' ').trim();
}

// ----------------------------------------------------------------
// Build cover PDF
// ----------------------------------------------------------------

const PAGE_WIDTH = 595;   // A4 portrait points
const PAGE_HEIGHT = 842;
const MARGIN = 48;

const PACKAGE_TYPE_LABEL: Record<PackageType, string> = {
  client_full: 'BO HO SO DAY DU - CLIENT',
  permit_submission: 'HO SO XIN PHEP XAY DUNG',
  tech_only: 'HO SO KY THUAT',
  commercial_only: 'HO SO THUONG MAI',
};

export async function buildCoverPdf(input: CoverPageInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(safe(`${input.project.code} - ${input.project.name}`));
  pdf.setAuthor(safe(input.branding.company || 'Viet-Contech'));
  pdf.setSubject(`Cover - ${PACKAGE_TYPE_LABEL[input.packageType]}`);
  pdf.setProducer('Viet-Contech Output Packager v2.0');
  pdf.setCreator('Viet-Contech AI Design Platform');
  pdf.setCreationDate(new Date());

  const fontReg = await pdf.embedFont(StandardFonts.TimesRoman);
  const fontBold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const fontMono = await pdf.embedFont(StandardFonts.Courier);

  const accent = hexToRgb(input.branding.color || '#C4933A');
  const fg = rgb(0.95, 0.92, 0.85);
  const muted = rgb(0.6, 0.55, 0.45);
  const bg = rgb(0.055, 0.051, 0.039);

  // ── PAGE 1: COVER ──
  const cover = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  await drawCoverPage(cover, {
    fontReg, fontBold, fontMono,
    accent, fg, muted, bg,
    input,
  });

  // ── PAGE 2: TABLE OF CONTENTS ──
  if (input.drawings.length > 0) {
    const toc = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    drawTocPage(toc, {
      fontReg, fontBold, fontMono,
      accent, fg, muted, bg,
      input,
    });
  }

  return await pdf.save();
}

// ----------------------------------------------------------------
// Cover page
// ----------------------------------------------------------------

interface DrawCtx {
  fontReg: PDFFont;
  fontBold: PDFFont;
  fontMono: PDFFont;
  accent: { r: number; g: number; b: number };
  fg: ReturnType<typeof rgb>;
  muted: ReturnType<typeof rgb>;
  bg: ReturnType<typeof rgb>;
  input: CoverPageInput;
}

async function drawCoverPage(page: PDFPage, ctx: DrawCtx): Promise<void> {
  const { fontReg, fontBold, fontMono, accent, fg, muted, input } = ctx;
  const accentColor = rgb(accent.r, accent.g, accent.b);

  // Background dark luxury panel (rectangle full page)
  page.drawRectangle({
    x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT,
    color: rgb(0.055, 0.051, 0.039),
  });

  // Top accent bar
  page.drawRectangle({
    x: 0, y: PAGE_HEIGHT - 8, width: PAGE_WIDTH, height: 8,
    color: accentColor,
  });

  // Bottom accent bar
  page.drawRectangle({
    x: 0, y: 0, width: PAGE_WIDTH, height: 8,
    color: accentColor,
  });

  // Logo slot (left top)
  let logoBottom = PAGE_HEIGHT - MARGIN - 60;
  if (input.branding.logo_path && existsSync(input.branding.logo_path)) {
    try {
      const buf = await readFile(input.branding.logo_path);
      let img: PDFImage | null = null;
      const ext = input.branding.logo_path.split('.').pop()?.toLowerCase();
      if (ext === 'png') img = await page.doc.embedPng(buf);
      else if (ext === 'jpg' || ext === 'jpeg') img = await page.doc.embedJpg(buf);
      if (img) {
        const targetH = 56;
        const ratio = img.width / img.height;
        const targetW = targetH * ratio;
        page.drawImage(img, {
          x: MARGIN, y: PAGE_HEIGHT - MARGIN - targetH,
          width: targetW, height: targetH,
        });
        logoBottom = PAGE_HEIGHT - MARGIN - targetH;
      }
    } catch {
      /* ignore — fallback to text logo */
    }
  } else {
    // Text logo fallback
    const company = safe(input.branding.company || 'VIET CONTECH');
    page.drawText(company, {
      x: MARGIN, y: PAGE_HEIGHT - MARGIN - 28,
      size: 22, font: fontBold, color: accentColor,
    });
    if (input.branding.tagline) {
      page.drawText(safe(input.branding.tagline), {
        x: MARGIN, y: PAGE_HEIGHT - MARGIN - 48,
        size: 9, font: fontReg, color: muted,
      });
    }
  }

  // Top right: package type badge
  const badgeText = PACKAGE_TYPE_LABEL[input.packageType];
  const badgeWidth = fontBold.widthOfTextAtSize(badgeText, 9) + 24;
  page.drawRectangle({
    x: PAGE_WIDTH - MARGIN - badgeWidth, y: PAGE_HEIGHT - MARGIN - 20,
    width: badgeWidth, height: 18,
    color: accentColor,
  });
  page.drawText(badgeText, {
    x: PAGE_WIDTH - MARGIN - badgeWidth + 12, y: PAGE_HEIGHT - MARGIN - 14,
    size: 9, font: fontBold, color: rgb(0.055, 0.051, 0.039),
  });

  // Decorative line under logo
  const sepY = logoBottom - 24;
  page.drawLine({
    start: { x: MARGIN, y: sepY },
    end: { x: PAGE_WIDTH - MARGIN, y: sepY },
    thickness: 0.8,
    color: rgb(accent.r * 0.6, accent.g * 0.6, accent.b * 0.6),
  });

  // ── HERO: project name centered ──
  const heroTopY = sepY - 80;
  drawCenteredWrapped(page, safe(input.project.name), {
    fontBold, size: 26, color: fg,
    yTop: heroTopY, lineHeight: 32, maxWidth: PAGE_WIDTH - MARGIN * 2,
    maxLines: 3,
  });

  // Project code
  const codeY = heroTopY - 110;
  drawCentered(page, input.project.code, {
    font: fontMono, size: 14, color: accentColor, y: codeY,
  });

  // Address
  drawCentered(page, safe(input.project.address), {
    font: fontReg, size: 12, color: muted, y: codeY - 22,
  });

  // ── INFO BLOCK ──
  const infoTop = codeY - 70;
  const colW = (PAGE_WIDTH - MARGIN * 2) / 2;
  drawInfoCol(page, {
    x: MARGIN, y: infoTop, width: colW - 8,
    fontReg, fontBold, accent: accentColor, muted, fg,
    rows: [
      ['CHU DAU TU', safe(input.project.owner_name)],
      ['DON VI THIET KE', safe(input.project.designed_by)],
      ['KTS CHU TRI', safe(input.project.signed_by_kts || 'Nguoi ky')],
      ['CHUNG CHI HN', input.project.cert_no || '—'],
    ],
  });
  drawInfoCol(page, {
    x: MARGIN + colW + 8, y: infoTop, width: colW - 8,
    fontReg, fontBold, accent: accentColor, muted, fg,
    rows: [
      ['PHASE', input.project.phase],
      ['REVISION', `R${String(input.revision).padStart(2, '0')}`],
      ['NGAY PHAT HANH', (input.generated_at ?? new Date().toISOString()).slice(0, 10)],
      ['SO BAN VE', String(input.drawings.length)],
    ],
  });

  // ── STATS BLOCK ──
  const statsY = infoTop - 200;
  const stats: { label: string; value: string }[] = [
    { label: 'Drawings', value: String(input.drawings.length) },
    { label: 'Renders', value: String(input.render_count ?? 0) },
    { label: 'BIM/IFC', value: input.has_ifc ? 'Yes' : 'No' },
    { label: 'BOQ (VND)', value: input.boq_total_vnd
        ? input.boq_total_vnd.toLocaleString('en-US')
        : '—' },
  ];
  const statW = (PAGE_WIDTH - MARGIN * 2) / stats.length;
  for (let i = 0; i < stats.length; i++) {
    const sx = MARGIN + i * statW;
    page.drawRectangle({
      x: sx + 4, y: statsY - 60, width: statW - 8, height: 60,
      borderColor: accentColor, borderWidth: 0.6,
      color: rgb(0.075, 0.07, 0.055),
    });
    page.drawText(stats[i]!.label.toUpperCase(), {
      x: sx + 14, y: statsY - 18,
      size: 8, font: fontBold, color: muted,
    });
    page.drawText(stats[i]!.value, {
      x: sx + 14, y: statsY - 44,
      size: 14, font: fontBold, color: fg,
    });
  }

  // ── QR CODE + SIGNATURE ──
  const sigY = 180;

  // QR code (right side)
  if (input.online_review_url) {
    try {
      const qrPng = await QRCode.toBuffer(input.online_review_url, {
        type: 'png',
        width: 200,
        margin: 1,
        color: { dark: '#0e0d0a', light: '#f0e8d8' },
      });
      const qrImg = await page.doc.embedPng(qrPng);
      const qrSize = 100;
      page.drawImage(qrImg, {
        x: PAGE_WIDTH - MARGIN - qrSize, y: sigY - qrSize,
        width: qrSize, height: qrSize,
      });
      page.drawText('SCAN DE XEM ONLINE', {
        x: PAGE_WIDTH - MARGIN - qrSize, y: sigY - qrSize - 14,
        size: 7, font: fontBold, color: muted,
      });
    } catch {
      /* QR generation failed — skip silently */
    }
  }

  // Signature box (left side)
  const sigW = 220;
  page.drawText('KTS CHU TRI / TRUONG NHOM THIET KE', {
    x: MARGIN, y: sigY,
    size: 9, font: fontBold, color: muted,
  });
  page.drawLine({
    start: { x: MARGIN, y: sigY - 70 },
    end: { x: MARGIN + sigW, y: sigY - 70 },
    thickness: 0.5, color: muted,
  });
  page.drawText(safe(input.project.signed_by_kts || '..............'), {
    x: MARGIN, y: sigY - 85,
    size: 11, font: fontBold, color: fg,
  });
  if (input.project.cert_no) {
    page.drawText(`CCHN: ${safe(input.project.cert_no)}`, {
      x: MARGIN, y: sigY - 100,
      size: 9, font: fontReg, color: muted,
    });
  }

  // Stamp circle (decorative — center between sig & QR)
  const stampX = PAGE_WIDTH / 2 + 40;
  const stampY = sigY - 50;
  page.drawCircle({
    x: stampX, y: stampY, size: 36,
    borderColor: rgb(0.85, 0.2, 0.2), borderWidth: 1.5,
    opacity: 0.75,
  });
  page.drawText('VCT', {
    x: stampX - 12, y: stampY - 4,
    size: 12, font: fontBold, color: rgb(0.85, 0.2, 0.2),
    opacity: 0.75,
  });

  // Footer (page bottom — 24pt above bottom bar)
  const footerY = 26;
  drawCentered(page, `${safe(input.branding.company || 'VIET CONTECH')}  •  ${input.branding.website ? safe(input.branding.website) : 'vietcontech.vn'}  •  Generated by Viet-Contech AI Design Platform`, {
    font: fontReg, size: 8, color: muted, y: footerY,
  });
}

// ----------------------------------------------------------------
// Page 2 — Table of Contents
// ----------------------------------------------------------------

function drawTocPage(page: PDFPage, ctx: DrawCtx): void {
  const { fontReg, fontBold, fontMono, accent, fg, muted, input } = ctx;
  const accentColor = rgb(accent.r, accent.g, accent.b);

  page.drawRectangle({
    x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT,
    color: rgb(0.055, 0.051, 0.039),
  });

  // Top accent bar
  page.drawRectangle({
    x: 0, y: PAGE_HEIGHT - 8, width: PAGE_WIDTH, height: 8,
    color: accentColor,
  });
  page.drawRectangle({
    x: 0, y: 0, width: PAGE_WIDTH, height: 8,
    color: accentColor,
  });

  // Title
  page.drawText('DANH MUC BAN VE', {
    x: MARGIN, y: PAGE_HEIGHT - MARGIN - 24,
    size: 20, font: fontBold, color: accentColor,
  });
  page.drawText(`${input.project.code}  •  R${String(input.revision).padStart(2, '0')}  •  ${input.drawings.length} ban ve`, {
    x: MARGIN, y: PAGE_HEIGHT - MARGIN - 44,
    size: 10, font: fontReg, color: muted,
  });
  page.drawLine({
    start: { x: MARGIN, y: PAGE_HEIGHT - MARGIN - 56 },
    end: { x: PAGE_WIDTH - MARGIN, y: PAGE_HEIGHT - MARGIN - 56 },
    thickness: 0.8, color: accentColor,
  });

  // Table headers
  let y = PAGE_HEIGHT - MARGIN - 80;
  const xCols = {
    no: MARGIN,
    code: MARGIN + 30,
    name: MARGIN + 90,
    type: PAGE_WIDTH - MARGIN - 100,
    fmt: PAGE_WIDTH - MARGIN - 50,
  };
  page.drawText('STT', { x: xCols.no, y, size: 8, font: fontBold, color: muted });
  page.drawText('MA', { x: xCols.code, y, size: 8, font: fontBold, color: muted });
  page.drawText('TEN BAN VE', { x: xCols.name, y, size: 8, font: fontBold, color: muted });
  page.drawText('LOAI', { x: xCols.type, y, size: 8, font: fontBold, color: muted });
  page.drawText('FORMAT', { x: xCols.fmt, y, size: 8, font: fontBold, color: muted });
  y -= 4;
  page.drawLine({
    start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y },
    thickness: 0.4, color: muted,
  });
  y -= 12;

  // Rows (max ~36 per page — for stage 1 we render up to 60 rows on this page)
  const maxRows = Math.min(input.drawings.length, 56);
  for (let i = 0; i < maxRows; i++) {
    const d = input.drawings[i]!;
    const stt = String(i + 1).padStart(2, '0');
    const code = d.code || `${d.type}-${d.number || (i + 1)}`;
    const name = safe(d.name || d.layer || code);
    const truncatedName = name.length > 50 ? name.slice(0, 47) + '...' : name;

    page.drawText(stt, { x: xCols.no, y, size: 9, font: fontMono, color: fg });
    page.drawText(safe(code), { x: xCols.code, y, size: 9, font: fontMono, color: accentColor });
    page.drawText(truncatedName, { x: xCols.name, y, size: 9, font: fontReg, color: fg });
    page.drawText(safe(d.type), { x: xCols.type, y, size: 9, font: fontMono, color: muted });
    page.drawText(d.format.toUpperCase(), { x: xCols.fmt, y, size: 9, font: fontMono, color: muted });

    y -= 13;
    if (y < 60) break;
  }

  // Footer
  const tail = input.drawings.length > maxRows
    ? `+${input.drawings.length - maxRows} ban ve khac trong package`
    : '';
  if (tail) {
    page.drawText(tail, {
      x: MARGIN, y: 32,
      size: 9, font: fontReg, color: muted,
    });
  }
  drawCentered(page, `Trang 2 / 2  •  ${safe(input.branding.company || 'VIET CONTECH')}`, {
    font: fontReg, size: 8, color: muted, y: 18,
  });
}

// ----------------------------------------------------------------
// Layout helpers
// ----------------------------------------------------------------

function drawCentered(page: PDFPage, text: string, opts: {
  font: PDFFont; size: number; color: ReturnType<typeof rgb>; y: number;
}): void {
  const w = opts.font.widthOfTextAtSize(text, opts.size);
  page.drawText(text, {
    x: (PAGE_WIDTH - w) / 2,
    y: opts.y,
    size: opts.size, font: opts.font, color: opts.color,
  });
}

function drawCenteredWrapped(page: PDFPage, text: string, opts: {
  fontBold: PDFFont; size: number; color: ReturnType<typeof rgb>;
  yTop: number; lineHeight: number; maxWidth: number; maxLines: number;
}): void {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const trial = cur ? `${cur} ${w}` : w;
    if (opts.fontBold.widthOfTextAtSize(trial, opts.size) > opts.maxWidth) {
      if (cur) lines.push(cur);
      cur = w;
      if (lines.length >= opts.maxLines - 1) break;
    } else {
      cur = trial;
    }
  }
  if (cur && lines.length < opts.maxLines) lines.push(cur);

  let y = opts.yTop;
  for (const line of lines) {
    drawCentered(page, line, {
      font: opts.fontBold, size: opts.size, color: opts.color, y,
    });
    y -= opts.lineHeight;
  }
}

function drawInfoCol(page: PDFPage, opts: {
  x: number; y: number; width: number;
  fontReg: PDFFont; fontBold: PDFFont;
  accent: ReturnType<typeof rgb>; muted: ReturnType<typeof rgb>; fg: ReturnType<typeof rgb>;
  rows: [string, string][];
}): void {
  let yy = opts.y;
  for (const [label, value] of opts.rows) {
    page.drawText(label, {
      x: opts.x, y: yy,
      size: 8, font: opts.fontBold, color: opts.muted,
    });
    page.drawText(value, {
      x: opts.x, y: yy - 14,
      size: 11, font: opts.fontReg, color: opts.fg,
      maxWidth: opts.width,
    });
    yy -= 38;
  }
}
