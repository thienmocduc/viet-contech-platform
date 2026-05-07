/**
 * Provider: Zeni Cloud Lop 03 — AI Engine route v1.
 *
 *   POST https://zenicloud.io/api/v1/router/route?ws=$WS
 *   Authorization: Bearer $TOKEN
 *   {
 *     messages, model_hint:"image", task_type:"image_gen",
 *     params: { prompt, negative_prompt, size, seed, ... }
 *   }
 *
 * Tra ve PNG bytes (base64 hoac url) cho RenderFarm.
 *
 * Khi khong co token, mock=true → tu sinh placeholder bytes co label
 * "MOCK render: <style> <room> <angle>" via canvas-ish PNG.
 */

import { createHash, randomBytes } from 'crypto';
import { deflateSync } from 'zlib';
import type { ImageProvider, ProviderRequest, ProviderResponse } from './provider.js';

export interface ZeniL3ProviderConfig {
  endpoint?: string;
  workspace?: string;
  api_token?: string;
  mock?: boolean;
  vnd_per_usd?: number;
  cost_per_image_usd?: number;
}

export class ZeniL3Provider implements ImageProvider {
  readonly name = 'zeni-l3';
  private endpoint: string;
  private workspace: string;
  private token: string;
  private mock: boolean;
  private vndPerUsd: number;
  private costPerImageUsd: number;

  constructor(cfg: ZeniL3ProviderConfig = {}) {
    this.endpoint = cfg.endpoint ?? process.env.ZENI_L3_ENDPOINT ?? 'https://zenicloud.io/api/v1/router/route';
    this.workspace = cfg.workspace ?? process.env.ZENI_WORKSPACE ?? 'vietcontech';
    this.token = cfg.api_token ?? process.env.ZENI_L3_TOKEN ?? '';
    this.mock = cfg.mock ?? !this.token;
    this.vndPerUsd = cfg.vnd_per_usd ?? 24500;
    this.costPerImageUsd = cfg.cost_per_image_usd ?? 0.04;
  }

  isMock(): boolean {
    return this.mock;
  }

  async generate(req: ProviderRequest): Promise<ProviderResponse> {
    const startedAt = Date.now();
    if (this.mock) return this.mockGenerate(req, startedAt);
    return this.realGenerate(req, startedAt);
  }

  // ----------------------------------------------------------
  // Real call to Zeni Cloud Lop 03
  // ----------------------------------------------------------
  private async realGenerate(req: ProviderRequest, startedAt: number): Promise<ProviderResponse> {
    const url = `${this.endpoint}?ws=${encodeURIComponent(this.workspace)}`;
    const seed = req.seed ?? Math.floor(Math.random() * 2 ** 31);
    const body = {
      model_hint: 'image',
      task_type: 'image_gen',
      messages: [
        { role: 'user', content: req.prompt },
      ],
      params: {
        model: 'sd-lora-interior',
        prompt: req.prompt,
        negative_prompt: req.negative_prompt,
        size: this.sizeFor(req.resolution),
        seed,
        guidance_scale: 7.5,
        steps: req.resolution === 'preview' ? 20 : 30,
        num_images: 1,
        hdr: req.hdr ?? true,
      },
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.token}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`zeni-l3 HTTP ${res.status}: ${await res.text().catch(() => '')}`);
    }
    type ApiResp = {
      image_url?: string;
      image_b64?: string;
      seed?: number;
      hash?: string;
      duration_ms?: number;
      cost_usd?: number;
    };
    const data = (await res.json()) as ApiResp;

    let bytes: Buffer;
    if (data.image_b64) {
      bytes = Buffer.from(data.image_b64, 'base64');
    } else if (data.image_url) {
      const r = await fetch(data.image_url);
      if (!r.ok) throw new Error(`zeni-l3 image dl HTTP ${r.status}`);
      bytes = Buffer.from(await r.arrayBuffer());
    } else {
      throw new Error('zeni-l3 response missing image_url and image_b64');
    }
    const costUsd = data.cost_usd ?? this.costPerImageUsd * this.sizeMultiplier(req.resolution);
    return {
      bytes,
      provider: this.name,
      hash: data.hash ?? createHash('sha256').update(bytes).digest('hex'),
      seed: data.seed ?? seed,
      cost_usd: costUsd,
      cost_vnd: Math.round(costUsd * this.vndPerUsd),
      duration_ms: data.duration_ms ?? (Date.now() - startedAt),
    };
  }

  // ----------------------------------------------------------
  // Mock: generate small placeholder PNG bytes deterministically
  // ----------------------------------------------------------
  private async mockGenerate(req: ProviderRequest, startedAt: number): Promise<ProviderResponse> {
    const delay = parseInt(process.env.ZENI_L3_MOCK_DELAY_MS ?? '50', 10);
    await new Promise((r) => setTimeout(r, delay));

    const seed = req.seed ?? Math.floor(Math.random() * 2 ** 31);
    const label = `MOCK render: ${req.label ?? req.prompt.slice(0, 40)}`;
    const bytes = makeLabelPng(label, seed);
    const hash = createHash('sha256').update(bytes).digest('hex');
    const costUsd = this.costPerImageUsd * this.sizeMultiplier(req.resolution);
    return {
      bytes,
      provider: this.name,
      hash,
      seed,
      cost_usd: costUsd,
      cost_vnd: Math.round(costUsd * this.vndPerUsd),
      duration_ms: Date.now() - startedAt,
    };
  }

  private sizeFor(resolution: ProviderRequest['resolution']): string {
    switch (resolution) {
      case 'preview':  return '1024x768';
      case 'standard': return '2048x1536';
      case '4k':       return '4096x3072';
      case '8k':       return '8192x6144';
      default:         return '1024x768';
    }
  }

  private sizeMultiplier(resolution: ProviderRequest['resolution']): number {
    switch (resolution) {
      case 'preview':  return 1;     // base $0.04
      case 'standard': return 2;     // $0.08
      case '4k':       return 4;     // $0.16
      case '8k':       return 8;     // $0.32
      default:         return 1;
    }
  }
}

// ============================================================
// Helper: minimal PNG generator co tag label trong text chunk.
// Khong dung sharp o day vi want zero-import — mock buffer du de
// downstream sharp (resizer + watermark) co buffer that nhan vao.
// ============================================================
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

/**
 * Generate 64x64 RGBA PNG with label embedded in tEXt chunk.
 * Sharp downstream se resize / watermark / re-encode that.
 */
function makeLabelPng(label: string, seed: number): Buffer {
  const w = 64, h = 64;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;     // bit depth
  ihdr[9] = 6;     // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // Random-ish RGBA pixels deterministic by seed
  const raw = Buffer.alloc(h * (1 + w * 4));
  let s = seed >>> 0;
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0; // filter byte 0
    for (let x = 0; x < w; x++) {
      s = (s * 1103515245 + 12345) >>> 0;
      const off = y * (1 + w * 4) + 1 + x * 4;
      raw[off] = (s >> 8) & 0xff;
      raw[off + 1] = (s >> 16) & 0xff;
      raw[off + 2] = (s >> 24) & 0xff;
      raw[off + 3] = 0xff;
    }
  }
  // zlib compress raw (fastest)
  const idat = deflateSync(raw, { level: 1 });

  // tEXt chunk for label (so test can verify)
  const text = Buffer.concat([
    Buffer.from('Comment\x00', 'ascii'),
    Buffer.from(label, 'utf-8'),
  ]);

  return Buffer.concat([
    PNG_SIG,
    chunk('IHDR', ihdr),
    chunk('tEXt', text),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
