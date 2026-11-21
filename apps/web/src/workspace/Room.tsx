import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ROLE_INFO, personalLabel, roleList, type Hold, type Person, type PinRecord, type PinSummary, type ProjectState } from '@pinthread/shared';
import { Avatar, Spinner, StatusChip, useToast } from '../components/ui';
import { Crop } from '../drawing/Crop';
import { ApiError, api } from '../lib/api';
import { ago, clock, compressImage, uuid } from '../lib/format';
import { Icon } from '../lib/icons';
import type { Quote } from '../chat/types';
import { domainKey, ThreadItem, type ThreadCtx } from './Cards';
import { markOwnDecision, useThread } from './data';

export type RoomModal = { kind: 'proposal'; revise: boolean } | { kind: 'hold' } | { kind: 'evidence'; hold: Hold } | { kind: 'clear'; hold: Hold } | { kind: 'change' };

interface Props {
  pin: PinSummary;
  record: PinRecord | undefined;
  state: ProjectState;
  onClose: () => void;
  openModal: (m: RoomModal) => void;
  onRegister: () => void;
  compact?: boolean;
  thread: ReturnType<typeof useThread>;
}

function SignoffBar({ record, me, revision }: { record: PinRecord; me: Person; revision: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const cur = record.proposals.find(p => p.current);
  const key = useMemo(() => uuid(), [cur?.id]); // one intention per displayed proposal; repeated clicks reuse it
  const [phase, setPhase] = useState<'idle' | 'confirm' | 'busy' | 'stale' | 'error'>('idle');
  const [err, setErr] = useState('');
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => { setPhase('idle'); }, [cur?.id]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  if (!cur || !record.reviewers.some(r => r.userId === me.userId)) return null;
  if (record.holds.some(h => h.status === 'active')) return null;
  const mine = record.signoffs.find(s => s.proposalId === cur.id && s.reviewer.userId === me.userId && s.revision === revision && s.verdict !== 'withdrawn');
  if (record.state.status === 'complete') return null;
  if (mine?.verdict === 'approve') {
    return <div className="signoff done"><div className="what grow"><b>You approved v{cur.version}</b>{record.state.waitingFor.length ? `Waiting for ${roleList(record.state.waitingFor.map(w => w.role))}` : 'Waiting for the record to update'}</div><span style={{ color: 'var(--complete)' }}><Icon name="check" /></span></div>;
  }
  const approve = async () => {
    if (phase === 'idle' || phase === 'error') {
      setPhase('confirm');
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setPhase(p => (p === 'confirm' ? 'idle' : p)), 4000);
      return;
    }
    if (phase !== 'confirm') return;
    window.clearTimeout(timer.current);
    setPhase('busy');
    markOwnDecision();
    try {
      const r = await api.signoff(record.id, key, { proposalId: cur.id, revision, verdict: 'approve', comment: null });
      qc.setQueryData(['pin', record.id], r.record);
      void qc.invalidateQueries({ queryKey: ['state'] });
      toast({ tone: 'ok', text: r.record.state.status === 'complete' ? <><b>Approved.</b> {record.number} is green for everyone.</> : <><b>Approved.</b> Waiting for {roleList(r.record.state.waitingFor.map(w => w.role))}.</> });
      setPhase('idle');
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'stale' || e.code === 'stale_revision')) { setPhase('stale'); setErr(e.message); void qc.invalidateQueries({ queryKey: ['pin', record.id] }); }
      else { setPhase('error'); setErr(e instanceof ApiError && e.code === 'network' ? "Couldn't save your approval. Check your connection and try again." : e instanceof Error ? e.message : 'Try again.'); }
    }
  };
  if (phase === 'stale') {
    return <div className="signoff stale"><div className="what grow"><b>Proposal changed</b>{err}</div><button className="btn btn-outline sm" onClick={() => setPhase('idle')}>Show latest</button></div>;
  }
  return (
    <div className="signoff">
      <div className="what">{mine?.verdict === 'request_change' ? <>You asked for a change on <b style={{ display: 'inline' }}>v{cur.version}</b>. Approve if it's resolved.</> : <>You're reviewing <b style={{ display: 'inline' }}>Proposal v{cur.version} on Rev {revision}</b> as {ROLE_INFO[me.role].label}</>}</div>
      {phase === 'error' && <div className="form-error" role="alert">{err}</div>}
      <div className="row" style={{ gap: 10 }}>
        <button className="btn btn-outline lg" style={{ flex: 1 }} disabled={phase === 'busy'} onClick={() => document.dispatchEvent(new CustomEvent('pt:request-change'))}>Request change</button>
        <button className={`btn btn-approve lg ${phase === 'confirm' ? 'confirming' : ''}`} style={{ flex: 1.3 }} onClick={approve} disabled={phase === 'busy'} data-testid="approve">
          {phase === 'busy' ? <><Spinner />Approving…</> : phase === 'confirm' ? <><Icon name="check" size="sm" />Confirm approval of v{cur.version}</> : phase === 'error' ? 'Try again' : <><Icon name="check" size="sm" />Approve proposal</>}
        </button>
      </div>
      {phase === 'confirm' && <button className="linkbtn" style={{ alignSelf: 'center' }} onClick={() => setPhase('idle')}>Cancel</button>}
    </div>
  );
}

export function Room({ pin, record, state, onClose, openModal, onRegister, compact, thread }: Props) {
  const me = state.me;
  const toast = useToast();
  const people = useMemo(() => new Map(state.members.map(m => [m.userId, m as Person])), [state.members]);
  const isMember = pin.memberIds.includes(me.userId);
  const [text, setText] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [uploading, setUploading] = useState<number | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const label = personalLabel(pin.state, me.userId);
  const isReviewer = pin.reviewers.some(r => r.userId === me.userId);
  const canPropose = isReviewer || me.role === 'site';
  const activeHold = record?.holds.find(h => h.status === 'active');
  const canHold = isReviewer && me.canHold && !activeHold && pin.state.status !== 'complete';

  useEffect(() => { const el = scroller.current; if (el) el.scrollTop = el.scrollHeight; }, [thread.messages.length, record?.state.status]);
  useEffect(() => {
    const f = () => openModal({ kind: 'change' });
    document.addEventListener('pt:request-change', f);
    return () => document.removeEventListener('pt:request-change', f);
  }, [openModal]);

  const send = () => {
    const t = text.trim();
    if (!t) return;
    setText(''); setQuote(null);
    void thread.sendText(t, quote);
  };
  const onPhoto = async (f: File | undefined) => {
    if (!f) return;
    setUploading(0);
    try { await thread.sendImage(await compressImage(f), p => setUploading(p)); }
    catch (e) { toast({ tone: 'warn', text: e instanceof Error ? e.message : 'Upload failed' }); }
    finally { setUploading(null); if (fileRef.current) fileRef.current.value = ''; }
  };

  const ctx: ThreadCtx | null = record ? {
    record, people, meId: me.userId, onReply: q => setQuote(q), onRevise: () => openModal({ kind: 'proposal', revise: true }),
    onEvidence: h => openModal({ kind: 'evidence', hold: h }), onClearHold: h => openModal({ kind: 'clear', hold: h }), onRegister, onRetry: thread.retry,
  } : null;

  const seen = new Set<string>();
  const items = thread.messages.filter(m => { const k = domainKey(m); if (seen.has(k)) return false; seen.add(k); return true; });

  return (
    <div className="room">
      <div className="ph room-head">
        <div className="row"><StatusChip status={pin.state.status} text={label} large /><span className="grow" />
          <button className="tool sm" aria-label="Copy link" onClick={() => { void navigator.clipboard?.writeText(`${location.origin}${location.pathname}?pin=${pin.id}`); toast({ tone: 'ok', text: 'Link copied' }); }}><Icon name="link" size="sm" /></button>
          {!compact && <button className="tool sm" aria-label="Close issue" onClick={onClose}><Icon name="x" size="sm" /></button>}
        </div>
        <h1 className="h-title">{pin.title}</h1>
        <div className="row wrap" style={{ marginTop: 6, gap: 6 }}>
          <span className="ref">{pin.number} · {state.project.sheet.number} Rev {state.project.sheet.revision} · Grid {pin.gridRef}</span>
          <span className={`tag sev-${pin.severity}`}>{pin.severity}</span><span className={`tag ${pin.discipline === 'elec' ? 'mep' : pin.discipline}`}>{pin.discipline}</span>
        </div>
      </div>

      <div className="room-scroll" ref={scroller}>
        <div className="brief">
          <div className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
            <div style={{ width: 118, flex: 'none' }}><Crop at={[pin.x, pin.y]} status={pin.state.status} width={170} aspect={1.5} /></div>
            <p className="q">“{record?.question ?? '…'}” <span className="faint">— {record?.raisedBy.name}, {record ? ROLE_INFO[record.raisedBy.role].title : ''}</span></p>
          </div>
          <div className="reviewers">
            {pin.reviewers.map(r => {
              const s = record?.signoffs.find(x => x.reviewer.userId === r.userId && record.proposals.find(p => p.current)?.id === x.proposalId && x.verdict !== 'withdrawn');
              const waiting = pin.state.waitingFor.some(w => w.userId === r.userId) && pin.state.status !== 'open';
              return (
                <div key={r.userId} className={`rv ${waiting ? 'waiting' : ''}`}>
                  <Avatar p={r} mark={s?.verdict === 'approve' ? 'ok' : waiting ? 'wait' : undefined} />
                  <div><div className="nm">{r.name}{r.userId === me.userId ? <span className="faint" style={{ fontWeight: 400 }}> (you)</span> : null}</div>
                    <div className="rl" style={waiting ? { color: 'var(--review-text)' } : undefined}>{ROLE_INFO[r.role].label} · {s?.verdict === 'approve' ? `approved ${clock(s.at)}` : s?.verdict === 'request_change' ? 'change requested' : waiting ? `waiting ${ago(pin.waitingSince)}` : pin.state.status === 'open' ? 'needs a proposal' : '—'}</div></div>
                </div>
              );
            })}
          </div>
          {record?.state.outstanding && pin.state.status !== 'complete' && <div className="outstanding"><Icon name="clock" size="sm" />{record.state.outstanding}</div>}
        </div>

        <div className="thread">
          {!isMember && (
            <div className="note"><Icon name="info" size="sm" /><span>Only this issue's reviewers and the site lead are in its Nexconn room. You can see the decision record.</span></div>
          )}
          {isMember && !pin.roomReady && <div className="daysep"><Spinner /> Setting up the room…</div>}
          {isMember && thread.loading && <div className="skeleton-list"><i /><i /><i /></div>}
          {isMember && thread.error && <div className="form-error">Couldn't load the conversation: {thread.error}</div>}
          {isMember && ctx && items.map(m => <ThreadItem key={m.id} m={m} ctx={ctx} />)}
          {!isMember && ctx && record?.proposals.map(p => (
            <ThreadItem key={p.id} ctx={ctx} m={{ id: p.id, communityId: '', subId: '', type: 'pt:proposal', senderId: p.author.userId, sentAt: new Date(p.createdAt).getTime(), content: { proposalId: p.id, version: p.version, summary: p.summary, route: p.route, author: p.author }, metadata: {} }} />
          ))}
          {isMember && !thread.loading && pin.roomReady && items.length === 0 && <div className="empty">Ask a question or post a proposal to start the review.</div>}
        </div>
      </div>

      {record && <SignoffBar record={record} me={me} revision={state.project.sheet.revision} />}
      {isMember && (
        <div className="composer-wrap">
          {quote && <div className="quote-chip"><Icon name="reply" size="sm" /><span className="grow">Replying to <b>{quote.name}</b>: {quote.text.slice(0, 80)}</span><button className="tool sm" onClick={() => setQuote(null)} aria-label="Cancel reply"><Icon name="x" size="sm" /></button></div>}
          {uploading !== null && <div className="upload-bar"><i style={{ width: `${Math.max(8, uploading)}%` }} />Uploading photo…</div>}
          <div className="composer">
            <button className="tool" aria-label="Add photo" onClick={() => fileRef.current?.click()}><Icon name="camera" /></button>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => onPhoto(e.target.files?.[0])} />
            {canPropose && pin.state.status !== 'complete' && <button className={`tool ${compact ? '' : 'lbl'}`} aria-label={record?.proposals.length ? 'Revise proposal' : 'New proposal'} title={record?.proposals.length ? 'Revise proposal' : 'New proposal'} onClick={() => openModal({ kind: 'proposal', revise: !!record?.proposals.length })}><Icon name="route" size={compact ? undefined : 'sm'} />{!compact && (record?.proposals.length ? 'Revise' : 'Proposal')}</button>}
            {canHold && <button className="tool" aria-label="Place hold" title="Place hold" onClick={() => openModal({ kind: 'hold' })}><Icon name="hold" /></button>}
            <textarea className="input" rows={1} value={text} placeholder={compact ? 'Message…' : `Message ${pin.number}…`} aria-label={`Message ${pin.number}`}
              onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
            <button className="send" aria-label="Send" onClick={send} disabled={!text.trim()}><Icon name="send" size="sm" /></button>
          </div>
        </div>
      )}
    </div>
  );
}
