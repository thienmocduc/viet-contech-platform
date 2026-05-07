/**
 * MockProvider — sinh PNG placeholder co label de development / unit test.
 *
 * Re-uses cac util tu zeni-l3 (mock branch) qua composition: mockGenerate
 * tao PNG 64x64 RGBA voi label "MOCK render: <style> <room> <angle>"
 * trong tEXt chunk + RGB pixels deterministic theo seed.
 *
 * Ket qua: bytes la PNG that → sharp co the resize / watermark.
 */

import { ZeniL3Provider } from './zeni-l3.js';
import type { ImageProvider, ProviderRequest, ProviderResponse } from './provider.js';

export interface MockProviderConfig {
  cost_per_image_usd?: number;
  delay_ms?: number;
  vnd_per_usd?: number;
}

export class MockProvider implements ImageProvider {
  readonly name = 'mock';
  private inner: ZeniL3Provider;

  constructor(cfg: MockProviderConfig = {}) {
    if (cfg.delay_ms !== undefined) {
      process.env.ZENI_L3_MOCK_DELAY_MS = String(cfg.delay_ms);
    }
    this.inner = new ZeniL3Provider({
      mock: true,
      cost_per_image_usd: cfg.cost_per_image_usd ?? 0.04,
      vnd_per_usd: cfg.vnd_per_usd ?? 24500,
    });
  }

  isMock(): boolean {
    return true;
  }

  async generate(req: ProviderRequest): Promise<ProviderResponse> {
    const r = await this.inner.generate(req);
    return { ...r, provider: this.name };
  }
}
