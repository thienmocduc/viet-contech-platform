/**
 * auth.ts — Email-OTP based auth (Gmail SMTP).
 *
 * Routes:
 *   POST   /register/start   { name, year, email, phone, role? } -> { sessionId }
 *   POST   /register/verify  { sessionId, otp } -> set cookie, { user }
 *   POST   /login            { email, otp? } — neu khong otp se gui OTP, tra sessionId
 *   POST   /login/verify     { sessionId, otp } -> set cookie, { user }
 *   POST   /logout           clear cookie + revoke session
 *   GET    /me               { user } neu auth, 401 neu khong
 */

import { Hono } from 'hono';
import { setCookie, deleteCookie } from 'hono/cookie';
import { z } from 'zod';
import crypto from 'node:crypto';
import { env, isProd } from '../env.js';
import { exec, queryOne } from '../lib/db.js';
import { uid, nowIso } from '../lib/uid.js';
import { signJwt } from '../lib/jwt.js';
import { startOtp, verifyOtp } from '../lib/email-otp.js';
import { requireAuth, type AuthUser } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';

// ============================================================
// Schemas
// ============================================================
const RegisterStartSchema = z.object({
  name: z.string().trim().min(2).max(100),
  year: z.number().int().min(1900).max(2100),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[^\s@]+@gmail\.com$/i, 'Email phai la @gmail.com'),
  phone: z.string().trim().regex(/^[0-9+\-()\s]{8,16}$/, 'So dien thoai khong hop le'),
  role: z.enum(['client', 'kts', 'engineer']).default('client'),
});

const VerifySchema = z.object({
  sessionId: z.string().uuid(),
  otp: z.string().regex(/^\d{4,8}$/),
});

const LoginStartSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
});

// ============================================================
// Helpers
// ============================================================

interface RegisterPayload {
  name: string;
  year: number;
  email: string;
  phone: string;
  role: string;
}

interface LoginPayload {
  email: string;
}

function setAuthCookie(c: Parameters<typeof setCookie>[0], token: string): void {
  setCookie(c, env.COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: env.COOKIE_SECURE || isProd(),
    path: '/',
    maxAge: env.JWT_TTL_SECONDS,
    domain: env.COOKIE_DOMAIN || undefined,
  });
}

async function issueSessionAndCookie(
  c: Parameters<typeof setCookie>[0],
  user: { id: string; role: string; email: string; name: string },
  ip: string | null,
  ua: string | null,
): Promise<{ token: string; jti: string }> {
  const jti = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + env.JWT_TTL_SECONDS * 1000).toISOString();
  exec(
    `INSERT INTO sessions (id, user_id, jti, ip, ua, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [uid('sess'), user.id, jti, ip, ua, expiresAt],
  );
  const token = await signJwt({
    sub: user.id,
    role: user.role,
    jti,
    email: user.email,
    name: user.name,
  });
  setAuthCookie(c, token);
  return { token, jti };
}

interface DbUserRow {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
}

// ============================================================
// Router
// ============================================================
export function createAuthRouter(): Hono {
  const app = new Hono();

  // ---- POST /register/start ----
  app.post('/register/start', async (c) => {
    const json = await c.req.json().catch(() => null);
    const parsed = RegisterStartSchema.safeParse(json);
    if (!parsed.success) {
      return c.json({ ok: false, error: 'invalid_input', issues: parsed.error.issues }, 400);
    }
    const { name, year, email, phone, role } = parsed.data;

    const existing = queryOne<DbUserRow>('SELECT id FROM users WHERE email=?', [email]);
    if (existing) {
      return c.json({ ok: false, error: 'email_exists' }, 409);
    }

    const result = await startOtp<RegisterPayload>({
      email,
      name,
      payload: { name, year, email, phone, role },
      purpose: 'register',
    });
    return c.json({
      ok: true,
      sessionId: result.sessionId,
      ...(result.otpDevPreview ? { otpDevPreview: result.otpDevPreview } : {}),
    });
  });

  // ---- POST /register/verify ----
  app.post('/register/verify', async (c) => {
    const json = await c.req.json().catch(() => null);
    const parsed = VerifySchema.safeParse(json);
    if (!parsed.success) return c.json({ ok: false, error: 'invalid_input' }, 400);

    const v = verifyOtp<RegisterPayload>(parsed.data.sessionId, parsed.data.otp);
    if (!v.ok || !v.payload) {
      return c.json({ ok: false, error: v.error ?? 'verify_failed' }, 401);
    }

    // Race: re-check email
    const dup = queryOne<DbUserRow>('SELECT id FROM users WHERE email=?', [v.payload.email]);
    if (dup) return c.json({ ok: false, error: 'email_exists' }, 409);

    const id = uid('usr');
    exec(
      `INSERT INTO users (id, email, name, year_born, phone_zalo, role, status, last_login_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`,
      [id, v.payload.email, v.payload.name, v.payload.year, v.payload.phone, v.payload.role, nowIso()],
    );
    audit({
      action: 'auth.register',
      actor: id,
      target_type: 'user',
      target_id: id,
      after: { email: v.payload.email, role: v.payload.role },
      ip: c.req.header('x-forwarded-for') ?? null,
      ua: c.req.header('user-agent') ?? null,
    });
    const user: DbUserRow = {
      id,
      email: v.payload.email,
      name: v.payload.name,
      role: v.payload.role,
      status: 'active',
    };
    await issueSessionAndCookie(
      c,
      user,
      c.req.header('x-forwarded-for') ?? null,
      c.req.header('user-agent') ?? null,
    );
    return c.json({ ok: true, user: { id, name: user.name, email: user.email, role: user.role } });
  });

  // ---- POST /login ----
  app.post('/login', async (c) => {
    const json = await c.req.json().catch(() => null);
    const parsed = LoginStartSchema.safeParse(json);
    if (!parsed.success) return c.json({ ok: false, error: 'invalid_input' }, 400);

    const u = queryOne<DbUserRow>(
      'SELECT id, email, name, role, status FROM users WHERE email=?',
      [parsed.data.email],
    );
    if (!u || u.status !== 'active') return c.json({ ok: false, error: 'no_account' }, 404);

    const result = await startOtp<LoginPayload>({
      email: u.email,
      name: u.name,
      payload: { email: u.email },
      purpose: 'login',
    });
    return c.json({
      ok: true,
      sessionId: result.sessionId,
      ...(result.otpDevPreview ? { otpDevPreview: result.otpDevPreview } : {}),
    });
  });

  // ---- POST /login/verify ----
  app.post('/login/verify', async (c) => {
    const json = await c.req.json().catch(() => null);
    const parsed = VerifySchema.safeParse(json);
    if (!parsed.success) return c.json({ ok: false, error: 'invalid_input' }, 400);

    const v = verifyOtp<LoginPayload>(parsed.data.sessionId, parsed.data.otp);
    if (!v.ok || !v.payload) {
      return c.json({ ok: false, error: v.error ?? 'verify_failed' }, 401);
    }
    const u = queryOne<DbUserRow>(
      'SELECT id, email, name, role, status FROM users WHERE email=?',
      [v.payload.email],
    );
    if (!u || u.status !== 'active') return c.json({ ok: false, error: 'no_account' }, 404);

    exec('UPDATE users SET last_login_at=? WHERE id=?', [nowIso(), u.id]);
    await issueSessionAndCookie(
      c,
      u,
      c.req.header('x-forwarded-for') ?? null,
      c.req.header('user-agent') ?? null,
    );
    audit({
      action: 'auth.login',
      actor: u.id,
      target_type: 'user',
      target_id: u.id,
      ip: c.req.header('x-forwarded-for') ?? null,
      ua: c.req.header('user-agent') ?? null,
    });
    return c.json({ ok: true, user: { id: u.id, name: u.name, email: u.email, role: u.role } });
  });

  // ---- POST /logout ----
  app.post('/logout', requireAuth, async (c) => {
    const user = c.get('user') as AuthUser;
    exec('UPDATE sessions SET revoked=1 WHERE jti=?', [user.jti]);
    deleteCookie(c, env.COOKIE_NAME, { path: '/' });
    audit({
      action: 'auth.logout',
      actor: user.id,
      target_type: 'session',
      target_id: user.jti,
    });
    return c.json({ ok: true });
  });

  // ---- GET /me ----
  app.get('/me', requireAuth, (c) => {
    const u = c.get('user') as AuthUser;
    return c.json({
      ok: true,
      user: { id: u.id, name: u.name, email: u.email, role: u.role },
    });
  });

  return app;
}
