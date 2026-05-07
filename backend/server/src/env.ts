/**
 * env.ts — Validate va export config tu process.env voi Zod.
 * Goi trong moi module su dung de fail-fast khi thieu bien.
 */

import { z } from 'zod';

const truthy = z
  .union([z.string(), z.boolean()])
  .transform((v) => v === true || v === 'true' || v === '1');

const csvList = z
  .string()
  .default('')
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

const Schema = z.object({
  // HTTP
  PORT: z.coerce.number().int().positive().default(8787),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // CORS
  CORS_ORIGINS: csvList.default('http://localhost:5173,http://localhost:3000'),

  // JWT
  JWT_SECRET: z
    .string()
    .min(16, 'JWT_SECRET phai >= 16 ky tu')
    .default('dev-only-jwt-secret-change-me-please-32+'),
  JWT_ISSUER: z.string().default('viet-contech.com'),
  JWT_AUDIENCE: z.string().default('vct-design-platform'),
  JWT_TTL_SECONDS: z.coerce.number().int().positive().default(60 * 60 * 24 * 7),

  // Cookie
  COOKIE_NAME: z.string().default('vct_session'),
  COOKIE_SECURE: truthy.default(false),
  COOKIE_DOMAIN: z.string().optional().default(''),

  // DB
  VCT_DB_PATH: z.string().default('data/vct.db'),

  // SMTP
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().int().positive().default(465),
  SMTP_SECURE: truthy.default(true),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  SMTP_FROM: z.string().default(''),

  // OTP
  OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  OTP_LENGTH: z.coerce.number().int().min(4).max(10).default(6),

  // Rate-limit
  RATE_LIMIT_USER_RPM: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_IP_RPM: z.coerce.number().int().positive().default(1000),

  // Providers
  ZENI_L3_API_KEY: z.string().optional().default(''),
  ZENI_L3_BASE_URL: z.string().url().default('https://api.zeni.cloud/v1'),

  // Public
  PUBLIC_BASE_URL: z.string().default('http://localhost:8787'),
});

export type Env = z.infer<typeof Schema>;

function loadEnv(): Env {
  const parsed = Schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    // eslint-disable-next-line no-console
    console.error('[ENV] config khong hop le:\n' + issues);
    throw new Error('Invalid env config');
  }
  return parsed.data;
}

export const env: Env = loadEnv();

// Tien ich
export function isProd(): boolean {
  return env.NODE_ENV === 'production';
}
export function smtpConfigured(): boolean {
  return Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);
}
