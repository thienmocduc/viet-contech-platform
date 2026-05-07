/**
 * Output folder layout cho 1 render job.
 *
 *   exports/renders/{projectId}/{revisionId}/
 *   ├── 4k/                              ← full resolution PNG (or whatever)
 *   │   ├── {scene}_{style}_{angle}.png
 *   │   └── ...
 *   ├── preview/                         ← 1024px JPEG
 *   │   └── {scene}_{style}_{angle}.jpg
 *   ├── 360/                             ← future GLB / USDZ
 *   │   └── {scene}_panorama.glb
 *   └── manifest.json                    ← metadata + URL danh sach
 *
 * Manifest schema:
 *   {
 *     jobId, projectId, revisionId, status,
 *     resolution, watermark, hdr, priority,
 *     totalRenders, completed, failed,
 *     costUsd, costVnd, durationMs,
 *     renders: RenderResultV2[],
 *     createdAt, finishedAt
 *   }
 */

import { mkdir, writeFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import type { RenderResultV2, Resolution, SubmitJobInfo } from './types.js';

export interface ManifestData extends SubmitJobInfo {
  resolution: Resolution;
  watermark: boolean;
  hdr: boolean;
  priority: string;
  durationMs: number;
  renders: RenderResultV2[];
  rootDir: string;
  createdAt: string;
}

export class OutputFolder {
  readonly root: string;          // exports/renders/{projectId}/{revisionId}
  readonly fullDir: string;       // .../4k
  readonly previewDir: string;    // .../preview
  readonly panoramaDir: string;   // .../360
  readonly manifestPath: string;

  constructor(opts: {
    baseDir?: string;             // default exports/renders
    projectId: string;
    revisionId: string;
    resolutionFolder?: string;    // default '4k' (driven by job resolution)
  }) {
    const base = opts.baseDir ?? resolve(process.cwd(), 'exports', 'renders');
    this.root = join(base, opts.projectId, opts.revisionId);
    this.fullDir = join(this.root, opts.resolutionFolder ?? '4k');
    this.previewDir = join(this.root, 'preview');
    this.panoramaDir = join(this.root, '360');
    this.manifestPath = join(this.root, 'manifest.json');
  }

  async ensure(): Promise<void> {
    for (const d of [this.fullDir, this.previewDir, this.panoramaDir]) {
      if (!existsSync(d)) {
        await mkdir(d, { recursive: true });
      }
    }
  }

  fullPath(scene: string, style: string, angle: string, ext = 'png'): string {
    return join(this.fullDir, this.fileBase(scene, style, angle) + '.' + ext);
  }

  previewPath(scene: string, style: string, angle: string, ext = 'jpg'): string {
    return join(this.previewDir, this.fileBase(scene, style, angle) + '.' + ext);
  }

  panoramaPath(scene: string, ext = 'glb'): string {
    return join(this.panoramaDir, `${scene}_panorama.${ext}`);
  }

  fileBase(scene: string, style: string, angle: string): string {
    // sanitize: chi keep [a-z0-9_-]
    return [scene, style, angle]
      .map((s) => s.toLowerCase().replace(/[^a-z0-9_-]/g, '_'))
      .join('_');
  }

  async writeManifest(m: ManifestData): Promise<void> {
    await this.ensure();
    await writeFile(this.manifestPath, JSON.stringify(m, null, 2), 'utf-8');
  }

  async readManifest(): Promise<ManifestData | null> {
    if (!existsSync(this.manifestPath)) return null;
    const raw = await readFile(this.manifestPath, 'utf-8');
    return JSON.parse(raw) as ManifestData;
  }

  async writeFull(scene: string, style: string, angle: string, bytes: Buffer, ext = 'png'): Promise<string> {
    await this.ensure();
    const p = this.fullPath(scene, style, angle, ext);
    await writeFile(p, bytes);
    return p;
  }

  async writePreview(scene: string, style: string, angle: string, bytes: Buffer, ext = 'jpg'): Promise<string> {
    await this.ensure();
    const p = this.previewPath(scene, style, angle, ext);
    await writeFile(p, bytes);
    return p;
  }
}

/**
 * Factory: pick folder name theo resolution.
 */
export function folderForResolution(res: Resolution): string {
  switch (res) {
    case 'preview':  return 'preview-only';
    case 'standard': return '2k';
    case '4k':       return '4k';
    case '8k':       return '8k';
    default:         return '4k';
  }
}
