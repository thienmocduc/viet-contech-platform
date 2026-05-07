// ===============================================================
// Preview Generator — auto-generate thumbnails cho từng deliverable
// ===============================================================
// Mục đích: khách mở ZIP có thể xem nhanh không cần phần mềm CAD.
// Mỗi file gốc → 1 PNG thumbnail bên cạnh (`<file>.preview.png`).
//
// Stage 1: gen placeholder PNG (1×1 white pixel + filename label).
//          Production: shelling-out to LibreDWG / poppler / IfcConvert.
// ===============================================================

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, basename, extname } from 'node:path';
import type { DeliverableKind } from './types.js';

export interface PreviewSpec {
  /** Resolution mục tiêu */
  width: number;
  height: number;
  /** Mỗi kind có method khác nhau */
  method: 'dwg-render' | 'pdf-page1' | 'ifc-snapshot' | 'glb-render' | 'xlsx-rasterize' | 'image-resize' | 'noop';
  /** Mô tả ngắn cho log */
  hint: string;
}

const PREVIEW_SPECS: Record<DeliverableKind, PreviewSpec> = {
  dwg:  { width: 1280, height: 1280, method: 'dwg-render',     hint: 'LibreDWG renderer → PNG' },
  dxf:  { width: 1280, height: 1280, method: 'dwg-render',     hint: 'LibreDWG renderer → PNG' },
  pdf:  { width: 1280, height: 1810, method: 'pdf-page1',      hint: 'pdftoppm first page' },
  ifc:  { width: 1920, height: 1080, method: 'ifc-snapshot',   hint: 'IfcConvert + 3D render 4 góc' },
  glb:  { width: 1920, height: 1080, method: 'glb-render',     hint: 'three.js headless render' },
  usdz: { width: 1920, height: 1080, method: 'glb-render',     hint: 'usd-renderer headless' },
  xlsx: { width: 1280, height: 720,  method: 'xlsx-rasterize', hint: 'libreoffice --headless → PNG' },
  png:  { width: 512,  height: 512,  method: 'image-resize',   hint: 'sharp resize' },
  jpg:  { width: 512,  height: 512,  method: 'image-resize',   hint: 'sharp resize' },
  json: { width: 0,    height: 0,    method: 'noop',           hint: 'no preview' },
  md:   { width: 0,    height: 0,    method: 'noop',           hint: 'no preview' },
  csv:  { width: 0,    height: 0,    method: 'noop',           hint: 'no preview' },
};

/** Lấy spec preview cho 1 kind */
export function getPreviewSpec(kind: DeliverableKind): PreviewSpec {
  return PREVIEW_SPECS[kind];
}

/** Đường dẫn preview PNG cạnh file gốc */
export function previewPathOf(absPath: string): string {
  const dir = dirname(absPath);
  const ext = extname(absPath);
  const base = basename(absPath, ext);
  return join(dir, `${base}.preview.png`);
}

/**
 * Minimal valid PNG — 1×1 white pixel, không cần dependency.
 * Production sẽ replace bằng full image renderer.
 */
function buildPlaceholderPng(): Buffer {
  // Constructed bytes for a 1x1 white PNG (with alpha 255).
  // Reference IHDR + IDAT + IEND with pre-computed CRCs.
  return Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // signature
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR len + tag
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1×1
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, // bit depth + CRC
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, // IDAT len + tag
    0x78, 0x9c, 0x62, 0xff, 0xff, 0xff, 0xff, 0x3f,
    0x00, 0x05, 0xfe, 0x02, 0xfe, 0xa3, 0x35, 0x81, 0x84,
    0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
}

export interface PreviewResult {
  generated: boolean;
  preview_path?: string;
  method: string;
  size_bytes: number;
  reason?: string;
}

/**
 * Generate preview cho 1 file. Stage 1 = placeholder, production sẽ
 * shell-out tới native renderer tương ứng.
 */
export async function generatePreview(
  absPath: string,
  kind: DeliverableKind,
): Promise<PreviewResult> {
  const spec = getPreviewSpec(kind);
  if (spec.method === 'noop') {
    return { generated: false, method: spec.method, size_bytes: 0, reason: 'kind không cần preview' };
  }

  const previewPath = previewPathOf(absPath);
  await mkdir(dirname(previewPath), { recursive: true });

  // Stage 1: ghi placeholder PNG. Production thay bằng:
  //   spawnSync('pdftoppm', ['-png', '-r', '150', '-f', '1', '-l', '1', absPath, base])
  //   spawnSync('IfcConvert', [absPath, previewPath])
  const png = buildPlaceholderPng();
  await writeFile(previewPath, png);

  return {
    generated: true,
    preview_path: previewPath,
    method: spec.method,
    size_bytes: png.length,
  };
}

/**
 * Batch generate previews cho nhiều file. Concurrency = 4 mặc định.
 */
export async function generatePreviewsBatch(
  files: { abs_path: string; kind: DeliverableKind }[],
  concurrency = 4,
): Promise<PreviewResult[]> {
  const results: PreviewResult[] = new Array(files.length);
  let i = 0;

  async function worker() {
    while (i < files.length) {
      const idx = i++;
      const f = files[idx]!;
      try {
        results[idx] = await generatePreview(f.abs_path, f.kind);
      } catch (err) {
        results[idx] = {
          generated: false,
          method: 'error',
          size_bytes: 0,
          reason: err instanceof Error ? err.message : 'unknown',
        };
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}
