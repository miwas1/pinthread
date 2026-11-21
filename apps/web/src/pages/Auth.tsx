import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import { ChatHero } from '../components/ChatHero';
import { Spinner } from '../components/ui';
import { safeNext, useAccount, useSetAccount } from '../lib/account';
import { ApiError, api } from '../lib/api';
import { Icon, Logo } from '../lib/icons';

export function AuthPage({ mode }: { mode: 'login' | 'signup' }) {
  const search = useSearch();
  const [, navigate] = useLocation();
  const next = safeNext(new URLSearchParams(search).get('next'));
  const { data: account } = useAccount();
  const setAccount = useSetAccount();
  const [name, setName] = useState('');
  const [firm, setFirm] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const signup = mode === 'signup';

  useEffect(() => { if (account) navigate(next, { replace: true }); }, [account, next, navigate]);
  useEffect(() => { document.title = signup ? 'Create your account · PinThread' : 'Log in · PinThread'; }, [signup]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (signup && name.trim().length < 2) { setErr('Enter your full name.'); return; }
    if (signup && password.length < 8) { setErr('Use at least 8 characters for your password.'); return; }
    setBusy(true);
    try {
      const r = signup ? await api.signup({ name: name.trim(), firm: firm.trim(), email: email.trim(), password }) : await api.login({ email: email.trim(), password });
      setAccount(r.account);
      navigate(next, { replace: true });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Something went wrong. Try again.');
      setBusy(false);
    }
  };

  const other = `${signup ? '/login' : '/signup'}${next !== '/app' ? `?next=${encodeURIComponent(next)}` : ''}`;
  return (
    <div className="auth">
      <div className="auth-main">
        <Link href="/" className="logo" style={{ fontSize: 18, textDecoration: 'none' }}><Logo size={26} />PinThread</Link>
        <form className="auth-form" onSubmit={submit} noValidate>
          <h1 className="auth-h">{signup ? 'Create your account' : 'Log in to PinThread'}</h1>
          <p className="muted" style={{ margin: '6px 0 22px' }}>{signup ? 'Set up a project, upload your sheets and invite your team.' : 'Welcome back. Your projects are where you left them.'}</p>
          {next.startsWith('/invite/') && <div className="note" style={{ marginBottom: 16 }}><Icon name="users" size="sm" /><span>{signup ? 'Create an account' : 'Log in'} to accept your project invite.</span></div>}
          <div className="form">
            {signup && <label className="field-l">Full name<input className="field" autoComplete="name" value={name} onChange={e => setName(e.target.value)} placeholder="Priya Shah" autoFocus maxLength={80} /></label>}
            {signup && <label className="field-l"><span>Company <span className="faint">(optional)</span></span><input className="field" autoComplete="organization" value={firm} onChange={e => setFirm(e.target.value)} placeholder="Halden Construction" maxLength={80} /></label>}
            <label className="field-l">Work email<input className="field" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" autoFocus={!signup} maxLength={200} /></label>
            <label className="field-l">Password
              <span className="pw">
                <input className="field" type={show ? 'text' : 'password'} autoComplete={signup ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} placeholder={signup ? 'At least 8 characters' : ''} maxLength={200} />
                <button type="button" className="linkbtn" onClick={() => setShow(s => !s)} aria-pressed={show}>{show ? 'Hide' : 'Show'}</button>
              </span>
            </label>
            {err && <div className="form-error" role="alert"><Icon name="info" size="sm" />{err}</div>}
            <button className="btn btn-ink xl block" type="submit" disabled={busy}>{busy ? <><Spinner />{signup ? 'Creating your account…' : 'Logging in…'}</> : signup ? 'Create account' : 'Log in'}</button>
          </div>
          <p className="small muted" style={{ marginTop: 18 }}>
            {signup ? <>Already have an account? <Link href={other}>Log in</Link></> : <>New to PinThread? <Link href={other}>Create an account</Link></>}
          </p>
          <div className="auth-demo"><span className="faint small">Just looking?</span> <Link href="/demo" className="small">Try the live demo without an account</Link></div>
        </form>
      </div>
      <aside className="auth-side" aria-hidden>
        <div className="auth-side-inner">
          <p className="auth-quote">Every drawing question gets its own thread, with the people who have to sign it off.</p>
          <ChatHero compact />
        </div>
      </aside>
    </div>
  );
}
