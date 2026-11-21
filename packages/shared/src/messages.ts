// PinThread custom Nexconn message types. Rules: ≤ 32 chars, must not start with RC:/NC:, custom content ≤ 10 KB.
import type { PinStatus, Point, Verdict } from './types';
import type { Role } from './roles';

export const MT = {
  brief: 'pt:brief',
  evidence: 'pt:evidence',
  proposal: 'pt:proposal',
  signoff: 'pt:signoff',
  hold: 'pt:hold',
  decision: 'pt:decision',
  jump: 'pt:jump',
  pinstate: 'pt:pinstate',
} as const;
export type PtMessageType = (typeof MT)[keyof typeof MT];

/** Registration list for NCEngine.registerCustomMessages (call before connect). */
export const PT_MESSAGE_REGISTRATIONS = [
  { messageType: MT.brief, isPersisted: true, isCounted: false },
  { messageType: MT.evidence, isPersisted: true, isCounted: true },
  { messageType: MT.proposal, isPersisted: true, isCounted: true },
  { messageType: MT.signoff, isPersisted: true, isCounted: true },
  { messageType: MT.hold, isPersisted: true, isCounted: true },
  { messageType: MT.decision, isPersisted: true, isCounted: false },
  { messageType: MT.jump, isPersisted: true, isCounted: true },
  { messageType: MT.pinstate, isPersisted: false, isCounted: false, isStatusMessage: true },
];

/** Messages whose sender must be the PinThread bot to be trusted. */
export const BOT_ONLY_TYPES: string[] = [MT.brief, MT.decision, MT.jump, MT.pinstate];

interface Base { v: 1; projectId: string; pinId: string; seq: number }
interface Who { userId: string; name: string; role: Role }

export interface BriefContent extends Base { number: string; title: string; question: string; gridRef: string; sheet: string; revision: string; raisedBy: Who; reviewers: Who[] }
export interface EvidenceContent extends Base { evidenceId: string; imageUrl: string; caption: string; holdId: string | null; author: Who }
export interface ProposalContent extends Base { proposalId: string; version: number; revision: string; summary: string; route: Point[] | null; costImpact: string | null; scheduleImpact: string | null; author: Who; supersedesVersion: number | null }
export interface SignoffContent extends Base { signoffId: string; proposalId: string; version: number; revision: string; verdict: Verdict; comment: string | null; reviewer: Who }
export interface HoldContent extends Base { holdId: string; action: 'placed' | 'evidence_added' | 'cleared'; reason: string; clearCondition: string; actor: Who; note: string | null }
export interface DecisionContent extends Base { decisionId: string; status: PinStatus; label: string; version: number | null; revision: string; approvals: { name: string; role: Role; at: string }[]; recordHash: string }
export interface JumpContent extends Base { number: string; title: string; ask: string; forUserIds: string[]; forRole: Role; from: Who; mentionedInfo?: { type: 2; userIdList: string[]; mentionedContent?: string } }
export interface PinStateContent extends Base { status: PinStatus; label: string }

export const MAX_CUSTOM_CONTENT_BYTES = 10 * 1024;
export const MAX_ROUTE_POINTS = 64;

export function contentSize(content: unknown): number {
  return new TextEncoder().encode(JSON.stringify(content)).length;
}

export function assertContentSize(content: unknown): void {
  const n = contentSize(content);
  if (n > MAX_CUSTOM_CONTENT_BYTES) throw new Error(`Message content is ${n} bytes, over the 10 KB Nexconn limit`);
}

/** Round to 4 decimals and cap point count so a route always fits a card. */
export function compactRoute(route: Point[] | null | undefined): Point[] | null {
  if (!route || route.length < 2) return null;
  return route.slice(0, MAX_ROUTE_POINTS).map(([x, y]) => [Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4] as Point);
}
