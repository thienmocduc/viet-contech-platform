/**
 * Render Farm Orchestrator — Viet-Contech AI Design Platform.
 *
 * Auto render:
 *   - 1 phong / 1 style / 8 goc        →  RenderResult (8 frames)
 *   - 1 phong / 9 style / N goc        →  Record<Style, RenderResult>
 *   - 1 phong / 1 style / 360 panorama →  Walkthrough360Result (6 cubemap + GLB + USDZ)
 *
 * Dieu phoi:
 *   - PromptBuilder  → tao prompt + negative cho tung frame
 *   - ZeniL3Client   → goi sd-lora-interior
 *   - StorageAdapter → save bytes (local hoac Zeni L2)
 *   - JobRegistry    → progress tracking
 *   - runPool        → parallel max 5 + retry 3 lan
 */

import { ZeniL3Client } from './zeni-l3-client.js';
import { LocalStorageAdapter } from './storage.js';
import { buildPrompt, buildCubemapPrompt } from './prompt-builder.js';
import { runPool, JobRegistry, globalJobRegistry } from './queue.js';
import {
  ALL_STYLES, ALL_ANGLES,
} from './types.js';
import type {
  RenderRoomOptions, RenderAllStylesOptions, Walkthrough360Options,
  RenderFrame, RenderResult, Walkthrough360Result,
  Style, RoomType, CameraAngle, StorageAdapter, Quality,
} from './types.js';
import type { CubemapFace } from './prompt-builder.js';

// ============================================================
// Render farm config
// ============================================================
export interface RenderFarmConfig {
  client?: ZeniL3Client;
  storage?: StorageAdapter;
  registry?: JobRegistry;
  concurrent?: number;
  max_retries?: number;
}

// ============================================================
// Main class
// ============================================================
export class RenderFarm {
  private client: ZeniL3Client;
  private storage: StorageAdapter;
  private registry: JobRegistry;
  private concurrent: number;
  private maxRetries: number;

  constructor(cfg: RenderFarmConfig = {}) {
    this.client = cfg.client ?? new ZeniL3Client();
    this.storage = cfg.storage ?? new LocalStorageAdapter();
    this.registry = cfg.registry ?? globalJobRegistry;
    this.concurrent = cfg.concurrent ?? 5;
    this.maxRetries = cfg.max_retries ?? 3;
  }

  // ----------------------------------------------------------
  // 1 room / 1 style / N angles (default 8)
  // ----------------------------------------------------------
  async renderRoom(opts: RenderRoomOptions): Promise<RenderResult> {
    const numAngles = opts.num_angles ?? 8;
    const quality = opts.quality ?? 'preview';
    const watermark = opts.watermark ?? true;
    const seedBase = opts.seed_base ?? 42000;

    const angles: CameraAngle[] = ALL_ANGLES.slice(0, numAngles);
    const job = this.registry.createJob({
      projectId: opts.projectId,
      jobType: 'room',
      totalFrames: angles.length,
    });
    this.registry.setStatus(job.job_id, 'running');

    const tasks = angles.map((angle, i) => async () => {
      return this.renderOneFrame({
        projectId: opts.projectId,
        roomType: opts.roomType,
        style: opts.style,
        angle,
        cungMenh: opts.cung_menh,
        quality,
        watermark,
        seed: seedBase + i,
        onDone: (vnd, usd) => this.registry.reportFrameDone(job.job_id, vnd, usd),
        onFail: (err) => this.registry.reportFrameFailed(job.job_id, err),
      });
    });

    const settled = await runPool(tasks, {
      concurrent: this.concurrent,
      max_retries: this.maxRetries,
    });

    const frames: RenderFrame[] = settled.filter((x): x is RenderFrame => !!x);

    const result: RenderResult = {
      project_id: opts.projectId,
      room_type: opts.roomType,
      style: opts.style,
      frames,
      render_count: frames.length,
      cost_vnd_total: frames.reduce((s, f) => s + f.cost_vnd, 0),
      cost_usd_total: roundCurrency(frames.reduce((s, f) => s + f.cost_usd, 0)),
      duration_ms_total: frames.reduce((s, f) => s + f.duration_ms, 0),
      watermark_count: frames.filter((f) => f.watermark).length,
    };

    this.registry.setResult(job.job_id, result);
    const allOk = frames.length === angles.length;
    this.registry.setStatus(job.job_id, allOk ? 'done' : 'failed',
      allOk ? undefined : `Only ${frames.length}/${angles.length} frames succeeded`);
    return result;
  }

  // ----------------------------------------------------------
  // 1 room / 9 styles / N angles
  // ----------------------------------------------------------
  async renderAll9Styles(
    opts: RenderAllStylesOptions,
  ): Promise<Record<Style, RenderResult>> {
    const styles = opts.styles ?? ALL_STYLES;
    const numAngles = opts.num_angles ?? 8;

    const job = this.registry.createJob({
      projectId: opts.projectId,
      jobType: 'all_styles',
      totalFrames: styles.length * numAngles,
    });
    this.registry.setStatus(job.job_id, 'running');

    const out: Partial<Record<Style, RenderResult>> = {};

    // Run styles SEQUENTIAL (1 style xong moi qua style ke), nhung BEN TRONG 1 style
    // van parallel 5 angles. Tranh burst 45 concurrent goi → rate limit Zeni.
    for (const style of styles) {
      const r = await this.renderRoom({
        projectId: opts.projectId,
        roomType: opts.roomType,
        style,
        layout_2d_path: opts.layout_2d_path,
        cung_menh: opts.cung_menh,
        num_angles: numAngles,
        quality: opts.quality,
      });
      out[style] = r;
      // Bridge progress sang job tong (sub-job tracked rieng, day la roll-up)
      for (const f of r.frames) {
        this.registry.reportFrameDone(job.job_id, f.cost_vnd, f.cost_usd);
      }
    }

    this.registry.setResult(job.job_id, Object.values(out) as RenderResult[]);
    this.registry.setStatus(job.job_id, 'done');
    return out as Record<Style, RenderResult>;
  }

  // ----------------------------------------------------------
  // 360 panorama walkthrough
  // ----------------------------------------------------------
  async render360(opts: Walkthrough360Options): Promise<Walkthrough360Result> {
    const quality = opts.quality ?? 'production';
    const faces: CubemapFace[] = ['front', 'back', 'left', 'right', 'up', 'down'];
    const seedBase = 99000;

    const job = this.registry.createJob({
      projectId: opts.projectId,
      jobType: '360',
      // 6 cubemap + 1 panorama stitch + 1 GLB + 1 USDZ
      totalFrames: faces.length + 3,
    });
    this.registry.setStatus(job.job_id, 'running');

    // 6 cubemap face render — parallel
    const tasks = faces.map((face, i) => async () => {
      const startedAt = Date.now();
      const { prompt, negative_prompt } = buildCubemapPrompt({
        style: opts.style,
        roomType: opts.roomType,
        cungMenh: opts.cung_menh,
        face,
      });
      const resp = await this.client.generateImage({
        prompt,
        negative_prompt,
        quality,
        seed: seedBase + i,
      });
      const bytes = await this.client.downloadBytes(resp.image_url);
      const saved = await this.storage.saveImage({
        projectId: opts.projectId,
        style: opts.style,
        roomType: opts.roomType,
        angle: `face_${face}` as never,
        bytes,
        extension: 'png',
      });
      this.registry.reportFrameDone(job.job_id, resp.cost_vnd, resp.cost_usd);
      return {
        face,
        path: saved.path,
        url: saved.url,
        cost_vnd: resp.cost_vnd,
        cost_usd: resp.cost_usd,
        duration_ms: Date.now() - startedAt,
      };
    });

    const settled = await runPool(tasks, {
      concurrent: this.concurrent,
      max_retries: this.maxRetries,
    });
    const cubemap = settled.filter((x): x is NonNullable<typeof x> => !!x);

    if (cubemap.length !== faces.length) {
      this.registry.setStatus(job.job_id, 'failed',
        `Only ${cubemap.length}/${faces.length} cubemap faces succeeded`);
      throw new Error(`360 render incomplete: ${cubemap.length}/${faces.length}`);
    }

    // Stitch panorama equirectangular 4096x2048 (mock: combine 6 face bytes)
    const panoBytes = await this.stitchPanorama(cubemap.map((c) => c.path));
    const panoSaved = await this.storage.saveImage({
      projectId: opts.projectId,
      style: opts.style,
      roomType: opts.roomType,
      angle: 'panorama',
      bytes: panoBytes,
      extension: 'png',
    });
    this.registry.reportFrameDone(job.job_id, 0, 0);

    // Build GLB + USDZ (mock: minimal binary stubs)
    const glbBytes = this.makeGlbStub(panoSaved.url);
    const glbSaved = await this.storage.saveImage({
      projectId: opts.projectId,
      style: opts.style,
      roomType: opts.roomType,
      angle: 'panorama',
      bytes: glbBytes,
      extension: 'glb',
    });
    this.registry.reportFrameDone(job.job_id, 0, 0);

    const usdzBytes = this.makeUsdzStub(panoSaved.url);
    const usdzSaved = await this.storage.saveImage({
      projectId: opts.projectId,
      style: opts.style,
      roomType: opts.roomType,
      angle: 'panorama',
      bytes: usdzBytes,
      extension: 'usdz',
    });
    this.registry.reportFrameDone(job.job_id, 0, 0);

    const result: Walkthrough360Result = {
      project_id: opts.projectId,
      room_type: opts.roomType,
      style: opts.style,
      glb_path: glbSaved.path,
      usdz_path: usdzSaved.path,
      panorama_equirectangular_path: panoSaved.path,
      cubemap_faces: cubemap.map((c) => c.path),
      cost_vnd_total: cubemap.reduce((s, c) => s + c.cost_vnd, 0),
      cost_usd_total: roundCurrency(cubemap.reduce((s, c) => s + c.cost_usd, 0)),
      duration_ms_total: cubemap.reduce((s, c) => s + c.duration_ms, 0),
    };

    this.registry.setResult(job.job_id, result);
    this.registry.setStatus(job.job_id, 'done');
    return result;
  }

  // ==========================================================
  // Internals
  // ==========================================================

  /**
   * Render 1 frame: prompt → Zeni L3 → download → storage.
   */
  private async renderOneFrame(opts: {
    projectId: string;
    roomType: RoomType;
    style: Style;
    angle: CameraAngle;
    cungMenh: RenderRoomOptions['cung_menh'];
    quality: Quality;
    watermark: boolean;
    seed: number;
    onDone: (costVnd: number, costUsd: number) => void;
    onFail: (err: string) => void;
  }): Promise<RenderFrame> {
    const startedAt = Date.now();
    try {
      const { prompt, negative_prompt } = buildPrompt({
        style: opts.style,
        roomType: opts.roomType,
        angle: opts.angle,
        cungMenh: opts.cungMenh,
        quality: opts.quality,
        watermark: opts.watermark,
      });

      const resp = await this.client.generateImage({
        prompt,
        negative_prompt,
        quality: opts.quality,
        seed: opts.seed,
      });

      const bytes = await this.client.downloadBytes(resp.image_url);
      const saved = await this.storage.saveImage({
        projectId: opts.projectId,
        style: opts.style,
        roomType: opts.roomType,
        angle: opts.angle,
        bytes,
        extension: 'png',
      });

      const frame: RenderFrame = {
        project_id: opts.projectId,
        room_type: opts.roomType,
        style: opts.style,
        angle: opts.angle,
        prompt_used: prompt,
        negative_prompt,
        seed: resp.seed,
        url: saved.url,
        hash: resp.hash,
        cost_vnd: resp.cost_vnd,
        cost_usd: resp.cost_usd,
        duration_ms: Date.now() - startedAt,
        watermark: opts.watermark,
        resolution: this.resolutionFor(opts.quality),
        created_at: new Date().toISOString(),
      };

      opts.onDone(resp.cost_vnd, resp.cost_usd);
      return frame;
    } catch (e) {
      opts.onFail(e instanceof Error ? e.message : String(e));
      throw e;
    }
  }

  private resolutionFor(q: Quality): string {
    return q === 'preview' ? '1024x768' : '2048x1536';
  }

  /**
   * Stitch 6 cubemap face thanh 1 equirectangular panorama 4096x2048.
   *
   * Mock: noi byte 6 face vao 1 buffer co PNG header — du de unit test
   * verify file ton tai. Production: dung sharp + cube-to-equirect lib.
   */
  private async stitchPanorama(faceFiles: string[]): Promise<Buffer> {
    const { readFile } = await import('fs/promises');
    const buffers = await Promise.all(faceFiles.map((p) => readFile(p)));
    return Buffer.concat([
      Buffer.from('PANO_EQUIRECT_4096x2048_v1\n', 'utf-8'),
      ...buffers,
    ]);
  }

  /**
   * Mock GLB stub: header glTF binary + reference toi panorama.
   * Production: dung @gltf-transform de pack texture.
   */
  private makeGlbStub(panoramaUrl: string): Buffer {
    const header = Buffer.from('glTF\x02\x00\x00\x00', 'binary'); // glTF 2.0 magic
    const json = JSON.stringify({
      asset: { version: '2.0', generator: 'viet-contech-render-farm' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      meshes: [{ primitives: [{ attributes: {}, material: 0 }] }],
      materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
      textures: [{ source: 0 }],
      images: [{ uri: panoramaUrl }],
    });
    return Buffer.concat([header, Buffer.from(json, 'utf-8')]);
  }

  /**
   * Mock USDZ stub: USDA + reference texture.
   */
  private makeUsdzStub(panoramaUrl: string): Buffer {
    const usda = `#usda 1.0
(
    defaultPrim = "Pano"
    metersPerUnit = 1
    upAxis = "Y"
)
def Sphere "Pano" {
    rel material:binding = </Pano/Material>
    def Material "Material" {
        token outputs:surface.connect = </Pano/Material/PreviewSurface.outputs:surface>
        def Shader "PreviewSurface" {
            uniform token info:id = "UsdPreviewSurface"
            color3f inputs:diffuseColor.connect = </Pano/Material/Tex.outputs:rgb>
            token outputs:surface
        }
        def Shader "Tex" {
            uniform token info:id = "UsdUVTexture"
            asset inputs:file = @${panoramaUrl}@
            float3 outputs:rgb
        }
    }
}`;
    return Buffer.from(usda, 'utf-8');
  }
}

function roundCurrency(n: number): number {
  return Math.round(n * 100) / 100;
}
