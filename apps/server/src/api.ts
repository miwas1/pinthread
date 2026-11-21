import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { ROLES, ROLE_INFO, type ClientConfig, type ProjectState, type Role, type SessionResponse, type TeamInfo } from '@pinthread/shared';
import { config } from './config';
import { sql } from './db';
import { gateway } from './chat/gateway';
import { canAccess, localHistory, localHub, localToken, storeAndPublish, verifyLocalToken } from './chat/local';
import { inviteSig, requireUser, signSession, userOf, verifyInvite, type UserRow } from './auth';
import { claimDemoProject } from './demo';
import { addEvidence, clearHold, createPin, newSheetRevision, nudge, placeHold, postProposal, recordExport, removeMember, signoff } from './domain';
import { registerPdf } from './pdf';
import { buildPinRecord, getProject, getSheet, person, projectPeople, projectPins, projectSheets, type SheetRow } from './repo';
import { parseBody, sheetSchema } from './schemas';
import { addSheet, communityForNewPin, createInvite, deleteTeamProject, ownFile, type InviteRow } from './team';
import { HttpError, newLongId, rateLimiter, sha1hex, safeEqual } from './util';
import { log } from './log';

type Env = { Variables: { user: UserRow } };
export const api = new Hono<Env>();

const parse = parseBody;
const body = async (c: Context) => c.req.json().catch(() => ({}));
const origin = (c: Context) => config.publicUrl || new URL(c.req.url).origin.replace(/^http:\/\/(?!localhost|127\.)/, 'https://');
const clientIp = (c: Context) => c.req.header('x-forwarded-for')?.split(',')[0].trim() ?? 'local';

export async function sessionFor(c: Context, user: UserRow): Promise<SessionResponse> {
  if (config.chatMode === 'local') user.token = localToken(user.id); // derived from the current secret, never cached
  else if (!user.token) {
    const token = await gateway().issueToken(user.id, user.name);
    await sql`update users set token = ${token} where id = ${user.id}`;
    user.token = token;
  }
  const project = await getProject(sql, user.project_id);
  const joinLinks: SessionResponse['joinLinks'] = {};
  let heroPinId: string | null = null;
  if (project.kind === 'demo') {
    const exp = Date.now() + 24 * 3600_000;
    const [hero] = await sql<{ id: string }[]>`select id from pins where project_id = ${user.project_id} and number = 1`;
    heroPinId = hero?.id ?? null;
    for (const r of ROLES) {
      if (r === user.role) continue;
      const q = new URLSearchParams({ exp: String(exp), sig: inviteSig(user.project_id, r, exp), ...(hero ? { pin: hero.id } : {}) });
      joinLinks[r] = `${origin(c)}/j/${user.project_id}/${r}?${q}`;
    }
  }
  await sql`insert into analytics (project_id, project_kind, user_id, name) values (${project.id}, ${project.kind}, ${user.id}, 'session.started')`;
  // Team sessions are short-lived: the tab renews them from the account cookie on every load.
  const session = await signSession(user.id, user.project_id, project.kind === 'demo' ? '7d' : '12h');
  return { session, me: person(user), projectId: user.project_id, kind: project.kind, nexconnToken: user.token!, joinLinks, heroPinId };
}

async function assertDemo(projectId: string) {
  const [p] = await sql<{ kind: string }[]>`select kind from projects where id = ${projectId}`;
  if (!p || p.kind !== 'demo') throw new HttpError(404, 'not_found', 'That demo project no longer exists.');
}

async function userByRole(projectId: string, role: Role) {
  await assertDemo(projectId); // acting as a role is a demo feature; team members are real accounts
  const [u] = await sql<UserRow[]>`select * from users where project_id = ${projectId} and role = ${role}`;
  if (!u) throw new HttpError(404, 'not_found', 'That project no longer exists. Start a new demo.');
  return u;
}

function assertProject(user: UserRow, projectId: string) {
  if (user.project_id !== projectId) throw new HttpError(403, 'forbidden', 'You are not a member of this project.');
}
async function assertPinAccess(user: UserRow, pinId: string) {
  const [p] = await sql<{ project_id: string }[]>`select project_id from pins where id = ${pinId}`;
  if (!p) throw new HttpError(404, 'not_found', 'Issue not found.');
  assertProject(user, p.project_id);
}

// ---------------------------------------------------------------- public

api.get('/healthz', c => c.json({ ok: true }));

api.get('/config', c => c.json<ClientConfig>({ chatMode: config.chatMode, appKey: config.chatMode === 'nexconn' ? config.nexconn.appKey : null, areaCode: config.nexconn.area }));

const claimLimit = rateLimiter(20, 3600_000);
api.post('/demo/sessions', async c => {
  const { role } = parse(z.object({ role: z.enum(ROLES).default('mep') }), await body(c));
  if (!claimLimit(clientIp(c))) throw new HttpError(429, 'slow_down', 'Too many demo projects from this network. Try again later.');
  const projectId = await claimDemoProject();
  return c.json(await sessionFor(c, await userByRole(projectId, role)));
});

api.post('/demo/join', async c => {
  const b = parse(z.object({ projectId: z.string().max(20), role: z.string(), exp: z.coerce.number(), sig: z.string().max(100) }), await body(c));
  const role = verifyInvite(b.projectId, b.role, b.exp, b.sig);
  return c.json(await sessionFor(c, await userByRole(b.projectId, role)));
});

api.get('/demo/invite', async c => {
  const projectId = c.req.query('projectId') ?? '', role = c.req.query('role') ?? '';
  const exp = Number(c.req.query('exp')), sig = c.req.query('sig') ?? '';
  const r = verifyInvite(projectId, role, exp, sig);
  await assertDemo(projectId);
  const u = await userByRole(projectId, r);
  const [p] = await sql<{ name: string }[]>`select name from projects where id = ${projectId}`;
  return c.json({ project: p?.name ?? 'Meridian Tower', person: person(u), title: ROLE_INFO[r].title });
});

// Nexconn webhook: user:connection_status (authoritative "real users on Nexconn" for traction metrics).
api.post('/nexconn/webhook', async c => {
  const nonce = c.req.header('nonce') ?? '', ts = c.req.header('timestamp') ?? '', sig = c.req.header('signature') ?? '';
  if (config.chatMode !== 'nexconn' || !safeEqual(sha1hex(config.nexconn.appSecret + nonce + ts), sig)) return c.text('bad signature', 401);
  const evt = await c.req.json().catch(() => null) as { type?: string; data?: { status: string; userId: string; os?: string; time?: number }[] } | null;
  if (evt?.type === 'user:connection_status') {
    for (const d of evt.data ?? []) {
      await sql`insert into presence (user_id, status, os, at) values (${d.userId}, ${d.status}, ${d.os ?? null}, to_timestamp(${(d.time ?? Date.now()) / 1000}))`;
      if (d.status === '0') await sql`update users set first_connected_at = coalesce(first_connected_at, now()) where id = ${d.userId}`;
    }
  }
  return c.text('OK');
});

api.get('/admin/metrics', async c => {
  if (!config.adminKey || c.req.query('key') !== config.adminKey) throw new HttpError(403, 'forbidden', 'Admin key required.');
  const byKind = async (kind: string) => {
    const [r] = await sql`select
      (select count(*)::int from projects where kind = ${kind} and (kind = 'team' or claimed_at is not null)) as projects,
      (select count(distinct u.id)::int from users u join projects p on p.id = u.project_id where p.kind = ${kind} and u.first_connected_at is not null) as users_connected,
      (select count(distinct pr.user_id)::int from presence pr join users u on u.id = pr.user_id join projects p on p.id = u.project_id where p.kind = ${kind} and pr.status = '0') as users_connected_webhook,
      (select count(*)::int from pins pi join projects p on p.id = pi.project_id where p.kind = ${kind} and pi.status = 'complete' and pi.number > case when ${kind} = 'demo' then 4 else 0 end) as issues_completed_new,
      (select count(*)::int from accounts) as accounts,
      (select count(*)::int from events e join projects p on p.id = e.project_id where p.kind = ${kind} and e.type = 'signoff.approve') as approvals,
      (select count(*)::int from projects where kind = ${kind} and exported_at is not null) as registers_exported`;
    return r;
  };
  return c.json({ generatedAt: new Date().toISOString(), chatMode: config.chatMode, team: await byKind('team'), demo: await byKind('demo') });
});

// ---------------------------------------------------------------- authenticated

const authed = new Hono<Env>();
authed.use('*', requireUser);

authed.get('/me', async c => c.json(await sessionFor(c, userOf(c))));

authed.post('/demo/switch-role', async c => {
  const { role } = parse(z.object({ role: z.enum(ROLES) }), await body(c));
  return c.json(await sessionFor(c, await userByRole(userOf(c).project_id, role))); // userByRole refuses team projects
});

authed.post('/me/connected', async c => {
  const u = userOf(c);
  await sql`update users set first_connected_at = coalesce(first_connected_at, now()) where id = ${u.id}`;
  return c.json({ ok: true });
});

authed.get('/projects/:id/state', async c => {
  const u = userOf(c), id = c.req.param('id');
  assertProject(u, id);
  const project = await getProject(sql, id);
  const people = await projectPeople(sql, id);
  const pins = await projectPins(sql, id);
  const sheets = await projectSheets(sql, id);
  const struct = [...people.values()].find(p => p.role === 'struct');
  const hero = pins.find(p => p.number === 'RFI-001');
  const state: ProjectState = {
    project: { id, name: project.name, kind: project.kind, communityId: project.community_id, sheets },
    me: { ...person(u), canHold: u.can_hold, isAdmin: u.is_admin },
    members: [...people.values()].filter(p => p.active).map(p => ({ ...person(p), connected: !!p.first_connected_at || (config.chatMode === 'local' && localHub.online(p.id)) })),
    pins,
    demo: project.kind === 'demo' ? { tracker: {
      proposed: !!hero && hero.state.status !== 'open',
      structConnected: !!struct?.first_connected_at || (config.chatMode === 'local' && !!struct && localHub.online(struct.id)),
      approved: hero?.state.status === 'complete',
      exported: !!project.exported_at,
    } } : null,
  };
  return c.json(state);
});

authed.get('/pins/:id', async c => {
  await assertPinAccess(userOf(c), c.req.param('id'));
  return c.json(await buildPinRecord(sql, c.req.param('id')));
});

const point = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]);

authed.post('/projects/:id/pins', async c => {
  const u = userOf(c), id = c.req.param('id');
  assertProject(u, id);
  const b = parse(z.object({
    sheetId: z.string().max(20).optional(), gridRef: z.string().trim().max(24).nullable().optional(),
    x: z.number().min(0).max(1), y: z.number().min(0).max(1), title: z.string().trim().min(3).max(90), question: z.string().trim().min(3).max(600),
    discipline: z.enum(['mep', 'struct', 'arch', 'elec']), severity: z.enum(['low', 'medium', 'high']), reviewerIds: z.array(z.string().max(64)).min(1).max(6),
  }), await body(c));
  const project = await getProject(sql, id);
  const sheetId = b.sheetId ?? (await sql<{ id: string }[]>`select id from sheets where project_id = ${id} order by ord, created_at limit 1`)[0]?.id;
  if (!sheetId) throw new HttpError(400, 'no_sheet', 'Add a drawing sheet first.');
  const pinId = await createPin(id, u.id, { ...b, sheetId }, await communityForNewPin(project));
  return c.json(await buildPinRecord(sql, pinId), 201);
});

authed.post('/pins/:id/proposals', async c => {
  const u = userOf(c), id = c.req.param('id');
  await assertPinAccess(u, id);
  const b = parse(z.object({
    summary: z.string().trim().min(3).max(280), route: z.array(point).min(2).max(200).nullable().default(null),
    costImpact: z.string().trim().max(80).nullable().default(null), scheduleImpact: z.string().trim().max(40).nullable().default(null),
    approveOwn: z.boolean().default(true), basedOnVersion: z.number().int().min(0).nullable().default(null),
  }), await body(c));
  await postProposal(id, u.id, { ...b, costImpact: b.costImpact || null, scheduleImpact: b.scheduleImpact || null });
  return c.json(await buildPinRecord(sql, id), 201);
});

authed.post('/pins/:id/signoffs', async c => {
  const u = userOf(c), id = c.req.param('id');
  await assertPinAccess(u, id);
  const key = c.req.header('idempotency-key')?.slice(0, 100);
  if (key) {
    const [hit] = await sql<{ response: unknown }[]>`select response from idempotency where key = ${key} and user_id = ${u.id}`;
    if (hit) return c.json({ record: await buildPinRecord(sql, id), duplicate: true, replayed: true });
  }
  const b = parse(z.object({ proposalId: z.string().max(20), revision: z.string().max(8), verdict: z.enum(['approve', 'request_change']), comment: z.string().trim().max(500).nullable().default(null) }), await body(c));
  const { duplicate } = await signoff(id, u.id, b);
  const record = await buildPinRecord(sql, id);
  const response = { record, duplicate };
  if (key) await sql`insert into idempotency (key, user_id, response) values (${key}, ${u.id}, ${sql.json({ duplicate } as never)}) on conflict do nothing`;
  return c.json(response);
});

authed.post('/pins/:id/holds', async c => {
  const u = userOf(c), id = c.req.param('id');
  await assertPinAccess(u, id);
  const b = parse(z.object({ reason: z.string().trim().min(3).max(300), clearCondition: z.string().trim().min(3).max(200) }), await body(c));
  await placeHold(id, u.id, b);
  return c.json(await buildPinRecord(sql, id), 201);
});

authed.post('/pins/:id/evidence', async c => {
  const u = userOf(c), id = c.req.param('id');
  await assertPinAccess(u, id);
  const b = parse(z.object({ holdId: z.string().max(20).nullable().default(null), imageUrl: z.string().max(2000), caption: z.string().trim().min(1).max(200), messageId: z.string().max(100).nullable().default(null) }), await body(c));
  if (!/^(https?:\/\/|\/)/.test(b.imageUrl)) throw new HttpError(400, 'invalid', 'imageUrl must be an http(s) or relative URL.');
  await addEvidence(id, u.id, b);
  return c.json(await buildPinRecord(sql, id), 201);
});

authed.post('/pins/:id/holds/:holdId/clear', async c => {
  const u = userOf(c), id = c.req.param('id');
  await assertPinAccess(u, id);
  const b = parse(z.object({ note: z.string().trim().max(300).nullable().default(null) }), await body(c));
  await clearHold(id, c.req.param('holdId'), u.id, b.note);
  return c.json(await buildPinRecord(sql, id));
});

authed.post('/pins/:id/nudge', async c => {
  const u = userOf(c), id = c.req.param('id');
  await assertPinAccess(u, id);
  await nudge(id, u.id);
  return c.json({ ok: true });
});

authed.get('/projects/:id/register.pdf', async c => {
  const u = userOf(c), id = c.req.param('id');
  assertProject(u, id);
  const project = await getProject(sql, id);
  const sheets = await sql<SheetRow[]>`select * from sheets where project_id = ${id} order by ord, created_at`;
  const ids = (await sql<{ id: string }[]>`select p.id from pins p join sheets s on s.id = p.sheet_id where p.project_id = ${id} order by s.ord, s.created_at, p.number`).map(r => r.id);
  const recs = [];
  for (const pid of ids) recs.push(await buildPinRecord(sql, pid));
  const images = new Map<string, Buffer>();
  for (const s of sheets) {
    if (s.source !== 'image' || !s.file_id || !recs.some(r => r.sheetId === s.id)) continue;
    const [f] = await sql<{ bytes: Buffer }[]>`select bytes from files where id = ${s.file_id}`;
    if (f) images.set(s.id, f.bytes);
  }
  const pdf = await registerPdf(project, sheets, images, recs, { name: u.name, role: ROLE_INFO[u.role].title });
  await recordExport(id, u.id);
  const slug = project.name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';
  return new Response(new Uint8Array(pdf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="RFI-register-${slug}.pdf"`, 'Cache-Control': 'no-store' } });
});

// ---------------------------------------------------------------- team projects: sheets, people, settings

/** Drawings change what every approval is measured against, so admins and site leads manage them. */
const canManageSheets = (u: UserRow) => u.is_admin || u.role === 'site';

async function assertTeam(u: UserRow, projectId: string, adminOnly = false) {
  assertProject(u, projectId);
  const project = await getProject(sql, projectId);
  if (project.kind !== 'team') throw new HttpError(400, 'demo_project', 'This is a demo project. Create your own project to do this.');
  if (adminOnly && !u.is_admin) throw new HttpError(403, 'admin_only', 'Only a project admin can do this.');
  return project;
}

authed.post('/projects/:id/sheets', async c => {
  const u = userOf(c), id = c.req.param('id');
  await assertTeam(u, id);
  if (!canManageSheets(u)) throw new HttpError(403, 'forbidden', 'Only project admins and site leads can add sheets.');
  const b = parse(sheetSchema, await body(c));
  const sheetId = await addSheet(id, u, b);
  return c.json({ sheetId, sheets: await projectSheets(sql, id) }, 201);
});

authed.post('/sheets/:id/revisions', async c => {
  const u = userOf(c);
  const sheet = await getSheet(sql, c.req.param('id'));
  await assertTeam(u, sheet.project_id);
  if (!canManageSheets(u)) throw new HttpError(403, 'forbidden', 'Only project admins and site leads can publish new revisions.');
  const b = parse(z.object({ revision: z.string().trim().min(1, 'Enter the new revision label.').max(8), fileId: z.string().max(40), thumbFileId: z.string().max(40).nullable().default(null) }), await body(c));
  if (!u.account_id) throw new HttpError(403, 'forbidden', 'Sign in to upload drawings.');
  const file = await ownFile(u.account_id, b.fileId);
  if (b.thumbFileId) await ownFile(u.account_id, b.thumbFileId);
  const r = await newSheetRevision(sheet.id, u.id, { revision: b.revision, fileId: file.id, thumbFileId: b.thumbFileId, width: file.width, height: file.height });
  return c.json({ ...r, sheets: await projectSheets(sql, sheet.project_id) });
});

const inviteDto = (c: Context, i: InviteRow & { by?: string | null }) => ({
  id: i.id, role: i.role, url: `${origin(c)}/invite/${i.token}`, createdAt: new Date(i.created_at).toISOString(),
  expiresAt: new Date(i.expires_at).toISOString(), uses: i.uses, createdBy: i.by ?? '',
});

authed.get('/projects/:id/team', async c => {
  const u = userOf(c), id = c.req.param('id');
  await assertTeam(u, id);
  const people = [...(await projectPeople(sql, id)).values()].filter(p => p.active);
  const invites = u.is_admin ? await sql<(InviteRow & { by: string | null })[]>`select i.*, x.name as by from invites i left join users x on x.id = i.created_by
    where i.project_id = ${id} and i.revoked_at is null and i.expires_at > now() order by i.created_at desc` : [];
  const team: TeamInfo = {
    canManage: u.is_admin,
    members: people.map(p => ({ ...person(p), email: u.is_admin || p.id === u.id ? p.email : null, isAdmin: p.is_admin, isMe: p.id === u.id,
      connected: !!p.first_connected_at || (config.chatMode === 'local' && localHub.online(p.id)), joinedAt: new Date(p.created_at).toISOString() })),
    invites: invites.map(i => inviteDto(c, i)),
  };
  return c.json(team);
});

authed.post('/projects/:id/invites', async c => {
  const u = userOf(c), id = c.req.param('id');
  await assertTeam(u, id, true);
  const { role } = parse(z.object({ role: z.enum(ROLES) }), await body(c));
  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from invites where project_id = ${id} and revoked_at is null and expires_at > now()`;
  if (n >= 30) throw new HttpError(409, 'too_many_invites', 'Turn off some old invite links first.');
  const inv = await createInvite(id, role, u.id);
  return c.json(inviteDto(c, { ...inv, by: u.name }), 201);
});

authed.post('/projects/:id/invites/:inviteId/revoke', async c => {
  const u = userOf(c), id = c.req.param('id');
  await assertTeam(u, id, true);
  await sql`update invites set revoked_at = now() where id = ${c.req.param('inviteId')} and project_id = ${id} and revoked_at is null`;
  return c.json({ ok: true });
});

authed.post('/projects/:id/members/:userId/remove', async c => {
  const u = userOf(c), id = c.req.param('id'), target = c.req.param('userId');
  await assertTeam(u, id, true);
  if (target === u.id) throw new HttpError(400, 'self', "You can't remove yourself. Make someone else an admin first.");
  return c.json(await removeMember(id, target, u.id));
});

authed.post('/projects/:id/members/:userId/admin', async c => {
  const u = userOf(c), id = c.req.param('id'), target = c.req.param('userId');
  await assertTeam(u, id, true);
  const { admin } = parse(z.object({ admin: z.boolean() }), await body(c));
  if (!admin) {
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from users where project_id = ${id} and active and is_admin and id <> ${target}`;
    if (n < 1) throw new HttpError(409, 'last_admin', 'A project needs at least one admin.');
  }
  const [r] = await sql`update users set is_admin = ${admin} where id = ${target} and project_id = ${id} and active returning id`;
  if (!r) throw new HttpError(404, 'not_found', 'That person is not on this project.');
  return c.json({ ok: true });
});

authed.patch('/projects/:id', async c => {
  const u = userOf(c), id = c.req.param('id');
  await assertTeam(u, id, true);
  const { name } = parse(z.object({ name: z.string().trim().min(2, 'Give the project a name.').max(80) }), await body(c));
  await sql`update projects set name = ${name}, updated_at = now() where id = ${id}`;
  return c.json({ ok: true });
});

authed.post('/projects/:id/delete', async c => {
  const u = userOf(c), id = c.req.param('id');
  const project = await assertTeam(u, id, true);
  const { confirm } = parse(z.object({ confirm: z.string() }), await body(c));
  if (confirm.trim() !== project.name) throw new HttpError(400, 'confirm', 'Type the project name exactly to delete it.');
  await deleteTeamProject(id);
  return c.json({ ok: true });
});

api.route('/', authed);

// ---------------------------------------------------------------- local chat mode (no Nexconn credentials)

export const localChat = new Hono();
const localUser = (c: Context) => {
  const h = c.req.header('authorization') ?? '';
  const uid = verifyLocalToken(h.startsWith('Bearer ') ? h.slice(7) : c.req.query('token') ?? '');
  if (!uid) throw new HttpError(401, 'unauthorized', 'Invalid chat token.');
  return uid;
};

localChat.get('/stream', c => {
  const uid = localUser(c);
  return streamSSE(c, async stream => {
    const queue: string[] = [];
    let wake: (() => void) | null = null;
    const off = localHub.subscribe(uid, e => { queue.push(JSON.stringify(e)); wake?.(); });
    stream.onAbort(() => { off(); wake?.(); });
    await stream.writeSSE({ event: 'ready', data: JSON.stringify({ userId: uid }) });
    while (!stream.aborted) {
      if (!queue.length) await Promise.race([new Promise<void>(r => (wake = r)), new Promise(r => setTimeout(r, 15000))]);
      wake = null;
      if (stream.aborted) break;
      if (!queue.length) { await stream.writeSSE({ event: 'ping', data: '{}' }); continue; }
      while (queue.length) await stream.writeSSE({ event: 'chat', data: queue.shift()! });
    }
    off();
  });
});

localChat.get('/history', async c => {
  const uid = localUser(c);
  const cId = c.req.query('c') ?? '', sId = c.req.query('s') ?? '';
  if (!(await canAccess(uid, cId, sId))) throw new HttpError(403, 'forbidden', 'Not a member of this room.');
  return c.json(await localHistory(cId, sId, Number(c.req.query('before') ?? Date.now() + 1), Math.min(100, Number(c.req.query('limit') ?? 30))));
});

localChat.post('/send', async c => {
  const uid = localUser(c);
  const b = parse(z.object({ c: z.string(), s: z.string(), type: z.enum(['RC:TxtMsg', 'RC:ImgMsg']), content: z.record(z.any()), metadata: z.record(z.string()).default({}) }), await body(c));
  if (!(await canAccess(uid, b.c, b.s))) throw new HttpError(403, 'forbidden', 'Not a member of this room.');
  const m = await storeAndPublish({ communityId: b.c, subId: b.s, type: b.type, senderId: uid, content: b.content, metadata: b.metadata });
  return c.json(m);
});

localChat.post('/upload', async c => {
  localUser(c);
  const mime = c.req.header('content-type') ?? 'application/octet-stream';
  if (!/^image\/(jpeg|png|webp|gif)$/.test(mime)) throw new HttpError(415, 'unsupported', 'Upload a JPG, PNG, WebP or GIF image.');
  const buf = Buffer.from(await c.req.arrayBuffer());
  if (buf.length > 4 * 1024 * 1024) throw new HttpError(413, 'too_large', 'Images must be under 4 MB.');
  const id = newLongId();
  await sql`insert into uploads (id, mime, bytes) values (${id}, ${mime}, ${buf})`;
  return c.json({ url: `/api/uploads/${id}` });
});

export const uploads = new Hono();
uploads.get('/:id', async c => {
  const [u] = await sql<{ mime: string; bytes: Buffer }[]>`select mime, bytes from uploads where id = ${c.req.param('id')}`;
  if (!u) return c.notFound();
  return new Response(new Uint8Array(u.bytes), { headers: { 'Content-Type': u.mime, 'Cache-Control': 'public, max-age=31536000, immutable' } });
});

export function errorHandler(err: Error, c: Context) {
  if (err instanceof HttpError) return c.json({ error: err.code, message: err.message, ...err.extra }, err.status as 400);
  log.error('http.error', { path: c.req.path, error: String(err), stack: err.stack?.split('\n').slice(0, 4).join(' | ') });
  return c.json({ error: 'server_error', message: 'Something went wrong on our side. Try again.' }, 500);
}

