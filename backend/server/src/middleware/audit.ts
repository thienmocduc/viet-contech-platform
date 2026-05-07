/**
 * audit-mw.ts — Auto-log mutation API call vao audit_log.
 *
 * Hook sau khi response san sang. Chi log POST/PATCH/PUT/DELETE va status 2xx.
 */

import type { Context, MiddlewareHandler, Next } from 'hono';
import { audit } from '../lib/audit.js';

const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

export const auditMw: MiddlewareHandler = async (c: Context, next: Next) => {
  await next();
  try {
    if (!MUTATING.has(c.req.method)) return;
    if (c.res.status >= 400) return;
    const user = c.get('user') as { id: string } | undefined;
    audit({
      action: `${c.req.method.toLowerCase()} ${new URL(c.req.url).pathname}`,
      actor: user?.id ?? 'anonymous',
      target_type: 'http',
      target_id: new URL(c.req.url).pathname,
      ip: c.req.header('x-forwarded-for') ?? null,
      ua: c.req.header('user-agent') ?? null,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[audit] log failed', e);
  }
};
