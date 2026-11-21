// Integration test: real Postgres, local chat gateway, full HTTP API.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://pinthread:pinthread@localhost:5432/pinthread_test';
process.env.PINTHREAD_NO_MAIN = '1';
process.env.LOG_SILENT = '1';
process.env.CHAT_MODE = 'local';
process.env.DEMO_POOL_SIZE = '1';

type Json = any;
let app: { fetch: (r: Request) => Response | Promise<Response> };
let sql: any;
let drainProject: (id: string) => Promise<void>;

async function call(method: string, path: string, opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const res = await app.fetch(new Request(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}), ...opts.headers },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  }));
  const ct = res.headers.get('content-type') ?? '';
  return { status: res.status, json: ct.includes('json') ? await res.json() : null, res };
}

async function join(link: string) {
  const u = new URL(link);
  const [, , projectId, role] = u.pathname.split('/');
  const r = await call('POST', '/api/demo/join', { body: { projectId, role, exp: u.searchParams.get('exp'), sig: u.searchParams.get('sig') } });
  expect(r.status).toBe(200);
  return r.json as Json;
}

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

describe('demo project', () => {
  let mep: Json, struct: Json, site: Json, arch: Json, state: Json;
  const pin = (n: string) => state.pins.find((p: Json) => p.number === n);
  const refresh = async (s: Json = mep) => { state = (await call('GET', `/api/projects/${s.projectId}/state`, { token: s.session })).json; return state; };

  it('claims a seeded project with the four demo pins in the right states', async () => {
    const r = await call('POST', '/api/demo/sessions', { body: { role: 'mep' } });
    expect(r.status).toBe(200);
    mep = r.json;
    expect(mep.me.role).toBe('mep');
    expect(mep.nexconnToken).toMatch(/^local\./);
    await refresh();
    expect(state.pins.map((p: Json) => [p.number, p.state.status])).toEqual([
      ['RFI-001', 'open'], ['RFI-002', 'review'], ['RFI-003', 'blocked'], ['RFI-004', 'complete'],
    ]);
    expect(pin('RFI-002').state.label).toBe('In review · Waiting for Architect');
    expect(pin('RFI-003').state.label).toBe('Blocked · Hold by Structural');
    expect(pin('RFI-001').roomReady).toBe(true);
    const [{ n }] = await sql`select count(*)::int as n from outbox where project_id = ${mep.projectId} and sent_at is null`;
    expect(n).toBe(0);
  });

  it('runs the hero flow: propose, alert, approve, green', async () => {
    const hero = pin('RFI-001');
    const route = [[0.2786, 0.3848], [0.3071, 0.3848], [0.3229, 0.4162], [0.3629, 0.4162], [0.3786, 0.3848], [0.4143, 0.3848]];
    const p = await call('POST', `/api/pins/${hero.id}/proposals`, { token: mep.session, body: { summary: 'Drop SD-3 150 mm and cross B-14 at WO-2.', route, costImpact: '+$1,200 est.', scheduleImpact: 'None', approveOwn: true, basedOnVersion: 0 } });
    expect(p.status).toBe(201);
    expect(p.json.state.label).toBe('In review · Waiting for Structural');
    await drainProject(mep.projectId);
    const jumps = await sql`select * from local_messages where community_id = ${'c' + mep.projectId} and subchannel_id = 'discstruct' and type = 'pt:jump' order by seq`;
    expect(jumps.at(-1).content.ask).toContain('needs Structural on RFI-001');

    struct = await join(mep.joinLinks.struct);
    expect(struct.me.role).toBe('struct');
    const rec = (await call('GET', `/api/pins/${hero.id}`, { token: struct.session })).json;
    const v1 = rec.proposals.find((x: Json) => x.current);

    // Stale proposal id is rejected
    const stale = await call('POST', `/api/pins/${hero.id}/signoffs`, { token: struct.session, body: { proposalId: 'nope', revision: 'B', verdict: 'approve' } });
    expect(stale.status).toBe(409);
    expect(stale.json.error).toBe('stale');

    // Five rapid clicks with the same key plus a reconnect retry with another key: exactly one approval.
    const clicks = await Promise.all([
      ...Array.from({ length: 5 }, () => call('POST', `/api/pins/${hero.id}/signoffs`, { token: struct.session, headers: { 'idempotency-key': 'k1' }, body: { proposalId: v1.id, revision: 'B', verdict: 'approve' } })),
      call('POST', `/api/pins/${hero.id}/signoffs`, { token: struct.session, headers: { 'idempotency-key': 'k2' }, body: { proposalId: v1.id, revision: 'B', verdict: 'approve' } }),
    ]);
    expect(clicks.every(c => c.status === 200)).toBe(true);
    const rows = await sql`select * from signoffs where proposal_id = ${v1.id} and reviewer_id = ${struct.me.userId}`;
    expect(rows).toHaveLength(1);
    await drainProject(mep.projectId);
    const cards = await sql`select * from local_messages where subchannel_id = ${hero.subchannelId} and type = 'pt:signoff' and sender_id = ${struct.me.userId}`;
    expect(cards).toHaveLength(1);

    await refresh();
    expect(pin('RFI-001').state.status).toBe('complete');
    const done = (await call('GET', `/api/pins/${hero.id}`, { token: mep.session })).json;
    expect(done.signoffs.filter((s: Json) => s.verdict === 'approve').map((s: Json) => s.reviewer.name).sort()).toEqual(['Dana Okafor', 'Marco Ruiz']);
    const decision = await sql`select * from local_messages where subchannel_id = ${hero.subchannelId} and type = 'pt:decision' order by seq desc limit 1`;
    expect(decision[0].content.status).toBe('complete');
    expect(decision[0].content.recordHash).toBe(done.recordHash);
    const meta = await sql`select metadata from local_messages where message_id = ${done.proposals[0].messageId}`;
    expect(meta[0].metadata.st).toBe('accepted');
    expect(state.demo.tracker).toMatchObject({ proposed: true, approved: true });
  });

  it('requires fresh approval when the proposal is revised', async () => {
    site = await join(mep.joinLinks.site);
    const created = await call('POST', `/api/projects/${mep.projectId}/pins`, { token: site.session, body: { x: 0.4, y: 0.6, title: 'New clash at E/4', question: 'Pipe hits the beam?', discipline: 'mep', severity: 'medium', reviewerIds: [mep.me.userId, struct.me.userId] } });
    expect(created.status).toBe(201);
    expect(created.json.number).toBe('RFI-005');
    expect(created.json.gridRef).toMatch(/\//);
    const id = created.json.id;
    const v1 = (await call('POST', `/api/pins/${id}/proposals`, { token: mep.session, body: { summary: 'Route A', approveOwn: true, basedOnVersion: 0 } })).json.proposals.at(-1);
    await call('POST', `/api/pins/${id}/signoffs`, { token: struct.session, body: { proposalId: v1.id, revision: 'B', verdict: 'request_change', comment: 'Too close to the column' } });
    let rec = (await call('GET', `/api/pins/${id}`, { token: mep.session })).json;
    expect(rec.state.label).toBe('In review · Change requested by Structural');
    const stale = await call('POST', `/api/pins/${id}/proposals`, { token: mep.session, body: { summary: 'Route B', approveOwn: true, basedOnVersion: 0 } });
    expect(stale.status).toBe(409);
    rec = (await call('POST', `/api/pins/${id}/proposals`, { token: mep.session, body: { summary: 'Route B', approveOwn: true, basedOnVersion: 1 } })).json;
    expect(rec.proposals).toHaveLength(2);
    expect(rec.state.label).toBe('In review · Waiting for Structural');
    const oldApproval = await call('POST', `/api/pins/${id}/signoffs`, { token: struct.session, body: { proposalId: v1.id, revision: 'B', verdict: 'approve' } });
    expect(oldApproval.status).toBe(409);
  });

  it('handles the hold → evidence → clear → approve path', async () => {
    arch = await join(mep.joinLinks.arch);
    await refresh();
    const slab = pin('RFI-003');
    const rec = (await call('GET', `/api/pins/${slab.id}`, { token: site.session })).json;
    const hold = rec.holds.find((h: Json) => h.status === 'active');
    const blockedApprove = await call('POST', `/api/pins/${slab.id}/signoffs`, { token: struct.session, body: { proposalId: rec.proposals[0].id, revision: 'B', verdict: 'approve' } });
    expect(blockedApprove.status).toBe(409);
    const ev = await call('POST', `/api/pins/${slab.id}/evidence`, { token: site.session, body: { holdId: hold.id, imageUrl: '/field/img_0611.jpg', caption: 'Core test results attached: 42 MPa', messageId: null } });
    expect(ev.status).toBe(201);
    expect(ev.json.state.waitingFor[0].role).toBe('struct');
    const wrong = await call('POST', `/api/pins/${slab.id}/holds/${hold.id}/clear`, { token: arch.session, body: { note: 'ok' } });
    expect(wrong.status).toBe(403);
    const cleared = await call('POST', `/api/pins/${slab.id}/holds/${hold.id}/clear`, { token: struct.session, body: { note: 'Results acceptable' } });
    expect(cleared.json.state.label).toBe('In review · Waiting for Structural and Architect');
    for (const s of [struct, arch]) await call('POST', `/api/pins/${slab.id}/signoffs`, { token: s.session, body: { proposalId: rec.proposals[0].id, revision: 'B', verdict: 'approve' } });
    const fin = (await call('GET', `/api/pins/${slab.id}`, { token: site.session })).json;
    expect(fin.state.status).toBe('complete');
  });

  it('rejects people outside the project and non-reviewers', async () => {
    const other = (await call('POST', '/api/demo/sessions', { body: { role: 'mep' } })).json;
    const r = await call('GET', `/api/projects/${mep.projectId}/state`, { token: other.session });
    expect(r.status).toBe(403);
    await refresh();
    const hero = pin('RFI-002');
    const rec = (await call('GET', `/api/pins/${hero.id}`, { token: site.session })).json;
    const nr = await call('POST', `/api/pins/${hero.id}/signoffs`, { token: site.session, body: { proposalId: rec.proposals[0].id, revision: 'B', verdict: 'approve' } });
    expect(nr.status).toBe(403);
    const hold = await call('POST', `/api/pins/${hero.id}/holds`, { token: mep.session, body: { reason: 'nope nope', clearCondition: 'nope' } });
    expect(hold.status).toBe(403);
  });

  it('exports a register PDF that matches the record', async () => {
    const r = await call('GET', `/api/projects/${mep.projectId}/register.pdf`, { token: site.session });
    expect(r.status).toBe(200);
    expect(r.res.headers.get('content-type')).toBe('application/pdf');
    const buf = Buffer.from(await r.res.arrayBuffer());
    const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default;
    const text = (await pdfParse(buf)).text;
    await refresh();
    const hero = (await call('GET', `/api/pins/${pin('RFI-001').id}`, { token: site.session })).json;
    expect(text).toContain('RFI Register');
    expect(text).toContain('Dana Okafor');
    expect(text).toContain('Marco Ruiz');
    expect(text).toContain('REVIEW COMPLETE');
    expect(text).toContain(`Record ${hero.recordHash}`);
    expect(text).toContain('Rev B');
    await refresh();
    expect(state.demo.tracker.exported).toBe(true);
  });
});
