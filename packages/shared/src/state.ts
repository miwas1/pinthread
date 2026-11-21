import { roleList } from './roles';
import type { Person, PinState, Verdict } from './types';

export interface PinFacts {
  requiredReviewers: Person[];
  siteLead: Person;
  currentRevision: string;
  currentProposal: { id: string; version: number; revision: string } | null;
  /** All sign-offs on the pin (any proposal). */
  signoffs: { proposalId: string; reviewerId: string; revision: string; verdict: Verdict | 'withdrawn'; at: string }[];
  activeHold: { placedBy: Person; reason: string; clearCondition: string; evidenceSubmitted: boolean } | null;
}

const names = (ps: Person[]) => {
  const n = ps.map(p => p.name);
  return n.length <= 1 ? n.join('') : `${n.slice(0, -1).join(', ')} and ${n.at(-1)}`;
};

/**
 * Single source of pin status, shared by server (authoritative) and client (optimistic display).
 * Rules (PRODUCT_SPEC "What changes a pin"):
 *  - An active hold takes precedence: Blocked.
 *  - No proposal yet: Open.
 *  - Every required reviewer approved the *current* proposal on the *current* revision: Review complete.
 *  - Otherwise: In review, waiting for whoever has not approved.
 */
export function derivePinState(f: PinFacts): PinState {
  if (f.activeHold) {
    const h = f.activeHold;
    return {
      status: 'blocked',
      label: `Blocked · Hold by ${roleList([h.placedBy.role])}`,
      waitingFor: h.evidenceSubmitted ? [h.placedBy] : [f.siteLead],
      outstanding: h.evidenceSubmitted
        ? `${h.placedBy.name} (${roleList([h.placedBy.role])}) to assess the evidence and clear the hold`
        : `Site lead to post corrective evidence: ${h.clearCondition}`,
      changeRequestedBy: [],
    };
  }
  if (!f.currentProposal) {
    return { status: 'open', label: 'Open', waitingFor: f.requiredReviewers, outstanding: 'A proposal is needed', changeRequestedBy: [] };
  }
  const cur = f.currentProposal;
  const onCurrent = f.signoffs.filter(s => s.proposalId === cur.id && s.revision === f.currentRevision);
  const approved = new Set(onCurrent.filter(s => s.verdict === 'approve').map(s => s.reviewerId));
  const changeIds = new Set(onCurrent.filter(s => s.verdict === 'request_change').map(s => s.reviewerId));
  const missing = f.requiredReviewers.filter(r => !approved.has(r.userId));
  if (missing.length === 0) {
    return { status: 'complete', label: 'Review complete', waitingFor: [], outstanding: null, changeRequestedBy: [] };
  }
  const changeRequestedBy = f.requiredReviewers.filter(r => changeIds.has(r.userId));
  return {
    status: 'review',
    label: changeRequestedBy.length
      ? `In review · Change requested by ${roleList(changeRequestedBy.map(p => p.role))}`
      : `In review · Waiting for ${roleList(missing.map(p => p.role))}`,
    waitingFor: missing,
    outstanding: `Approval of v${cur.version} by ${names(missing)}`,
    changeRequestedBy,
  };
}

/** Personalised label: "Waiting for you" when the viewer is the only one outstanding. */
export function personalLabel(state: PinState, viewerId: string): string {
  if (state.status === 'review' && !state.changeRequestedBy.length && state.waitingFor.some(p => p.userId === viewerId)) {
    const others = state.waitingFor.filter(p => p.userId !== viewerId);
    return others.length ? `In review · Waiting for you and ${roleList(others.map(p => p.role))}` : 'In review · Waiting for you';
  }
  return state.label;
}
