/**
 * auth.ts — JWT verify middleware cho Hono.
 *
 * - Doc cookie env.COOKIE_NAME hoac Authorization: Bearer <token>
 * - Set c.set('user', { id, role, email, name }) khi pass
 * - 401 khi thieu/sai token
 */
import { getCookie } from 'hono/cookie';
import { env } from '../env.js';
import { verifyJwt } from '../lib/jwt.js';
import { queryOne } from '../lib/db.js';
async function readToken(c) {
    const cookie = getCookie(c, env.COOKIE_NAME);
    if (cookie)
        return cookie;
    const auth = c.req.header('authorization') || c.req.header('Authorization');
    if (auth && auth.toLowerCase().startsWith('bearer ')) {
        return auth.slice(7).trim();
    }
    return null;
}
async function verifyAndLoadUser(token) {
    let claims;
    try {
        claims = await verifyJwt(token);
    }
    catch {
        return null;
    }
    // Check session not revoked
    const sess = queryOne('SELECT revoked, expires_at FROM sessions WHERE jti=? LIMIT 1', [claims.jti]);
    if (!sess || sess.revoked === 1)
        return null;
    if (new Date(sess.expires_at).getTime() < Date.now())
        return null;
    const u = queryOne('SELECT id, role, email, name, status FROM users WHERE id=? LIMIT 1', [claims.sub]);
    if (!u || u.status !== 'active')
        return null;
    return { id: u.id, role: u.role, email: u.email, name: u.name, jti: claims.jti };
}
export const requireAuth = async (c, next) => {
    const token = await readToken(c);
    if (!token)
        return c.json({ ok: false, error: 'unauthorized' }, 401);
    const user = await verifyAndLoadUser(token);
    if (!user)
        return c.json({ ok: false, error: 'unauthorized' }, 401);
    c.set('user', user);
    await next();
};
export const optionalAuth = async (c, next) => {
    const token = await readToken(c);
    if (token) {
        const user = await verifyAndLoadUser(token);
        if (user)
            c.set('user', user);
    }
    await next();
};
export function requireRole(...roles) {
    return async (c, next) => {
        const u = c.get('user');
        if (!u)
            return c.json({ ok: false, error: 'unauthorized' }, 401);
        if (!roles.includes(u.role))
            return c.json({ ok: false, error: 'forbidden' }, 403);
        await next();
    };
}
//# sourceMappingURL=auth.js.map