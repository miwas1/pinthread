import { BOT_USER_ID, MT, ROLE_INFO, type Hold, type Person, type PinRecord } from '@pinthread/shared';
import type { ChatMessage, Quote } from '../chat/types';
import { Avatar } from '../components/ui';
import { Crop } from '../drawing/Crop';
import { clock } from '../lib/format';
import { Icon } from '../lib/icons';

export interface ThreadCtx {
  record: PinRecord;
  people: Map<string, Person>;
  meId: string;
  onReply: (q: Quote) => void;
  onRevise: () => void;
  onEvidence: (h: Hold) => void;
  onClearHold: (h: Hold) => void;
  onRegister: () => void;
  onRetry: (m: ChatMessage) => void;
}

const nameOf = (ctx: ThreadCtx, id: string) => (id === BOT_USER_ID ? 'PinThread' : ctx.people.get(id)?.name ?? 'Someone');

/** Domain key so a card that arrives twice (retry, echo) renders once. */
export function domainKey(m: ChatMessage): string {
  const c = m.content ?? {};
  switch (m.type) {
    case MT.proposal: return `p:${c.proposalId}`;
    case MT.decision: return `d:${c.decisionId}`;
    case MT.signoff: return `s:${c.signoffId}:${c.verdict}:${c.seq}`;
    case MT.hold: return `h:${c.holdId}:${c.action}:${c.note ?? ''}`;
    case MT.brief: return `b:${c.pinId}`;
    default: return `m:${m.id}`;
  }
}

function Sys({ icon, children, tone }: { icon?: React.ReactNode; children: React.ReactNode; tone?: 'ok' | 'warn' | 'bad' }) {
  return <div className={`sys ${tone ?? ''}`}><span className="line" />{icon}<span>{children}</span><span className="line" /></div>;
}

function Bubble({ m, ctx }: { m: ChatMessage; ctx: ThreadCtx }) {
  const mine = m.senderId === ctx.meId || m.senderId === '__me';
  const sender = ctx.people.get(m.senderId);
  const text: string = m.content?.text ?? '';
  return (
    <div className={`msg ${mine ? 'mine' : ''}`}>
      {!mine && <Avatar p={sender} />}
      <div className="body">
        <div className="meta">{mine ? <><span>{m.pending ? 'Sending…' : clock(m.sentAt)}</span><b>You</b></> : <><b>{nameOf(ctx, m.senderId)}</b><span>{clock(m.sentAt)}</span></>}</div>
        <div className={`bubble ${m.failed ? 'failed' : ''}`}>
          {m.metadata?.q_text && <span className="quote">{m.metadata.q_name ? `${m.metadata.q_name}: ` : ''}{m.metadata.q_text}</span>}
          {text}
        </div>
        {m.failed && <button className="linkbtn danger" onClick={() => ctx.onRetry(m)}>Not sent. Tap to retry</button>}
        {!mine && !m.pending && <button className="linkbtn reply" onClick={() => ctx.onReply({ messageId: m.id, name: sender?.name ?? '', text })}><Icon name="reply" size="sm" />Reply</button>}
      </div>
    </div>
  );
}

function Photo({ m, ctx }: { m: ChatMessage; ctx: ThreadCtx }) {
  const mine = m.senderId === ctx.meId;
  const src = m.content?.remoteUrl || (m.content?.thumbnailBase64 ? `data:image/jpeg;base64,${m.content.thumbnailBase64}` : '');
  return (
    <div className={`msg ${mine ? 'mine' : ''}`}>
      {!mine && <Avatar p={ctx.people.get(m.senderId)} />}
      <div className="body">
        <div className="meta">{mine ? <><span>{clock(m.sentAt)}</span><b>You</b></> : <><b>{nameOf(ctx, m.senderId)}</b><span>{clock(m.sentAt)}</span></>}</div>
        <a className="photo-msg" href={m.content?.remoteUrl || undefined} target="_blank" rel="noreferrer">
          {src ? <img src={src} alt="Field photo" loading="lazy" /> : <span className="faint">Photo</span>}
        </a>
      </div>
    </div>
  );
}

function ProposalCard({ m, ctx }: { m: ChatMessage; ctx: ThreadCtx }) {
  const c = m.content;
  const rec = ctx.record;
  const p = rec.proposals.find(x => x.id === c.proposalId);
  const version = p?.version ?? c.version;
  const current = p?.current ?? false;
  const prev = rec.proposals.find(x => x.version === version - 1);
  const latest = rec.proposals.at(-1);
  const signoffs = rec.signoffs.filter(s => s.proposalId === c.proposalId && s.verdict !== 'withdrawn');
  const accepted = current && rec.state.status === 'complete';
  const mine = (p?.author.userId ?? c.author?.userId) === ctx.meId;
  const canRevise = current && (mine || rec.reviewers.some(r => r.userId === ctx.meId) || ctx.people.get(ctx.meId)?.role === 'site') && rec.state.status !== 'complete';
  return (
    <div className={`msg ${mine ? 'mine' : ''}`}>
      {!mine && <Avatar p={ctx.people.get(m.senderId)} />}
      <div className="body">
        <div className="meta">{mine ? <><span>{clock(m.sentAt)}</span><b>You</b></> : <><b>{nameOf(ctx, m.senderId)}</b><span>{clock(m.sentAt)}</span></>}</div>
        <div className={`card proposal ${current ? '' : 'superseded'}`}>
          <div className="ch">
            <span className={`tag ver ${current ? '' : 'old'}`}>v{version}</span><b>Proposal</b>
            <span className="faint small">{current ? `Rev ${p?.revision ?? c.revision} · ${accepted ? 'accepted' : 'current'}` : `Superseded by v${latest?.version}`}</span>
            <span className="grow" /><span style={{ color: 'var(--redline)' }}><Icon name="route" size="sm" /></span>
          </div>
          <div className="cb">
            {(p?.route ?? c.route) && <Crop at={[rec.x, rec.y]} status={rec.state.status} route={p?.route ?? c.route} ghost={prev?.route ?? null} width={210} />}
            <p className="psum">{p?.summary ?? c.summary}</p>
            {(p?.costImpact || p?.scheduleImpact) && (
              <dl className="kv">{p?.costImpact && <><dt>Cost</dt><dd>{p.costImpact}</dd></>}{p?.scheduleImpact && <><dt>Schedule</dt><dd>{p.scheduleImpact}</dd></>}</dl>
            )}
          </div>
          <div className="cf">
            {rec.reviewers.map(r => {
              const s = signoffs.find(x => x.reviewer.userId === r.userId);
              if (s?.verdict === 'approve') return <span key={r.userId} className="appr ok"><Avatar p={r} mark="ok" size="sm" />{ROLE_INFO[r.role].label} {clock(s.at)}</span>;
              if (s?.verdict === 'request_change') return <span key={r.userId} className="appr wait">{<Avatar p={r} mark="wait" size="sm" />}Change requested</span>;
              return current ? <span key={r.userId} className="appr wait"><Avatar p={r} mark="wait" size="sm" />{r.userId === ctx.meId ? 'You' : `${ROLE_INFO[r.role].label} waiting`}</span> : null;
            })}
            <span className="grow" />
            {current && <button className="linkbtn" onClick={() => ctx.onReply({ messageId: m.id, name: `Proposal v${version}`, text: (p?.summary ?? c.summary).slice(0, 120) })}><Icon name="reply" size="sm" />Ask</button>}
            {canRevise && <button className="linkbtn" onClick={ctx.onRevise}><Icon name="route" size="sm" />Revise as v{(latest?.version ?? version) + 1}</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

function HoldCard({ m, ctx }: { m: ChatMessage; ctx: ThreadCtx }) {
  const c = m.content;
  const hold = ctx.record.holds.find(h => h.id === c.holdId);
  const me = ctx.people.get(ctx.meId);
  if (c.action === 'evidence_added') return <Sys icon={<Icon name="camera" size="sm" />}><b>{c.actor.name}</b> posted corrective evidence{c.note ? `: ${c.note}` : ''}</Sys>;
  if (c.action === 'cleared') return <Sys tone="ok" icon={<Icon name="check" size="sm" />}><b>{c.actor.name}</b> cleared the hold{c.note ? `: “${c.note}”` : ''}</Sys>;
  const active = hold?.status === 'active';
  const evidenceIn = (hold?.evidence.length ?? 0) > 0;
  const canEvidence = active && (me?.role === 'site' || ctx.record.memberIds.includes(ctx.meId)) && hold?.placedBy.userId !== ctx.meId;
  const canClear = active && !!me && (hold?.placedBy.userId === ctx.meId || hold?.placedBy.role === me.role);
  return (
    <div className="card hold full">
      <div className="ch"><Icon name="hold" size="sm" /><b>Hold · {ROLE_INFO[c.actor.role as keyof typeof ROLE_INFO]?.label ?? ''}</b><span className="faint small">{c.actor.name} · {clock(m.sentAt)}</span>{!active && <span className="tag" style={{ marginLeft: 'auto' }}>Cleared</span>}</div>
      <div className="cb small">
        {c.reason}
        <dl className="kv"><dt>To clear</dt><dd>{c.clearCondition}</dd></dl>
        {hold?.evidence.map(e => <a key={e.id} className="evidence" href={e.imageUrl} target="_blank" rel="noreferrer"><img src={e.imageUrl} alt="" /><span>{e.caption}<br /><span className="faint">{e.author.name} · {clock(e.at)}</span></span></a>)}
      </div>
      {active && (
        <div className="cf">
          <span className="faint small grow">{evidenceIn ? `Evidence posted · awaiting ${hold?.placedBy.name}` : 'Waiting for corrective evidence'}</span>
          {canEvidence && <button className="btn btn-outline sm" onClick={() => hold && ctx.onEvidence(hold)}><Icon name="camera" size="sm" />Add evidence</button>}
          {canClear && <button className="btn btn-outline sm" onClick={() => hold && ctx.onClearHold(hold)}><Icon name="check" size="sm" />Clear hold</button>}
        </div>
      )}
    </div>
  );
}

function DecisionCard({ m, ctx }: { m: ChatMessage; ctx: ThreadCtx }) {
  const c = m.content;
  if (c.status === 'blocked') return <Sys tone="bad" icon={<Icon name="hold" size="sm" />}>{c.label}</Sys>;
  if (c.status !== 'complete') return <Sys icon={<Icon name="info" size="sm" />}>{c.label}</Sys>;
  return (
    <div className="card decision full">
      <div className="ch"><span className="okdot"><Icon name="check" size="sm" /></span><b>Review complete</b><span className="grow" /><span className="ref" style={{ color: 'var(--complete-text)' }}>{clock(m.sentAt)}</span></div>
      <div className="cb small">
        <div className="muted" style={{ paddingBottom: 4 }}>{c.approvals.length} of {c.approvals.length} required approvals on <b style={{ color: 'var(--text)' }}>Proposal v{c.version}</b> · <span className="mono">Rev {c.revision}</span></div>
        {c.approvals.map((a: { name: string; role: string; at: string }) => {
          const p = [...ctx.people.values()].find(x => x.name === a.name);
          return <div key={a.name} className="ap"><Avatar p={p} mark="ok" /><div className="grow"><b>{a.name}{p?.userId === ctx.meId ? <span className="faint" style={{ fontWeight: 400 }}> (you)</span> : null}</b><div className="faint">{ROLE_INFO[a.role as keyof typeof ROLE_INFO]?.title}{p?.firm ? ` · ${p.firm}` : ''}</div></div><span className="ref">{clock(a.at)}</span></div>;
        })}
      </div>
      <div className="cf"><Icon name="hash" size="sm" /><span className="ref">Record {c.recordHash}</span><span className="grow" /><button className="btn btn-outline sm" onClick={ctx.onRegister}><Icon name="file" size="sm" />Register</button></div>
    </div>
  );
}

function SignoffRow({ m }: { m: ChatMessage }) {
  const c = m.content;
  if (c.verdict === 'approve') return <Sys tone="ok" icon={<Icon name="check" size="sm" />}><b>{c.reviewer.name}</b> approved v{c.version} for {ROLE_INFO[c.reviewer.role as keyof typeof ROLE_INFO]?.label} · {clock(m.sentAt)}</Sys>;
  return (
    <div className="card change full">
      <div className="ch"><Icon name="reply" size="sm" /><b>Change requested · {ROLE_INFO[c.reviewer.role as keyof typeof ROLE_INFO]?.label}</b><span className="faint small">{c.reviewer.name} · v{c.version}</span></div>
      <div className="cb small">{c.comment}</div>
    </div>
  );
}

export function ThreadItem({ m, ctx }: { m: ChatMessage; ctx: ThreadCtx }) {
  if (m.type.startsWith('pt:') && [MT.brief, MT.decision, MT.jump, MT.pinstate].includes(m.type as never) && m.senderId !== BOT_USER_ID) return null;
  switch (m.type) {
    case 'RC:TxtMsg': return <Bubble m={m} ctx={ctx} />;
    case 'RC:ImgMsg': return <Photo m={m} ctx={ctx} />;
    case MT.brief: return <Sys icon={<Icon name="pin" size="sm" />}><b>{m.content.raisedBy?.name}</b> raised {m.content.number} · needs {m.content.reviewers?.map((r: { role: keyof typeof ROLE_INFO }) => ROLE_INFO[r.role].label).join(' and ')}</Sys>;
    case MT.proposal: return <ProposalCard m={m} ctx={ctx} />;
    case MT.signoff: return <SignoffRow m={m} />;
    case MT.hold: return <HoldCard m={m} ctx={ctx} />;
    case MT.decision: return <DecisionCard m={m} ctx={ctx} />;
    case MT.pinstate: case MT.jump: return null;
    default: return <Sys>Unsupported message</Sys>;
  }
}
