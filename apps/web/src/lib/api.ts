import type { Account, ClientConfig, InviteInfo, InviteLink, PinRecord, ProjectListItem, ProjectState, Role, SessionResponse, Sheet, TeamInfo, Point } from '@pinthread/shared';

// Identity is per browser tab (sessionStorage) so two tabs can be two different reviewers, and a refresh keeps the role.
const KEY = 'pt.session';
export function getSession(): SessionResponse | null {
  try { const v = sessionStorage.getItem(KEY); return v ? JSON.parse(v) : null; } catch { return null; }
}
export function setSession(s: SessionResponse | null) {
  try { if (s) sessionStorage.setItem(KEY, JSON.stringify(s)); else sessionStorage.removeItem(KEY); } catch { /* private mode */ }
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public extra: Record<string, unknown> = {}) { super(message); }
}

/** Team project sessions are short-lived; renew from the account cookie once and retry. */
let renewing: Promise<boolean> | null = null;
function renewSession(): Promise<boolean> {
  const s = getSession();
  if (!s || s.kind !== 'team') return Promise.resolve(false);
  renewing ??= fetch(`/api/projects/${s.projectId}/session`, { method: 'POST', headers: { 'X-PinThread': '1', 'Content-Type': 'application/json' }, body: '{}' })
    .then(async r => { if (!r.ok) return false; setSession(await r.json()); return true; })
    .catch(() => false)
    .finally(() => { renewing = null; });
  return renewing;
}

async function req<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}, retried = false): Promise<T> {
  const s = getSession();
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      // X-PinThread marks requests as coming from this app (CSRF guard for cookie-authenticated account routes).
      headers: { 'X-PinThread': '1', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(s ? { Authorization: `Bearer ${s.session}` } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'network', "Couldn't reach PinThread. Check your connection and try again.");
  }
  if (res.ok) return (res.headers.get('content-type')?.includes('json') ? res.json() : res.blob()) as Promise<T>;
  if (res.status === 401 && s && !retried && (await renewSession())) return req<T>(method, path, body, headers, true);
  const j = await res.json().catch(() => ({}));
  throw new ApiError(res.status, j.error ?? 'error', j.message ?? 'Something went wrong. Try again.', j);
}

export interface SheetDraft { number: string; title: string; revision: string; fileId: string; thumbFileId: string | null }

/** Upload a drawing file with progress (fetch has no upload progress). */
export function uploadFile(blob: Blob, onProgress?: (fraction: number) => void): Promise<{ id: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', '/api/files');
    x.setRequestHeader('Content-Type', blob.type || 'application/octet-stream');
    x.setRequestHeader('X-PinThread', '1');
    x.upload.onprogress = e => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    x.onload = () => {
      let j: Record<string, unknown> = {};
      try { j = JSON.parse(x.responseText); } catch { /* not JSON */ }
      if (x.status >= 200 && x.status < 300) resolve(j as never);
      else reject(new ApiError(x.status, String(j.error ?? 'error'), String(j.message ?? 'Upload failed. Try again.'), j));
    };
    x.onerror = () => reject(new ApiError(0, 'network', "Couldn't reach PinThread. Check your connection and try again."));
    x.send(blob);
  });
}

export const api = {
  config: () => req<ClientConfig>('GET', '/config'),
  // Accounts (httpOnly cookie)
  account: () => req<{ account: Account | null }>('GET', '/auth/me').then(r => r.account),
  signup: (b: { name: string; email: string; password: string; firm: string }) => req<{ account: Account }>('POST', '/auth/signup', b),
  login: (b: { email: string; password: string }) => req<{ account: Account }>('POST', '/auth/login', b),
  logout: () => req<{ ok: true }>('POST', '/auth/logout', {}),
  updateAccount: (b: { name: string; firm: string }) => req<{ account: Account }>('PATCH', '/auth/me', b),
  changePassword: (b: { current: string; next: string }) => req<{ ok: true }>('POST', '/auth/password', b),
  projects: () => req<{ projects: ProjectListItem[] }>('GET', '/projects').then(r => r.projects),
  createProject: (b: { name: string; role: Role; sheet: SheetDraft }) => req<{ projectId: string }>('POST', '/projects', b),
  openProject: (projectId: string) => req<SessionResponse>('POST', `/projects/${projectId}/session`, {}),
  inviteInfo: (token: string) => req<InviteInfo>('GET', `/invites/${encodeURIComponent(token)}`),
  acceptInvite: (token: string) => req<{ projectId: string }>('POST', `/invites/${encodeURIComponent(token)}/accept`, {}),
  // Team project management (project session)
  team: (projectId: string) => req<TeamInfo>('GET', `/projects/${projectId}/team`),
  createInvite: (projectId: string, role: Role) => req<InviteLink>('POST', `/projects/${projectId}/invites`, { role }),
  revokeInvite: (projectId: string, inviteId: string) => req<{ ok: true }>('POST', `/projects/${projectId}/invites/${inviteId}/revoke`, {}),
  removeMember: (projectId: string, userId: string) => req<{ reassigned: number }>('POST', `/projects/${projectId}/members/${userId}/remove`, {}),
  setAdmin: (projectId: string, userId: string, admin: boolean) => req<{ ok: true }>('POST', `/projects/${projectId}/members/${userId}/admin`, { admin }),
  renameProject: (projectId: string, name: string) => req<{ ok: true }>('PATCH', `/projects/${projectId}`, { name }),
  deleteProject: (projectId: string, confirm: string) => req<{ ok: true }>('POST', `/projects/${projectId}/delete`, { confirm }),
  addSheet: (projectId: string, b: SheetDraft) => req<{ sheetId: string; sheets: Sheet[] }>('POST', `/projects/${projectId}/sheets`, b),
  newRevision: (sheetId: string, b: { revision: string; fileId: string; thumbFileId: string | null }) => req<{ affected: number; sheets: Sheet[] }>('POST', `/sheets/${sheetId}/revisions`, b),
  // Demo
  startDemo: (role: string) => req<SessionResponse>('POST', '/demo/sessions', { role }),
  invite: (q: URLSearchParams) => req<{ project: string; person: { name: string; firm: string; role: string; initials: string }; title: string }>('GET', `/demo/invite?${q}`),
  join: (b: { projectId: string; role: string; exp: string; sig: string }) => req<SessionResponse>('POST', '/demo/join', b),
  switchRole: (role: string) => req<SessionResponse>('POST', '/demo/switch-role', { role }),
  me: () => req<SessionResponse>('GET', '/me'),
  connected: () => req<{ ok: true }>('POST', '/me/connected'),
  state: (projectId: string) => req<ProjectState>('GET', `/projects/${projectId}/state`),
  pin: (pinId: string) => req<PinRecord>('GET', `/pins/${pinId}`),
  createPin: (projectId: string, b: { sheetId: string; gridRef: string | null; x: number; y: number; title: string; question: string; discipline: string; severity: string; reviewerIds: string[] }) =>
    req<PinRecord>('POST', `/projects/${projectId}/pins`, b),
  propose: (pinId: string, b: { summary: string; route: Point[] | null; costImpact: string | null; scheduleImpact: string | null; approveOwn: boolean; basedOnVersion: number }) =>
    req<PinRecord>('POST', `/pins/${pinId}/proposals`, b),
  signoff: (pinId: string, key: string, b: { proposalId: string; revision: string; verdict: 'approve' | 'request_change'; comment: string | null }) =>
    req<{ record: PinRecord; duplicate: boolean }>('POST', `/pins/${pinId}/signoffs`, b, { 'Idempotency-Key': key }),
  hold: (pinId: string, b: { reason: string; clearCondition: string }) => req<PinRecord>('POST', `/pins/${pinId}/holds`, b),
  evidence: (pinId: string, b: { holdId: string | null; imageUrl: string; caption: string; messageId: string | null }) => req<PinRecord>('POST', `/pins/${pinId}/evidence`, b),
  clearHold: (pinId: string, holdId: string, note: string | null) => req<PinRecord>('POST', `/pins/${pinId}/holds/${holdId}/clear`, { note }),
  nudge: (pinId: string) => req<{ ok: true }>('POST', `/pins/${pinId}/nudge`),
  register: (projectId: string) => req<Blob>('GET', `/projects/${projectId}/register.pdf`),
};
