// Integration test: accounts, team projects, uploaded sheets, invites, revisions and membership (local chat gateway).
import { deflateSync, crc32 } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://pinthread:pinthread@localhost:5432/pinthread_test';
process.env.PINTHREAD_NO_MAIN = '1';
process.env.LOG_SILENT = process.env.SHOW_LOGS ? '' : '1';
process.env.CHAT_MODE = 'local';

type Json = any;
let app: { fetch: (r: Request) => Response | Promise<Response> };
let sql: any;
let drainProject: (id: string) => Promise<void>;

/** A tiny valid PNG (solid grey) of the given size. */
function png(w: number, h: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0; // 8-bit greyscale
  const raw = Buffer.alloc((w + 1) * h, 0xdd);
  for (let y = 0; y < h; y++) raw[y * (w + 1)] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

interface Who { cookie: string; account: Json }

async function call(method: string, path: string, o: { who?: Who | null; token?: string; body?: unknown; raw?: Buffer; type?: string; app?: boolean } = {}) {
  const headers: Record<string, string> = {};
  if (o.app !== false) headers['x-pinthread'] = '1';
  if (o.who) headers.cookie = o.who.cookie;
  if (o.token) headers.authorization = `Bearer ${o.token}`;
  if (o.body !== undefined) headers['content-type'] = 'application/json';
  if (o.raw) headers['content-type'] = o.type ?? 'image/png';
  const res = await app.fetch(new Request(`http://localhost${path}`, { method, headers, body: o.raw ? new Uint8Array(o.raw) : o.body === undefined ? undefined : JSON.stringify(o.body) }));
  const ct = res.headers.get('content-type') ?? '';
  return { status: res.status, json: ct.includes('json') ? await res.json() : null, res };
}

const cookieOf = (res: Response) => (res.headers.get('set-cookie') ?? '').split(';')[0];

async function signup(name: string, email: string, password = 'a good long password'): Promise<Who> {
  const r = await call('POST', '/api/auth/signup', { body: { name, email, password, firm: 'Test Co' } });
  expect(r.status).toBe(201);
  return { cookie: cookieOf(r.res), account: r.json.account };
}

async function upload(who: Who, w = 800, h = 566) {
  const r = await call('POST', '/api/files', { who, raw: png(w, h) });
  expect(r.status).toBe(201);
  return r.json.id as string;
}

const open = async (who: Who, projectId: string) => (await call('POST', `/api/projects/${projectId}/session`, { who, body: {} }));

beforeAll(async () => {
  const db = await import('../src/db');
  sql = db.sql;
  await sql.unsafe(`drop schema public cascade; create schema public;`);
  await db.migrate();
  const main = await import('../src/main');
  await main.initGateway();
  app = main.buildApp();
  ({ drainProject } = await import('../src/outbox'));
}, 30_000);

afterAll(async () => { await sql?.end({ timeout: 1 }); });

describe('accounts', () => {
  it('signs up, logs in and rejects bad credentials', async () => {
    const a = await signup('Alice Moreno', 'Alice@Example.com');
    expect(a.account).toMatchObject({ email: 'alice@example.com', initials: 'AM' });
    expect(a.cookie).toMatch(/^pt_auth=/);
    const dupe = await call('POST', '/api/auth/signup', { body: { name: 'Alice Two', email: 'alice@example.com', password: 'another password', firm: '' } });
    expect(dupe.status).toBe(409);
    const short = await call('POST', '/api/auth/signup', { body: { name: 'Bo', email: 'b@example.com', password: 'short', firm: '' } });
    expect(short.status).toBe(400);
    expect(short.json.message).toMatch(/8 characters/);
    const bad = await call('POST', '/api/auth/login', { body: { email: 'alice@example.com', password: 'wrong password' } });
    expect(bad.status).toBe(401);
    const ok = await call('POST', '/api/auth/login', { body: { email: 'ALICE@example.com', password: 'a good long password' } });
    expect(ok.status).toBe(200);
    const me = await call('GET', '/api/auth/me', { who: { cookie: cookieOf(ok.res), account: null } });
    expect(me.json.account.name).toBe('Alice Moreno');
    expect((await call('GET', '/api/auth/me')).json.account).toBeNull();
  });

  it('blocks cookie-authenticated writes without the app header (CSRF)', async () => {
    const r = await call('POST', '/api/auth/login', { app: false, body: { email: 'alice@example.com', password: 'a good long password' } });
    expect(r.status).toBe(403);
    expect(r.json.error).toBe('csrf');
  });

  it('changes the password and signs other devices out', async () => {
    const c = await signup('Carol Diaz', 'carol@example.com');
    const other = cookieOf((await call('POST', '/api/auth/login', { body: { email: 'carol@example.com', password: 'a good long password' } })).res);
    await sql`update accounts set sessions_valid_after = '2000-01-01' where email = 'carol@example.com'`;
    // Make the other device's cookie look older than the change.
    await new Promise(r => setTimeout(r, 1100));
    const wrong = await call('POST', '/api/auth/password', { who: c, body: { current: 'nope', next: 'brand new password' } });
    expect(wrong.status).toBe(400);
    const r = await call('POST', '/api/auth/password', { who: c, body: { current: 'a good long password', next: 'brand new password' } });
    expect(r.status).toBe(200);
    const fresh = cookieOf(r.res);
    expect((await call('GET', '/api/auth/me', { who: { cookie: fresh, account: null } })).json.account.email).toBe('carol@example.com');
    expect((await call('GET', '/api/auth/me', { who: { cookie: other, account: null } })).json.account).toBeNull();
    expect((await call('POST', '/api/auth/login', { body: { email: 'carol@example.com', password: 'brand new password' } })).status).toBe(200);
  });
});

describe('team project', () => {
  let alice: Who, bob: Who, dave: Who;
  let projectId = '', sheetId = '', aliceS: Json, bobS: Json, inviteUrl = '';
  const state = async (token: string) => (await call('GET', `/api/projects/${projectId}/state`, { token })).json;

  it('accepts PNG/JPEG drawings only, up to 25 MB', async () => {
    alice = await signup('Alice Site', 'alice.site@example.com');
    const notImage = await call('POST', '/api/files', { who: alice, raw: Buffer.from('%PDF-1.7 not an image'), type: 'application/pdf' });
    expect(notImage.status).toBe(415);
    const huge = await call('POST', '/api/files', { who: alice, raw: Buffer.alloc(26 * 1024 * 1024) });
    expect(huge.status).toBe(413);
    const anon = await call('POST', '/api/files', { raw: png(100, 100) });
    expect(anon.status).toBe(401);
  });

  it('creates a project with an uploaded sheet and makes the creator admin', async () => {
    const fileId = await upload(alice);
    const r = await call('POST', '/api/projects', { who: alice, body: { name: 'Harbour Point', role: 'site', sheet: { number: 'M-201', title: 'Level 02 Mechanical', revision: 'A', fileId, thumbFileId: null } } });
    expect(r.status).toBe(201);
    projectId = r.json.projectId;
    const s = await open(alice, projectId);
    expect(s.status).toBe(200);
    aliceS = s.json;
    expect(aliceS.kind).toBe('team');
    expect(aliceS.joinLinks).toEqual({});
    const st = await state(aliceS.session);
    expect(st.project.kind).toBe('team');
    expect(st.me.isAdmin).toBe(true);
    expect(st.project.sheets).toHaveLength(1);
    sheetId = st.project.sheets[0].id;
    expect(st.project.sheets[0]).toMatchObject({ number: 'M-201', revision: 'A', source: 'image', width: 800, height: 566 });
    expect(st.project.sheets[0].imageUrl).toMatch(new RegExp(`^/api/sheets/${sheetId}/image\\?v=`));
    const list = (await call('GET', '/api/projects', { who: alice })).json.projects;
    expect(list.map((p: Json) => p.name)).toEqual(['Harbour Point']);
  });

  it('refuses demo-only shortcuts on team projects', async () => {
    const sw = await call('POST', '/api/demo/switch-role', { token: aliceS.session, body: { role: 'struct' } });
    expect(sw.status).toBe(404);
  });

  it('invites by link: account required, then joins once', async () => {
    const inv = await call('POST', `/api/projects/${projectId}/invites`, { token: aliceS.session, body: { role: 'struct' } });
    expect(inv.status).toBe(201);
    inviteUrl = inv.json.url;
    const token = inviteUrl.split('/invite/')[1];
    const info = await call('GET', `/api/invites/${token}`);
    expect(info.json).toMatchObject({ project: 'Harbour Point', role: 'struct', invitedBy: 'Alice Site', alreadyMember: false });
    expect((await call('POST', `/api/invites/${token}/accept`, { body: {} })).status).toBe(401);
    bob = await signup('Bob Ng', 'bob@example.com');
    const acc = await call('POST', `/api/invites/${token}/accept`, { who: bob, body: {} });
    expect(acc.json.projectId).toBe(projectId);
    expect((await call('POST', `/api/invites/${token}/accept`, { who: bob, body: {} })).json.projectId).toBe(projectId);
    bobS = (await open(bob, projectId)).json;
    expect(bobS.me.role).toBe('struct');
    const st = await state(aliceS.session);
    expect(st.members.map((m: Json) => m.name).sort()).toEqual(['Alice Site', 'Bob Ng']);
    const notAdmin = await call('POST', `/api/projects/${projectId}/invites`, { token: bobS.session, body: { role: 'arch' } });
    expect(notAdmin.status).toBe(403);
    const team = (await call('GET', `/api/projects/${projectId}/team`, { token: bobS.session })).json;
    expect(team.canManage).toBe(false);
    expect(team.invites).toEqual([]);
    expect(team.members.find((m: Json) => m.name === 'Alice Site').email).toBeNull(); // emails are for admins
  });

  it('serves sheet images to members only', async () => {
    dave = await signup('Dave Outsider', 'dave@example.com');
    expect((await call('GET', `/api/sheets/${sheetId}/image`, { who: bob })).status).toBe(200);
    expect((await call('GET', `/api/sheets/${sheetId}/image`, { who: dave })).status).toBe(403);
    expect((await call('GET', `/api/sheets/${sheetId}/image`)).status).toBe(401);
    expect((await open(dave, projectId)).status).toBe(403);
    expect((await call('GET', `/api/projects/${projectId}/state`, { token: (await call('POST', '/api/demo/sessions', { body: { role: 'mep' } })).json.session })).status).toBe(403);
  });

  let pinId = '';
  it('runs raise → propose → approve on the uploaded sheet', async () => {
    const off = await call('POST', `/api/projects/${projectId}/pins`, { token: aliceS.session, body: { sheetId, x: 1.2, y: 0.5, title: 'Off', question: 'Off the sheet', discipline: 'mep', severity: 'low', reviewerIds: [bobS.me.userId] } });
    expect(off.status).toBe(400);
    const r = await call('POST', `/api/projects/${projectId}/pins`, { token: aliceS.session, body: { sheetId, gridRef: 'B–C/2', x: 0.42, y: 0.4, title: 'SD-3 hits the transfer beam', question: 'Drop below or web opening?', discipline: 'mep', severity: 'high', reviewerIds: [bobS.me.userId] } });
    expect(r.status).toBe(201);
    pinId = r.json.id;
    expect(r.json).toMatchObject({ number: 'RFI-001', gridRef: 'B–C/2', sheetId });
    const p = await call('POST', `/api/pins/${pinId}/proposals`, { token: aliceS.session, body: { summary: 'Drop SD-3 200 mm', route: [[0.3, 0.4], [0.5, 0.45]], approveOwn: true, basedOnVersion: 0 } });
    expect(p.json.state.label).toBe('In review · Waiting for Structural');
    const v1 = p.json.proposals[0];
    const ok = await call('POST', `/api/pins/${pinId}/signoffs`, { token: bobS.session, body: { proposalId: v1.id, revision: 'A', verdict: 'approve' } });
    expect(ok.json.record.state.status).toBe('complete');
    await drainProject(projectId);
    const list = (await call('GET', '/api/projects', { who: alice })).json.projects[0];
    expect(list).toMatchObject({ issues: 1, complete: 1, open: 0, members: 2 });
  });

  it('reopens approvals when a new revision of the sheet is published', async () => {
    const same = await call('POST', `/api/sheets/${sheetId}/revisions`, { token: aliceS.session, body: { revision: 'a', fileId: await upload(alice), thumbFileId: null } });
    expect(same.status).toBe(409);
    const foreign = await call('POST', `/api/sheets/${sheetId}/revisions`, { token: aliceS.session, body: { revision: 'B', fileId: await upload(bob), thumbFileId: null } });
    expect(foreign.status).toBe(400); // someone else's upload
    const r = await call('POST', `/api/sheets/${sheetId}/revisions`, { token: aliceS.session, body: { revision: 'B', fileId: await upload(alice, 900, 636), thumbFileId: null } });
    expect(r.json.affected).toBe(1);
    expect(r.json.sheets[0]).toMatchObject({ revision: 'B', width: 900 });
    expect(r.json.sheets[0].revisions.map((x: Json) => x.revision)).toEqual(['B', 'A']);
    const rec = (await call('GET', `/api/pins/${pinId}`, { token: bobS.session })).json;
    expect(rec.state.label).toBe('In review · Waiting for Structural');
    const v1 = rec.proposals[0];
    const old = await call('POST', `/api/pins/${pinId}/signoffs`, { token: bobS.session, body: { proposalId: v1.id, revision: 'A', verdict: 'approve' } });
    expect(old.status).toBe(409);
    expect(old.json.error).toBe('stale_revision');
    const again = await call('POST', `/api/pins/${pinId}/signoffs`, { token: bobS.session, body: { proposalId: v1.id, revision: 'B', verdict: 'approve' } });
    expect(again.json.record.state.status).toBe('complete');
    await drainProject(projectId);
    const jumps = await sql`select content from local_messages where subchannel_id = 'discstruct' and type = 'pt:jump' order by seq`;
    expect(jumps.some((j: Json) => /now Rev B/.test(j.content.ask))).toBe(true);
  });

  it('adds sheets (admins and site leads) and refuses duplicate sheet numbers', async () => {
    const notAllowed = await call('POST', `/api/projects/${projectId}/sheets`, { token: bobS.session, body: { number: 'S-101', title: 'Framing', revision: 'A', fileId: await upload(bob), thumbFileId: null } });
    expect(notAllowed.status).toBe(403);
    expect((await call('POST', `/api/sheets/${sheetId}/revisions`, { token: bobS.session, body: { revision: 'Z', fileId: await upload(bob), thumbFileId: null } })).status).toBe(403);
    const r = await call('POST', `/api/projects/${projectId}/sheets`, { token: aliceS.session, body: { number: 'M-202', title: 'Level 03 Mechanical', revision: 'A', fileId: await upload(alice), thumbFileId: null } });
    expect(r.status).toBe(201);
    expect(r.json.sheets.map((s: Json) => s.number)).toEqual(['M-201', 'M-202']);
    const dupe = await call('POST', `/api/projects/${projectId}/sheets`, { token: aliceS.session, body: { number: 'm-202', title: 'Again', revision: 'A', fileId: await upload(alice), thumbFileId: null } });
    expect(dupe.status).toBe(409);
  });

  it('opens an overflow community when a community runs out of rooms', async () => {
    const { PINS_PER_COMMUNITY } = await import('../src/team');
    const [{ n }] = await sql`select count(*)::int as n from pins where project_id = ${projectId}`;
    let last: Json = null;
    for (let i = n; i <= PINS_PER_COMMUNITY; i++) {
      last = (await call('POST', `/api/projects/${projectId}/pins`, { token: aliceS.session, body: { sheetId, x: 0.1 + (i % 9) / 10, y: 0.5, title: `Issue ${i}`, question: 'Batch', discipline: 'arch', severity: 'low', reviewerIds: [bobS.me.userId] } })).json;
    }
    const st = await state(aliceS.session);
    expect(last.communityId).not.toBe(st.project.communityId);
    const members = await sql`select user_id from local_members where community_id = ${last.communityId} and subchannel_id = ''`;
    expect(members.map((m: Json) => m.user_id).sort()).toEqual([aliceS.me.userId, bobS.me.userId].sort());
    await drainProject(projectId);
    const room = await sql`select user_id from local_members where community_id = ${last.communityId} and subchannel_id = ${last.subchannelId}`;
    expect(room.length).toBe(2);
  }, 120_000);

  it('removes a member: access ends and their open reviews move to the admin', async () => {
    const open1 = (await call('POST', `/api/projects/${projectId}/pins`, { token: aliceS.session, body: { sheetId, x: 0.6, y: 0.7, title: 'Only Bob reviews', question: 'Who signs this off?', discipline: 'struct', severity: 'low', reviewerIds: [bobS.me.userId] } })).json;
    const self = await call('POST', `/api/projects/${projectId}/members/${aliceS.me.userId}/remove`, { token: aliceS.session, body: {} });
    expect(self.status).toBe(400);
    const r = await call('POST', `/api/projects/${projectId}/members/${bobS.me.userId}/remove`, { token: aliceS.session, body: {} });
    expect(r.status).toBe(200);
    expect(r.json.reassigned).toBeGreaterThan(0);
    expect((await call('GET', `/api/projects/${projectId}/state`, { token: bobS.session })).status).toBe(403);
    expect((await open(bob, projectId)).status).toBe(403);
    expect((await call('GET', '/api/projects', { who: bob })).json.projects).toEqual([]);
    const rec = (await call('GET', `/api/pins/${open1.id}`, { token: aliceS.session })).json;
    expect(rec.reviewers.map((x: Json) => x.name)).toEqual(['Alice Site']);
    const done = (await call('GET', `/api/pins/${pinId}`, { token: aliceS.session })).json;
    expect(done.state.status).toBe('complete'); // completed reviews keep their record
    await drainProject(projectId);
    const left = await sql`select 1 from local_members where user_id = ${bobS.me.userId}`;
    expect(left).toHaveLength(0);
    // Re-invited: same identity comes back
    const inv = (await call('POST', `/api/projects/${projectId}/invites`, { token: aliceS.session, body: { role: 'arch' } })).json;
    await call('POST', `/api/invites/${inv.url.split('/invite/')[1]}/accept`, { who: bob, body: {} });
    const back = (await open(bob, projectId)).json;
    expect(back.me).toMatchObject({ userId: bobS.me.userId, role: 'arch' });
  });

  it('exports a register covering every sheet', async () => {
    const r = await call('GET', `/api/projects/${projectId}/register.pdf`, { token: aliceS.session });
    expect(r.status).toBe(200);
    const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default;
    const text = (await pdfParse(Buffer.from(await r.res.arrayBuffer()))).text;
    expect(text).toContain('Harbour Point');
    expect(text).toContain('M-201');
    expect(text).toContain('SD-3 hits the transfer beam');
  });

  it('deletes the project only with the exact name', async () => {
    const used = (await sql`select r.file_id from sheet_revisions r join sheets s on s.id = r.sheet_id where s.project_id = ${projectId}`).map((x: Json) => x.file_id);
    expect(used.length).toBe(3);
    expect((await call('POST', `/api/projects/${projectId}/delete`, { token: aliceS.session, body: { confirm: 'harbour' } })).status).toBe(400);
    expect((await call('POST', `/api/projects/${projectId}/delete`, { token: aliceS.session, body: { confirm: 'Harbour Point' } })).status).toBe(200);
    expect((await call('GET', `/api/projects/${projectId}/state`, { token: aliceS.session })).status).toBe(401);
    expect((await call('GET', '/api/projects', { who: alice })).json.projects).toEqual([]);
    const [{ n }] = await sql`select count(*)::int as n from files where id in ${sql(used)}`;
    expect(n).toBe(0);
  });
});
