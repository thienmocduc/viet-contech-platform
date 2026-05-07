/**
 * Resizer — generate web preview tu render goc.
 *
 * Default: 1024px wide JPEG quality 80 (preview).
 *
 * Sharp option:
 *   - .resize({ width, withoutEnlargement: true })
 *   - .jpeg({ quality, progressive: true, mozjpeg: true })
 *
 * Khi input nho hon target (mock 64x64), `withoutEnlargement: true`
 * giu nguyen kich thuoc → upstream test van pass.
 */

import sharp from 'sharp';

export interface ResizeOptions {
  width?: number;             // default 1024
  height?: number;            // default auto (proportional)
  quality?: number;           // default 80
  format?: 'jpeg' | 'png' | 'webp';
  progressive?: boolean;
  enlarge?: boolean;          // default false
}

const DEFAULTS: Required<ResizeOptions> = {
  width: 1024,
  height: 0,
  quality: 80,
  format: 'jpeg',
  progressive: true,
  enlarge: false,
};

export async function resizeForPreview(
  input: Buffer,
  opts: ResizeOptions = {},
): Promise<Buffer> {
  const o = { ...DEFAULTS, ...opts };
  let pipeline = sharp(input).resize({
    width: o.width,
    height: o.height > 0 ? o.height : undefined,
    fit: 'inside',
    withoutEnlargement: !o.enlarge,
  });
  switch (o.format) {
    case 'jpeg':
      pipeline = pipeline.jpeg({ quality: o.quality, progressive: o.progressive, mozjpeg: false });
      break;
    case 'png':
      pipeline = pipeline.png({ compressionLevel: 9 });
      break;
    case 'webp':
      pipeline = pipeline.webp({ quality: o.quality });
      break;
  }
  return pipeline.toBuffer();
}

export async function resizeMany(
  input: Buffer,
  variants: Array<ResizeOptions & { name: string }>,
): Promise<Record<string, Buffer>> {
  const out: Record<string, Buffer> = {};
  for (const v of variants) {
    out[v.name] = await resizeForPreview(input, v);
  }
  return out;
}

export async function getDimensions(buf: Buffer): Promise<{ width: number; height: number }> {
  const m = await sharp(buf).metadata();
  return { width: m.width ?? 0, height: m.height ?? 0 };
}
