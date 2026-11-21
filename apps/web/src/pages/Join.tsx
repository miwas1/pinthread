import { useEffect, useState } from 'react';
import { useLocation, useSearch } from 'wouter';
import { ROLE_INFO, type Role } from '@pinthread/shared';
import { Avatar, Spinner } from '../components/ui';
import { ApiError, api, setSession } from '../lib/api';
import { Logo } from '../lib/icons';

export function Join({ projectId, role }: { projectId: string; role: string }) {
  const search = useSearch();
  const [, navigate] = useLocation();
  const q = new URLSearchParams(search);
  const [info, setInfo] = useState<{ project: string; person: { name: string; firm: string; role: string; initials: string }; title: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.invite(new URLSearchParams({ projectId, role, exp: q.get('exp') ?? '', sig: q.get('sig') ?? '' }))
      .then(setInfo).catch(e => setErr(e instanceof ApiError ? e.message : 'This invite could not be opened.'));
  }, [projectId, role, search]); // eslint-disable-line react-hooks/exhaustive-deps

  const join = async () => {
    setBusy(true);
    try {
      const s = await api.join({ projectId, role, exp: q.get('exp') ?? '', sig: q.get('sig') ?? '' });
      setSession(s);
      const pin = q.get('pin');
      navigate(`/p/${s.projectId}${pin ? `?pin=${pin}` : ''}`, { replace: true });
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not join.'); setBusy(false); }
  };

  const r = role as Role;
  return (
    <div className="center-page">
      <div className="card pad join">
        <span className="logo"><Logo size={26} />PinThread</span>
        {err ? (
          <><h1 className="h-title" style={{ marginTop: 18 }}>This invite can't be used</h1><p className="muted">{err}</p><a className="btn btn-ink lg" href="/">Start your own demo</a></>
        ) : !info ? (
          <p className="muted" style={{ marginTop: 18 }}><Spinner /> Checking the invite…</p>
        ) : (
          <>
            <p className="muted" style={{ marginTop: 18, marginBottom: 6 }}>You're joining <b style={{ color: 'var(--text)' }}>{info.project}</b> as</p>
            <div className="row" style={{ gap: 12 }}><Avatar p={{ initials: info.person.initials, role: r, name: info.person.name }} size="lg" /><div><b style={{ fontSize: 17 }}>{info.person.name}</b><div className="faint">{ROLE_INFO[r]?.title} · {info.person.firm}</div></div></div>
            <p className="small muted" style={{ margin: '14px 0 18px' }}>{r === 'struct' ? "Marco has proposed a new duct route across Beam B-14. You'll land on the same spot on C-103 Rev B to review it." : 'You will see the same drawing and issues, live.'}</p>
            <button className="btn btn-ink xl block" onClick={join} disabled={busy}>{busy ? <><Spinner />Joining…</> : `Join as ${info.person.name.split(' ')[0]}`}</button>
          </>
        )}
      </div>
    </div>
  );
}
