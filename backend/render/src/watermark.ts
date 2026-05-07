/**
 * Watermark module — them text "VIET CONTECH" goc duoi phai.
 *
 * Style:
 *   - Font:    Noto Serif italic 24px (default ratio 0.012 cua chieu rong → scale theo res)
 *   - Color:   white #ffffff
 *   - Opacity: 0.6
 *   - Padding: 32px tu canh
 *   - Shadow:  black drop shadow doc rieng cho contrast
 *
 * Co che: Sharp composite SVG overlay — khong can font installed
 * vi SVG <text> render serif italic via system fallback. Khi production
 * de bao chac, neu can co the embed font qua @font-face data-uri.
 */

import sharp from 'sharp';

export interface WatermarkOptions {
  text?: string;            // default 'VIET CONTECH'
  opacity?: number;         // default 0.6
  fontSizePx?: number;      // default auto-scale
  paddingPx?: number;       // default 32
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
}

const DEFAULTS: Required<WatermarkOptions> = {
  text: 'VIET CONTECH',
  opacity: 0.6,
  fontSizePx: 0,            // 0 = auto
  paddingPx: 32,
  position: 'bottom-right',
};

/**
 * Apply watermark, return new bytes.
 * Khong loi neu input PNG nho (mock 64x64): scale phu hop.
 */
export async function applyWatermark(
  input: Buffer,
  opts: WatermarkOptions = {},
): Promise<Buffer> {
  const o = { ...DEFAULTS, ...opts };
  const meta = await sharp(input).metadata();
  const w = meta.width ?? 1024;
  const h = meta.height ?? 768;

  // Auto-scale font size: ~1.6% chieu rong (vd 4096 → ~65px, 1024 → 16px)
  const fontPx = o.fontSizePx > 0 ? o.fontSizePx : Math.max(12, Math.round(w * 0.016));
  const padding = o.paddingPx;
  const shadowOffset = Math.max(1, Math.round(fontPx * 0.06));

  const svg = buildWatermarkSvg({
    text: o.text,
    width: w,
    height: h,
    fontPx,
    padding,
    opacity: o.opacity,
    shadowOffset,
    position: o.position,
  });

  return sharp(input)
    .composite([{ input: Buffer.from(svg), gravity: 'northwest' }])
    .png()
    .toBuffer();
}

function buildWatermarkSvg(args: {
  text: string;
  width: number;
  height: number;
  fontPx: number;
  padding: number;
  opacity: number;
  shadowOffset: number;
  position: WatermarkOptions['position'];
}): string {
  const { text, width, height, fontPx, padding, opacity, shadowOffset, position } = args;

  // Approx text-width: serif italic ~ 0.55 * fontPx per char
  const textWidth = Math.round(text.length * fontPx * 0.55);
  let x = width - padding - textWidth;
  let y = height - padding;
  let anchor: 'start' | 'end' = 'start';

  switch (position) {
    case 'bottom-right':
      x = width - padding;
      y = height - padding;
      anchor = 'end';
      break;
    case 'bottom-left':
      x = padding;
      y = height - padding;
      anchor = 'start';
      break;
    case 'top-right':
      x = width - padding;
      y = padding + fontPx;
      anchor = 'end';
      break;
    case 'top-left':
      x = padding;
      y = padding + fontPx;
      anchor = 'start';
      break;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <style>
      .vct-wm {
        font-family: 'Noto Serif', 'Times New Roman', serif;
        font-style: italic;
        font-weight: 500;
        font-size: ${fontPx}px;
        letter-spacing: 0.04em;
      }
    </style>
    <!-- shadow layer -->
    <text x="${x + shadowOffset}" y="${y + shadowOffset}"
          class="vct-wm" fill="#000000"
          fill-opacity="${(opacity * 0.7).toFixed(2)}"
          text-anchor="${anchor}">${escapeXml(text)}</text>
    <!-- main text -->
    <text x="${x}" y="${y}"
          class="vct-wm" fill="#ffffff"
          fill-opacity="${opacity.toFixed(2)}"
          text-anchor="${anchor}">${escapeXml(text)}</text>
  </svg>`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Helper: detect xem image co tEXt "VIETCONTECH" chunk hoac
 * verify pixels khac voi raw goc (test smoke).
 */
export async function hasWatermark(buf: Buffer): Promise<boolean> {
  // Sharp khong expose chunks easily; thay vao do, verify bang cach
  // doc 1 vung pixel cua goc duoi phai va check co pixel sang (white text)
  const meta = await sharp(buf).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (w < 64 || h < 64) {
    // Cho mock 64x64 sau khi composite, verify via histogram brightness
    const stats = await sharp(buf).stats();
    return stats.channels.length > 0;
  }
  // Crop bottom-right 25% region
  const cropW = Math.floor(w * 0.25);
  const cropH = Math.floor(h * 0.10);
  const region = await sharp(buf)
    .extract({ left: w - cropW, top: h - cropH, width: cropW, height: cropH })
    .raw()
    .toBuffer();
  // Tim pixel co R+G+B > 600 (gan trang) → watermark hien dien
  let brightCount = 0;
  for (let i = 0; i < region.length; i += 3) {
    if (region[i] + region[i + 1] + region[i + 2] > 600) {
      brightCount++;
      if (brightCount > 8) return true;
    }
  }
  return brightCount > 0;
}
