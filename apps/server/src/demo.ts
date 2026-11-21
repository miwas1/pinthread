// Demo projects: each visitor claims their own pre-seeded Meridian Tower project (Level 03, Rev B).
import { FIELD_PHOTOS, FIXED_SUBCHANNELS, MERIDIAN, communityIdFor, demoUserIdFor, type Point, type Role } from '@pinthread/shared';
import { gateway } from './chat/gateway';
import { config } from './config';
import { sql } from './db';
import { createPin, placeHold, postProposal, signoff } from './domain';
import { log } from './log';
import { drainProject, enqueue } from './outbox';
import { HttpError, newId } from './util';

export const PEOPLE: Record<Role, { name: string; firm: string; initials: string; canHold: boolean }> = {
  site: { name: 'Priya Shah', firm: 'Halden Construction', initials: 'PS', canHold: false },
  mep: { name: 'Marco Ruiz', firm: 'Northline MEP', initials: 'MR', canHold: false },
  struct: { name: 'Dana Okafor', firm: 'Okafor Structural', initials: 'DO', canHold: true },
  arch: { name: 'Lena Park', firm: 'Park & Vale Architects', initials: 'LP', canHold: true },
};

const at = (id: keyof typeof MERIDIAN.pins) => MERIDIAN.pins[id].at as Point;
const xy = (p: Point) => ({ x: p[0], y: p[1] });
const n = (x: number, y: number): Point => [+(x / MERIDIAN.sheet.width).toFixed(4), +(y / MERIDIAN.sheet.height).toFixed(4)];
const photoUrl = (key: string) => `${config.publicUrl}${FIELD_PHOTOS[key].url}`;

async function sitePhoto(projectId: string, pinId: string, fromUserId: string, key: string, text: string) {
  const [p] = await sql<{ community_id: string; subchannel_id: string }[]>`select pr.community_id, pi.subchannel_id from pins pi join projects pr on pr.id = pi.project_id where pi.id = ${pinId}`;
  await enqueue(sql, projectId, `${projectId}:seedphoto:${pinId}`, {
    kind: 'send', spec: { communityId: p.community_id, subchannelId: p.subchannel_id, fromUserId, messageType: 'RC:ImgMsg', content: { content: FIELD_PHOTOS[key].thumb, imageUri: photoUrl(key) } },
  });
  await enqueue(sql, projectId, `${projectId}:seedtext:${pinId}`, {
    kind: 'send', spec: { communityId: p.community_id, subchannelId: p.subchannel_id, fromUserId, messageType: 'RC:TxtMsg', content: { content: text } },
  });
}

export async function seedDemoProject(): Promise<string> {
  const projectId = newId();
  const communityId = communityIdFor(projectId);
  const g = gateway();
  const uid = (r: Role) => demoUserIdFor(projectId, r);
  const sheetId = newId();
  await sql.begin(async t => {
    await t`insert into projects (id, kind, name, community_id, sheet_number, sheet_title, revision, chat_mode)
      values (${projectId}, 'demo', 'Meridian Tower', ${communityId}, ${MERIDIAN.sheet.number}, ${MERIDIAN.sheet.title}, ${MERIDIAN.sheet.revision}, ${config.chatMode})`;
    await t`insert into project_communities (community_id, project_id, ord) values (${communityId}, ${projectId}, 0)`;
    await t`insert into sheets (id, project_id, number, title, revision, source, width, height)
      values (${sheetId}, ${projectId}, ${MERIDIAN.sheet.number}, ${MERIDIAN.sheet.title}, ${MERIDIAN.sheet.revision}, 'vector', ${MERIDIAN.sheet.width}, ${MERIDIAN.sheet.height})`;
    await t`insert into sheet_revisions (sheet_id, revision) values (${sheetId}, ${MERIDIAN.sheet.revision})`;
    for (const [role, p] of Object.entries(PEOPLE)) {
      await t`insert into users (id, project_id, role, name, firm, initials, can_hold) values (${uid(role as Role)}, ${projectId}, ${role}, ${p.name}, ${p.firm}, ${p.initials}, ${p.canHold})`;
    }
  });
  for (const [role, p] of Object.entries(PEOPLE)) {
    const token = await g.issueToken(uid(role as Role), p.name);
    await sql`update users set token = ${token} where id = ${uid(role as Role)}`;
  }
  await g.createCommunity(communityId, uid('site'), 'Meridian Tower');
  for (const r of ['mep', 'struct', 'arch'] as Role[]) await g.joinCommunity(communityId, uid(r));
  for (const s of FIXED_SUBCHANNELS) await g.createSubchannel(communityId, s, false);

  // RFI-001: the hero. Open, with the site lead's question and field photo.
  const r1 = await createPin(projectId, uid('site'), {
    sheetId, ...xy(at('RFI-001')), title: MERIDIAN.pins['RFI-001'].title, discipline: 'mep', severity: 'high', reviewerIds: [uid('mep'), uid('struct')],
    question: 'SD-3 hits the B-14 soffit between C and D. Ceiling close-out is Friday. What route can MEP and Structural both accept?',
  });
  await sitePhoto(projectId, r1, uid('site'), 'img_0742', 'Looking north at C–D/4. The duct is hard against the beam soffit.');

  // RFI-002: In review, waiting for the Architect.
  const r2 = await createPin(projectId, uid('site'), {
    sheetId, ...xy(at('RFI-002')), title: MERIDIAN.pins['RFI-002'].title, discipline: 'elec', severity: 'medium', reviewerIds: [uid('arch'), uid('mep')],
    question: 'The ER-2 sleeve lands on the edge of the core wall opening. Can the riser move, or does the opening need to change?',
  });
  await sitePhoto(projectId, r2, uid('site'), 'img_0815', 'Core C1 east wall. Sleeve is tight to the opening edge.');
  await postProposal(r2, uid('mep'), {
    summary: 'Shift ER-2 300 mm north to clear the opening edge and fit an FR-rated (2 h) sleeve.',
    route: [n(808, 560), n(808, 512), n(872, 512)], costImpact: '+$450 est.', scheduleImpact: 'None', approveOwn: true, basedOnVersion: null,
  });

  // RFI-003: Blocked. The exception path (evidence → clear hold → approvals).
  const r3 = await createPin(projectId, uid('site'), {
    sheetId, ...xy(at('RFI-003')), title: MERIDIAN.pins['RFI-003'].title, discipline: 'struct', severity: 'high', reviewerIds: [uid('struct'), uid('arch')],
    question: 'Honeycombing along the slab edge at pour 3B after the strike. Can we repair in place?',
  });
  await sitePhoto(projectId, r3, uid('site'), 'img_0611', 'Pour 3B edge after strike, grid F–G/2–3.');
  await postProposal(r3, uid('site'), {
    summary: 'Break out the honeycombed edge to sound concrete and reinstate with R4 repair mortar per method statement MS-07.',
    route: null, costImpact: '+$2,800 est.', scheduleImpact: '1–3 days', approveOwn: false, basedOnVersion: null,
  });
  await placeHold(r3, uid('struct'), { reason: 'Visible honeycombing at the slab edge. Not accepting the pour as-is.', clearCondition: 'Core test results or a repair method statement' });

  // RFI-004: Review complete, with a superseded v1.
  const r4 = await createPin(projectId, uid('site'), {
    sheetId, ...xy(at('RFI-004')), title: MERIDIAN.pins['RFI-004'].title, discipline: 'arch', severity: 'low', reviewerIds: [uid('arch'), uid('struct')],
    question: 'Bracket spacing on CW-1 does not match the fixing schedule. Which one governs?',
  });
  const v1 = await postProposal(r4, uid('arch'), { summary: 'Keep brackets at 1200 centres as drawn.', route: null, costImpact: null, scheduleImpact: 'None', approveOwn: true, basedOnVersion: null });
  void v1;
  const v2 = await postProposal(r4, uid('arch'), { summary: 'Brackets at 900 centres with extra fixings at the corners, per the fixing schedule.', route: null, costImpact: '+$600 est.', scheduleImpact: 'None', approveOwn: true, basedOnVersion: 1 });
  await signoff(r4, uid('struct'), { proposalId: v2, revision: MERIDIAN.sheet.revision, verdict: 'approve', comment: null });

  await drainProject(projectId);

  // Backdate the record so waiting times read naturally ("Waiting for Architect · 2 h").
  const shift = async (pinId: string, hours: number) => {
    const iv = `${hours} hours`;
    await sql`update pins set created_at = created_at - ${iv}::interval, waiting_since = waiting_since - ${iv}::interval where id = ${pinId}`;
    for (const tbl of ['proposals', 'holds', 'evidence']) await sql`update ${sql(tbl)} set created_at = created_at - ${iv}::interval where pin_id = ${pinId}`;
    await sql`update signoffs set created_at = created_at - ${iv}::interval, updated_at = updated_at - ${iv}::interval where pin_id = ${pinId}`;
  };
  await shift(r1, 3); await shift(r2, 2); await shift(r3, 18); await shift(r4, 30);
  await sql`update pins set waiting_since = now() - interval '3 hours' where id = ${r1}`;
  await sql`update projects set ready = true where id = ${projectId}`;
  log.info('demo.seeded', { projectId });
  return projectId;
}



let filling = false;
export async function ensurePool() {
  if (filling) return;
  filling = true;
  try {
    for (;;) {
      const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from projects where kind = 'demo' and ready and claimed_at is null and chat_mode = ${config.chatMode}`;
      if (n >= config.poolSize) break;
      await seedDemoProject();
    }
  } catch (e) {
    log.error('demo.pool', { error: String(e) });
  } finally {
    filling = false;
  }
}

export async function claimDemoProject(): Promise<string> {
  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from projects where kind = 'demo' and claimed_at > now() - interval '1 day'`;
  if (n >= config.maxDemoClaimsPerDay) throw new HttpError(503, 'capacity', 'The demo is at capacity for today. Please try again tomorrow.');
  const claim = () => sql<{ id: string }[]>`update projects set claimed_at = now(), expires_at = now() + make_interval(hours => ${config.demoTtlHours})
    where id = (select id from projects where kind = 'demo' and ready and claimed_at is null and chat_mode = ${config.chatMode}
      order by created_at limit 1 for update skip locked) returning id`;
  let [row] = await claim();
  if (!row) {
    await seedDemoProject();
    [row] = await claim();
  }
  if (!row) throw new HttpError(503, 'busy', 'Setting up demo projects. Try again in a few seconds.');
  setImmediate(() => void ensurePool());
  return row.id;
}

/** Pre-built projects from another chat mode (e.g. local before Nexconn keys were set) must never be handed out. */
export async function purgeMismatchedPool() {
  const rows = await sql<{ id: string }[]>`delete from projects p where kind = 'demo' and claimed_at is null and (chat_mode <> ${config.chatMode}
    or (${config.chatMode} = 'nexconn' and exists (select 1 from local_messages m where m.community_id = p.community_id))) returning id`;
  if (config.chatMode === 'nexconn') await sql`delete from local_messages m where exists (select 1 from projects p where p.community_id = m.community_id and p.chat_mode = 'nexconn')`;
  for (const r of rows) await sql`delete from outbox where project_id = ${r.id}`;
  if (rows.length) log.info('demo.pool.purged', { removed: rows.length, chatMode: config.chatMode });
}

export async function cleanupExpired() {
  const rows = await sql<{ id: string; community_id: string }[]>`select id, community_id from projects where kind = 'demo' and expires_at < now() limit 20`;
  for (const r of rows) {
    try { await gateway().dismissCommunity(r.community_id); } catch (e) { log.warn('demo.dismiss', { id: r.id, error: String(e) }); }
    await sql`delete from projects where id = ${r.id}`;
    await sql`delete from outbox where project_id = ${r.id}`;
  }
  if (rows.length) log.info('demo.cleanup', { removed: rows.length });
}

