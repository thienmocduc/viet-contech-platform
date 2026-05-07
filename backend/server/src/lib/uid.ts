/**
 * uid.ts — Sinh ID prefix theo dang `<prefix>_<base32>` rieng cho server.
 */

import crypto from 'node:crypto';

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'; // crockford-32-like (no i,l,o,u)

function rand(len: number): string {
  const buf = crypto.randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) {
    s += ALPHABET[buf[i] % ALPHABET.length];
  }
  return s;
}

export function uid(prefix: string, length = 12): string {
  return `${prefix}_${rand(length)}`;
}

export function uidUuid(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
