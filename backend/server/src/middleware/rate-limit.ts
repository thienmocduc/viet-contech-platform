/**
 * rate-limit.ts — Token-bucket trong process.
 *
 * - per IP: env.RATE_LIMIT_IP_RPM
 * - per user (sau khi auth): env.RATE_LIMIT_USER_RPM
 *
 * Bucket reset moi 60s.
 */

import type { Context, MiddlewareHandler, Next } from 'hono';
import { env } from '../env.js';

interface Bucket {
  count: number;
  resetAt: number;
}

const ipBuckets = new Map<string, Bucket>();
const userBuckets = new Map<string, Bucket>();

const WINDOW_MS = 60_000;

function take(map: Map<string, Bucket>, key: string, limit: number): boolean {
  const now = Date.now();
  const b = map.get(key);
  if (!b || b.resetAt < now) {
    map.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  b.count += 1;
  return b.count <= limit;
}

function clientIp(c: Context): string {
  return (
    c.req.header('cf-connecting-ip') ||
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    'unknown'
  );
}

export const rateLimitMw: MiddlewareHandler = async (c: Context, next: Next) => {
  const ip = clientIp(c);
  if (!take(ipBuckets, ip, env.RATE_LIMIT_IP_RPM)) {
    return c.json({ ok: false, error: 'rate_limited_ip' }, 429);
  }
  const user = c.get('user') as { id: string } | undefined;
  if (user) {
    if (!take(userBuckets, user.id, env.RATE_LIMIT_USER_RPM)) {
      return c.json({ ok: false, error: 'rate_limited_user' }, 429);
    }
  }
  await next();
};
