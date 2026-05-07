/**
 * Storage adapter cho Render Farm.
 *
 * - LocalStorageAdapter:  ghi xuong data/renders/{projectId}/{style}/{room}-{angle}.png
 * - ZeniL2StorageAdapter: upload Zeni Cloud Lop 02 Object Storage
 *                         (vietcontech-projects/{projectId}/03-3d/{style}/...)
 *
 * Default export: LocalStorageAdapter — duoc dung trong unit test va dev.
 */

import { mkdir, writeFile, readdir, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import type { StorageAdapter, Style, RoomType } from './types.js';

// ============================================================
// Local FS adapter
// ============================================================
export class LocalStorageAdapter implements StorageAdapter {
  private rootDir: string;

  constructor(rootDir?: string) {
    // Default: <module_root>/data/renders
    this.rootDir = rootDir ?? resolve(process.cwd(), 'data', 'renders');
  }

  async saveImage(opts: {
    projectId: string;
    style: Style;
    roomType: RoomType;
    angle: string;
    bytes: Buffer | Uint8Array;
    extension: 'png' | 'jpg' | 'glb' | 'usdz';
  }): Promise<{ url: string; path: string }> {
    const dir = join(this.rootDir, opts.projectId, opts.style);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }

    const filename = `${opts.roomType}-${opts.angle}.${opts.extension}`;
    const fullPath = join(dir, filename);
    await writeFile(fullPath, opts.bytes);

    // local "url" = file:// path
    const url = `file:///${fullPath.replace(/\\/g, '/')}`;
    return { url, path: fullPath };
  }

  async list(projectId: string): Promise<string[]> {
    const projDir = join(this.rootDir, projectId);
    if (!existsSync(projDir)) return [];

    const out: string[] = [];
    const styles = await readdir(projDir);
    for (const style of styles) {
      const styleDir = join(projDir, style);
      const st = await stat(styleDir).catch(() => null);
      if (!st || !st.isDirectory()) continue;
      const files = await readdir(styleDir);
      for (const f of files) out.push(join(styleDir, f));
    }
    return out;
  }

  getRootDir(): string {
    return this.rootDir;
  }
}

// ============================================================
// Zeni Cloud Lop 02 Object Storage adapter (real prod)
// ============================================================
export interface ZeniL2StorageConfig {
  endpoint?: string;
  bucket?: string;
  api_token?: string;
}

export class ZeniL2StorageAdapter implements StorageAdapter {
  private endpoint: string;
  private bucket: string;
  private token: string;

  constructor(cfg: ZeniL2StorageConfig = {}) {
    this.endpoint = cfg.endpoint ?? process.env.ZENI_L2_ENDPOINT ?? 'https://zenicloud.io/api/v1/storage';
    this.bucket = cfg.bucket ?? process.env.ZENI_L2_BUCKET ?? 'vietcontech-projects';
    this.token = cfg.api_token ?? process.env.ZENI_L2_TOKEN ?? '';
    if (!this.token) {
      throw new Error('ZeniL2StorageAdapter: missing ZENI_L2_TOKEN');
    }
  }

  async saveImage(opts: {
    projectId: string;
    style: Style;
    roomType: RoomType;
    angle: string;
    bytes: Buffer | Uint8Array;
    extension: 'png' | 'jpg' | 'glb' | 'usdz';
  }): Promise<{ url: string; path: string }> {
    const objectKey = `${opts.projectId}/03-3d/${opts.style}/${opts.roomType}-${opts.angle}.${opts.extension}`;
    const url = `${this.endpoint}/${this.bucket}/${objectKey}`;

    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': this.contentType(opts.extension),
        'Authorization': `Bearer ${this.token}`,
      },
      body: new Uint8Array(opts.bytes),
    });
    if (!res.ok) {
      throw new Error(`Zeni L2 PUT fail HTTP ${res.status}`);
    }
    const publicUrl = `https://cdn.zenicloud.io/${this.bucket}/${objectKey}`;
    return { url: publicUrl, path: objectKey };
  }

  async list(projectId: string): Promise<string[]> {
    const url = `${this.endpoint}/${this.bucket}?prefix=${encodeURIComponent(projectId + '/03-3d/')}`;
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${this.token}` },
    });
    if (!res.ok) return [];
    type ListResp = { keys?: string[] };
    const data = (await res.json()) as ListResp;
    return data.keys ?? [];
  }

  private contentType(ext: string): string {
    switch (ext) {
      case 'png':  return 'image/png';
      case 'jpg':  return 'image/jpeg';
      case 'glb':  return 'model/gltf-binary';
      case 'usdz': return 'model/vnd.usdz+zip';
      default:     return 'application/octet-stream';
    }
  }
}
