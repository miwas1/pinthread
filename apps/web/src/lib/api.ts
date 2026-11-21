import type { ClientConfig, PinRecord, ProjectState, SessionResponse, Point } from '@pinthread/shared';

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

async function req<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const s = getSession();
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(s ? { Authorization: `Bearer ${s.session}` } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'network', "Couldn't reach PinThread. Check your connection and try again.");
  }
  if (res.ok) return (res.headers.get('content-type')?.includes('json') ? res.json() : res.blob()) as Promise<T>;
  const j = await res.json().catch(() => ({}));
  throw new ApiError(res.status, j.error ?? 'error', j.message ?? 'Something went wrong. Try again.', j);
}

export const api = {
  config: () => req<ClientConfig>('GET', '/config'),
  startDemo: (role: string) => req<SessionResponse>('POST', '/demo/sessions', { role }),
  invite: (q: URLSearchParams) => req<{ project: string; person: { name: string; firm: string; role: string; initials: string }; title: string }>('GET', `/demo/invite?${q}`),
  join: (b: { projectId: string; role: string; exp: string; sig: string }) => req<SessionResponse>('POST', '/demo/join', b),
  switchRole: (role: string) => req<SessionResponse>('POST', '/demo/switch-role', { role }),
  me: () => req<SessionResponse>('GET', '/me'),
  connected: () => req<{ ok: true }>('POST', '/me/connected'),
  state: (projectId: string) => req<ProjectState>('GET', `/projects/${projectId}/state`),
  pin: (pinId: string) => req<PinRecord>('GET', `/pins/${pinId}`),
  createPin: (projectId: string, b: { x: number; y: number; title: string; question: string; discipline: string; severity: string; reviewerIds: string[] }) =>
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
