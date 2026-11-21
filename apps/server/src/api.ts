import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { ROLES, ROLE_INFO, type ClientConfig, type ProjectState, type Role, type SessionResponse } from '@pinthread/shared';
import { config } from './config';
import { sql } from './db';
import { gateway } from './chat/gateway';
import { canAccess, localHistory, localHub, localToken, storeAndPublish, verifyLocalToken } from './chat/local';
import { inviteSig, requireUser, signSession, userOf, verifyInvite, type UserRow } from './auth';
import { claimDemoProject } from './demo';
import { addEvidence, clearHold, createPin, nudge, placeHold, postProposal, recordExport, signoff } from './domain';
import { registerPdf } from './pdf';
import { buildPinRecord, getProject, person, projectPeople, projectPins } from './repo';
import { HttpError, newLongId, rateLimiter, sha1hex, safeEqual } from './util';
import { log } from './log';

type Env = { Variables: { user: UserRow } };
export const api = new Hono<Env>();

const parse = <T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> => {
  const r = schema.safeParse(data);
  if (!r.success) throw new HttpError(400, 'invalid', r.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
  return r.data;
};
const body = async (c: Context) => c.req.json().catch(() => ({}));
const origin = (c: Context) => config.publicUrl || new URL(c.req.url).origin.replace(/^http:\/\/(?!localhost|127\.)/, 'https://');
const clientIp = (c: Context) => c.req.header('x-forwarded-for')?.split(',')[0].trim() ?? 'local';

async function sessionFor(c: Context, user: UserRow): Promise<SessionResponse> {
  if (config.chatMode === 'local') user.token = localToken(user.id); // derived from the current secret, never cached
  else if (!user.token) {
    const token = await gateway().issueToken(user.id, user.name);
    await sql`update users set token = ${token} where id = ${user.id}`;
    user.token = token;
  }
  const exp = Date.now() + 24 * 3600_000;
  const [hero] = await sql<{ id: string }[]>`select id from pins where project_id = ${user.project_id} and number = 1`;
  const joinLinks: SessionResponse['joinLinks'] = {};
  for (const r of ROLES) {
    if (r === user.role) continue;
    const q = new URLSearchParams({ exp: String(exp), sig: inviteSig(user.project_id, r, exp), ...(hero ? { pin: hero.id } : {}) });
    joinLinks[r] = `${origin(c)}/j/${user.project_id}/${r}?${q}`;
  }
  await sql`insert into analytics (project_id, project_kind, user_id, name) select id, kind, ${user.id}, 'session.started' from projects where id = ${user.project_id}`;
  return { session: await signSession(user.id, user.project_id), me: person(user), projectId: user.project_id, nexconnToken: user.token!, joinLinks, heroPinId: hero?.id ?? null };
}

async function userByRole(projectId: string, role: Role) {
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
      (select count(*)::int from projects where kind = ${kind} and (kind = 'pilot' or claimed_at is not null)) as projects,
      (select count(distinct u.id)::int from users u join projects p on p.id = u.project_id where p.kind = ${kind} and u.first_connected_at is not null) as users_connected,
      (select count(distinct pr.user_id)::int from presence pr join users u on u.id = pr.user_id join projects p on p.id = u.project_id where p.kind = ${kind} and pr.status = '0') as users_connected_webhook,
      (select count(*)::int from pins pi join projects p on p.id = pi.project_id where p.kind = ${kind} and pi.status = 'complete' and pi.number > case when ${kind} = 'demo' then 4 else 0 end) as issues_completed_new,
      (select count(*)::int from events e join projects p on p.id = e.project_id where p.kind = ${kind} and e.type = 'signoff.approve') as approvals,
      (select count(*)::int from projects where kind = ${kind} and exported_at is not null) as registers_exported`;
    return r;
  };
  return c.json({ generatedAt: new Date().toISOString(), chatMode: config.chatMode, pilot: await byKind('pilot'), demo: await byKind('demo') });
});

// ---------------------------------------------------------------- authenticated

const authed = new Hono<Env>();
authed.use('*', requireUser);

authed.get('/me', async c => c.json(await sessionFor(c, userOf(c))));

authed.post('/demo/switch-role', async c => {
  const { role } = parse(z.object({ role: z.enum(ROLES) }), await body(c));
  return c.json(await sessionFor(c, await userByRole(userOf(c).project_id, role)));
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
  const struct = [...people.values()].find(p => p.role === 'struct');
  const hero = pins.find(p => p.number === 'RFI-001');
  const state: ProjectState = {
    project: { id, name: project.name, kind: project.kind, communityId: project.community_id, sheet: { number: project.sheet_number, title: project.sheet_title, revision: project.revision } },
    me: { ...person(u), canHold: u.can_hold },
    members: [...people.values()].map(p => ({ ...person(p), connected: !!p.first_connected_at || (config.chatMode === 'local' && localHub.online(p.id)) })),
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
    x: z.number().min(0).max(1), y: z.number().min(0).max(1), title: z.string().trim().min(3).max(90), question: z.string().trim().min(3).max(600),
    discipline: z.enum(['mep', 'struct', 'arch', 'elec']), severity: z.enum(['low', 'medium', 'high']), reviewerIds: z.array(z.string().max(64)).min(1).max(6),
  }), await body(c));
  const pinId = await createPin(id, u.id, b);
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
  const b = parse(z.object({ proposalId: z.string().max(20), revision: z.string().max(4), verdict: z.enum(['approve', 'request_change']), comment: z.string().trim().max(500).nullable().default(null) }), await body(c));
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
  const ids = (await sql<{ id: string }[]>`select id from pins where project_id = ${id} order by number`).map(r => r.id);
  const recs = [];
  for (const pid of ids) recs.push(await buildPinRecord(sql, pid));
  const pdf = await registerPdf(project, recs, { name: u.name, role: ROLE_INFO[u.role].title });
  await recordExport(id, u.id);
  return new Response(new Uint8Array(pdf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="RFI-register-${project.sheet_number}-Rev${project.revision}.pdf"`, 'Cache-Control': 'no-store' } });
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

