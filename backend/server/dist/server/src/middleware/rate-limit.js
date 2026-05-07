/**
 * rate-limit.ts — Token-bucket trong process.
 *
 * - per IP: env.RATE_LIMIT_IP_RPM
 * - per user (sau khi auth): env.RATE_LIMIT_USER_RPM
 *
 * Bucket reset moi 60s.
 */
import { env } from '../env.js';
const ipBuckets = new Map();
const userBuckets = new Map();
const WINDOW_MS = 60_000;
function take(map, key, limit) {
    const now = Date.now();
    const b = map.get(key);
    if (!b || b.resetAt < now) {
        map.set(key, { count: 1, resetAt: now + WINDOW_MS });
        return true;
    }
    b.count += 1;
    return b.count <= limit;
}
function clientIp(c) {
    return (c.req.header('cf-connecting-ip') ||
        c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
        c.req.header('x-real-ip') ||
        'unknown');
}
export const rateLimitMw = async (c, next) => {
    const ip = clientIp(c);
    if (!take(ipBuckets, ip, env.RATE_LIMIT_IP_RPM)) {
        return c.json({ ok: false, error: 'rate_limited_ip' }, 429);
    }
    const user = c.get('user');
    if (user) {
        if (!take(userBuckets, user.id, env.RATE_LIMIT_USER_RPM)) {
            return c.json({ ok: false, error: 'rate_limited_user' }, 429);
        }
    }
    await next();
};
//# sourceMappingURL=rate-limit.js.map