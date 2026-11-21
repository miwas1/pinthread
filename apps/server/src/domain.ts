import {
  BOT_USER_ID, MT, ROLE_INFO, compactRoute, derivePinState, gridRef, isNormalized, isOnDrawing, pinSubchannelFor, rfiNumber, roleList,
  type DecisionContent, type HoldContent, type JumpContent, type Person, type PinState, type Point, type ProposalContent,
  type SignoffContent, type BriefContent, type PinStateContent, type Role,
} from '@pinthread/shared';
import { config } from './config';
import { sql, type Tx } from './db';
import { enqueue, kickDispatcher } from './outbox';
import { buildPinRecord, getProject, getSheet, lockPin, person, pinFacts, pinMemberIds, type PinData } from './repo';
import { HttpError, newId, rateLimiter } from './util';

type Who = { userId: string; name: string; role: Role };
const who = (p: Person): Who => ({ userId: p.userId, name: p.name, role: p.role });

function actorOf(d: PinData, actorId: string): Person & { canHold: boolean } {
  const u = d.people.get(actorId);
  if (!u) throw new HttpError(403, 'forbidden', 'You are not a member of this project.');
  return { ...person(u), canHold: u.can_hold };
}

async function logEvent(tx: Tx, d: PinData, type: string, actorId: string, payload: Record<string, unknown> = {}) {
  await tx`insert into events (project_id, pin_id, type, actor_id, payload) values (${d.project.id}, ${d.pin.id}, ${type}, ${actorId}, ${tx.json(payload as never)})`;
}

/** Recompute status from fresh rows inside the transaction, persist it, bump seq. */
async function commitState(tx: Tx, pinId: string) {
  await tx`update projects set updated_at = now() where id = (select project_id from pins where id = ${pinId})`;
  const d = await lockPin(tx, pinId);
  const state = derivePinState(pinFacts(d));
  const changed = state.status !== d.pin.status || state.label !== d.pin.status_label;
  const seq = d.pin.state_seq + 1;
  await tx`update pins set status = ${state.status}, status_label = ${state.label}, state_seq = ${seq},
    waiting_since = ${changed ? new Date() : d.pin.waiting_since} where id = ${pinId}`;
  d.pin.state_seq = seq; d.pin.status = state.status; d.pin.status_label = state.label;
  return { d, state, seq, changed };
}

const base = (d: PinData, seq: number) => ({ v: 1 as const, projectId: d.project.id, pinId: d.pin.id, seq });

async function card(tx: Tx, d: PinData, key: string, fromUserId: string, messageType: string, content: object,
  o: { sub?: string; pushContent?: string; mentionUserIds?: string[]; metadata?: Record<string, string>; record?: { table: 'proposals' | 'evidence'; id: string }; transient?: boolean; counted?: boolean } = {}) {
  await enqueue(tx, d.project.id, `${d.project.id}:${key}`, {
    kind: 'send',
    spec: {
      communityId: d.pin.community_id, subchannelId: o.sub ?? d.pin.subchannel_id, fromUserId, messageType,
      content: content as Record<string, unknown>, pushContent: o.pushContent, mentionUserIds: o.mentionUserIds,
      metadata: o.metadata, transient: o.transient, counted: o.counted,
    },
    record: o.record,
  });
}

async function pinStateCard(tx: Tx, d: PinData, state: PinState, seq: number) {
  const content: PinStateContent = { ...base(d, seq), status: state.status, label: state.label };
  await card(tx, d, `pinstate:${d.pin.id}:${seq}`, BOT_USER_ID, MT.pinstate, content, { sub: 'board', transient: true });
}

/** "Jump to pin" alert in each person's discipline subchannel, @mentioning them. */
async function jumps(tx: Tx, d: PinData, seq: number, to: Person[], from: Person, ask: (p: Person) => string, key: string) {
  for (const p of to) {
    if (p.userId === from.userId) continue;
    const text = ask(p);
    const content: JumpContent = {
      ...base(d, seq), number: rfiNumber(d.pin.number), title: d.pin.title, ask: text, forUserIds: [p.userId], forRole: p.role, from: who(from),
      mentionedInfo: { type: 2, userIdList: [p.userId], mentionedContent: text },
    };
    await card(tx, d, `jump:${key}:${p.userId}`, BOT_USER_ID, MT.jump, content, { sub: ROLE_INFO[p.role].discChannel, pushContent: text, mentionUserIds: [p.userId] });
  }
}

async function decisionCard(tx: Tx, d: PinData, state: PinState, seq: number, key: string) {
  const rec = await buildPinRecord(tx, d.pin.id);
  const cur = rec.proposals.find(p => p.current);
  const approvals = rec.signoffs.filter(s => s.proposalId === cur?.id && s.verdict === 'approve' && s.revision === d.sheet.revision)
    .map(s => ({ name: s.reviewer.name, role: s.reviewer.role, at: s.at }));
  const content: DecisionContent = {
    ...base(d, seq), decisionId: `${d.pin.id}-${seq}`, status: state.status, label: state.label,
    version: cur?.version ?? null, revision: d.sheet.revision, approvals, recordHash: rec.recordHash,
  };
  await card(tx, d, `decision:${key}`, BOT_USER_ID, MT.decision, content, { counted: false });
}

const tx = <T>(fn: (tx: Tx) => Promise<T>) => sql.begin(fn as never) as Promise<T>;

// ---------------------------------------------------------------------------------------------------------------

export interface CreatePinInput {
  sheetId: string; x: number; y: number; title: string; question: string; discipline: string; severity: string; reviewerIds: string[];
  /** Uploaded sheets have no known grid: the person types the location (e.g. "C–D/4"). Ignored for the built-in sheet. */
  gridRef?: string | null;
}

/** communityId: the project community (or overflow community) that hosts the pin's private room. */
export async function createPin(projectId: string, actorId: string, input: CreatePinInput, communityId?: string): Promise<string> {
  const pinId = newId();
  await tx(async t => {
    const project = await getProject(t, projectId);
    const sheet = await getSheet(t, input.sheetId);
    if (sheet.project_id !== projectId) throw new HttpError(404, 'not_found', 'Sheet not found.');
    const [{ n }] = await t<{ n: number }[]>`select count(*)::int as n from pins where project_id = ${projectId}`;
    const limit = project.kind === 'demo' ? config.maxPinsPerProject : config.maxPinsPerTeamProject;
    if (n >= limit) throw new HttpError(409, 'too_many_pins', 'This project has reached its issue limit.');
    const pt = [input.x, input.y] as Point;
    if (sheet.source === 'vector' ? !isOnDrawing(pt) : !isNormalized(pt)) throw new HttpError(400, 'off_sheet', 'Drop the pin on the drawing area.');
    const grid = sheet.source === 'vector' ? gridRef(pt) : (input.gridRef?.trim() || '—');
    const users = await t<{ id: string; role: string }[]>`select id, role from users where project_id = ${projectId} and active`;
    if (!users.some(u => u.id === actorId)) throw new HttpError(403, 'forbidden', 'You are not a member of this project.');
    const reviewerIds = [...new Set(input.reviewerIds)].filter(id => users.some(u => u.id === id));
    if (!reviewerIds.length) throw new HttpError(400, 'no_reviewers', 'Choose at least one reviewer.');
    const [{ pin_seq }] = await t<{ pin_seq: number }[]>`update projects set pin_seq = pin_seq + 1 where id = ${projectId} returning pin_seq`;
    await t`insert into pins (id, project_id, sheet_id, community_id, number, x, y, grid_ref, title, question, discipline, severity, subchannel_id, created_by)
      values (${pinId}, ${projectId}, ${sheet.id}, ${communityId ?? project.community_id}, ${pin_seq}, ${input.x}, ${input.y}, ${grid}, ${input.title}, ${input.question},
        ${input.discipline}, ${input.severity}, ${pinSubchannelFor(pinId)}, ${actorId})`;
    for (const [i, uid] of reviewerIds.entries()) await t`insert into pin_reviewers (pin_id, user_id, ord) values (${pinId}, ${uid}, ${i})`;

    const { d, state, seq } = await commitState(t, pinId);
    await pinStateCard(t, d, state, seq); // first: pin colours update on every screen before the cards follow
    const actor = actorOf(d, actorId);
    await enqueue(t, projectId, `${projectId}:room:${pinId}`, {
      kind: 'subchannel', communityId: d.pin.community_id, subchannelId: d.pin.subchannel_id, isPrivate: true, members: pinMemberIds(d), pinId,
    });
    const reviewers = d.reviewerIds.map(id => person(d.people.get(id)!));
    const brief: BriefContent = {
      ...base(d, seq), number: rfiNumber(d.pin.number), title: d.pin.title, question: d.pin.question, gridRef: d.pin.grid_ref,
      sheet: d.sheet.number, revision: d.sheet.revision, raisedBy: who(actor), reviewers: reviewers.map(who),
    };
    await card(t, d, `brief:${pinId}`, BOT_USER_ID, MT.brief, brief, { counted: false });
    await jumps(t, d, seq, reviewers, actor, p => `${actor.name} needs ${ROLE_INFO[p.role].label} on ${rfiNumber(d.pin.number)}: ${d.pin.title}`, `create:${pinId}`);
    await logEvent(t, d, 'pin.created', actorId, { reviewerIds });
    await t`update projects set updated_at = now() where id = ${projectId}`;
  });
  kickDispatcher();
  return pinId;
}

export interface ProposalInput { summary: string; route: Point[] | null; costImpact: string | null; scheduleImpact: string | null; approveOwn: boolean; basedOnVersion: number | null }

export async function postProposal(pinId: string, actorId: string, input: ProposalInput): Promise<string> {
  const proposalId = newId();
  await tx(async t => {
    const d0 = await lockPin(t, pinId);
    const actor = actorOf(d0, actorId);
    const isReviewer = d0.reviewerIds.includes(actorId);
    if (!isReviewer && actor.role !== 'site') throw new HttpError(403, 'forbidden', 'Only the site lead or a required reviewer can post a proposal.');
    const latest = d0.proposals.at(-1);
    if (input.basedOnVersion !== null && (latest?.version ?? 0) !== input.basedOnVersion) {
      throw new HttpError(409, 'stale', `Proposal changed to v${latest?.version}. Review the new route first.`, { currentVersion: latest?.version ?? 0 });
    }
    const version = (latest?.version ?? 0) + 1;
    const prev = d0.proposals.find(p => p.id === d0.pin.current_proposal_id);
    await t`insert into proposals (id, pin_id, version, author_id, summary, route, cost_impact, schedule_impact, revision)
      values (${proposalId}, ${pinId}, ${version}, ${actorId}, ${input.summary}, ${input.route ? t.json(compactRoute(input.route) as never) : null},
        ${input.costImpact}, ${input.scheduleImpact}, ${d0.sheet.revision})`;
    await t`update pins set current_proposal_id = ${proposalId} where id = ${pinId}`;
    const approved = input.approveOwn && isReviewer;
    const signoffId = newId();
    if (approved) {
      await t`insert into signoffs (id, pin_id, proposal_id, reviewer_id, revision, verdict) values (${signoffId}, ${pinId}, ${proposalId}, ${actorId}, ${d0.sheet.revision}, 'approve')`;
    }
    const { d, state, seq } = await commitState(t, pinId);
    await pinStateCard(t, d, state, seq); // first: pin colours update on every screen before the cards follow
    const now = new Date().toISOString();
    if (prev) {
      await enqueue(t, d.project.id, `${d.project.id}:meta:${prev.id}:superseded`, {
        kind: 'metadata', communityId: d.pin.community_id, subchannelId: d.pin.subchannel_id, proposalId: prev.id, metadata: { st: 'superseded' },
      });
    }
    const content: ProposalContent = {
      ...base(d, seq), proposalId, version, revision: d.sheet.revision, summary: input.summary, route: compactRoute(input.route),
      costImpact: input.costImpact, scheduleImpact: input.scheduleImpact, author: who(actor), supersedesVersion: prev?.version ?? null,
    };
    await card(t, d, `proposal:${proposalId}`, actorId, MT.proposal, content, {
      metadata: { st: state.status === 'complete' ? 'accepted' : 'current', ...(approved ? { [`ap_${actorId}`]: now } : {}) },
      record: { table: 'proposals', id: proposalId }, pushContent: `${actor.name} posted proposal v${version} on ${rfiNumber(d.pin.number)}`,
    });
    if (approved) {
      const so: SignoffContent = { ...base(d, seq), signoffId, proposalId, version, revision: d.sheet.revision, verdict: 'approve', comment: null, reviewer: who(actor) };
      await card(t, d, `signoff:${signoffId}:approve`, actorId, MT.signoff, so);
    }
    if (state.status === 'complete') await decisionCard(t, d, state, seq, `${pinId}:${seq}`);
    await jumps(t, d, seq, state.status === 'review' ? state.waitingFor : [], actor,
      p => `${actor.name} needs ${ROLE_INFO[p.role].label} on ${rfiNumber(d.pin.number)}: proposal v${version}`, `proposal:${proposalId}`);
    await logEvent(t, d, 'proposal.posted', actorId, { proposalId, version, approveOwn: approved });
  });
  kickDispatcher();
  return proposalId;
}

export interface SignoffInput { proposalId: string; revision: string; verdict: 'approve' | 'request_change'; comment: string | null }

export async function signoff(pinId: string, actorId: string, input: SignoffInput): Promise<{ duplicate: boolean }> {
  let duplicate = false;
  await tx(async t => {
    const d0 = await lockPin(t, pinId);
    const actor = actorOf(d0, actorId);
    if (!d0.reviewerIds.includes(actorId)) throw new HttpError(403, 'forbidden', 'Only required reviewers can sign off this issue.');
    if (d0.holds.some(h => h.status === 'active')) throw new HttpError(409, 'blocked', 'This issue is on hold. Clear the hold before signing off.');
    const cur = d0.proposals.find(p => p.id === d0.pin.current_proposal_id);
    if (!cur) throw new HttpError(409, 'no_proposal', 'There is no proposal to sign off yet.');
    if (input.proposalId !== cur.id) throw new HttpError(409, 'stale', `Proposal changed to v${cur.version}. Review the new route first.`, { currentVersion: cur.version, currentProposalId: cur.id });
    if (input.revision !== d0.sheet.revision) throw new HttpError(409, 'stale_revision', `The drawing is now Rev ${d0.sheet.revision}. Review it before signing off.`);
    if (input.verdict === 'request_change' && !(input.comment && input.comment.trim().length >= 3)) {
      throw new HttpError(400, 'comment_required', 'Say what needs to change.');
    }
    const [existing] = await t`select * from signoffs where proposal_id = ${cur.id} and reviewer_id = ${actorId} and revision = ${d0.sheet.revision}`;
    if (existing && existing.verdict === input.verdict) { duplicate = true; return; }
    const signoffId = existing?.id ?? newId();
    if (existing) {
      await t`update signoffs set verdict = ${input.verdict}, comment = ${input.comment}, updated_at = now() where id = ${existing.id}`;
    } else {
      await t`insert into signoffs (id, pin_id, proposal_id, reviewer_id, revision, verdict, comment)
        values (${signoffId}, ${pinId}, ${cur.id}, ${actorId}, ${d0.sheet.revision}, ${input.verdict}, ${input.comment})`;
    }
    const { d, state, seq } = await commitState(t, pinId);
    await pinStateCard(t, d, state, seq); // first: pin colours update on every screen before the cards follow
    const now = new Date().toISOString();
    const so: SignoffContent = { ...base(d, seq), signoffId, proposalId: cur.id, version: cur.version, revision: d.sheet.revision, verdict: input.verdict, comment: input.comment, reviewer: who(actor) };
    await card(t, d, `signoff:${signoffId}:${input.verdict}:${seq}`, actorId, MT.signoff, so, {
      pushContent: input.verdict === 'approve' ? `${actor.name} approved v${cur.version} on ${rfiNumber(d.pin.number)}` : `${actor.name} requested a change on ${rfiNumber(d.pin.number)}`,
    });
    await enqueue(t, d.project.id, `${d.project.id}:meta:${cur.id}:${signoffId}:${seq}`, {
      kind: 'metadata', communityId: d.pin.community_id, subchannelId: d.pin.subchannel_id, proposalId: cur.id,
      metadata: { [`${input.verdict === 'approve' ? 'ap' : 'rc'}_${actorId}`]: now, ...(state.status === 'complete' ? { st: 'accepted' } : {}) },
    });
    if (state.status === 'complete') await decisionCard(t, d, state, seq, `${pinId}:${seq}`);
    if (input.verdict === 'request_change') {
      const author = person(d.people.get(cur.author_id)!);
      await jumps(t, d, seq, [author], actor, () => `${actor.name} requested a change on ${rfiNumber(d.pin.number)} v${cur.version}`, `rc:${signoffId}:${seq}`);
    }
    await logEvent(t, d, `signoff.${input.verdict}`, actorId, { proposalId: cur.id, version: cur.version });
  });
  if (!duplicate) kickDispatcher();
  return { duplicate };
}

export async function placeHold(pinId: string, actorId: string, input: { reason: string; clearCondition: string }) {
  await tx(async t => {
    const d0 = await lockPin(t, pinId);
    const actor = actorOf(d0, actorId);
    if (!d0.reviewerIds.includes(actorId) || !actor.canHold) throw new HttpError(403, 'forbidden', 'Only a Structural or Architect reviewer on this issue can place a hold.');
    if (d0.holds.some(h => h.status === 'active')) throw new HttpError(409, 'hold_exists', 'This issue is already on hold.');
    const holdId = newId();
    await t`insert into holds (id, pin_id, placed_by, reason, clear_condition) values (${holdId}, ${pinId}, ${actorId}, ${input.reason}, ${input.clearCondition})`;
    if (d0.pin.current_proposal_id) {
      await t`update signoffs set verdict = 'withdrawn', updated_at = now() where proposal_id = ${d0.pin.current_proposal_id} and reviewer_id = ${actorId} and verdict = 'approve'`;
    }
    const { d, state, seq } = await commitState(t, pinId);
    await pinStateCard(t, d, state, seq); // first: pin colours update on every screen before the cards follow
    const content: HoldContent = { ...base(d, seq), holdId, action: 'placed', reason: input.reason, clearCondition: input.clearCondition, actor: who(actor), note: null };
    await card(t, d, `hold:${holdId}:placed`, actorId, MT.hold, content, { pushContent: `${actor.name} placed a hold on ${rfiNumber(d.pin.number)}` });
    await decisionCard(t, d, state, seq, `${pinId}:${seq}`);
    const site = [...d.people.values()].filter(u => u.role === 'site').map(person);
    await jumps(t, d, seq, site, actor, () => `${actor.name} placed a hold on ${rfiNumber(d.pin.number)}: ${input.clearCondition}`, `hold:${holdId}`);
    await logEvent(t, d, 'hold.placed', actorId, { holdId });
  });
  kickDispatcher();
}

export async function addEvidence(pinId: string, actorId: string, input: { holdId: string | null; imageUrl: string; caption: string; messageId: string | null }) {
  await tx(async t => {
    const d0 = await lockPin(t, pinId);
    const actor = actorOf(d0, actorId);
    if (!pinMemberIds(d0).includes(actorId)) throw new HttpError(403, 'forbidden', 'Only people on this issue can add evidence.');
    const hold = input.holdId ? d0.holds.find(h => h.id === input.holdId) : null;
    if (input.holdId && (!hold || hold.status !== 'active')) throw new HttpError(409, 'hold_not_active', 'That hold is no longer active.');
    const evidenceId = newId();
    await t`insert into evidence (id, pin_id, hold_id, author_id, image_url, caption, message_id)
      values (${evidenceId}, ${pinId}, ${input.holdId}, ${actorId}, ${input.imageUrl}, ${input.caption}, ${input.messageId})`;
    const { d, state, seq } = await commitState(t, pinId);
    await pinStateCard(t, d, state, seq); // first: pin colours update on every screen before the cards follow
    if (hold) {
      const content: HoldContent = { ...base(d, seq), holdId: hold.id, action: 'evidence_added', reason: hold.reason, clearCondition: hold.clear_condition, actor: who(actor), note: input.caption };
      await card(t, d, `hold:${hold.id}:evidence:${evidenceId}`, actorId, MT.hold, content);
      const placer = person(d.people.get(hold.placed_by)!);
      await jumps(t, d, seq, [placer], actor, () => `${actor.name} posted corrective evidence on ${rfiNumber(d.pin.number)}. Assess and clear the hold.`, `evidence:${evidenceId}`);
    }
    await logEvent(t, d, 'evidence.added', actorId, { evidenceId, holdId: input.holdId });
  });
  kickDispatcher();
}

export async function clearHold(pinId: string, holdId: string, actorId: string, note: string | null) {
  await tx(async t => {
    const d0 = await lockPin(t, pinId);
    const actor = actorOf(d0, actorId);
    const hold = d0.holds.find(h => h.id === holdId);
    if (!hold || hold.status !== 'active') throw new HttpError(409, 'hold_not_active', 'That hold is no longer active.');
    const placer = d0.people.get(hold.placed_by)!;
    if (actorId !== hold.placed_by && actor.role !== placer.role) throw new HttpError(403, 'forbidden', `Only ${roleList([placer.role as Role])} can clear this hold.`);
    await t`update holds set status = 'cleared', cleared_by = ${actorId}, cleared_at = now(), note = ${note} where id = ${holdId}`;
    const { d, state, seq } = await commitState(t, pinId);
    await pinStateCard(t, d, state, seq); // first: pin colours update on every screen before the cards follow
    const content: HoldContent = { ...base(d, seq), holdId, action: 'cleared', reason: hold.reason, clearCondition: hold.clear_condition, actor: who(actor), note };
    await card(t, d, `hold:${holdId}:cleared`, actorId, MT.hold, content, { pushContent: `${actor.name} cleared the hold on ${rfiNumber(d.pin.number)}` });
    await decisionCard(t, d, state, seq, `${pinId}:${seq}`);
    if (state.status === 'review') {
      await jumps(t, d, seq, state.waitingFor, actor, p => `Hold cleared on ${rfiNumber(d.pin.number)}. ${ROLE_INFO[p.role].label} review needed.`, `clear:${holdId}`);
    }
    await logEvent(t, d, 'hold.cleared', actorId, { holdId });
  });
  kickDispatcher();
}

const nudgeLimit = rateLimiter(1, 60_000);
export async function nudge(pinId: string, actorId: string) {
  if (!nudgeLimit(`${pinId}:${actorId}`)) throw new HttpError(429, 'slow_down', 'You nudged this issue less than a minute ago.');
  await tx(async t => {
    const d = await lockPin(t, pinId);
    const actor = actorOf(d, actorId);
    const state = derivePinState(pinFacts(d));
    await jumps(t, d, d.pin.state_seq, state.waitingFor, actor, p => `${actor.name} is waiting on ${ROLE_INFO[p.role].label} for ${rfiNumber(d.pin.number)}`, `nudge:${Date.now()}`);
  });
  kickDispatcher();
}

export async function recordExport(projectId: string, userId: string) {
  await sql`update projects set exported_at = coalesce(exported_at, now()) where id = ${projectId}`;
  await sql`insert into analytics (project_id, project_kind, user_id, name) select id, kind, ${userId}, 'register.exported' from projects where id = ${projectId}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Sheets and team membership (team projects)

/**
 * Publish a new revision of a sheet. Approvals are only valid on the revision they were given on, so every pin on the
 * sheet is re-derived: a completed review goes back to "In review" and its reviewers are asked to look again.
 */
export async function newSheetRevision(sheetId: string, actorId: string, input: { revision: string; fileId: string; thumbFileId: string | null; width: number; height: number }) {
  const affected: string[] = [];
  await tx(async t => {
    const [sheet] = await t<{ id: string; project_id: string; revision: string; number: string }[]>`select * from sheets where id = ${sheetId} for update`;
    if (!sheet) throw new HttpError(404, 'not_found', 'Sheet not found.');
    if (sheet.revision.toLowerCase() === input.revision.toLowerCase()) throw new HttpError(409, 'same_revision', `This sheet is already Rev ${sheet.revision}. Use the new revision label.`);
    await t`update sheets set revision = ${input.revision}, file_id = ${input.fileId}, thumb_file_id = coalesce(${input.thumbFileId}, thumb_file_id),
      width = ${input.width}, height = ${input.height}, updated_at = now() where id = ${sheetId}`;
    await t`insert into sheet_revisions (sheet_id, revision, file_id, created_by) values (${sheetId}, ${input.revision}, ${input.fileId}, ${actorId})`;
    const pins = await t<{ id: string }[]>`select id from pins where sheet_id = ${sheetId} order by number`;
    for (const { id } of pins) {
      const { d, state, seq, changed } = await commitState(t, id);
      if (!changed) continue;
      affected.push(id);
      await pinStateCard(t, d, state, seq);
      await decisionCard(t, d, state, seq, `${id}:${seq}`);
      const actor = actorOf(d, actorId);
      if (state.status === 'review') {
        await jumps(t, d, seq, state.waitingFor, actor,
          () => `${d.sheet.number} is now Rev ${d.sheet.revision}. Re-check ${rfiNumber(d.pin.number)} on the new revision.`, `rev:${sheetId}:${input.revision}:${id}`);
      }
    }
    await t`insert into events (project_id, type, actor_id, payload) values (${sheet.project_id}, 'sheet.revised', ${actorId}, ${t.json({ sheetId, revision: input.revision, affected } as never)})`;
  });
  kickDispatcher();
  return { affected: affected.length };
}

/**
 * Remove someone from a team project. They lose access to the project and leave its Nexconn communities. Open reviews
 * they were holding up are taken off them; where nobody else was reviewing, the admin who removed them takes over.
 */
export async function removeMember(projectId: string, userId: string, byUserId: string) {
  let reassigned = 0;
  await tx(async t => {
    const [u] = await t<{ id: string; active: boolean; is_admin: boolean }[]>`select id, active, is_admin from users where id = ${userId} and project_id = ${projectId} for update`;
    if (!u || !u.active) throw new HttpError(404, 'not_found', 'That person is not on this project.');
    if (u.is_admin) {
      const [{ n }] = await t<{ n: number }[]>`select count(*)::int as n from users where project_id = ${projectId} and active and is_admin`;
      if (n <= 1) throw new HttpError(409, 'last_admin', 'A project needs at least one admin.');
    }
    await t`update users set active = false, is_admin = false where id = ${userId}`;
    const pins = await t<{ id: string; status: string }[]>`select p.id, p.status from pins p join pin_reviewers r on r.pin_id = p.id
      where p.project_id = ${projectId} and r.user_id = ${userId} and p.status <> 'complete' order by p.number`;
    for (const p of pins) {
      const [{ n }] = await t<{ n: number }[]>`select count(*)::int as n from pin_reviewers where pin_id = ${p.id} and user_id <> ${userId}`;
      await t`delete from pin_reviewers where pin_id = ${p.id} and user_id = ${userId}`;
      if (n === 0) {
        await t`insert into pin_reviewers (pin_id, user_id, ord) values (${p.id}, ${byUserId}, 0) on conflict do nothing`;
        const [pin] = await t<{ community_id: string; subchannel_id: string }[]>`select community_id, subchannel_id from pins where id = ${p.id}`;
        await enqueue(t, projectId, `${projectId}:members:${p.id}:${byUserId}`, { kind: 'members', communityId: pin.community_id, subchannelId: pin.subchannel_id, members: [byUserId] });
      }
      reassigned++;
      const { d, state, seq } = await commitState(t, p.id);
      await pinStateCard(t, d, state, seq);
    }
    const comms = await t<{ community_id: string }[]>`select community_id from project_communities where project_id = ${projectId}`;
    for (const c of comms) await enqueue(t, projectId, `${projectId}:leave:${c.community_id}:${userId}:${Date.now()}`, { kind: 'leave', communityId: c.community_id, userId });
    await t`insert into events (project_id, type, actor_id, payload) values (${projectId}, 'member.removed', ${byUserId}, ${t.json({ userId, reassigned } as never)})`;
  });
  kickDispatcher();
  return { reassigned };
}
