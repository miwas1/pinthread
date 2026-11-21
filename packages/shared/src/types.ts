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

export type SheetSource = 'vector' | 'image';

/** A drawing sheet. 'vector' is the built-in demo sheet; 'image' is an uploaded drawing (PNG/JPEG, or a PDF page rendered in the browser). */
export interface Sheet {
  id: string; number: string; title: string; revision: string; source: SheetSource;
  /** Authenticated image URL for uploaded sheets (changes with every new revision). */
  imageUrl: string | null;
  /** Pixel size of the uploaded image (aspect ratio of the sheet). */
  width: number; height: number;
  revisions: { revision: string; at: string; by: string | null }[];
}

export interface PinSummary {
  id: string; sheetId: string; number: string; x: number; y: number; gridRef: string;
  /** Nexconn community hosting this pin's private room (large projects span several communities). */
  communityId: string;
  title: string; discipline: Discipline; severity: Severity;
  subchannelId: string; seq: number; state: PinState;
  reviewers: Person[]; memberIds: string[]; approvedBy: string[]; waitingSince: string | null; createdAt: string; roomReady: boolean;
}

export interface PinRecord extends PinSummary {
  question: string; raisedBy: Person;
  proposals: Proposal[]; signoffs: Signoff[]; holds: Hold[]; evidence: Evidence[];
  recordHash: string;
}

export type ProjectKind = 'demo' | 'team';

export interface ProjectState {
  project: { id: string; name: string; kind: ProjectKind; communityId: string; sheets: Sheet[] };
  me: Person & { canHold: boolean; isAdmin: boolean };
  members: (Person & { connected: boolean })[];
  pins: PinSummary[];
  demo: { tracker: { proposed: boolean; structConnected: boolean; approved: boolean; exported: boolean } } | null;
}

export interface SessionResponse {
  session: string; me: Person; projectId: string; nexconnToken: string; kind: ProjectKind;
  /** Demo only: signed links that let a second device act as another role. */
  joinLinks: Partial<Record<Role, string>>; heroPinId: string | null;
}

/** A signed-in PinThread account (team projects). Demo sessions have no account. */
export interface Account { id: string; email: string; name: string; firm: string; initials: string }

export interface ProjectListItem {
  id: string; name: string; role: Role; isAdmin: boolean;
  sheets: { id: string; number: string; title: string; revision: string; imageUrl: string | null }[];
  members: number; issues: number; open: number; waitingOnMe: number; complete: number;
  createdAt: string; updatedAt: string;
}

export interface TeamMember extends Person { email: string | null; isAdmin: boolean; connected: boolean; joinedAt: string; isMe: boolean }
export interface InviteLink { id: string; role: Role; url: string; createdAt: string; expiresAt: string; uses: number; createdBy: string }
export interface TeamInfo { members: TeamMember[]; invites: InviteLink[]; canManage: boolean }

export interface InviteInfo { projectId: string; project: string; role: Role; invitedBy: string; expiresAt: string; alreadyMember: boolean }

export interface ClientConfig { chatMode: 'nexconn' | 'local'; appKey: string | null; areaCode: 'SG' | 'NA' | 'SAU' }
