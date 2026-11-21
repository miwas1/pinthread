import { SignJWT, jwtVerify } from 'jose';
import type { Context, Next } from 'hono';
import { isRole, type Role } from '@pinthread/shared';
import { config } from './config';
import { sql } from './db';
import { HttpError, hmac, safeEqual } from './util';

const key = () => new TextEncoder().encode(config.sessionSecret);

export interface UserRow {
  id: string; project_id: string; role: Role; name: string; firm: string; initials: string;
  can_hold: boolean; token: string | null; first_connected_at: Date | null;
}

export async function signSession(userId: string, projectId: string) {
  return new SignJWT({ pid: projectId }).setProtectedHeader({ alg: 'HS256' }).setSubject(userId)
    .setIssuedAt().setExpirationTime('7d').sign(key());
}

export async function verifySession(token: string): Promise<{ userId: string; projectId: string }> {
  try {
    const { payload } = await jwtVerify(token, key());
    return { userId: String(payload.sub), projectId: String(payload.pid) };
  } catch {
    throw new HttpError(401, 'unauthorized', 'Your session has expired. Start the demo again.');
  }
}

export async function requireUser(c: Context, next: Next) {
  const h = c.req.header('authorization') ?? '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : c.req.query('session') ?? '';
  if (!token) throw new HttpError(401, 'unauthorized', 'Sign in to continue.');
  const { userId } = await verifySession(token);
  const [user] = await sql<UserRow[]>`select * from users where id = ${userId}`;
  if (!user) throw new HttpError(401, 'unauthorized', 'This demo project has expired. Start a new one.');
  c.set('user', user);
  await next();
}

export const userOf = (c: Context) => c.get('user') as UserRow;

/** Signed invite for a role in a project: lets a second device join without an account. */
export function inviteSig(projectId: string, role: Role, exp: number) {
  return hmac(config.inviteSecret, `${projectId}:${role}:${exp}`);
}

export function verifyInvite(projectId: string, role: string, exp: number, sig: string) {
  if (!isRole(role)) throw new HttpError(400, 'bad_role', 'Unknown role.');
  if (!exp || exp < Date.now()) throw new HttpError(410, 'invite_expired', 'This invite has expired. Ask whoever sent it for a new QR.');
  if (!safeEqual(inviteSig(projectId, role, exp), sig)) throw new HttpError(403, 'invite_invalid', 'This invite link is not valid.');
  return role;
}
