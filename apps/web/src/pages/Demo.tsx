import { useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { Spinner } from '../components/ui';
import { useAccount } from '../lib/account';
import { ApiError, api, getSession, setSession } from '../lib/api';
import { Icon } from '../lib/icons';
import { MarketingNav } from './Landing';
import { ChatHero } from '../components/ChatHero';

/** The guided demo: a fresh, pre-filled Meridian Tower project per visitor. No account needed. */
export function DemoPage() {
  const [, navigate] = useLocation();
  const { data: account } = useAccount();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const existing = getSession();
  const resume = existing?.kind !== 'team' ? existing : null;
  useEffect(() => { document.title = 'Live demo · PinThread'; }, []);

  const start = async (role: 'mep' | 'site') => {
    setBusy(role); setErr(null);
    try {
      const s = await api.startDemo(role);
      setSession(s);
      navigate(`/p/${s.projectId}${s.heroPinId ? `?pin=${s.heroPinId}` : ''}`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not start the demo. Try again.');
      setBusy(null);
    }
  };

  return (
    <div className="landing">
      <MarketingNav />
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">Live demo · no account needed</span>
          <h1>Resolve a beam clash in <em>60 seconds.</em></h1>
          <p className="lead">You get your own copy of a sample project, Meridian Tower Level 03, with four RFIs in different states. Propose a reroute, then approve it from your phone as the structural engineer and watch the pin turn green on both screens.</p>
          <div className="cta">
            <button className="btn btn-ink xl" onClick={() => start('mep')} disabled={!!busy}>{busy === 'mep' ? <><Spinner />Setting up your project…</> : <>Start as MEP lead<Icon name="chevron" size="sm" /></>}</button>
            <button className="btn btn-outline xl" onClick={() => start('site')} disabled={!!busy}>{busy === 'site' ? <><Spinner />Setting up…</> : 'Start as Site lead'}</button>
          </div>
          {err && <div className="form-error" role="alert" style={{ marginTop: 12 }}>{err}</div>}
          <p className="faint note-line"><Icon name="phone" size="sm" />Keep a phone handy for the second reviewer. Demo projects are deleted after 48 hours.</p>
          {resume && <p className="small" style={{ marginTop: 8 }}><Link href={`/p/${resume.projectId}`}>Continue your demo as {resume.me.name}</Link></p>}
          <p className="small muted" style={{ marginTop: 18 }}>{account ? <>Ready for your own drawings? <Link href="/app/new">Create a project</Link></> : <>Ready for your own drawings? <Link href="/signup">Create an account</Link></>}</p>
        </div>
        <ChatHero />
      </section>
      <section className="lsec">
        <div className="steps4">
          {[['01', 'Propose the reroute', 'Draw the new duct route on the clash and confirm it for MEP.'],
            ['02', 'Bring in Structural', 'Scan the QR on a phone. Dana gets a Jump to pin alert.'],
            ['03', 'Approve on the spot', 'Same location, same revision. One tap, and the pin turns green.'],
            ['04', 'Hand it over', 'Refresh, then export the register. Drawing, thread and PDF agree.']].map(([k, t, d]) => (
            <div className="s4" key={k}><span className="k">{k}</span><b>{t}</b><span>{d}</span></div>
          ))}
        </div>
      </section>
      <footer className="lfoot"><span>Fictional demo project. People, drawings and photos are made up.</span><span className="grow" /><Link href="/">Home</Link></footer>
    </div>
  );
}
