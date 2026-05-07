/**
 * ImageProvider — common interface cho cac provider sinh anh.
 *
 *   Zeni L3 (sd-lora-interior)  → primary
 *   Replicate (mock-stub)        → fallback
 *   OpenAI gpt-image-1 (mock)    → fallback
 *   MockProvider                 → dev / unit test
 */

import type { Resolution } from '../types.js';

export interface ProviderRequest {
  prompt: string;
  negative_prompt: string;
  resolution: Resolution;
  hdr?: boolean;
  seed?: number;
  /** Optional human-readable label for mock placeholder text */
  label?: string;
}

export interface ProviderResponse {
  bytes: Buffer;
  provider: string;
  hash: string;
  seed: number;
  cost_usd: number;
  cost_vnd: number;
  duration_ms: number;
}

export interface ImageProvider {
  readonly name: string;
  generate(req: ProviderRequest): Promise<ProviderResponse>;
  isMock(): boolean;
}
