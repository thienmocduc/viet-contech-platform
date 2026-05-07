/**
 * Zeni Cloud Lop 03 — AI Engine client.
 *
 * Endpoint: POST https://zenicloud.io/api/v1/router/route?ws=<workspace>
 * Model:    sd-lora-interior  ($0.04/image base, +$0.04 cho 2K)
 *
 * Mock mode: tu sinh placeholder bytes (PNG header) khi khong co token,
 * van tinh cost va duration that de unit test pass.
 */

import { createHash, randomBytes } from 'crypto';
import type {
  ZeniL3Request, ZeniL3Response, Quality, QualitySpec,
} from './types.js';
import { QUALITY_PRESETS, VND_PER_USD } from './types.js';

// ============================================================
// Config
// ============================================================
export interface ZeniL3Config {
  endpoint?: string;
  workspace?: string;
  api_token?: string;
  mock?: boolean;             // default: true neu khong co api_token
  vnd_per_usd?: number;       // default 24500
}

// ============================================================
// 1x1 transparent PNG bytes — mock placeholder
// ============================================================
const PNG_1X1_TRANSPARENT = Buffer.from([
  0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
  0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
  0x89, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9C, 0x62, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,
  0x42, 0x60, 0x82,
]);

// ============================================================
// Client
// ============================================================
export class ZeniL3Client {
  private config: Required<ZeniL3Config>;

  constructor(cfg: ZeniL3Config = {}) {
    this.config = {
      endpoint: cfg.endpoint ?? process.env.ZENI_L3_ENDPOINT ?? 'https://zenicloud.io/api/v1/router/route',
      workspace: cfg.workspace ?? process.env.ZENI_WORKSPACE ?? 'vietcontech',
      api_token: cfg.api_token ?? process.env.ZENI_L3_TOKEN ?? '',
      mock: cfg.mock ?? !process.env.ZENI_L3_TOKEN,
      vnd_per_usd: cfg.vnd_per_usd ?? VND_PER_USD,
    };
  }

  /**
   * Generate 1 image (1 frame).
   * Mock mode: cost van tinh that, duration mo phong 4-6s.
   */
  async generateImage(opts: {
    prompt: string;
    negative_prompt: string;
    quality: Quality;
    seed?: number;
    num_images?: number;
  }): Promise<ZeniL3Response> {
    const startedAt = Date.now();
    const spec: QualitySpec = QUALITY_PRESETS[opts.quality];
    const seed = opts.seed ?? this.randomSeed();

    const req: ZeniL3Request = {
      model: 'sd-lora-interior',
      prompt: opts.prompt,
      negative_prompt: opts.negative_prompt,
      size: spec.size,
      seed,
      guidance_scale: spec.guidance_scale,
      steps: spec.steps,
      num_images: opts.num_images ?? 1,
    };

    if (this.config.mock) {
      return this.mockGenerate(req, spec, startedAt);
    }
    return this.realGenerate(req, spec, startedAt);
  }

  /**
   * Mock: return PNG bytes hash deterministic theo prompt+seed,
   * cost theo tier that, duration random 4-6s scaled.
   */
  private async mockGenerate(
    req: ZeniL3Request,
    spec: QualitySpec,
    startedAt: number,
  ): Promise<ZeniL3Response> {
    // Mock duration: 50-150ms cho test nhanh, real Zeni 4-6s
    const mockDelayMs = parseInt(process.env.ZENI_L3_MOCK_DELAY_MS ?? '80', 10);
    await new Promise((r) => setTimeout(r, mockDelayMs));

    const bytes = this.makeMockBytes(req.prompt, req.seed!);
    const hash = createHash('sha256').update(bytes).digest('hex');
    const requestId = `mock_${Date.now()}_${randomBytes(4).toString('hex')}`;

    // Mock url tro toi placeholder
    const promptHash = createHash('md5').update(req.prompt).digest('hex').slice(0, 8);
    const url = `mock://zenicloud.io/sd-lora-interior/${promptHash}_${req.seed}.png`;

    return {
      image_url: url,
      cost_vnd: Math.round(spec.cost_usd * this.config.vnd_per_usd),
      cost_usd: spec.cost_usd,
      duration_ms: Date.now() - startedAt,
      seed: req.seed!,
      hash,
      model_used: req.model,
      request_id: requestId,
    };
  }

  /**
   * Real Zeni Cloud Lop 03 call.
   */
  private async realGenerate(
    req: ZeniL3Request,
    spec: QualitySpec,
    startedAt: number,
  ): Promise<ZeniL3Response> {
    const url = `${this.config.endpoint}?ws=${encodeURIComponent(this.config.workspace)}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.api_token}`,
      },
      body: JSON.stringify(req),
    });

    if (!res.ok) {
      throw new Error(`Zeni L3 HTTP ${res.status}: ${await res.text().catch(() => '')}`);
    }

    type ApiResp = {
      image_url: string;
      seed?: number;
      hash?: string;
      request_id?: string;
      duration_ms?: number;
    };
    const data = (await res.json()) as ApiResp;

    return {
      image_url: data.image_url,
      cost_vnd: Math.round(spec.cost_usd * this.config.vnd_per_usd),
      cost_usd: spec.cost_usd,
      duration_ms: data.duration_ms ?? (Date.now() - startedAt),
      seed: data.seed ?? req.seed!,
      hash: data.hash ?? '',
      model_used: req.model,
      request_id: data.request_id ?? `zeni_${Date.now()}`,
    };
  }

  /**
   * Mock bytes: PNG header + payload deterministic theo prompt hash.
   * Du de unit test verify hash khac nhau cho prompt khac nhau.
   */
  private makeMockBytes(prompt: string, seed: number): Buffer {
    const tail = Buffer.from(`${prompt}|${seed}`, 'utf-8');
    return Buffer.concat([PNG_1X1_TRANSPARENT, tail]);
  }

  private randomSeed(): number {
    return Math.floor(Math.random() * 2 ** 31);
  }

  isMock(): boolean {
    return this.config.mock;
  }

  /**
   * Download bytes tu image_url.
   * Mock mode: tra ve mock bytes (cho storage upload).
   */
  async downloadBytes(image_url: string): Promise<Buffer> {
    if (image_url.startsWith('mock://')) {
      return this.makeMockBytes(image_url, 0);
    }
    const res = await fetch(image_url);
    if (!res.ok) throw new Error(`download fail: HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
}
