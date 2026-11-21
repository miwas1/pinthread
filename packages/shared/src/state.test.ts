import { describe, expect, it } from 'vitest';
import { derivePinState, personalLabel, type PinFacts } from './state';
import type { Person } from './types';
import { gridRef } from './geometry';
import { compactRoute, contentSize, MAX_CUSTOM_CONTENT_BYTES } from './messages';
import { isValidSubchannelId, pinSubchannelFor, demoUserIdFor, isValidUserId } from './ids';

const p = (userId: string, role: Person['role'], name = userId): Person => ({ userId, role, name, firm: 'F', initials: 'XX' });
const site = p('site', 'site', 'Priya Shah');
const mep = p('mep', 'mep', 'Marco Ruiz');
const struct = p('struct', 'struct', 'Dana Okafor');
const base = (): PinFacts => ({
  requiredReviewers: [mep, struct], siteLead: site, currentRevision: 'B',
  currentProposal: null, signoffs: [], activeHold: null,
});
const so = (proposalId: string, reviewerId: string, verdict: 'approve' | 'request_change' | 'withdrawn' = 'approve', revision = 'B') =>
  ({ proposalId, reviewerId, revision, verdict, at: '2026-11-21T10:00:00Z' });

describe('derivePinState', () => {
  it('is Open with no proposal', () => {
    const s = derivePinState(base());
    expect(s.status).toBe('open');
    expect(s.label).toBe('Open');
  });

  it('is In review waiting for everyone after a proposal', () => {
    const s = derivePinState({ ...base(), currentProposal: { id: 'p1', version: 1, revision: 'B' } });
    expect(s.status).toBe('review');
    expect(s.label).toBe('In review · Waiting for MEP and Structural');
    expect(s.waitingFor.map(w => w.userId)).toEqual(['mep', 'struct']);
  });

  it('waits only for reviewers who have not approved', () => {
    const s = derivePinState({ ...base(), currentProposal: { id: 'p1', version: 1, revision: 'B' }, signoffs: [so('p1', 'mep')] });
    expect(s.label).toBe('In review · Waiting for Structural');
    expect(s.outstanding).toBe('Approval of v1 by Dana Okafor');
  });

  it('completes when every required reviewer approved the current version', () => {
    const s = derivePinState({ ...base(), currentProposal: { id: 'p1', version: 1, revision: 'B' }, signoffs: [so('p1', 'mep'), so('p1', 'struct')] });
    expect(s.status).toBe('complete');
    expect(s.label).toBe('Review complete');
  });

  it('does not count approvals on a superseded version', () => {
    const s = derivePinState({ ...base(), currentProposal: { id: 'p2', version: 2, revision: 'B' }, signoffs: [so('p1', 'mep'), so('p1', 'struct'), so('p2', 'mep')] });
    expect(s.status).toBe('review');
    expect(s.waitingFor.map(w => w.userId)).toEqual(['struct']);
  });

  it('does not count approvals given on another revision', () => {
    const s = derivePinState({ ...base(), currentProposal: { id: 'p1', version: 1, revision: 'B' }, signoffs: [so('p1', 'mep', 'approve', 'A'), so('p1', 'struct')] });
    expect(s.status).toBe('review');
  });

  it('ignores approvals from non-required people', () => {
    const s = derivePinState({ ...base(), currentProposal: { id: 'p1', version: 1, revision: 'B' }, signoffs: [so('p1', 'mep'), so('p1', 'site')] });
    expect(s.status).toBe('review');
  });

  it('ignores withdrawn approvals', () => {
    const s = derivePinState({ ...base(), currentProposal: { id: 'p1', version: 1, revision: 'B' }, signoffs: [so('p1', 'mep'), so('p1', 'struct', 'withdrawn')] });
    expect(s.status).toBe('review');
  });

  it('labels change requests', () => {
    const s = derivePinState({ ...base(), currentProposal: { id: 'p1', version: 1, revision: 'B' }, signoffs: [so('p1', 'mep'), so('p1', 'struct', 'request_change')] });
    expect(s.label).toBe('In review · Change requested by Structural');
    expect(s.changeRequestedBy.map(c => c.userId)).toEqual(['struct']);
  });

  it('is Blocked by an active hold even when all approvals stand', () => {
    const s = derivePinState({
      ...base(), currentProposal: { id: 'p1', version: 1, revision: 'B' }, signoffs: [so('p1', 'mep'), so('p1', 'struct')],
      activeHold: { placedBy: struct, reason: 'r', clearCondition: 'core tests', evidenceSubmitted: false },
    });
    expect(s.status).toBe('blocked');
    expect(s.label).toBe('Blocked · Hold by Structural');
    expect(s.waitingFor).toEqual([site]);
  });

  it('waits for the hold author once evidence is submitted', () => {
    const s = derivePinState({ ...base(), activeHold: { placedBy: struct, reason: 'r', clearCondition: 'c', evidenceSubmitted: true } });
    expect(s.waitingFor).toEqual([struct]);
  });

  it('personalises the waiting label', () => {
    const s = derivePinState({ ...base(), currentProposal: { id: 'p1', version: 1, revision: 'B' }, signoffs: [so('p1', 'mep')] });
    expect(personalLabel(s, 'struct')).toBe('In review · Waiting for you');
    expect(personalLabel(s, 'mep')).toBe('In review · Waiting for Structural');
  });
});

describe('geometry and ids', () => {
  it('computes grid references', () => {
    expect(gridRef([480 / 1400, 381 / 990])).toBe('C–D/4');
    expect(gridRef([844 / 1400, 540 / 990])).toBe('E/7');
  });
  it('builds valid Nexconn ids', () => {
    expect(isValidSubchannelId(pinSubchannelFor('abcdefghij'))).toBe(true);
    expect(isValidSubchannelId('disc_mep')).toBe(false);
    expect(isValidSubchannelId('p' + 'a'.repeat(20))).toBe(false);
    expect(isValidUserId(demoUserIdFor('abcdefghij', 'struct'))).toBe(true);
  });
  it('keeps routes compact and under the 10 KB limit', () => {
    const route = Array.from({ length: 200 }, (_, i) => [i / 199, 0.123456789] as [number, number]);
    const c = compactRoute(route)!;
    expect(c).toHaveLength(64);
    expect(c[1][1]).toBe(0.1235);
    expect(contentSize({ route: c, summary: 'x'.repeat(280) })).toBeLessThan(MAX_CUSTOM_CONTENT_BYTES);
  });
});
