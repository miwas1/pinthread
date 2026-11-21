import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { customAlphabet } from 'nanoid';
import { ID_ALPHABET } from '@pinthread/shared';

export const newId = customAlphabet(ID_ALPHABET, 10);
export const newLongId = customAlphabet(ID_ALPHABET, 16);

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public extra: Record<string, unknown> = {}) {
    super(message);
  }
}

export const sha1hex = (s: string) => createHash('sha1').update(s).digest('hex');
export const sha256hex = (s: string) => createHash('sha256').update(s).digest('hex');

export function hmac(secret: string, data: string) {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Stable JSON for hashing (sorted keys). */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as object).sort().map(k => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

export const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);
export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Simple fixed-window rate limiter keyed by string. */
export function rateLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  return (key: string) => {
    const now = Date.now();
    const h = hits.get(key);
    if (!h || h.reset < now) { hits.set(key, { n: 1, reset: now + windowMs }); return true; }
    h.n += 1;
    return h.n <= limit;
  };
}
