/**
 * Types cho Render Farm Orchestrator.
 * Mirror agent render_3d trong agents/registry.json + Zeni Cloud Lop 03 contract.
 */

import { z } from 'zod';

// ============================================================
// 9 phong cach noi that (DNA Viet-Contech)
// ============================================================
export type Style =
  | 'luxury'
  | 'indochine'
  | 'modern'
  | 'walnut'
  | 'neoclassic'
  | 'japandi'
  | 'wabisabi'
  | 'minimalism'
  | 'mediterranean';

export const ALL_STYLES: Style[] = [
  'luxury', 'indochine', 'modern', 'walnut', 'neoclassic',
  'japandi', 'wabisabi', 'minimalism', 'mediterranean',
];

// ============================================================
// 7 loai phong tieu chuan
// ============================================================
export type RoomType =
  | 'living'    // phong khach
  | 'bedroom'   // phong ngu
  | 'kitchen'   // bep
  | 'bathroom'  // wc / phong tam
  | 'office'    // phong lam viec
  | 'dining'    // phong an
  | 'foyer';    // sanh / tien sanh

// ============================================================
// 8 goc may quay chuan / phong (theo agent DNA)
// ============================================================
export type CameraAngle =
  | 'front'        // chinh dien
  | 'back'         // sau
  | 'left'         // 45 do trai
  | 'right'        // 45 do phai
  | 'corner_ne'    // goc dong-bac
  | 'corner_sw'    // goc tay-nam
  | 'birds_eye'    // top-down
  | 'eye_level';   // perspective rong

export const ALL_ANGLES: CameraAngle[] = [
  'front', 'back', 'left', 'right',
  'corner_ne', 'corner_sw', 'birds_eye', 'eye_level',
];

// ============================================================
// Cung menh phong thuy → ngu hanh → mau hop
// ============================================================
export type CungMenh =
  | 'kham' | 'khon' | 'chan' | 'ton'   // dong tu trach
  | 'can' | 'doai' | 'cangroup' | 'ly' // tay tu trach
  | 'unknown';

export type NguHanh = 'kim' | 'moc' | 'thuy' | 'hoa' | 'tho';

// ============================================================
// Quality tier
// ============================================================
export type Quality = 'preview' | 'production';

export interface QualitySpec {
  size: '1024x768' | '1024x1024' | '2048x1536' | '2048x2048' | '4096x2048';
  steps: number;
  guidance_scale: number;
  cost_usd: number;        // USD / 1 image at this tier
}

// ============================================================
// 1 lan goi Zeni Cloud Lop 03 (sd-lora-interior)
// ============================================================
export interface ZeniL3Request {
  model: 'sd-lora-interior';
  prompt: string;
  negative_prompt: string;
  size: QualitySpec['size'];
  seed?: number;
  guidance_scale: number;
  steps: number;
  num_images: number;
}

export interface ZeniL3Response {
  image_url: string;
  image_path?: string;     // local path khi save xong
  cost_vnd: number;
  cost_usd: number;
  duration_ms: number;
  seed: number;
  hash: string;            // sha256 cua image bytes (FDIR)
  model_used: string;
  request_id: string;
}

// ============================================================
// 1 frame render (1 phong / 1 style / 1 angle)
// ============================================================
export interface RenderFrame {
  project_id: string;
  room_type: RoomType;
  style: Style;
  angle: CameraAngle;
  prompt_used: string;
  negative_prompt: string;
  seed: number;
  url: string;
  hash: string;
  cost_vnd: number;
  cost_usd: number;
  duration_ms: number;
  watermark: boolean;
  resolution: string;
  created_at: string;
}

// ============================================================
// 1 room render (8 angles x 1 style)
// ============================================================
export interface RenderResult {
  project_id: string;
  room_type: RoomType;
  style: Style;
  frames: RenderFrame[];     // 8 frames
  render_count: number;
  cost_vnd_total: number;
  cost_usd_total: number;
  duration_ms_total: number;
  walkthrough_360_url?: string;
  watermark_count: number;
}

// ============================================================
// Render options (input cua RenderFarm.renderRoom)
// ============================================================
export interface RenderRoomOptions {
  projectId: string;
  roomType: RoomType;
  style: Style;
  layout_2d_path: string;        // path dxf hoac png 2d cho LoRA
  cung_menh: CungMenh;
  num_angles?: number;           // default 8
  quality?: Quality;             // default 'preview'
  seed_base?: number;            // FDIR: re-prompt cung style nhung khac seed
  watermark?: boolean;           // default true
}

// ============================================================
// Render all 9 styles (1 room)
// ============================================================
export interface RenderAllStylesOptions {
  projectId: string;
  roomType: RoomType;
  layout_2d_path: string;
  cung_menh: CungMenh;
  num_angles?: number;           // default 8
  quality?: Quality;
  styles?: Style[];              // default ALL_STYLES (9)
}

// ============================================================
// 360 panorama
// ============================================================
export interface Walkthrough360Options {
  projectId: string;
  roomType: RoomType;
  style: Style;
  cung_menh: CungMenh;
  quality?: Quality;
}

export interface Walkthrough360Result {
  project_id: string;
  room_type: RoomType;
  style: Style;
  glb_path: string;             // path GLB binary scene
  usdz_path: string;            // iOS AR / Apple Vision Pro
  panorama_equirectangular_path: string;  // 4096x2048 png
  cubemap_faces: string[];      // 6 faces (front/back/left/right/up/down)
  cost_vnd_total: number;
  cost_usd_total: number;
  duration_ms_total: number;
}

// ============================================================
// Job queue
// ============================================================
export type JobStatus =
  | 'queued'
  | 'running'
  | 'done'
  | 'failed'
  | 'cancelled';

export interface RenderJob {
  job_id: string;
  project_id: string;
  job_type: 'room' | 'all_styles' | '360';
  status: JobStatus;
  progress_pct: number;             // 0..100
  total_frames: number;
  frames_done: number;
  frames_failed: number;
  cost_vnd_so_far: number;
  cost_usd_so_far: number;
  started_at: number;               // epoch ms
  finished_at?: number;
  error?: string;
  retries: number;
  result?: RenderResult | RenderResult[] | Walkthrough360Result;
}

export interface JobProgressEvent {
  job_id: string;
  type: 'frame_done' | 'frame_failed' | 'job_started' | 'job_done' | 'job_failed';
  progress_pct: number;
  frames_done: number;
  frames_failed: number;
  cost_vnd_so_far: number;
  message?: string;
}

// ============================================================
// Storage adapter contract
// ============================================================
export interface StorageAdapter {
  /** save 1 anh va return public url + local path */
  saveImage(opts: {
    projectId: string;
    style: Style;
    roomType: RoomType;
    angle: CameraAngle | 'face_front' | 'face_back' | 'face_left' | 'face_right' | 'face_up' | 'face_down' | 'panorama';
    bytes: Buffer | Uint8Array;
    extension: 'png' | 'jpg' | 'glb' | 'usdz';
  }): Promise<{ url: string; path: string }>;

  list(projectId: string): Promise<string[]>;
}

// ============================================================
// Cost tier bang gia
// ============================================================
export const QUALITY_PRESETS: Record<Quality, QualitySpec> = {
  preview: {
    size: '1024x768',
    steps: 20,
    guidance_scale: 7.5,
    cost_usd: 0.04,
  },
  production: {
    size: '2048x1536',
    steps: 30,
    guidance_scale: 7.5,
    cost_usd: 0.08,    // size 2x → cost 2x at sd-lora-interior tier
  },
};

export const VND_PER_USD = 24500;

// ============================================================
// SPEC v2 — submitJob batch API (4k pipeline)
// ============================================================

export type Resolution = 'preview' | 'standard' | '4k' | '8k';
export const ALL_RESOLUTIONS: Resolution[] = ['preview', 'standard', '4k', '8k'];

export type Priority = 'low' | 'normal' | 'high' | 'urgent';
export const ALL_PRIORITIES: Priority[] = ['low', 'normal', 'high', 'urgent'];

// 8 angles theo spec (gom panorama_360 + detail)
export const SPEC_ANGLES = [
  'front', 'back', 'left', 'right',
  'iso_high', 'iso_low', 'panorama_360', 'detail',
] as const;
export type SpecAngle = typeof SPEC_ANGLES[number];

// 9 styles
export const SPEC_STYLES: Style[] = [
  'luxury', 'indochine', 'modern', 'walnut', 'neoclassic',
  'japandi', 'wabisabi', 'minimalism', 'mediterranean',
];

// Cung menh — string mo de chap nhan UI text "Khảm", "Khôn"...
export const NGU_HANH_VALUES = ['Kim', 'Mộc', 'Thủy', 'Hỏa', 'Thổ'] as const;
export type NguHanhVN = typeof NGU_HANH_VALUES[number];

// ----- ZOD schemas -----

export const SceneSchema = z.object({
  roomCode: z.string().min(1),
  roomName: z.string().min(1),
  cungMenh: z.string().min(1),  // free string: "Khảm", "Khôn", ...
  nguHanh: z.enum(NGU_HANH_VALUES),
  layout: z.record(z.string(), z.unknown()).default({}),
  angles: z.array(z.enum(SPEC_ANGLES)).min(1),
});
export type Scene = z.infer<typeof SceneSchema>;

export const RenderJobOptsSchema = z.object({
  projectId: z.string().uuid(),
  revisionId: z.string().min(1).default('rev-001'),
  scenes: z.array(SceneSchema).min(1),
  styles: z.array(z.enum(['luxury','indochine','modern','walnut','neoclassic','japandi','wabisabi','minimalism','mediterranean'])).min(1),
  resolution: z.enum(['preview','standard','4k','8k']).default('4k'),
  hdr: z.boolean().default(true),
  priority: z.enum(['low','normal','high','urgent']).default('normal'),
  watermark: z.boolean().default(true),
  watermarkText: z.string().default('VIET CONTECH'),
  generatePreview: z.boolean().default(true),  // 1024px JPEG side-output
});
export type RenderJobOpts = z.infer<typeof RenderJobOptsSchema>;

// ----- Job lifecycle (spec v2) -----

export type SubmitJobStatus =
  | 'waiting' | 'running' | 'done' | 'failed' | 'cancelled';

export interface SubmitJobInfo {
  jobId: string;
  projectId: string;
  revisionId: string;
  status: SubmitJobStatus;
  totalRenders: number;
  completed: number;
  failed: number;
  costUsdSoFar: number;
  costVndSoFar: number;
  startedAt: number;
  finishedAt?: number;
  error?: string;
}

export interface RenderResultV2 {
  scene: string;             // roomCode
  style: Style;
  angle: SpecAngle;
  paths: {
    full: string;            // 4k PNG (or whatever resolution)
    preview?: string;        // 1024px JPEG
  };
  hash: string;
  seed: number;
  costUsd: number;
  costVnd: number;
  durationMs: number;
  watermark: boolean;
  resolution: Resolution;
}

// Resolution dimension lookup
export const RESOLUTION_PIXELS: Record<Resolution, { w: number; h: number }> = {
  preview:  { w: 1024, h: 768 },
  standard: { w: 2048, h: 1536 },
  '4k':     { w: 4096, h: 3072 },
  '8k':     { w: 8192, h: 6144 },
};

// Estimated seconds / 1 render — for queue ETA
export const RESOLUTION_SEC_PER_RENDER: Record<Resolution, number> = {
  preview:  3,
  standard: 6,
  '4k':     12,
  '8k':     24,
};

// Priority queue order (urgent first)
export const PRIORITY_RANK: Record<Priority, number> = {
  urgent: 0, high: 1, normal: 2, low: 3,
};
