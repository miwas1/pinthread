import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation, useSearch } from 'wouter';
import { ROLES, ROLE_INFO, personalLabel, type PinSummary, type Point, type ProjectState, type Role, type SessionResponse } from '@pinthread/shared';
import { useChat } from '../chat/ChatContext';
import { Avatar, Spinner, StatusChip, useToast, STATUS_LABEL } from '../components/ui';
import { SheetCanvas, ZoomStack, type CanvasHandle, type Layers } from '../drawing/SheetCanvas';
import { ApiError, api, setSession } from '../lib/api';
import { ago } from '../lib/format';
import { Icon, Logo } from '../lib/icons';
import { markOwnDecision, ownDecisionRecently, useIsMobile, useLiveSync, usePinRecord, useProjectState, useThread } from './data';
import { EvidenceModal, InviteModal, KickedModal, ProposalModal, RaiseIssueModal, TextPromptModal } from './Modals';
import { Room, type RoomModal } from './Room';


type Filter = 'all' | 'review' | 'blocked' | 'complete' | 'open';

function ConnChip({ compact }: { compact?: boolean }) {
  const { status, mode } = useChat();
  const map: Record<string, [string, string]> = {
    connected: ['', mode === 'nexconn' ? 'Nexconn live' : 'Live (local chat)'],
    connecting: ['warn', 'Connecting…'],
    reconnecting: ['warn', 'Reconnecting… decisions still save'],
    offline: ['off', 'Offline · refreshing every 5 s'],
    kicked: ['off', 'Open on another device'],
  };
  const [cls, label] = map[status];
  return <span className={`conn ${cls}`} title={label} data-status={status}>{compact ? (status === 'connected' ? 'Live' : status === 'offline' ? 'Offline' : '…') : label}</span>;
}

function Rail({ state, selectedId, onSelect, filter, setFilter, unread }: { state: ProjectState; selectedId: string | null; onSelect: (id: string) => void; filter: Filter; setFilter: (f: Filter) => void; unread: Record<string, number> }) {
  const [disc, setDisc] = useState('all');
  const me = state.me.userId;
  const counts = { review: 0, blocked: 0, complete: 0, open: 0 } as Record<string, number>;
  state.pins.forEach(p => { counts[p.state.status]++; });
  const shown = state.pins.filter(p => (filter === 'all' || p.state.status === filter) && (disc === 'all' || p.discipline === disc));
  const mine = shown.filter(p => p.state.waitingFor.some(w => w.userId === me) && p.state.status !== 'complete');
  const others = shown.filter(p => !mine.includes(p)).sort((a, b) => {
    const rank = (x: PinSummary) => (x.state.status === 'complete' ? 1 : 0);
    return rank(a) - rank(b) || new Date(a.waitingSince ?? 0).getTime() - new Date(b.waitingSince ?? 0).getTime();
  });
  const Item = ({ p }: { p: PinSummary }) => (
    <button className={`issue ${p.id === selectedId ? 'sel' : ''} st-${p.state.status}`} onClick={() => onSelect(p.id)} aria-current={p.id === selectedId}>
      <div className="row"><StatusChip status={p.state.status} /><span className="ref">{p.number}</span><span className="grow" />{unread[p.id] ? <span className="unread">{unread[p.id]}</span> : null}</div>
      <div className="t">{p.title}</div>
      <div className="m">Grid {p.gridRef} · {p.discipline.toUpperCase()} · {p.severity[0].toUpperCase() + p.severity.slice(1)}</div>
      <div className="w">
        <span className="row" style={{ gap: 4 }}>{p.reviewers.map(r => <Avatar key={r.userId} p={r} size="sm" mark={p.approvedBy.includes(r.userId) ? 'ok' : p.state.waitingFor.some(w => w.userId === r.userId) && p.state.status === 'review' ? 'wait' : undefined} />)}</span>
        {p.state.status === 'complete' ? `Approved · ${p.reviewers.map(r => ROLE_INFO[r.role].label).join(', ')}` : `${personalLabel(p.state, me).replace(/^(In review|Blocked) · /, '')} · ${ago(p.waitingSince)}`}
      </div>
    </button>
  );
  return (
    <>
      <div className="ph rail-head">
        <div className="row"><h2 className="h-title" style={{ fontSize: 16 }}>Issues</h2><span className="ref">{state.pins.length}</span></div>
        <div className="chips" style={{ marginTop: 10 }}>
          {(['all', 'review', 'blocked', 'complete', 'open'] as Filter[]).filter(f => f === 'all' || counts[f]).map(f => (
            <button key={f} className={`fchip ${filter === f ? 'on' : ''}`} onClick={() => setFilter(f)}>
              {f !== 'all' && <span className={`dot ${f}`} />}{f === 'all' ? 'All' : f === 'complete' ? 'Done' : STATUS_LABEL[f]} <span className="n">{f === 'all' ? state.pins.length : counts[f]}</span>
            </button>
          ))}
        </div>
        <div className="chips" style={{ marginTop: 6 }}>
          <label className="fchip select">Discipline
            <select value={disc} onChange={e => setDisc(e.target.value)} aria-label="Filter by discipline">
              <option value="all">All</option><option value="mep">MEP</option><option value="struct">Structural</option><option value="arch">Architecture</option><option value="elec">Electrical</option>
            </select><Icon name="chevdown" size="sm" />
          </label>
        </div>
      </div>
      <div className="scroll grow">
        {mine.length > 0 && <><div className="sec-h"><span className="h-sec">Waiting on you</span></div>{mine.map(p => <Item key={p.id} p={p} />)}</>}
        {others.length > 0 && <><div className="sec-h"><span className="h-sec">{mine.length ? 'Everything else' : 'Waiting on others'}</span><span className="grow" /><span className="faint small">Longest wait first</span></div>{others.map(p => <Item key={p.id} p={p} />)}</>}
        {!shown.length && <div className="empty">Nothing matches these filters. <button className="linkbtn" onClick={() => { setFilter('all'); setDisc('all'); }}>Clear filters</button></div>}
      </div>
    </>
  );
}

function Tracker({ state, onStep, onClose }: { state: ProjectState; onStep: (n: number) => void; onClose: () => void }) {
  const t = state.demo!.tracker;
  const done = [t.proposed, t.structConnected, t.approved, t.exported];
  const now = done.findIndex(d => !d);
  const steps = ['Propose the reroute', 'Bring in Structural on another device', 'Structural approves', 'Refresh and export the register'];
  const actions = ['Open the beam clash', "Show QR for Dana's phone", 'Open the beam clash', 'Export the register'];
  if (now === -1) {
    return <div className="tracker done"><div className="row"><span className="okdot"><Icon name="check" size="sm" /></span><b className="grow">Demo complete</b><button className="tool sm" onClick={onClose} aria-label="Dismiss"><Icon name="x" size="sm" /></button></div><p className="small muted" style={{ margin: '8px 0 0' }}>Drawing, thread and register agree. Try the slab hold on RFI-003 next.</p></div>;
  }
  return (
    <div className="tracker">
      <div className="row"><span className="h-sec">Demo · step {now + 1} of 4</span><span className="grow" /><button className="tool sm" onClick={onClose} aria-label="Dismiss guide"><Icon name="x" size="sm" /></button></div>
      <div className="progress" style={{ marginTop: 8 }}><i style={{ width: `${(done.filter(Boolean).length / 4) * 100}%` }} /></div>
      <div className="steps">{steps.map((s, i) => <div key={s} className={`step ${done[i] ? 'done' : i === now ? 'now' : ''}`}><span className="n">{done[i] ? <Icon name="check" size="sm" /> : i + 1}</span>{s}</div>)}</div>
      <button className="btn btn-ink block" style={{ marginTop: 12 }} onClick={() => onStep(now)}>{now === 1 && <Icon name="qr" size="sm" />}{actions[now]}</button>
    </div>
  );
}

function BottomSheet({ snap, setSnap, children }: { snap: 'peek' | 'half' | 'full'; setSnap: (s: 'peek' | 'half' | 'full') => void; children: ReactNode }) {
  const start = useRef<{ y: number; h: number } | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const heights = { peek: 148, half: Math.min(580, Math.round(vh * 0.66)), full: vh - 60 };
  const h = drag ?? heights[snap];
  return (
    <div className="bsheet" style={{ height: h, transition: drag === null ? 'height var(--d-slow) var(--ease-out)' : 'none' }}>
      <div className="grab-zone" role="button" aria-label="Resize panel" tabIndex={0}
        onKeyDown={e => { if (e.key === 'Enter') setSnap(snap === 'full' ? 'half' : 'full'); }}
        onPointerDown={e => { start.current = { y: e.clientY, h }; (e.currentTarget as Element).setPointerCapture(e.pointerId); }}
        onPointerMove={e => { if (start.current) setDrag(Math.max(110, Math.min(vh - 40, start.current.h + start.current.y - e.clientY))); }}
        onPointerUp={e => {
          if (!start.current) return;
          const moved = Math.abs(e.clientY - start.current.y);
          const cur = drag ?? h;
          start.current = null; setDrag(null);
          if (moved < 6) { setSnap(snap === 'peek' ? 'half' : snap === 'half' ? 'full' : 'half'); return; }
          const near = (Object.entries(heights) as ['peek' | 'half' | 'full', number][]).sort((a, b) => Math.abs(a[1] - cur) - Math.abs(b[1] - cur))[0][0];
          setSnap(near);
        }}><div className="grab" /></div>
      {children}
    </div>
  );
}

export function Workspace({ session }: { session: SessionResponse }) {
  const projectId = session.projectId;
  const search = useSearch();
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const toast = useToast();
  const chat = useChat();
  const isMobile = useIsMobile();
  const canvas = useRef<CanvasHandle>(null);
  const { data: state, error, isLoading } = useProjectState(projectId);
  const selectedId = new URLSearchParams(search).get('pin');
  const selected = state?.pins.find(p => p.id === selectedId) ?? null;
  const { data: record } = usePinRecord(selected?.id ?? null);
  const [layers, setLayers] = useState<Layers>({ arch: true, struct: true, mep: true });
  const [filter, setFilter] = useState<Filter>('all');
  const [placing, setPlacing] = useState(false);
  const [draft, setDraft] = useState<Point | null>(null);
  const [modal, setModal] = useState<RoomModal | { kind: 'invite' } | { kind: 'raise'; point: Point } | null>(null);
  const [menu, setMenu] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [snap, setSnap] = useState<'peek' | 'half' | 'full'>('half');
  const [pulseId, setPulseId] = useState<string | null>(null);
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [trackerOpen, setTrackerOpen] = useState(() => { try { return sessionStorage.getItem('pt.tracker') !== 'off'; } catch { return true; } });
  const [exporting, setExporting] = useState(false);
  const thread = useThread(selected, state?.project.communityId, !!selected && !!state && selected.memberIds.includes(state.me.userId));

  // Focus requests wait until the pin exists in the loaded state (e.g. a pin that was just raised).
  const pendingFocus = useRef<string | null>(selectedId);
  const select = useCallback((id: string | null, focus = true) => {
    navigate(id ? `/p/${projectId}?pin=${id}` : `/p/${projectId}`, { replace: true });
    if (id) { setUnread(u => ({ ...u, [id]: 0 })); if (isMobile) setSnap('half'); if (focus) pendingFocus.current = id; }
  }, [navigate, projectId, isMobile]);

  useEffect(() => {
    const id = pendingFocus.current;
    if (!id || !state?.pins.some(p => p.id === id)) return;
    pendingFocus.current = null;
    const t = setTimeout(() => canvas.current?.focusPin(id, isMobile ? 1.35 : 1.45), 120);
    return () => clearTimeout(t);
  }, [state, selectedId, isMobile]);

  useLiveSync(projectId, state, {
    onJump: m => {
      const c = m.content;
      toast({ tone: 'info', text: <><b>{c.from?.name}</b> {c.ask?.replace(`${c.from?.name} `, '')}</>, action: { label: 'Jump to pin', run: () => select(c.pinId) } });
    },
    onPinChange: (pinId, status, prev) => {
      if (status === prev) return;
      if (status === 'complete' || status === 'blocked') { setPulseId(pinId); setTimeout(() => setPulseId(null), 1600); }
      if (ownDecisionRecently()) return;
      const p = state?.pins.find(x => x.id === pinId);
      if (status === 'complete' && p) toast({ tone: 'ok', text: <><b>{p.number}</b> is now Review complete.</> });
    },
  });

  // Unread badges: count others' messages in rooms you are not looking at.
  useEffect(() => chat.subscribe(e => {
    if (e.kind !== 'message' || !state) return;
    const pin = state.pins.find(p => p.subchannelId === e.message.subId);
    if (!pin || pin.id === selectedId || e.message.senderId === state.me.userId || e.message.type === 'pt:pinstate') return;
    setUnread(u => ({ ...u, [pin.id]: (u[pin.id] ?? 0) + 1 }));
  }), [chat, state, selectedId]);

  const routes = useMemo(() => {
    if (!record || record.id !== selected?.id) return [];
    const cur = record.proposals.find(p => p.current);
    return cur?.route ? [{ route: cur.route }] : [];
  }, [record, selected?.id]);

  const exportRegister = async () => {
    setExporting(true);
    try {
      const blob = await api.register(projectId);
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), { href: url, download: `RFI-register-C-103-RevB.pdf` });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast({ tone: 'ok', text: <><b>Register exported.</b> Drawing, thread and PDF share one record.</> });
      void qc.invalidateQueries({ queryKey: ['state', projectId] });
    } catch (e) { toast({ tone: 'warn', text: e instanceof Error ? e.message : 'Export failed' }); }
    finally { setExporting(false); }
  };

  const switchRole = async (role: Role) => {
    try { setSession(await api.switchRole(role)); window.location.reload(); }
    catch (e) { toast({ tone: 'warn', text: e instanceof Error ? e.message : 'Could not switch role' }); }
  };
  const leave = () => { setSession(null); window.location.href = '/'; };

  if (isLoading || !state) {
    if (error) {
      const expired = error instanceof ApiError && (error.status === 401 || error.status === 404 || error.status === 403);
      return <div className="center-page"><div className="card pad"><h2 className="h-title">{expired ? 'This demo project has ended' : 'Could not load the project'}</h2><p className="muted">{error.message}</p><button className="btn btn-ink lg" onClick={leave}>Start a new demo</button></div></div>;
    }
    return <div className="center-page"><Spinner /> <span className="muted">Loading Meridian Tower…</span></div>;
  }

  const me = state.me;
  const roomProps = selected ? {
    pin: selected, record: record?.id === selected.id ? record : undefined, state, thread,
    onClose: () => select(null, false), openModal: (m: RoomModal) => setModal(m), onRegister: exportRegister,
  } : null;
  const roleTitle = ROLE_INFO[me.role].title;

  const handleStep = (n: number) => {
    const hero = state.pins.find(p => p.number === 'RFI-001');
    if (n === 0 && hero) { select(hero.id); if (me.role === 'mep' && hero.state.status === 'open') setTimeout(() => setModal({ kind: 'proposal', revise: false }), 500); }
    if (n === 1) setModal({ kind: 'invite' });
    if (n === 2 && hero) select(hero.id);
    if (n === 3) void exportRegister();
  };

  const modals = (
    <>
      {modal?.kind === 'invite' && <InviteModal session={session} state={state} onClose={() => setModal(null)} />}
      {modal?.kind === 'raise' && <RaiseIssueModal point={modal.point} state={state} onClose={() => { setModal(null); setDraft(null); }}
        onCreated={r => { setModal(null); setDraft(null); qc.setQueryData(['pin', r.id], r); void qc.invalidateQueries({ queryKey: ['state', projectId] }).then(() => select(r.id)); toast({ tone: 'ok', text: <><b>{r.number}</b> raised. Reviewers have been alerted.</> }); }} />}
      {record && modal?.kind === 'proposal' && <ProposalModal record={record} me={me} revise={modal.revise} onClose={() => setModal(null)}
        onPosted={r => { markOwnDecision(); setModal(null); qc.setQueryData(['pin', r.id], r); void qc.invalidateQueries({ queryKey: ['state', projectId] }); toast({ tone: 'ok', text: <><b>Proposal v{r.proposals.at(-1)?.version} posted.</b> {r.state.waitingFor.length ? `Waiting for ${r.state.waitingFor.map(w => ROLE_INFO[w.role].label).join(' and ')}.` : ''}</> }); }} />}
      {record && modal?.kind === 'hold' && <TextPromptModal title={`Place a hold on ${record.number}`} sub="The pin turns red for everyone until you clear it." label="What prevents approval?" placeholder="e.g. Visible honeycombing at the slab edge" cta="Place hold" danger
        second={{ label: 'What would clear it?', placeholder: 'e.g. Core test results or a repair method statement' }} onClose={() => setModal(null)}
        onSubmit={async (reason, clear) => { const r = await api.hold(record.id, { reason, clearCondition: clear! }); markOwnDecision(); qc.setQueryData(['pin', r.id], r); void qc.invalidateQueries({ queryKey: ['state', projectId] }); setModal(null); }} />}
      {record && modal?.kind === 'clear' && <TextPromptModal title={`Clear the hold on ${record.number}`} sub={`To clear: ${modal.hold.clearCondition}`} label="Note for the record" placeholder="e.g. Core results acceptable (42 MPa). Proceed with MS-07." cta="Clear hold" minLength={0}
        onClose={() => setModal(null)} onSubmit={async note => { const r = await api.clearHold(record.id, modal.hold.id, note || null); markOwnDecision(); qc.setQueryData(['pin', r.id], r); void qc.invalidateQueries({ queryKey: ['state', projectId] }); setModal(null); }} />}
      {record && modal?.kind === 'change' && <TextPromptModal title="Request a change" sub={`${record.number} · Proposal v${record.proposals.find(p => p.current)?.version}`} label="What needs to change?" placeholder="e.g. Keep 300 mm clear of the column flange" cta="Request change"
        onClose={() => setModal(null)} onSubmit={async comment => { const cur = record.proposals.find(p => p.current)!; const r = await api.signoff(record.id, crypto.randomUUID(), { proposalId: cur.id, revision: state.project.sheet.revision, verdict: 'request_change', comment }); qc.setQueryData(['pin', record.id], r.record); void qc.invalidateQueries({ queryKey: ['state', projectId] }); setModal(null); }} />}
      {record && modal?.kind === 'evidence' && <EvidenceModal hold={modal.hold} pinNumber={record.number} onClose={() => setModal(null)}
        upload={async f => { const m = await thread.sendImage(f); return { imageUrl: m.imageUrl, id: m.id }; }}
        onDone={async (url, caption, messageId) => { const r = await api.evidence(record.id, { holdId: modal.hold.id, imageUrl: url, caption, messageId }); qc.setQueryData(['pin', r.id], r); void qc.invalidateQueries({ queryKey: ['state', projectId] }); setModal(null); toast({ tone: 'ok', text: <><b>Evidence posted.</b> {modal.hold.placedBy.name} has been alerted.</> }); }} />}
      {chat.status === 'kicked' && <KickedModal name={me.name} onUseHere={() => void chat.reconnect()} onLeave={leave} />}
    </>
  );

  const canvasEl = (
    <section className="canvas" aria-label="Drawing C-103 Level 03 Rev B">
      <SheetCanvas ref={canvas} pins={state.pins} selectedId={selectedId} labelFor={p => personalLabel(p.state, me.userId)} onSelect={id => select(id)}
        routes={routes} layers={layers} placing={placing} onPlace={pt => { setPlacing(false); setDraft(pt); setModal({ kind: 'raise', point: pt }); }}
        bottomInset={isMobile ? (selected ? Math.min(580, Math.round(window.innerHeight * 0.66)) : 148) : 0} unread={unread} pulseId={pulseId} draft={draft} compactLabels={isMobile} />
      <div className="float tl"><div className="seg" role="group" aria-label="Drawing layers">
        {(['arch', 'struct', 'mep'] as const).map(k => <button key={k} className={layers[k] ? 'on' : ''} aria-pressed={layers[k]} onClick={() => setLayers(l => ({ ...l, [k]: !l[k] }))}><span className="sw" style={{ background: `var(--layer-${k})` }} />{k === 'arch' ? 'Arch' : k === 'struct' ? 'Struct' : 'MEP'}</button>)}
      </div></div>
      {state.demo && trackerOpen && !isMobile && <div className="float tr"><Tracker state={state} onStep={handleStep} onClose={() => { setTrackerOpen(false); try { sessionStorage.setItem('pt.tracker', 'off'); } catch { /* ignore */ } }} /></div>}
      {!isMobile && <div className="float br"><ZoomStack canvas={canvas} selectedId={selectedId} /></div>}
      <div className={`float ${isMobile ? 'tr' : 'bl'}`}>
        {placing
          ? <div className="placing-hint"><Icon name="pin" size="sm" />Tap where the issue is <button className="btn btn-outline sm" onClick={() => setPlacing(false)}>Cancel</button></div>
          : <button className={`fab ${isMobile ? 'icon' : ''}`} onClick={() => setPlacing(true)} aria-label="New issue"><Icon name="plus" />{!isMobile && 'New issue'}</button>}
      </div>
      {!isMobile && <div className="float bc"><span className="readout">{state.project.sheet.number} · Rev {state.project.sheet.revision}</span></div>}
    </section>
  );

  const menuEl = menu && (
    <div className="menu" role="menu" onMouseLeave={() => setMenu(false)}>
      <div className="menu-h"><Avatar p={me} /><div><b>{me.name}</b><div className="faint small">{roleTitle} · {me.firm}</div></div></div>
      <div className="menu-sec">Act as someone else</div>
      {ROLES.filter(r => r !== me.role).map(r => { const m = state.members.find(x => x.role === r); return <button key={r} role="menuitem" onClick={() => switchRole(r)}><Avatar p={m} size="sm" />{m?.name}<span className="faint small">{ROLE_INFO[r].label}</span></button>; })}
      <div className="menu-sep" />
      <button role="menuitem" onClick={() => { setActivityOpen(o => !o); setMenu(false); }}><Icon name="activity" size="sm" />{activityOpen ? 'Hide' : 'Show'} Nexconn activity</button>
      {state.demo && !trackerOpen && <button role="menuitem" onClick={() => { setTrackerOpen(true); setMenu(false); try { sessionStorage.removeItem('pt.tracker'); } catch { /* ignore */ } }}><Icon name="list" size="sm" />Show demo guide</button>}
      <button role="menuitem" onClick={leave}><Icon name="logout" size="sm" />Leave demo</button>
    </div>
  );

  const activity = activityOpen && (
    <div className="activity" aria-label="Nexconn activity">
      <div className="row"><b className="grow"><Icon name="activity" size="sm" /> Nexconn activity <span className="faint small">({chat.mode})</span></b><button className="tool sm" onClick={() => setActivityOpen(false)} aria-label="Close"><Icon name="x" size="sm" /></button></div>
      <ol>{chat.activity.map((a, i) => <li key={i}><span className="faint">{new Date(a.at).toLocaleTimeString([], { hour12: false })}</span> {a.text}</li>)}</ol>
    </div>
  );

  if (isMobile) {
    return (
      <div className="app mobile">
        <header className="mtop">
          <Logo size={26} /><span className="revpill">C-103 · Rev B</span><span className="grow" /><ConnChip compact />
          {state.demo && <button className="tool sm" aria-label="Invite another device" onClick={() => setModal({ kind: 'invite' })}><Icon name="qr" size="sm" /></button>}
          <button className="avbtn" onClick={() => setMenu(m => !m)} aria-label="Account menu"><Avatar p={me} /></button>
          {menuEl}
        </header>
        <main className="mcanvas">{canvasEl}</main>
        <BottomSheet snap={selected ? snap : snap === 'full' ? 'full' : snap === 'half' ? 'half' : 'peek'} setSnap={setSnap}>
          {roomProps ? <Room {...roomProps} compact /> : (
            <div className="rail mrail"><Rail state={state} selectedId={selectedId} onSelect={id => select(id)} filter={filter} setFilter={setFilter} unread={unread} /></div>
          )}
          {selected && <button className="sheet-back" onClick={() => select(null, false)}><Icon name="list" size="sm" />All issues</button>}
        </BottomSheet>
        {activity}
        {modals}
      </div>
    );
  }

  return (
    <div className={`app ${selected ? 'with-room' : ''}`}>
      <header className="topbar">
        <a className="logo" href="/" onClick={e => { e.preventDefault(); select(null, false); canvas.current?.fit(); }}><Logo />PinThread</a>
        <nav className="crumb"><span>{state.project.name}</span><span className="sep">/</span><b>{state.project.sheet.number} {state.project.sheet.title}</b><span className="revpill">Rev {state.project.sheet.revision}</span></nav>
        <span className="grow" />
        <ConnChip />
        {state.demo && <button className="btn btn-outline" onClick={() => setModal({ kind: 'invite' })}><Icon name="qr" size="sm" />Invite device</button>}
        <button className="btn btn-outline" onClick={exportRegister} disabled={exporting}>{exporting ? <Spinner /> : <Icon name="download" size="sm" />}Export register</button>
        <div className="me" style={{ position: 'relative' }}>
          <button className="avbtn" onClick={() => setMenu(m => !m)} aria-haspopup="menu" aria-expanded={menu}><Avatar p={me} /><div className="who"><b>{me.name}</b><span>{roleTitle} · {me.firm}</span></div><Icon name="chevdown" size="sm" /></button>
          {menuEl}
        </div>
      </header>
      <div className="main">
        <aside className="rail"><Rail state={state} selectedId={selectedId} onSelect={id => select(id)} filter={filter} setFilter={setFilter} unread={unread} /></aside>
        {canvasEl}
        {roomProps && <aside className="panel"><Room {...roomProps} /></aside>}
      </div>
      {activity}
      {modals}
    </div>
  );
}
