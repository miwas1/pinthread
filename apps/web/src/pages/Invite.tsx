import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation } from 'wouter';
import { ROLE_INFO } from '@pinthread/shared';
import { Spinner } from '../components/ui';
import { useAccount, useLogout } from '../lib/account';
import { ApiError, api } from '../lib/api';
import { Icon, Logo } from '../lib/icons';

export function InvitePage({ token }: { token: string }) {
  const [, navigate] = useLocation();
  const { data: account, isLoading: loadingAccount } = useAccount();
  const logout = useLogout();
  const info = useQuery({ queryKey: ['invite', token, account?.id ?? null], queryFn: () => api.inviteInfo(token), retry: false, enabled: !loadingAccount });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const here = `/invite/${token}`;
  useEffect(() => { document.title = 'Join a project · PinThread'; }, []);

  const join = async () => {
    setBusy(true); setErr(null);
    try { const r = await api.acceptInvite(token); navigate(`/p/${r.projectId}`, { replace: true }); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not join the project.'); setBusy(false); }
  };

  const i = info.data;
  return (
    <div className="center-page">
      <div className="card pad join" style={{ maxWidth: 460 }}>
        <Link href="/" className="logo" style={{ textDecoration: 'none' }}><Logo size={26} />PinThread</Link>
        {info.error ? (
          <><h1 className="h-title" style={{ marginTop: 18 }}>This invite can't be used</h1><p className="muted">{info.error instanceof ApiError ? info.error.message : 'The invite could not be opened.'}</p>
            <Link href={account ? '/app' : '/'} className="btn btn-ink lg">{account ? 'Go to your projects' : 'Go to PinThread'}</Link></>
        ) : !i ? (
          <p className="muted" style={{ marginTop: 18 }}><Spinner /> Checking the invite…</p>
        ) : (
          <>
            <p className="muted" style={{ marginTop: 18, marginBottom: 4 }}>{i.invitedBy} invited you to</p>
            <h1 className="h-title" style={{ fontSize: 22 }}>{i.project}</h1>
            <div className="invite-role"><span className={`av ${i.role}`}>{ROLE_INFO[i.role].label.slice(0, 2).toUpperCase()}</span><div><b>{ROLE_INFO[i.role].title}</b><div className="faint small">{i.role === 'site' ? "You'll be in every issue room on this project." : i.role === 'mep' ? 'You can propose routes and sign off issues assigned to MEP.' : `You can sign off issues assigned to ${ROLE_INFO[i.role].label} and place holds.`}</div></div></div>
            {err && <div className="form-error" role="alert" style={{ marginTop: 12 }}><Icon name="info" size="sm" />{err}</div>}
            {i.alreadyMember ? (
              <Link href={`/p/${i.projectId}`} className="btn btn-ink xl block" style={{ marginTop: 18 }}>You're already on this project. Open it</Link>
            ) : account ? (
              <>
                <button className="btn btn-ink xl block" style={{ marginTop: 18 }} onClick={join} disabled={busy}>{busy ? <><Spinner />Joining…</> : `Join as ${account.name}`}</button>
                <p className="small faint" style={{ marginTop: 10 }}>Signed in as {account.email}. Not you? <button className="linkbtn" onClick={() => void logout()}>Log out</button></p>
              </>
            ) : (
              <>
                <Link href={`/signup?next=${encodeURIComponent(here)}`} className="btn btn-ink xl block" style={{ marginTop: 18 }}>Create an account to join</Link>
                <Link href={`/login?next=${encodeURIComponent(here)}`} className="btn btn-outline lg block" style={{ marginTop: 8 }}>I already have an account</Link>
              </>
            )}
            <p className="small faint" style={{ marginTop: 14 }}>This link expires {new Date(i.expiresAt).toLocaleDateString([], { day: 'numeric', month: 'short' })}.</p>
          </>
        )}
      </div>
    </div>
  );
}
