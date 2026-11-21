import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { SignJWT, jwtVerify } from 'jose';
import type { Context, Next } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { initialsOf, isRole, type Account, type Role } from '@pinthread/shared';
import { config } from './config';
import { sql } from './db';
import { HttpError, hmac, safeEqual } from './util';

const key = () => new TextEncoder().encode(config.sessionSecret);

export interface UserRow {
  id: string; project_id: string; role: Role; name: string; firm: string; initials: string;
  can_hold: boolean; token: string | null; first_connected_at: Date | null;
  account_id: string | null; is_admin: boolean; active: boolean; email: string | null; created_at: Date;
}

export interface AccountRow {
  id: string; email: string; name: string; firm: string; password_hash: string; created_at: Date; last_login_at: Date | null;
  sessions_valid_after: Date;
}

export const accountDto = (a: AccountRow): Account => ({ id: a.id, email: a.email, name: a.name, firm: a.firm, initials: initialsOf(a.name) });

// ---------------------------------------------------------------- project (membership) sessions: bearer JWT per tab

export async function signSession(userId: string, projectId: string, ttl = '7d') {
  return new SignJWT({ pid: projectId, typ: 'member' }).setProtectedHeader({ alg: 'HS256' }).setSubject(userId)
    .setIssuedAt().setExpirationTime(ttl).sign(key());
}

export async function verifySession(token: string): Promise<{ userId: string; projectId: string }> {
  try {
    const { payload } = await jwtVerify(token, key());
    if (payload.typ === 'account') throw new Error('wrong token type');
    return { userId: String(payload.sub), projectId: String(payload.pid) };
  } catch {
    throw new HttpError(401, 'unauthorized', 'Your session has expired. Open the project again.');
  }
}

export async function requireUser(c: Context, next: Next) {
  const h = c.req.header('authorization') ?? '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : c.req.query('session') ?? '';
  if (!token) throw new HttpError(401, 'unauthorized', 'Sign in to continue.');
  const { userId } = await verifySession(token);
  const [user] = await sql<UserRow[]>`select * from users where id = ${userId}`;
  if (!user) throw new HttpError(401, 'unauthorized', 'This project no longer exists.');
  if (!user.active) throw new HttpError(403, 'removed', 'You are no longer a member of this project.');
  c.set('user', user);
  await next();
}

export const userOf = (c: Context) => c.get('user') as UserRow;

/** Signed invite for a role in a demo project: lets a second device join without an account. */
export function inviteSig(projectId: string, role: Role, exp: number) {
  return hmac(config.inviteSecret, `${projectId}:${role}:${exp}`);
}

export function verifyInvite(projectId: string, role: string, exp: number, sig: string) {
  if (!isRole(role)) throw new HttpError(400, 'bad_role', 'Unknown role.');
  if (!exp || exp < Date.now()) throw new HttpError(410, 'invite_expired', 'This invite has expired. Ask whoever sent it for a new QR.');
  if (!safeEqual(inviteSig(projectId, role, exp), sig)) throw new HttpError(403, 'invite_invalid', 'This invite link is not valid.');
  return role;
}

// ---------------------------------------------------------------- accounts: password + httpOnly cookie

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password.normalize('NFKC'), salt, 64, SCRYPT);
  return `s1$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [v, salt, hash] = stored.split('$');
  if (v !== 's1' || !salt || !hash) return false;
  const want = Buffer.from(hash, 'base64url');
  const got = await scrypt(password.normalize('NFKC'), Buffer.from(salt, 'base64url'), want.length, SCRYPT);
  return got.length === want.length && timingSafeEqual(got, want);
}

/** A real hash to compare against when the email is unknown, so response time does not reveal which emails exist. */
let decoy: Promise<string> | null = null;
export const decoyHash = () => (decoy ??= hashPassword(randomBytes(12).toString('hex')));

export const AUTH_COOKIE = 'pt_auth';
const ACCOUNT_TTL_DAYS = 30;
const secureCookies = () => config.isProd || config.publicUrl.startsWith('https://');

export async function startAccountSession(c: Context, accountId: string) {
  const jwt = await new SignJWT({ typ: 'account' }).setProtectedHeader({ alg: 'HS256' }).setSubject(accountId)
    .setIssuedAt().setExpirationTime(`${ACCOUNT_TTL_DAYS}d`).sign(key());
  setCookie(c, AUTH_COOKIE, jwt, { httpOnly: true, sameSite: 'Lax', secure: secureCookies(), path: '/', maxAge: ACCOUNT_TTL_DAYS * 86400 });
}

export function endAccountSession(c: Context) {
  deleteCookie(c, AUTH_COOKIE, { path: '/', secure: secureCookies() });
}

export async function accountFromCookie(c: Context): Promise<AccountRow | null> {
  const token = getCookie(c, AUTH_COOKIE);
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key());
    if (payload.typ !== 'account' || !payload.sub) return null;
    const [a] = await sql<AccountRow[]>`select * from accounts where id = ${payload.sub}`;
    if (!a) return null;
    // Cookies issued before the last password change (or "log out everywhere") are no longer valid.
    if ((payload.iat ?? 0) < Math.floor(new Date(a.sessions_valid_after).getTime() / 1000)) return null;
    return a;
  } catch {
    return null;
  }
}

export async function requireAccount(c: Context, next: Next) {
  const a = await accountFromCookie(c);
  if (!a) throw new HttpError(401, 'signed_out', 'Log in to continue.');
  c.set('account', a);
  await next();
}

export const accountOf = (c: Context) => c.get('account') as AccountRow;

/**
 * CSRF guard for cookie-authenticated writes: browsers cannot add a custom header to a cross-site request without a CORS
 * preflight, which this server never grants. SameSite=Lax on the cookie is the second layer.
 */
export async function requireAppHeader(c: Context, next: Next) {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && c.req.header('x-pinthread') !== '1') {
    throw new HttpError(403, 'csrf', 'Request blocked. Reload the page and try again.');
  }
  await next();
}
