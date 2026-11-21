import { useMemo, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { ROLE_INFO, gridRef, type Hold, type Person, type PinRecord, type Point, type ProjectState, type Role, type SessionResponse, type Sheet } from '@pinthread/shared';
import { Avatar, Modal, Spinner, useToast } from '../components/ui';
import { RedlineEditor } from '../drawing/Crop';
import { ApiError, api } from '../lib/api';
import { compressImage } from '../lib/format';
import { Icon } from '../lib/icons';

function ErrorLine({ e }: { e: string | null }) {
  return e ? <div className="form-error" role="alert"><Icon name="info" size="sm" />{e}</div> : null;
}

export function ProposalModal({ record, sheet, me, revise, onClose, onPosted }: { record: PinRecord; sheet: Sheet; me: Person; revise: boolean; onClose: () => void; onPosted: (r: PinRecord) => void }) {
  const cur = record.proposals.find(p => p.current) ?? null;
  const latest = record.proposals.at(-1);
  const isReviewer = record.reviewers.some(r => r.userId === me.userId);
  const [route, setRoute] = useState<Point[]>(revise && cur?.route ? cur.route : []);
  const [summary, setSummary] = useState(revise && cur ? cur.summary : '');
  const [cost, setCost] = useState(revise && cur?.costImpact ? cur.costImpact : '');
  const [schedule, setSchedule] = useState(revise && cur?.scheduleImpact ? cur.scheduleImpact : 'None');
  const [approveOwn, setApproveOwn] = useState(isReviewer);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const version = (latest?.version ?? 0) + 1;
  const others = record.reviewers.filter(r => r.userId !== me.userId);

  const submit = async () => {
    if (summary.trim().length < 3) { setErr('Describe the fix in a sentence.'); return; }
    setBusy(true); setErr(null);
    try {
      const r = await api.propose(record.id, { summary: summary.trim(), route: route.length > 1 ? route : null, costImpact: cost.trim() || null, scheduleImpact: schedule || null, approveOwn: approveOwn && isReviewer, basedOnVersion: latest?.version ?? 0 });
      onPosted(r);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not post the proposal. Try again.');
      setBusy(false);
    }
  };

  return (
    <Modal wide title={`${revise ? 'Revise' : 'New'} proposal for ${record.number}`} sub={`${record.title} · ${sheet.number} Rev ${sheet.revision} · Grid ${record.gridRef}`}
      icon={<span style={{ color: 'var(--redline)' }}><Icon name="route" size="lg" /></span>} onClose={onClose}
      footer={<>
        <span className="faint small grow">Route drawn on <span className="mono">{sheet.number} Rev {sheet.revision}</span>. A later edit creates v{version + 1} and asks everyone to approve again.</span>
        <button className="btn btn-ghost lg" onClick={onClose}>Cancel</button>
        <button className="btn btn-ink lg" onClick={submit} disabled={busy}>{busy ? <><Spinner />Posting…</> : `Post proposal v${version}`}</button>
      </>}>
      <div className="split">
        <RedlineEditor at={[record.x, record.y]} route={route} onChange={setRoute} ghost={revise ? null : cur?.route ?? null} />
        <div className="form">
          <label className="field-l">What is the fix?
            <textarea className="field" rows={4} maxLength={280} value={summary} onChange={e => setSummary(e.target.value)} placeholder="e.g. Drop SD-3 150 mm and cross B-14 through web opening WO-2." autoFocus />
            <span className="hint">{280 - summary.length} characters left. Shown on the card and in the register.</span>
          </label>
          <label className="field-l">Cost impact<input className="field" maxLength={80} value={cost} onChange={e => setCost(e.target.value)} placeholder="+$1,200 est. (2 fittings)" /></label>
          <div className="field-l">Schedule impact
            <div className="seg2" role="radiogroup">{['None', '< 1 day', '1–3 days', '> 3 days'].map(s => <button type="button" key={s} role="radio" aria-checked={schedule === s} className={schedule === s ? 'on' : ''} onClick={() => setSchedule(s)}>{s}</button>)}</div>
          </div>
          <div className="field-l">Needs approval from
            <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>{record.reviewers.map(r => <span key={r.userId} className={`appr ${r.userId === me.userId && approveOwn ? 'ok' : 'wait'}`}><Avatar p={r} mark={r.userId === me.userId && approveOwn ? 'ok' : 'wait'} size="sm" />{ROLE_INFO[r.role].label}{r.userId === me.userId ? ' · you' : ` · ${r.name}`}</span>)}</div>
          </div>
          {isReviewer && (
            <label className="check"><input type="checkbox" checked={approveOwn} onChange={e => setApproveOwn(e.target.checked)} /><span>Approve for <b>{ROLE_INFO[me.role].label}</b> when I post</span></label>
          )}
          {others.length > 0 && <div className="note"><Icon name="info" size="sm" /><span>{others.map(o => o.name).join(' and ')} {others.length > 1 ? 'get' : 'gets'} a <b>Jump to pin</b> alert and {others.length > 1 ? 'see' : 'sees'} this route on Rev {sheet.revision}.</span></div>}
          <ErrorLine e={err} />
        </div>
      </div>
    </Modal>
  );
}

const DISCIPLINES = [['mep', 'MEP'], ['struct', 'Structural'], ['arch', 'Architecture'], ['elec', 'Electrical']] as const;
const DEFAULT_REVIEWERS: Record<string, Role[]> = { mep: ['mep', 'struct'], struct: ['struct', 'arch'], arch: ['arch', 'struct'], elec: ['mep', 'arch'] };

export function RaiseIssueModal({ point, sheet, state, onClose, onCreated, onInvite }: { point: Point; sheet: Sheet; state: ProjectState; onClose: () => void; onCreated: (r: PinRecord) => void; onInvite?: () => void }) {
  const [title, setTitle] = useState('');
  const [question, setQuestion] = useState('');
  const [discipline, setDiscipline] = useState<string>('mep');
  const [severity, setSeverity] = useState('medium');
  const vector = sheet.source === 'vector';
  const [location, setLocation] = useState('');
  const team = state.project.kind === 'team';
  // Team projects can be small: you may be one of the reviewers yourself.
  const candidates = team ? [...state.members].sort((a, b) => Number(a.userId === state.me.userId) - Number(b.userId === state.me.userId)) : state.members.filter(m => m.userId !== state.me.userId);
  const [reviewers, setReviewers] = useState<string[]>(() => candidates.filter(m => DEFAULT_REVIEWERS.mep.includes(m.role)).map(m => m.userId));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const grid = vector ? gridRef(point) : location.trim();

  const pickDiscipline = (d: string) => { setDiscipline(d); setReviewers(candidates.filter(m => DEFAULT_REVIEWERS[d].includes(m.role)).map(m => m.userId)); };
  const submit = async () => {
    if (title.trim().length < 3 || question.trim().length < 3) { setErr('Add a short title and the question you need answered.'); return; }
    if (!reviewers.length) { setErr('Choose at least one reviewer.'); return; }
    setBusy(true); setErr(null);
    try { onCreated(await api.createPin(state.project.id, { sheetId: sheet.id, gridRef: vector ? null : location.trim() || null, x: point[0], y: point[1], title: title.trim(), question: question.trim(), discipline, severity, reviewerIds: reviewers })); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not raise the issue.'); setBusy(false); }
  };

  return (
    <Modal title="Raise an issue" sub={`${sheet.number} Rev ${sheet.revision}${grid ? ` · Grid ${grid}` : ''}`} icon={<Icon name="pin" size="lg" />} onClose={onClose}
      footer={<><span className="grow" /><button className="btn btn-ghost lg" onClick={onClose}>Cancel</button><button className="btn btn-ink lg" disabled={busy} onClick={submit}>{busy ? <><Spinner />Raising…</> : 'Raise issue'}</button></>}>
      <div className="form">
        <label className="field-l">Title<input className="field" maxLength={90} value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Sprinkler main clashes with cable tray" autoFocus /></label>
        <label className="field-l">Question<textarea className="field" rows={3} maxLength={600} value={question} onChange={e => setQuestion(e.target.value)} placeholder="What do you need the reviewers to decide?" /></label>
        {!vector && <label className="field-l"><span>Grid or location <span className="faint">(optional)</span></span><input className="field mono" maxLength={24} value={location} onChange={e => setLocation(e.target.value)} placeholder="e.g. C–D/4" /></label>}
        <div className="field-l">Discipline<div className="seg2">{DISCIPLINES.map(([k, l]) => <button type="button" key={k} className={discipline === k ? 'on' : ''} onClick={() => pickDiscipline(k)}>{l}</button>)}</div></div>
        <div className="field-l">Severity<div className="seg2" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>{['low', 'medium', 'high'].map(s => <button type="button" key={s} className={severity === s ? 'on' : ''} onClick={() => setSeverity(s)}>{s[0].toUpperCase() + s.slice(1)}</button>)}</div></div>
        <div className="field-l">Reviewers
          <div className="pickers">{candidates.map(m => (
            <label key={m.userId} className={`picker ${reviewers.includes(m.userId) ? 'on' : ''}`}>
              <input type="checkbox" checked={reviewers.includes(m.userId)} onChange={e => setReviewers(r => (e.target.checked ? [...r, m.userId] : r.filter(x => x !== m.userId)))} />
              <Avatar p={m} size="sm" /><span><b>{m.name}</b>{m.userId === state.me.userId && <span className="faint"> (you)</span>}<span className="faint"> · {ROLE_INFO[m.role].title}</span></span>
            </label>
          ))}</div>
          {onInvite && state.members.length < 3 && <span className="hint">Reviewer not on the project yet? <button type="button" className="linkbtn" onClick={onInvite}>Invite them</button> and add them when they join.</span>}
        </div>
        <ErrorLine e={err} />
      </div>
    </Modal>
  );
}

export function TextPromptModal({ title, sub, label, placeholder, cta, danger, minLength = 3, onClose, onSubmit, second }: {
  title: string; sub?: string; label: string; placeholder: string; cta: string; danger?: boolean; minLength?: number;
  onClose: () => void; onSubmit: (v: string, v2?: string) => Promise<void>; second?: { label: string; placeholder: string };
}) {
  const [v, setV] = useState('');
  const [v2, setV2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    if (v.trim().length < minLength || (second && v2.trim().length < 3)) { setErr('Please fill in both fields.'); return; }
    setBusy(true); setErr(null);
    try { await onSubmit(v.trim(), v2.trim()); } catch (e) { setErr(e instanceof ApiError ? e.message : 'That did not work. Try again.'); setBusy(false); }
  };
  return (
    <Modal title={title} sub={sub} onClose={onClose} footer={<><span className="grow" /><button className="btn btn-ghost lg" onClick={onClose}>Cancel</button><button className={`btn ${danger ? 'btn-danger' : 'btn-ink'} lg`} disabled={busy} onClick={go}>{busy ? <><Spinner />Saving…</> : cta}</button></>}>
      <div className="form">
        <label className="field-l">{label}<textarea className="field" rows={3} maxLength={300} value={v} onChange={e => setV(e.target.value)} placeholder={placeholder} autoFocus /></label>
        {second && <label className="field-l">{second.label}<input className="field" maxLength={200} value={v2} onChange={e => setV2(e.target.value)} placeholder={second.placeholder} /></label>}
        <ErrorLine e={err} />
      </div>
    </Modal>
  );
}

export function EvidenceModal({ hold, pinNumber, onClose, upload, onDone }: { hold: Hold; pinNumber: string; onClose: () => void; upload: (f: File) => Promise<{ imageUrl: string; id: string }>; onDone: (url: string, caption: string, messageId: string) => Promise<void> }) {
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  const go = async () => {
    if (!file || caption.trim().length < 2) { setErr('Add a photo and a short caption.'); return; }
    setBusy(true); setErr(null);
    try {
      const sent = await upload(await compressImage(file));
      await onDone(sent.imageUrl, caption.trim(), sent.id);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Upload failed.'); setBusy(false); }
  };
  return (
    <Modal title="Add corrective evidence" sub={`${pinNumber} · to clear: ${hold.clearCondition}`} icon={<Icon name="camera" size="lg" />} onClose={onClose}
      footer={<><span className="grow" /><button className="btn btn-ghost lg" onClick={onClose}>Cancel</button><button className="btn btn-ink lg" disabled={busy} onClick={go}>{busy ? <><Spinner />Uploading…</> : 'Post evidence'}</button></>}>
      <div className="form">
        <label className="dropzone">
          {preview ? <img src={preview} alt="Selected evidence" /> : <span><Icon name="camera" size="lg" /><br />Take or choose a photo</span>}
          <input type="file" accept="image/*" capture="environment" onChange={e => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <label className="field-l">Caption<input className="field" maxLength={200} value={caption} onChange={e => setCaption(e.target.value)} placeholder="e.g. Core test results: 42 MPa, report attached" /></label>
        <ErrorLine e={err} />
      </div>
    </Modal>
  );
}

export function InviteModal({ session, state, onClose }: { session: SessionResponse; state: ProjectState; onClose: () => void }) {
  const roles = Object.keys(session.joinLinks) as Role[];
  const [role, setRole] = useState<Role>(roles.includes('struct') ? 'struct' : roles[0]);
  const toast = useToast();
  const link = session.joinLinks[role]!;
  const person = state.members.find(m => m.role === role);
  return (
    <Modal title="Bring in another reviewer" sub="Each role is a separate Nexconn user. Open it on a phone or in another tab." icon={<Icon name="qr" size="lg" />} onClose={onClose}>
      <div className="invite">
        <div className="qr"><QRCodeSVG value={link} size={208} marginSize={2} /></div>
        <div className="col" style={{ gap: 12, minWidth: 0 }}>
          <div className="seg2" style={{ gridTemplateColumns: `repeat(${roles.length},1fr)` }}>{roles.map(r => <button key={r} className={r === role ? 'on' : ''} onClick={() => setRole(r)}>{ROLE_INFO[r].label}</button>)}</div>
          <div className="row" style={{ gap: 10 }}><Avatar p={person} size="lg" /><div><b>{person?.name}</b><div className="faint small">{ROLE_INFO[role].title}{person?.firm ? ` · ${person.firm}` : ''}</div></div></div>
          <p className="small muted" style={{ margin: 0 }}>Scan with your phone to act as {person?.name}. You'll land on {role === 'struct' ? 'the beam clash, ready to review' : 'the project'}.</p>
          <div className={`presence ${person?.connected ? 'on' : ''}`}>{person?.connected ? <><Icon name="check" size="sm" />{person.name.split(' ')[0]} is connected</> : <><Spinner />Waiting for {person?.name.split(' ')[0]} to connect…</>}</div>
          <div className="row wrap" style={{ gap: 8 }}>
            <button className="btn btn-outline" onClick={() => { void navigator.clipboard?.writeText(link); toast({ text: 'Link copied', tone: 'ok' }); }}><Icon name="link" size="sm" />Copy link</button>
            <a className="btn btn-outline" href={link} target="_blank" rel="noreferrer"><Icon name="chevron" size="sm" />Open in new tab</a>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export function KickedModal({ name, onUseHere, onLeave }: { name: string; onUseHere: () => void; onLeave: () => void }) {
  return (
    <Modal title={`${name}'s role is open on another device`} onClose={onLeave} footer={<><span className="grow" /><button className="btn btn-ghost lg" onClick={onLeave}>Leave</button><button className="btn btn-ink lg" onClick={onUseHere}>Use it here</button></>}>
      <p className="muted" style={{ margin: 0 }}>Only one device per role stays connected to Nexconn. Use it here to reconnect this tab.</p>
    </Modal>
  );
}
