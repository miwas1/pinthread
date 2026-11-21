import {
  BOT_USER_ID, MT, ROLE_INFO, compactRoute, derivePinState, gridRef, isOnDrawing, pinSubchannelFor, rfiNumber, roleList,
  type DecisionContent, type HoldContent, type JumpContent, type Person, type PinState, type Point, type ProposalContent,
  type SignoffContent, type BriefContent, type PinStateContent, type Role,
} from '@pinthread/shared';
import { config } from './config';
import { sql, type Tx } from './db';
import { enqueue, kickDispatcher } from './outbox';
import { buildPinRecord, getProject, lockPin, person, pinFacts, pinMemberIds, type PinData } from './repo';
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
      communityId: d.project.community_id, subchannelId: o.sub ?? d.pin.subchannel_id, fromUserId, messageType,
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
  const approvals = rec.signoffs.filter(s => s.proposalId === cur?.id && s.verdict === 'approve' && s.revision === d.project.revision)
    .map(s => ({ name: s.reviewer.name, role: s.reviewer.role, at: s.at }));
  const content: DecisionContent = {
    ...base(d, seq), decisionId: `${d.pin.id}-${seq}`, status: state.status, label: state.label,
    version: cur?.version ?? null, revision: d.project.revision, approvals, recordHash: rec.recordHash,
  };
  await card(tx, d, `decision:${key}`, BOT_USER_ID, MT.decision, content, { counted: false });
}

const tx = <T>(fn: (tx: Tx) => Promise<T>) => sql.begin(fn as never) as Promise<T>;

// ---------------------------------------------------------------------------------------------------------------

export interface CreatePinInput { x: number; y: number; title: string; question: string; discipline: string; severity: string; reviewerIds: string[] }

export async function createPin(projectId: string, actorId: string, input: CreatePinInput): Promise<string> {
  const pinId = newId();
  await tx(async t => {
    const project = await getProject(t, projectId);
    const [{ n }] = await t<{ n: number }[]>`select count(*)::int as n from pins where project_id = ${projectId}`;
    if (n >= config.maxPinsPerProject) throw new HttpError(409, 'too_many_pins', 'This project has reached its issue limit.');
    if (!isOnDrawing([input.x, input.y])) throw new HttpError(400, 'off_sheet', 'Drop the pin on the drawing area.');
    const users = await t<{ id: string; role: string }[]>`select id, role from users where project_id = ${projectId}`;
    if (!users.some(u => u.id === actorId)) throw new HttpError(403, 'forbidden', 'You are not a member of this project.');
    const reviewerIds = [...new Set(input.reviewerIds)].filter(id => users.some(u => u.id === id));
    if (!reviewerIds.length) throw new HttpError(400, 'no_reviewers', 'Choose at least one reviewer.');
    const [{ pin_seq }] = await t<{ pin_seq: number }[]>`update projects set pin_seq = pin_seq + 1 where id = ${projectId} returning pin_seq`;
    await t`insert into pins (id, project_id, number, x, y, grid_ref, title, question, discipline, severity, subchannel_id, created_by)
      values (${pinId}, ${projectId}, ${pin_seq}, ${input.x}, ${input.y}, ${gridRef([input.x, input.y] as Point)}, ${input.title}, ${input.question},
        ${input.discipline}, ${input.severity}, ${pinSubchannelFor(pinId)}, ${actorId})`;
    for (const [i, uid] of reviewerIds.entries()) await t`insert into pin_reviewers (pin_id, user_id, ord) values (${pinId}, ${uid}, ${i})`;

    const { d, state, seq } = await commitState(t, pinId);
    const actor = actorOf(d, actorId);
    await enqueue(t, projectId, `${projectId}:room:${pinId}`, {
      kind: 'subchannel', communityId: project.community_id, subchannelId: d.pin.subchannel_id, isPrivate: true, members: pinMemberIds(d), pinId,
    });
    const reviewers = d.reviewerIds.map(id => person(d.people.get(id)!));
    const brief: BriefContent = {
      ...base(d, seq), number: rfiNumber(d.pin.number), title: d.pin.title, question: d.pin.question, gridRef: d.pin.grid_ref,
      sheet: project.sheet_number, revision: project.revision, raisedBy: who(actor), reviewers: reviewers.map(who),
    };
    await card(t, d, `brief:${pinId}`, BOT_USER_ID, MT.brief, brief, { counted: false });
    await jumps(t, d, seq, reviewers, actor, p => `${actor.name} needs ${ROLE_INFO[p.role].label} on ${rfiNumber(d.pin.number)}: ${d.pin.title}`, `create:${pinId}`);
    await pinStateCard(t, d, state, seq);
    await logEvent(t, d, 'pin.created', actorId, { reviewerIds });
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
        ${input.costImpact}, ${input.scheduleImpact}, ${d0.project.revision})`;
    await t`update pins set current_proposal_id = ${proposalId} where id = ${pinId}`;
    const approved = input.approveOwn && isReviewer;
    const signoffId = newId();
    if (approved) {
      await t`insert into signoffs (id, pin_id, proposal_id, reviewer_id, revision, verdict) values (${signoffId}, ${pinId}, ${proposalId}, ${actorId}, ${d0.project.revision}, 'approve')`;
    }
    const { d, state, seq } = await commitState(t, pinId);
    const now = new Date().toISOString();
    if (prev) {
      await enqueue(t, d.project.id, `${d.project.id}:meta:${prev.id}:superseded`, {
        kind: 'metadata', communityId: d.project.community_id, subchannelId: d.pin.subchannel_id, proposalId: prev.id, metadata: { st: 'superseded' },
      });
    }
    const content: ProposalContent = {
      ...base(d, seq), proposalId, version, revision: d.project.revision, summary: input.summary, route: compactRoute(input.route),
      costImpact: input.costImpact, scheduleImpact: input.scheduleImpact, author: who(actor), supersedesVersion: prev?.version ?? null,
    };
    await card(t, d, `proposal:${proposalId}`, actorId, MT.proposal, content, {
      metadata: { st: state.status === 'complete' ? 'accepted' : 'current', ...(approved ? { [`ap_${actorId}`]: now } : {}) },
      record: { table: 'proposals', id: proposalId }, pushContent: `${actor.name} posted proposal v${version} on ${rfiNumber(d.pin.number)}`,
    });
    if (approved) {
      const so: SignoffContent = { ...base(d, seq), signoffId, proposalId, version, revision: d.project.revision, verdict: 'approve', comment: null, reviewer: who(actor) };
      await card(t, d, `signoff:${signoffId}:approve`, actorId, MT.signoff, so);
    }
    if (state.status === 'complete') await decisionCard(t, d, state, seq, `${pinId}:${seq}`);
    await jumps(t, d, seq, state.status === 'review' ? state.waitingFor : [], actor,
      p => `${actor.name} needs ${ROLE_INFO[p.role].label} on ${rfiNumber(d.pin.number)}: proposal v${version}`, `proposal:${proposalId}`);
    await pinStateCard(t, d, state, seq);
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
    if (input.revision !== d0.project.revision) throw new HttpError(409, 'stale_revision', `The drawing is now Rev ${d0.project.revision}. Review it before signing off.`);
    if (input.verdict === 'request_change' && !(input.comment && input.comment.trim().length >= 3)) {
      throw new HttpError(400, 'comment_required', 'Say what needs to change.');
    }
    const [existing] = await t`select * from signoffs where proposal_id = ${cur.id} and reviewer_id = ${actorId} and revision = ${d0.project.revision}`;
    if (existing && existing.verdict === input.verdict) { duplicate = true; return; }
    const signoffId = existing?.id ?? newId();
    if (existing) {
      await t`update signoffs set verdict = ${input.verdict}, comment = ${input.comment}, updated_at = now() where id = ${existing.id}`;
    } else {
      await t`insert into signoffs (id, pin_id, proposal_id, reviewer_id, revision, verdict, comment)
        values (${signoffId}, ${pinId}, ${cur.id}, ${actorId}, ${d0.project.revision}, ${input.verdict}, ${input.comment})`;
    }
    const { d, state, seq } = await commitState(t, pinId);
    const now = new Date().toISOString();
    const so: SignoffContent = { ...base(d, seq), signoffId, proposalId: cur.id, version: cur.version, revision: d.project.revision, verdict: input.verdict, comment: input.comment, reviewer: who(actor) };
    await card(t, d, `signoff:${signoffId}:${input.verdict}:${seq}`, actorId, MT.signoff, so, {
      pushContent: input.verdict === 'approve' ? `${actor.name} approved v${cur.version} on ${rfiNumber(d.pin.number)}` : `${actor.name} requested a change on ${rfiNumber(d.pin.number)}`,
    });
    await enqueue(t, d.project.id, `${d.project.id}:meta:${cur.id}:${signoffId}:${seq}`, {
      kind: 'metadata', communityId: d.project.community_id, subchannelId: d.pin.subchannel_id, proposalId: cur.id,
      metadata: { [`${input.verdict === 'approve' ? 'ap' : 'rc'}_${actorId}`]: now, ...(state.status === 'complete' ? { st: 'accepted' } : {}) },
    });
    if (state.status === 'complete') await decisionCard(t, d, state, seq, `${pinId}:${seq}`);
    if (input.verdict === 'request_change') {
      const author = person(d.people.get(cur.author_id)!);
      await jumps(t, d, seq, [author], actor, () => `${actor.name} requested a change on ${rfiNumber(d.pin.number)} v${cur.version}`, `rc:${signoffId}:${seq}`);
    }
    await pinStateCard(t, d, state, seq);
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
    const content: HoldContent = { ...base(d, seq), holdId, action: 'placed', reason: input.reason, clearCondition: input.clearCondition, actor: who(actor), note: null };
    await card(t, d, `hold:${holdId}:placed`, actorId, MT.hold, content, { pushContent: `${actor.name} placed a hold on ${rfiNumber(d.pin.number)}` });
    await decisionCard(t, d, state, seq, `${pinId}:${seq}`);
    const site = [...d.people.values()].filter(u => u.role === 'site').map(person);
    await jumps(t, d, seq, site, actor, () => `${actor.name} placed a hold on ${rfiNumber(d.pin.number)}: ${input.clearCondition}`, `hold:${holdId}`);
    await pinStateCard(t, d, state, seq);
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
    if (hold) {
      const content: HoldContent = { ...base(d, seq), holdId: hold.id, action: 'evidence_added', reason: hold.reason, clearCondition: hold.clear_condition, actor: who(actor), note: input.caption };
      await card(t, d, `hold:${hold.id}:evidence:${evidenceId}`, actorId, MT.hold, content);
      const placer = person(d.people.get(hold.placed_by)!);
      await jumps(t, d, seq, [placer], actor, () => `${actor.name} posted corrective evidence on ${rfiNumber(d.pin.number)}. Assess and clear the hold.`, `evidence:${evidenceId}`);
    }
    await pinStateCard(t, d, state, seq);
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
    const content: HoldContent = { ...base(d, seq), holdId, action: 'cleared', reason: hold.reason, clearCondition: hold.clear_condition, actor: who(actor), note };
    await card(t, d, `hold:${holdId}:cleared`, actorId, MT.hold, content, { pushContent: `${actor.name} cleared the hold on ${rfiNumber(d.pin.number)}` });
    await decisionCard(t, d, state, seq, `${pinId}:${seq}`);
    if (state.status === 'review') {
      await jumps(t, d, seq, state.waitingFor, actor, p => `Hold cleared on ${rfiNumber(d.pin.number)}. ${ROLE_INFO[p.role].label} review needed.`, `clear:${holdId}`);
    }
    await pinStateCard(t, d, state, seq);
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
