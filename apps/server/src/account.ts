// Account API: sign-up, log-in, projects list and creation, drawing uploads, invite acceptance.
// Authenticated with an httpOnly cookie (see auth.ts). Writes also need the X-PinThread header (CSRF guard).
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { ROLES, type InviteInfo, type ProjectListItem } from '@pinthread/shared';
import {
  accountDto, accountFromCookie, accountOf, decoyHash, endAccountSession, hashPassword, requireAccount, requireAppHeader,
  startAccountSession, verifyPassword, type AccountRow, type UserRow,
} from './auth';
import { sessionFor } from './api';
import { sql } from './db';
import { parseBody, sheetSchema } from './schemas';
import { log } from './log';
import { sheetImageUrl, type SheetRow } from './repo';
import { acceptInvite, createTeamProject, liveInvite } from './team';
import { HttpError, imageSize, iso, newLongId, rateLimiter } from './util';

export const accountApi = new Hono();
accountApi.use('/auth/*', requireAppHeader);
accountApi.use('/files', requireAppHeader);
accountApi.use('/invites/*', requireAppHeader);

const parse = parseBody;
const body = async (c: Context) => c.req.json().catch(() => ({}));
const clientIp = (c: Context) => c.req.header('x-forwarded-for')?.split(',')[0].trim() ?? 'local';

const email = z.string().trim().toLowerCase().max(200).email('Enter a valid email address.');
const password = z.string().min(8, 'Use at least 8 characters for your password.').max(200, 'That password is too long.');
const name = z.string().trim().min(2, 'Enter your full name.').max(80, 'That name is too long.');
const firm = z.string().trim().max(80, 'That company name is too long.').default('');

// ---------------------------------------------------------------- auth

const signupLimit = rateLimiter(10, 3600_000);
accountApi.post('/auth/signup', async c => {
  const b = parse(z.object({ name, email, password, firm }), await body(c));
  if (!signupLimit(clientIp(c))) throw new HttpError(429, 'slow_down', 'Too many sign-ups from this network. Try again later.');
  const [exists] = await sql`select 1 from accounts where email = ${b.email}`;
  if (exists) throw new HttpError(409, 'email_taken', 'An account with this email already exists. Log in instead.');
  const id = `a${newLongId()}`;
  const [a] = await sql<AccountRow[]>`insert into accounts (id, email, name, firm, password_hash, last_login_at)
    values (${id}, ${b.email}, ${b.name}, ${b.firm}, ${await hashPassword(b.password)}, now()) on conflict (email) do nothing returning *`;
  if (!a) throw new HttpError(409, 'email_taken', 'An account with this email already exists. Log in instead.');
  await startAccountSession(c, a.id);
  log.info('account.created', { accountId: a.id });
  return c.json({ account: accountDto(a) }, 201);
});

const loginLimit = rateLimiter(10, 15 * 60_000);
accountApi.post('/auth/login', async c => {
  const b = parse(z.object({ email, password: z.string().min(1, 'Enter your password.').max(200) }), await body(c));
  if (!loginLimit(`${clientIp(c)}:${b.email}`)) throw new HttpError(429, 'slow_down', 'Too many attempts. Wait 15 minutes and try again.');
  const [a] = await sql<AccountRow[]>`select * from accounts where email = ${b.email}`;
  const ok = await verifyPassword(b.password, a?.password_hash ?? await decoyHash());
  if (!a || !ok) throw new HttpError(401, 'bad_credentials', "That email and password don't match an account.");
  await sql`update accounts set last_login_at = now() where id = ${a.id}`;
  await startAccountSession(c, a.id);
  return c.json({ account: accountDto(a) });
});

accountApi.post('/auth/logout', c => {
  endAccountSession(c);
  return c.json({ ok: true });
});

accountApi.get('/auth/me', async c => {
  const a = await accountFromCookie(c);
  c.header('Cache-Control', 'no-store');
  return c.json({ account: a ? accountDto(a) : null });
});

accountApi.patch('/auth/me', requireAccount, async c => {
  const a = accountOf(c);
  const b = parse(z.object({ name, firm }), await body(c));
  const [u] = await sql<AccountRow[]>`update accounts set name = ${b.name}, firm = ${b.firm} where id = ${a.id} returning *`;
  const initials = accountDto(u).initials;
  await sql`update users set name = ${b.name}, firm = ${b.firm}, initials = ${initials} where account_id = ${a.id}`;
  return c.json({ account: accountDto(u) });
});

accountApi.post('/auth/password', requireAccount, async c => {
  const a = accountOf(c);
  const b = parse(z.object({ current: z.string().min(1, 'Enter your current password.').max(200), next: password }), await body(c));
  if (!(await verifyPassword(b.current, a.password_hash))) throw new HttpError(400, 'bad_password', 'Your current password is not right.');
  // Sign out every other device; this one gets a fresh cookie.
  // Cookies are compared at one-second precision (JWT iat), using this server's clock for both sides.
  const validAfter = new Date(Math.floor(Date.now() / 1000) * 1000);
  await sql`update accounts set password_hash = ${await hashPassword(b.next)}, sessions_valid_after = ${validAfter} where id = ${a.id}`;
  await startAccountSession(c, a.id);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- projects

accountApi.get('/projects', requireAccount, async c => {
  const a = accountOf(c);
  const rows = await sql<{ id: string; name: string; created_at: Date; updated_at: Date; member_id: string; role: string; is_admin: boolean; members: number }[]>`
    select p.id, p.name, p.created_at, p.updated_at, u.id as member_id, u.role, u.is_admin,
      (select count(*)::int from users x where x.project_id = p.id and x.active) as members
    from users u join projects p on p.id = u.project_id
    where u.account_id = ${a.id} and u.active and p.kind = 'team' order by p.updated_at desc`;
  const ids = rows.map(r => r.id);
  const sheets = ids.length ? await sql<SheetRow[]>`select * from sheets where project_id in ${sql(ids)} order by ord, created_at` : [];
  const stats = ids.length ? await sql<{ project_id: string; issues: number; complete: number; open: number }[]>`
    select project_id, count(*)::int as issues, count(*) filter (where status = 'complete')::int as complete,
      count(*) filter (where status <> 'complete')::int as open from pins where project_id in ${sql(ids)} group by project_id` : [];
  const waiting = rows.length ? await sql<{ project_id: string; n: number }[]>`
    select p.project_id, count(*)::int as n from pins p
    join pin_reviewers r on r.pin_id = p.id and r.user_id in ${sql(rows.map(r => r.member_id))}
    join sheets s on s.id = p.sheet_id
    where p.status in ('open', 'review') and not exists (
      select 1 from signoffs so where so.proposal_id = p.current_proposal_id and so.reviewer_id = r.user_id and so.verdict = 'approve' and so.revision = s.revision)
    group by p.project_id` : [];
  const list: ProjectListItem[] = rows.map(r => {
    const st = stats.find(s => s.project_id === r.id);
    return {
      id: r.id, name: r.name, role: r.role as ProjectListItem['role'], isAdmin: r.is_admin, members: r.members,
      sheets: sheets.filter(s => s.project_id === r.id).map(s => ({ id: s.id, number: s.number, title: s.title, revision: s.revision, imageUrl: s.thumb_file_id ? `/api/sheets/${s.id}/thumb?v=${s.thumb_file_id}` : sheetImageUrl(s) })),
      issues: st?.issues ?? 0, complete: st?.complete ?? 0, open: st?.open ?? 0, waitingOnMe: waiting.find(w => w.project_id === r.id)?.n ?? 0,
      createdAt: iso(r.created_at)!, updatedAt: iso(r.updated_at)!,
    };
  });
  c.header('Cache-Control', 'no-store');
  return c.json({ projects: list });
});


accountApi.post('/projects', requireAppHeader, requireAccount, async c => {
  const b = parse(z.object({
    name: z.string().trim().min(2, 'Give the project a name.').max(80, 'Keep the project name under 80 characters.'),
    role: z.enum(ROLES, { errorMap: () => ({ message: 'Choose your role on this project.' }) }),
    sheet: sheetSchema,
  }), await body(c));
  const projectId = await createTeamProject(accountOf(c), b);
  return c.json({ projectId }, 201);
});

/** Exchange the account cookie for this tab's project session (membership token + Nexconn token). */
accountApi.post('/projects/:id/session', requireAppHeader, requireAccount, async c => {
  const a = accountOf(c);
  const [u] = await sql<UserRow[]>`select * from users where project_id = ${c.req.param('id')} and account_id = ${a.id}`;
  if (!u) throw new HttpError(403, 'not_member', "You're not a member of this project. Ask its admin for an invite link.");
  if (!u.active) throw new HttpError(403, 'removed', 'You were removed from this project. Ask its admin for a new invite link.');
  return c.json(await sessionFor(c, u));
});

// ---------------------------------------------------------------- drawing files

const uploadLimit = rateLimiter(60, 3600_000);
const MAX_FILE = 25 * 1024 * 1024;
const fileBody = bodyLimit({ maxSize: MAX_FILE, onError: () => { throw new HttpError(413, 'too_large', 'Drawings must be under 25 MB.'); } });
accountApi.post('/files', requireAccount, fileBody, async c => {
  const a = accountOf(c);
  if (!uploadLimit(a.id)) throw new HttpError(429, 'slow_down', 'Too many uploads. Try again in an hour.');
  const buf = Buffer.from(await c.req.arrayBuffer());
  const info = imageSize(buf);
  if (!info) throw new HttpError(415, 'unsupported', 'Upload a PDF, PNG or JPG drawing.');
  if (info.width < 64 || info.height < 64 || info.width > 20000 || info.height > 20000) throw new HttpError(400, 'bad_size', 'That image is too small or too large to use as a drawing.');
  const id = `f${newLongId()}`;
  await sql`insert into files (id, account_id, mime, bytes, width, height) values (${id}, ${a.id}, ${info.mime}, ${buf}, ${info.width}, ${info.height})`;
  return c.json({ id, width: info.width, height: info.height }, 201);
});

async function sheetFile(c: Context, which: 'file_id' | 'thumb_file_id') {
  const a = await accountFromCookie(c);
  if (!a) throw new HttpError(401, 'signed_out', 'Log in to view this drawing.');
  const [s] = await sql<SheetRow[]>`select * from sheets where id = ${c.req.param('id')}`;
  if (!s) return c.notFound();
  const [m] = await sql`select 1 from users where project_id = ${s.project_id} and account_id = ${a.id} and active`;
  if (!m) throw new HttpError(403, 'forbidden', 'You are not a member of this project.');
  const fileId = (which === 'thumb_file_id' && s.thumb_file_id) || s.file_id;
  const [f] = fileId ? await sql<{ mime: string; bytes: Buffer }[]>`select mime, bytes from files where id = ${fileId}` : [];
  if (!f) return c.notFound();
  return new Response(new Uint8Array(f.bytes), { headers: { 'Content-Type': f.mime, 'Cache-Control': 'private, max-age=604800, immutable' } });
}
accountApi.get('/sheets/:id/image', c => sheetFile(c, 'file_id'));
accountApi.get('/sheets/:id/thumb', c => sheetFile(c, 'thumb_file_id'));

// ---------------------------------------------------------------- invites

accountApi.get('/invites/:token', async c => {
  const inv = await liveInvite(c.req.param('token'));
  const a = await accountFromCookie(c);
  const [m] = a ? await sql`select 1 from users where project_id = ${inv.project_id} and account_id = ${a.id} and active` : [];
  const info: InviteInfo = { projectId: inv.project_id, project: inv.project_name, role: inv.role, invitedBy: inv.inviter ?? 'A teammate', expiresAt: iso(inv.expires_at)!, alreadyMember: !!m };
  return c.json(info);
});

accountApi.post('/invites/:token/accept', requireAccount, async c => {
  const projectId = await acceptInvite(c.req.param('token'), accountOf(c));
  return c.json({ projectId });
});
