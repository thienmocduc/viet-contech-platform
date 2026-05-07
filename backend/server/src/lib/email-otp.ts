/**
 * email-otp.ts — In-memory OTP store + send qua nodemailer Gmail SMTP.
 *
 * Hoat dong:
 *   1) startSession({email, payload}) -> {sessionId, otp}, send mail
 *   2) verifyOtp(sessionId, otp) -> payload | error
 *
 * Tinh nang:
 *   - TTL 5 phut (tu env.OTP_TTL_SECONDS)
 *   - Max 5 attempts (tu env.OTP_MAX_ATTEMPTS) — sau do session bi xoa
 *   - Khi SMTP chua cau hinh: dev mode — in OTP ra console (KHONG send)
 *   - Template HTML rose-gold (mau nhan dien Viet-Contech)
 */

import crypto from 'node:crypto';
import nodemailer, { type Transporter } from 'nodemailer';
import { env, smtpConfigured } from '../env.js';

interface OtpSession<T> {
  sessionId: string;
  email: string;
  otpHash: string;
  payload: T;
  createdAt: number;
  expiresAt: number;
  attempts: number;
}

const sessions: Map<string, OtpSession<unknown>> = new Map();

let transporter: Transporter | null = null;
function getTransporter(): Transporter | null {
  if (!smtpConfigured()) return null;
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  });
  return transporter;
}

function genOtp(len = env.OTP_LENGTH): string {
  let s = '';
  while (s.length < len) {
    s += crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
  }
  return s.slice(0, len);
}

function hashOtp(otp: string, sessionId: string): string {
  return crypto.createHmac('sha256', env.JWT_SECRET).update(`${sessionId}:${otp}`).digest('hex');
}

function purgeExpired(): void {
  const now = Date.now();
  for (const [k, v] of sessions) {
    if (v.expiresAt < now) sessions.delete(k);
  }
}

const ROSE = '#B76E79';
const INK = '#1f2937';

function renderHtml(otp: string, name: string): string {
  return `<!doctype html>
<html lang="vi">
<head><meta charset="utf-8"><title>Viet-Contech OTP</title></head>
<body style="margin:0;background:#faf7f5;font-family:Inter,system-ui,Arial,sans-serif;color:${INK};">
  <div style="max-width:520px;margin:32px auto;background:#fff;border:1px solid #f0e0dc;border-radius:16px;overflow:hidden;">
    <div style="padding:20px 28px;background:linear-gradient(120deg, ${ROSE}, #d39ba2);color:#fff;">
      <div style="font-size:13px;letter-spacing:.18em;text-transform:uppercase;opacity:.85;">VIET-CONTECH DESIGN PLATFORM</div>
      <div style="font-size:22px;font-weight:700;margin-top:6px;">Ma OTP cua ban</div>
    </div>
    <div style="padding:24px 28px;">
      <p style="margin:0 0 12px;">Xin chao <b>${escapeHtml(name)}</b>,</p>
      <p style="margin:0 0 16px;">Ban vua yeu cau ma xac thuc cho tai khoan Viet-Contech. Ma co hieu luc <b>${Math.floor(env.OTP_TTL_SECONDS / 60)} phut</b>:</p>
      <div style="text-align:center;margin:18px 0;">
        <div style="display:inline-block;font-family:'JetBrains Mono',monospace;font-size:32px;font-weight:700;letter-spacing:8px;color:${ROSE};border:2px dashed ${ROSE};padding:14px 24px;border-radius:12px;">${otp}</div>
      </div>
      <p style="font-size:13px;color:#6b7280;margin:0;">Neu khong phai ban, hay bo qua email nay. Khong bao gio chia se OTP voi nguoi khac.</p>
    </div>
    <div style="padding:14px 28px;border-top:1px solid #f3e8e6;background:#fffaf8;color:#9b6a72;font-size:12px;">
      Viet-Contech &copy; ${new Date().getFullYear()} — Thiet ke biet thu nha pho cao cap
    </div>
  </div>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

// ============================================================
// Public API
// ============================================================

export interface StartOtpResult {
  sessionId: string;
  /** Chi return OTP trong dev mode (khong cau hinh SMTP) — production luon undefined */
  otpDevPreview?: string;
}

export async function startOtp<T>(opts: {
  email: string;
  name?: string;
  payload: T;
  purpose: 'register' | 'login';
}): Promise<StartOtpResult> {
  purgeExpired();
  const sessionId = crypto.randomUUID();
  const otp = genOtp();
  const session: OtpSession<T> = {
    sessionId,
    email: opts.email.toLowerCase(),
    otpHash: hashOtp(otp, sessionId),
    payload: opts.payload,
    createdAt: Date.now(),
    expiresAt: Date.now() + env.OTP_TTL_SECONDS * 1000,
    attempts: 0,
  };
  sessions.set(sessionId, session as OtpSession<unknown>);

  const t = getTransporter();
  const subject =
    opts.purpose === 'register'
      ? `[Viet-Contech] OTP dang ky — ${otp}`
      : `[Viet-Contech] OTP dang nhap — ${otp}`;

  if (!t) {
    // eslint-disable-next-line no-console
    console.log(`[OTP] DEV MODE — email=${session.email} otp=${otp} session=${sessionId}`);
    return { sessionId, otpDevPreview: otp };
  }

  await t.sendMail({
    from: env.SMTP_FROM || env.SMTP_USER,
    to: session.email,
    subject,
    text: `Ma OTP Viet-Contech cua ban: ${otp}\nHieu luc ${Math.floor(env.OTP_TTL_SECONDS / 60)} phut.`,
    html: renderHtml(otp, opts.name ?? 'Quy khach'),
  });

  return { sessionId };
}

export interface VerifyResult<T> {
  ok: boolean;
  payload?: T;
  email?: string;
  error?: 'expired' | 'wrong_otp' | 'too_many_attempts' | 'no_session';
}

export function verifyOtp<T>(sessionId: string, otp: string): VerifyResult<T> {
  purgeExpired();
  const s = sessions.get(sessionId) as OtpSession<T> | undefined;
  if (!s) return { ok: false, error: 'no_session' };
  if (s.expiresAt < Date.now()) {
    sessions.delete(sessionId);
    return { ok: false, error: 'expired' };
  }
  s.attempts += 1;
  if (s.attempts > env.OTP_MAX_ATTEMPTS) {
    sessions.delete(sessionId);
    return { ok: false, error: 'too_many_attempts' };
  }
  if (hashOtp(otp, sessionId) !== s.otpHash) {
    return { ok: false, error: 'wrong_otp' };
  }
  // OK — pop
  sessions.delete(sessionId);
  return { ok: true, payload: s.payload, email: s.email };
}

/** Dung trong test de check session count khong leak. */
export function _otpSessionsCount(): number {
  return sessions.size;
}
