import type { Role } from './roles';

export type PinStatus = 'open' | 'review' | 'blocked' | 'complete';
export type Discipline = 'mep' | 'struct' | 'arch' | 'elec';
export type Severity = 'low' | 'medium' | 'high';
export type Verdict = 'approve' | 'request_change';
export type Point = [number, number]; // normalized 0..1 sheet coordinates

export interface Person { userId: string; name: string; role: Role; firm: string; initials: string }

export interface PinState {
  status: PinStatus;
  /** Status text without personalisation, e.g. "In review · Waiting for Structural" */
  label: string;
  waitingFor: Person[];
  outstanding: string | null;
  changeRequestedBy: Person[];
}

export interface Proposal {
  id: string; version: number; revision: string;
  summary: string; route: Point[] | null;
  costImpact: string | null; scheduleImpact: string | null;
  author: Person; createdAt: string;
  current: boolean; messageId: string | null;
}

export interface Signoff {
  id: string; proposalId: string; version: number; revision: string;
  verdict: Verdict | 'withdrawn'; comment: string | null; reviewer: Person; at: string;
}

export interface Evidence { id: string; imageUrl: string; caption: string; author: Person; at: string; holdId: string | null }

export interface Hold {
  id: string; status: 'active' | 'cleared'; reason: string; clearCondition: string;
  placedBy: Person; createdAt: string; clearedBy: Person | null; clearedAt: string | null;
  evidence: Evidence[];
}

export interface PinSummary {
  id: string; number: string; x: number; y: number; gridRef: string;
  title: string; discipline: Discipline; severity: Severity;
  subchannelId: string; seq: number; state: PinState;
  reviewers: Person[]; memberIds: string[]; approvedBy: string[]; waitingSince: string | null; createdAt: string; roomReady: boolean;
}

export interface PinRecord extends PinSummary {
  question: string; raisedBy: Person;
  proposals: Proposal[]; signoffs: Signoff[]; holds: Hold[]; evidence: Evidence[];
  recordHash: string;
}

export interface ProjectState {
  project: { id: string; name: string; kind: 'demo' | 'pilot'; communityId: string; sheet: { number: string; title: string; revision: string } };
  me: Person & { canHold: boolean };
  members: (Person & { connected: boolean })[];
  pins: PinSummary[];
  demo: { tracker: { proposed: boolean; structConnected: boolean; approved: boolean; exported: boolean } } | null;
}

export interface SessionResponse {
  session: string; me: Person; projectId: string; nexconnToken: string;
  joinLinks: Partial<Record<Role, string>>; heroPinId: string | null;
}

export interface ClientConfig { chatMode: 'nexconn' | 'local'; appKey: string | null; areaCode: 'SG' | 'NA' | 'SAU' }
