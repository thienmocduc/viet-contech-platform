/**
 * jwt.ts — JWT sign/verify dung jose (HS256).
 *
 * Token claims:
 *   sub  = user_id
 *   role = user role
 *   jti  = session id (de revoke)
 *   iss / aud / exp tu env
 */

import { SignJWT, jwtVerify } from 'jose';
import type { JWTPayload } from 'jose';
import { env } from '../env.js';

const secret = new TextEncoder().encode(env.JWT_SECRET);

export interface VctClaims extends JWTPayload {
  sub: string;
  role: string;
  jti: string;
  email?: string;
  name?: string;
}

export async function signJwt(claims: Omit<VctClaims, 'iat' | 'exp' | 'iss' | 'aud'>): Promise<string> {
  return new SignJWT(claims as JWTPayload)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setIssuer(env.JWT_ISSUER)
    .setAudience(env.JWT_AUDIENCE)
    .setExpirationTime(`${env.JWT_TTL_SECONDS}s`)
    .sign(secret);
}

export async function verifyJwt(token: string): Promise<VctClaims> {
  const { payload } = await jwtVerify(token, secret, {
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
  });
  if (!payload.sub || !payload.jti) {
    throw new Error('Token thieu sub/jti');
  }
  return payload as VctClaims;
}
