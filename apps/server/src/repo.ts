// Read models: turn rows into the shared DTOs (Person, PinSummary, PinRecord) and PinFacts for derivePinState.
import { derivePinState, rfiNumber, type Hold, type Person, type PinFacts, type PinRecord, type PinState, type PinSummary, type Proposal, type Role, type Signoff, type Evidence } from '@pinthread/shared';
import type { Q } from './db';
import { canonical, HttpError, iso, sha256hex } from './util';

export interface PinRow {
  id: string; project_id: string; number: number; x: number; y: number; grid_ref: string; title: string; question: string;
  discipline: string; severity: string; subchannel_id: string; created_by: string; created_at: Date; status: string;
  status_label: string; state_seq: number; current_proposal_id: string | null; waiting_since: Date | null; room_ready: boolean;
}
export interface ProjectRow {
  id: string; kind: 'demo' | 'pilot'; name: string; community_id: string; sheet_number: string; sheet_title: string;
  revision: string; pin_seq: number; ready: boolean; claimed_at: Date | null; exported_at: Date | null; expires_at: Date | null;
}

export const person = (u: { id: string; name: string; role: string; firm: string; initials: string }): Person =>
  ({ userId: u.id, name: u.name, role: u.role as Role, firm: u.firm, initials: u.initials });

export async function getProject(db: Q, projectId: string): Promise<ProjectRow> {
  const [p] = await db<ProjectRow[]>`select * from projects where id = ${projectId}`;
  if (!p) throw new HttpError(404, 'not_found', 'Project not found.');
  return p;
}

export async function projectPeople(db: Q, projectId: string) {
  const users = await db<{ id: string; name: string; role: string; firm: string; initials: string; can_hold: boolean; first_connected_at: Date | null }[]>`
    select id, name, role, firm, initials, can_hold, first_connected_at from users where project_id = ${projectId} order by created_at, id`;
  return new Map(users.map(u => [u.id, u]));
}

interface PinData {
  pin: PinRow; project: ProjectRow; people: Awaited<ReturnType<typeof projectPeople>>;
  reviewerIds: string[]; proposals: any[]; signoffs: any[]; holds: any[]; evidence: any[];
}

async function loadPinData(db: Q, pinId: string, lock = false): Promise<PinData> {
  const [pin] = lock ? await db<PinRow[]>`select * from pins where id = ${pinId} for update` : await db<PinRow[]>`select * from pins where id = ${pinId}`;
  if (!pin) throw new HttpError(404, 'not_found', 'Issue not found.');
  const project = await getProject(db, pin.project_id);
  const people = await projectPeople(db, pin.project_id);
  const reviewerIds = (await db<{ user_id: string }[]>`select user_id from pin_reviewers where pin_id = ${pinId} order by ord`).map(r => r.user_id);
  const proposals = await db`select * from proposals where pin_id = ${pinId} order by version`;
  const signoffs = await db`select s.*, p.version from signoffs s join proposals p on p.id = s.proposal_id where s.pin_id = ${pinId} order by s.updated_at`;
  const holds = await db`select * from holds where pin_id = ${pinId} order by created_at`;
  const evidence = await db`select * from evidence where pin_id = ${pinId} order by created_at`;
  return { pin, project, people, reviewerIds, proposals, signoffs, holds, evidence };
}

function facts(d: PinData): PinFacts {
  const P = (id: string) => person(d.people.get(id)!);
  const site = [...d.people.values()].find(u => u.role === 'site');
  const cur = d.proposals.find(p => p.id === d.pin.current_proposal_id);
  const hold = d.holds.find(h => h.status === 'active');
  return {
    requiredReviewers: d.reviewerIds.map(P),
    siteLead: site ? person(site) : P(d.pin.created_by),
    currentRevision: d.project.revision,
    currentProposal: cur ? { id: cur.id, version: cur.version, revision: cur.revision } : null,
    signoffs: d.signoffs.map(s => ({ proposalId: s.proposal_id, reviewerId: s.reviewer_id, revision: s.revision, verdict: s.verdict, at: iso(s.updated_at)! })),
    activeHold: hold ? { placedBy: P(hold.placed_by), reason: hold.reason, clearCondition: hold.clear_condition, evidenceSubmitted: d.evidence.some(e => e.hold_id === hold.id) } : null,
  };
}

export function pinMemberIds(d: { pin: PinRow; reviewerIds: string[]; people: PinData['people'] }): string[] {
  const site = [...d.people.values()].filter(u => u.role === 'site').map(u => u.id);
  return [...new Set([...site, d.pin.created_by, ...d.reviewerIds])];
}

function summary(d: PinData, state: PinState): PinSummary {
  const cur = d.proposals.find(p => p.id === d.pin.current_proposal_id);
  const approvedBy = cur ? d.signoffs.filter(s => s.proposal_id === cur.id && s.verdict === 'approve' && s.revision === d.project.revision).map(s => s.reviewer_id) : [];
  return {
    id: d.pin.id, number: rfiNumber(d.pin.number), x: d.pin.x, y: d.pin.y, gridRef: d.pin.grid_ref, title: d.pin.title,
    discipline: d.pin.discipline as PinSummary['discipline'], severity: d.pin.severity as PinSummary['severity'],
    subchannelId: d.pin.subchannel_id, seq: d.pin.state_seq, state,
    reviewers: d.reviewerIds.map(id => person(d.people.get(id)!)), memberIds: pinMemberIds(d), approvedBy,
    waitingSince: iso(d.pin.waiting_since), createdAt: iso(d.pin.created_at)!, roomReady: d.pin.room_ready,
  };
}

function record(d: PinData): PinRecord {
  const P = (id: string) => person(d.people.get(id)!);
  const state = derivePinState(facts(d));
  const proposals: Proposal[] = d.proposals.map(p => ({
    id: p.id, version: p.version, revision: p.revision, summary: p.summary, route: p.route ?? null,
    costImpact: p.cost_impact, scheduleImpact: p.schedule_impact, author: P(p.author_id), createdAt: iso(p.created_at)!,
    current: p.id === d.pin.current_proposal_id, messageId: p.message_id,
  }));
  const signoffs: Signoff[] = d.signoffs.map(s => ({
    id: s.id, proposalId: s.proposal_id, version: s.version, revision: s.revision, verdict: s.verdict,
    comment: s.comment, reviewer: P(s.reviewer_id), at: iso(s.updated_at)!,
  }));
  const evidence: Evidence[] = d.evidence.map(e => ({ id: e.id, imageUrl: e.image_url, caption: e.caption, author: P(e.author_id), at: iso(e.created_at)!, holdId: e.hold_id }));
  const holds: Hold[] = d.holds.map(h => ({
    id: h.id, status: h.status, reason: h.reason, clearCondition: h.clear_condition, placedBy: P(h.placed_by),
    createdAt: iso(h.created_at)!, clearedBy: h.cleared_by ? P(h.cleared_by) : null, clearedAt: iso(h.cleared_at),
    evidence: evidence.filter(e => e.holdId === h.id),
  }));
  const cur = proposals.find(p => p.current);
  const hashInput = {
    pin: d.pin.id, status: state.status, revision: d.project.revision,
    proposal: cur ? { id: cur.id, version: cur.version, revision: cur.revision, summary: cur.summary, route: cur.route } : null,
    signoffs: signoffs.filter(s => s.proposalId === cur?.id).map(s => [s.reviewer.userId, s.verdict, s.revision, s.at]).sort(),
    holds: holds.map(h => [h.id, h.status]),
  };
  return {
    ...summary(d, state), question: d.pin.question, raisedBy: P(d.pin.created_by),
    proposals, signoffs, holds, evidence, recordHash: sha256hex(canonical(hashInput)).slice(0, 8),
  };
}

export async function buildPinRecord(db: Q, pinId: string): Promise<PinRecord> {
  return record(await loadPinData(db, pinId));
}

export async function lockPin(db: Q, pinId: string) {
  return loadPinData(db, pinId, true);
}

export { facts as pinFacts, record as pinRecordFrom, summary as pinSummaryFrom };
export type { PinData };

export async function projectPins(db: Q, projectId: string): Promise<PinSummary[]> {
  const ids = (await db<{ id: string }[]>`select id from pins where project_id = ${projectId} order by number`).map(r => r.id);
  const out: PinSummary[] = [];
  for (const id of ids) {
    const d = await loadPinData(db, id);
    out.push(summary(d, derivePinState(facts(d))));
  }
  return out;
}
