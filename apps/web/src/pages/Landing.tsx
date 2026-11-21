import { useState } from 'react';
import { useLocation } from 'wouter';
import { MERIDIAN, SHEET_INNER, type Point } from '@pinthread/shared';
import { PinMarker, Spinner } from '../components/ui';
import { Crop } from '../drawing/Crop';
import { RouteLines, SHEET_H, SHEET_W } from '../drawing/SheetCanvas';
import { ApiError, api, getSession, setSession } from '../lib/api';
import { Icon, Logo } from '../lib/icons';

const HERO_ROUTE = MERIDIAN.routes['RFI-001/v1'] as Point[];

export function Landing() {
  const [, navigate] = useLocation();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const existing = getSession();

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

  const at = MERIDIAN.pins['RFI-001'].at as Point;
  return (
    <div className="landing">
      <nav className="lnav">
        <span className="logo" style={{ fontSize: 18 }}><Logo size={26} />PinThread</span>
        <span className="grow" />
        <a href="#how">How it works</a>
        <a href="https://github.com/miwas1/pinthread" target="_blank" rel="noreferrer">GitHub</a>
        <span className="tag built">Built on Nexconn Chat</span>
      </nav>
      <section className="hero">
        <div>
          <span className="eyebrow">For site leads, engineers and MEP coordinators</span>
          <h1>Drawing questions, answered <em>on the drawing.</em></h1>
          <p className="lead">Drop a pin where the clash is. The right reviewers get the crop, the proposed fix and the question in one thread. The pin turns green on everyone's drawing when the last one signs off.</p>
          <div className="cta">
            <button className="btn btn-ink xl" onClick={() => start('mep')} disabled={!!busy}>{busy === 'mep' ? <><Spinner />Setting up your project…</> : <>Start as MEP lead<Icon name="chevron" size="sm" /></>}</button>
            <button className="btn btn-outline xl" onClick={() => start('site')} disabled={!!busy}>{busy === 'site' ? <><Spinner />Setting up…</> : 'Start as Site lead'}</button>
          </div>
          {err && <div className="form-error" role="alert" style={{ marginTop: 12 }}>{err}</div>}
          <p className="faint note-line"><Icon name="phone" size="sm" />No sign-up. You get your own Meridian Tower project. Keep a phone handy for the second reviewer.</p>
          {existing && <p className="small" style={{ marginTop: 8 }}><a href={`/p/${existing.projectId}`}>Continue your demo as {existing.me.name}</a></p>}
        </div>
        <div className="stage" aria-hidden>
          <svg viewBox={`330 250 520 360`} preserveAspectRatio="xMidYMid slice" className="stage-svg">
            <g dangerouslySetInnerHTML={{ __html: SHEET_INNER }} />
            <RouteLines route={HERO_ROUTE} />
          </svg>
          <span className="stage-pin" style={{ left: `${((at[0] * SHEET_W - 330) / 520) * 100}%`, top: `${((at[1] * SHEET_H - 250) / 360) * 100}%` }}>
            <span className="pin complete sel" style={{ position: 'absolute', left: 0, top: 0 }}><span className="halo" /><PinMarker status="complete" /><span className="label"><span className="id">RFI-001</span><span className="st">Review complete</span></span></span>
          </span>
          <div className="stage-card card proposal">
            <div className="ch"><span className="tag ver">v1</span><b>Proposal</b><span className="faint small">Marco Ruiz · MEP</span></div>
            <div className="cb"><Crop at={at} status="complete" route={HERO_ROUTE} width={210} /></div>
            <div className="cf"><span className="appr ok">MEP ✓</span><span className="appr ok">Structural ✓</span></div>
          </div>
          <div className="toast stage-toast"><span className="ok"><Icon name="check" size="sm" /></span><span><b>Dana Okafor approved.</b> RFI-001 is green on every device.</span></div>
        </div>
      </section>
      <section className="steps4" id="how">
        {[['01', 'Propose the reroute', 'Draw the new duct route on the clash and confirm it for MEP.'],
          ['02', 'Bring in Structural', 'Scan the QR on a phone. Dana gets a Jump to pin alert.'],
          ['03', 'Approve on the spot', 'Same location, same revision. One tap, and the pin turns green.'],
          ['04', 'Hand it over', 'Refresh, then export the register. Drawing, thread and PDF agree.']].map(([k, t, d]) => (
          <div className="s4" key={k}><span className="k">{k}</span><b>{t}</b><span>{d}</span></div>
        ))}
      </section>
      <footer className="lfoot">Fictional demo project. Real-time messaging by the Nexconn Chat SDK. <a href="https://github.com/miwas1/pinthread" target="_blank" rel="noreferrer">Source</a></footer>
    </div>
  );
}
