import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { QRCodeSVG } from 'qrcode.react';
import { ROLE_INFO, type ProjectState, type Role, type Sheet } from '@pinthread/shared';
import { DrawingPicker, uploadDrawing, type PickedDrawing } from '../components/DrawingPicker';
import { Avatar, Modal, Spinner, useToast } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { guessSheet } from '../lib/drawing';
import { ago } from '../lib/format';
import { Icon } from '../lib/icons';
import { RolePicker, SheetFields } from '../pages/AppPages';

function ErrorLine({ e }: { e: string | null }) {
  return e ? <div className="form-error" role="alert"><Icon name="info" size="sm" />{e}</div> : null;
}

// ---------------------------------------------------------------- team & settings

export function TeamModal({ state, onClose, initialTab = 'people' }: { state: ProjectState; onClose: () => void; initialTab?: 'people' | 'settings' }) {
  const projectId = state.project.id;
  const qc = useQueryClient();
  const toast = useToast();
  const [, navigate] = useLocation();
  const [tab, setTab] = useState(initialTab);
  const team = useQuery({ queryKey: ['team', projectId], queryFn: () => api.team(projectId), refetchInterval: 15_000 });
  const [role, setRole] = useState<Role>('struct');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [shown, setShown] = useState<string | null>(null);
  const [name, setName] = useState(state.project.name);
  const [confirm, setConfirm] = useState('');
  const canManage = !!team.data?.canManage;

  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key); setErr(null);
    try { await fn(); if (ok) toast({ tone: 'ok', text: ok }); await qc.invalidateQueries({ queryKey: ['team', projectId] }); void qc.invalidateQueries({ queryKey: ['state', projectId] }); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'That did not work. Try again.'); }
    finally { setBusy(null); }
  };

  const invite = () => run('invite', async () => { const inv = await api.createInvite(projectId, role); setShown(inv.id); void navigator.clipboard?.writeText(inv.url).catch(() => {}); }, 'Invite link created and copied');
  const copy = (url: string) => { void navigator.clipboard?.writeText(url); toast({ tone: 'ok', text: 'Link copied' }); };
  const shownInvite = team.data?.invites.find(i => i.id === shown) ?? null;

  return (
    <Modal wide title={tab === 'people' ? 'Team' : 'Project settings'} sub={state.project.name} icon={<Icon name="users" size="lg" />} onClose={onClose}>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'people'} className={tab === 'people' ? 'on' : ''} onClick={() => setTab('people')}>People</button>
        <button role="tab" aria-selected={tab === 'settings'} className={tab === 'settings' ? 'on' : ''} onClick={() => setTab('settings')}>Settings</button>
      </div>
      {tab === 'people' && (
        <div className="team">
          {canManage && (
            <div className="invite-box">
              <b>Invite someone</b>
              <p className="small muted" style={{ margin: '2px 0 10px' }}>Anyone with the link can join with their own account in the role you choose. Links last 14 days and you can turn them off.</p>
              <RolePicker value={role} onChange={setRole} />
              <div className="row" style={{ marginTop: 10, gap: 8 }}>
                <button className="btn btn-ink" onClick={invite} disabled={busy === 'invite'}>{busy === 'invite' ? <Spinner /> : <Icon name="link" size="sm" />}Create invite link for {ROLE_INFO[role].title}</button>
              </div>
              {shownInvite && (
                <div className="invite-out">
                  <div className="qr sm"><QRCodeSVG value={shownInvite.url} size={112} marginSize={1} /></div>
                  <div className="col grow" style={{ gap: 6, minWidth: 0 }}>
                    <span className="small"><b>{ROLE_INFO[shownInvite.role].title}</b> invite · scan on a phone or send the link</span>
                    <code className="linkbox" title={shownInvite.url}>{shownInvite.url}</code>
                    <div className="row" style={{ gap: 6 }}><button className="btn btn-outline sm" onClick={() => copy(shownInvite.url)}><Icon name="link" size="sm" />Copy link</button><a className="btn btn-ghost sm" href={`mailto:?subject=${encodeURIComponent(`Join ${state.project.name} on PinThread`)}&body=${encodeURIComponent(`You're invited to ${state.project.name} on PinThread as ${ROLE_INFO[shownInvite.role].title}.\n\n${shownInvite.url}`)}`}>Email it</a></div>
                  </div>
                </div>
              )}
            </div>
          )}
          <ErrorLine e={err} />
          <div className="h-sec" style={{ margin: '16px 0 8px' }}>Members · {team.data?.members.length ?? '…'}</div>
          {team.isLoading && <div className="faint"><Spinner /> Loading…</div>}
          <div className="members">
            {team.data?.members.map(m => (
              <div className="member" key={m.userId}>
                <Avatar p={m} />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="row" style={{ gap: 6 }}><b className="ellipsis">{m.name}{m.isMe ? <span className="faint" style={{ fontWeight: 400 }}> (you)</span> : null}</b>{m.isAdmin && <span className="tag">Admin</span>}</div>
                  <div className="faint small ellipsis">{ROLE_INFO[m.role].title}{m.firm ? ` · ${m.firm}` : ''}{m.email ? ` · ${m.email}` : ''}</div>
                </div>
                <span className={`presence-dot ${m.connected ? 'on' : ''}`} title={m.connected ? 'Has connected' : 'Not connected yet'} />
                {canManage && !m.isMe && (
                  <span className="row" style={{ gap: 4 }}>
                    <button className="linkbtn" disabled={!!busy} onClick={() => void run(`admin:${m.userId}`, () => api.setAdmin(projectId, m.userId, !m.isAdmin), m.isAdmin ? `${m.name} is no longer an admin` : `${m.name} is now an admin`)}>{m.isAdmin ? 'Remove admin' : 'Make admin'}</button>
                    <button className="linkbtn danger" disabled={!!busy} onClick={() => {
                      if (!window.confirm(`Remove ${m.name} from ${state.project.name}? They lose access straight away. Open reviews waiting on them move to the other reviewers, or to you where nobody else is reviewing.`)) return;
                      void run(`rm:${m.userId}`, async () => { const r = await api.removeMember(projectId, m.userId); if (r.reassigned) toast({ tone: 'info', text: `${r.reassigned} open review${r.reassigned === 1 ? '' : 's'} reassigned.` }); }, `${m.name} removed`);
                    }}>Remove</button>
                  </span>
                )}
              </div>
            ))}
          </div>
          {canManage && !!team.data?.invites.length && (
            <>
              <div className="h-sec" style={{ margin: '18px 0 8px' }}>Active invite links</div>
              <div className="members">
                {team.data.invites.map(i => (
                  <div className="member" key={i.id}>
                    <span className={`av ${i.role} sm`}>{ROLE_INFO[i.role].label.slice(0, 2).toUpperCase()}</span>
                    <div className="grow" style={{ minWidth: 0 }}><b>{ROLE_INFO[i.role].title}</b><div className="faint small">Created {ago(i.createdAt)} ago by {i.createdBy} · used {i.uses}× · expires {new Date(i.expiresAt).toLocaleDateString([], { day: 'numeric', month: 'short' })}</div></div>
                    <button className="linkbtn" onClick={() => { setShown(i.id); copy(i.url); }}>Copy</button>
                    <button className="linkbtn danger" disabled={!!busy} onClick={() => void run(`rv:${i.id}`, () => api.revokeInvite(projectId, i.id), 'Invite link turned off')}>Turn off</button>
                  </div>
                ))}
              </div>
            </>
          )}
          {!canManage && <p className="small faint" style={{ marginTop: 14 }}>Ask a project admin to invite more people.</p>}
        </div>
      )}
      {tab === 'settings' && (
        <div className="form">
          {!canManage && <p className="muted">Only project admins can change these settings.</p>}
          <label className="field-l">Project name<input className="field" value={name} onChange={e => setName(e.target.value)} maxLength={80} disabled={!canManage} /></label>
          {canManage && <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn btn-ink" disabled={busy === 'rename' || name.trim() === state.project.name || name.trim().length < 2} onClick={() => void run('rename', () => api.renameProject(projectId, name.trim()), 'Project renamed')}>Save name</button></div>}
          {canManage && (
            <div className="danger-zone">
              <b>Delete this project</b>
              <p className="small muted" style={{ margin: '4px 0 10px' }}>Deletes every sheet, issue, decision and conversation for everyone on the project. This can't be undone. Export the register first if you need a record.</p>
              <label className="field-l">Type <b>{state.project.name}</b> to confirm<input className="field" value={confirm} onChange={e => setConfirm(e.target.value)} /></label>
              <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
                <button className="btn btn-danger" disabled={confirm.trim() !== state.project.name || busy === 'delete'} onClick={() => void run('delete', async () => { await api.deleteProject(projectId, confirm.trim()); void qc.invalidateQueries({ queryKey: ['projects'] }); navigate('/app', { replace: true }); }, 'Project deleted')}>{busy === 'delete' ? <Spinner /> : null}Delete project</button>
              </div>
            </div>
          )}
          <ErrorLine e={err} />
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------- sheets

export function SheetMenu({ state, current, onPick, onAdd, onRevise, canEdit }: {
  state: ProjectState; current: Sheet; onPick: (id: string) => void; onAdd: () => void; onRevise: () => void; canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  const sheets = state.project.sheets;
  const count = (id: string) => state.pins.filter(p => p.sheetId === id && p.state.status !== 'complete').length;
  const mine = (id: string) => state.pins.filter(p => p.sheetId === id && p.state.status !== 'complete' && p.state.waitingFor.some(w => w.userId === state.me.userId)).length;
  return (
    <div className="sheetmenu" ref={ref}>
      <button className="sheetbtn" onClick={() => setOpen(o => !o)} aria-haspopup="menu" aria-expanded={open}>
        <b className="mono">{current.number}</b><span className="sheetbtn-t">{current.title}</span><span className="revpill">Rev {current.revision}</span>
        {(sheets.length > 1 || canEdit) && <Icon name="chevdown" size="sm" />}
      </button>
      {open && (
        <div className="menu sheets" role="menu">
          <div className="menu-sec">Sheets · {sheets.length}</div>
          <div className="sheet-list">
            {sheets.map(s => (
              <button key={s.id} role="menuitemradio" aria-checked={s.id === current.id} className={s.id === current.id ? 'cur' : ''} onClick={() => { setOpen(false); onPick(s.id); }}>
                <span className="mono sheet-no">{s.number}</span><span className="grow ellipsis">{s.title}</span>
                {mine(s.id) > 0 && <span className="unread warn" title="Waiting on you">{mine(s.id)}</span>}
                <span className="faint small">{count(s.id)} open · Rev {s.revision}</span>
              </button>
            ))}
          </div>
          {canEdit && <>
            <div className="menu-sep" />
            <button role="menuitem" onClick={() => { setOpen(false); onRevise(); }}><Icon name="layers" size="sm" />Upload a new revision of {current.number}</button>
            <button role="menuitem" onClick={() => { setOpen(false); onAdd(); }}><Icon name="plus" size="sm" />Add a sheet</button>
          </>}
          {current.revisions.length > 1 && (
            <>
              <div className="menu-sep" />
              <div className="menu-sec">{current.number} history</div>
              {current.revisions.slice(0, 6).map((r, i) => <div key={i} className="rev-row"><span className="mono">Rev {r.revision}</span><span className="faint small grow">{r.by ?? 'Created'}</span><span className="faint small">{new Date(r.at).toLocaleDateString([], { day: 'numeric', month: 'short' })}</span></div>)}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function AddSheetModal({ projectId, onClose, onAdded }: { projectId: string; onClose: () => void; onAdded: (sheetId: string) => void }) {
  const qc = useQueryClient();
  const [drawing, setDrawing] = useState<PickedDrawing | null>(null);
  const [f, setF] = useState({ number: '', title: '', revision: 'A' });
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const touched = useRef(false);
  const go = async () => {
    if (!drawing) { setErr('Add the drawing file.'); return; }
    if (!f.number.trim() || !f.title.trim() || !f.revision.trim()) { setErr('Fill in the sheet number, title and revision.'); return; }
    setBusy(true); setErr(null);
    try {
      const files = await uploadDrawing(drawing, setProgress);
      const r = await api.addSheet(projectId, { number: f.number.trim(), title: f.title.trim(), revision: f.revision.trim(), ...files });
      await qc.invalidateQueries({ queryKey: ['state', projectId] });
      onAdded(r.sheetId);
    } catch (e) { setErr(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Could not add the sheet.'); setBusy(false); }
  };
  return (
    <Modal title="Add a sheet" sub="PDF, PNG or JPG. Everyone on the project sees it straight away." icon={<Icon name="file" size="lg" />} onClose={onClose}
      footer={<>{busy && <span className="faint small grow">Uploading… {Math.round(progress * 100)}%</span>}<span className="grow" /><button className="btn btn-ghost lg" onClick={onClose}>Cancel</button><button className="btn btn-ink lg" onClick={go} disabled={busy || !drawing}>{busy ? <><Spinner />Adding…</> : 'Add sheet'}</button></>}>
      <div className="form">
        <DrawingPicker onChange={setDrawing} onFile={n => { if (touched.current) return; const g = guessSheet(n); setF(s => ({ ...s, number: g.number || s.number, title: g.title || s.title })); }} />
        {drawing && <SheetFields {...f} set={(k, v) => { touched.current = true; setF(s => ({ ...s, [k]: v })); }} />}
        <ErrorLine e={err} />
      </div>
    </Modal>
  );
}

const nextRev = (r: string) => (/^[A-Y]$/i.test(r) ? String.fromCharCode(r.toUpperCase().charCodeAt(0) + 1) : /\d+$/.test(r) ? r.replace(/\d+$/, d => String(Number(d) + 1).padStart(d.length, '0')) : '');

export function RevisionModal({ state, sheet, onClose }: { state: ProjectState; sheet: Sheet; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [drawing, setDrawing] = useState<PickedDrawing | null>(null);
  const [rev, setRev] = useState(nextRev(sheet.revision));
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const onSheet = state.pins.filter(p => p.sheetId === sheet.id);
  const approved = onSheet.filter(p => p.approvedBy.length > 0).length;
  const go = async () => {
    if (!drawing) { setErr('Add the new drawing file.'); return; }
    if (!rev.trim()) { setErr('Enter the new revision label.'); return; }
    setBusy(true); setErr(null);
    try {
      const files = await uploadDrawing(drawing, setProgress);
      const r = await api.newRevision(sheet.id, { revision: rev.trim(), ...files });
      await qc.invalidateQueries({ queryKey: ['state', state.project.id] });
      void qc.invalidateQueries({ queryKey: ['pin'] });
      toast({ tone: 'ok', text: <><b>{sheet.number} is now Rev {rev.trim()}.</b> {r.affected ? `${r.affected} issue${r.affected === 1 ? '' : 's'} went back to review.` : 'No reviews were affected.'}</> });
      onClose();
    } catch (e) { setErr(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Could not upload the revision.'); setBusy(false); }
  };
  return (
    <Modal title={`New revision of ${sheet.number}`} sub={`${sheet.title} · currently Rev ${sheet.revision}`} icon={<Icon name="layers" size="lg" />} onClose={onClose}
      footer={<>{busy && <span className="faint small grow">Uploading… {Math.round(progress * 100)}%</span>}<span className="grow" /><button className="btn btn-ghost lg" onClick={onClose}>Cancel</button><button className="btn btn-ink lg" onClick={go} disabled={busy || !drawing}>{busy ? <><Spinner />Publishing…</> : `Publish Rev ${rev || '…'}`}</button></>}>
      <div className="form">
        <DrawingPicker onChange={setDrawing} />
        <label className="field-l">New revision<input className="field mono" value={rev} onChange={e => setRev(e.target.value)} maxLength={8} placeholder="e.g. C" style={{ maxWidth: 160 }} /></label>
        {approved > 0 && <div className="note warn"><Icon name="info" size="sm" /><span>Approvals are tied to the revision they were given on. <b>{approved} issue{approved === 1 ? '' : 's'}</b> on this sheet will go back to review, and their reviewers get a Jump to pin alert to check the new revision.</span></div>}
        <p className="small faint" style={{ margin: 0 }}>Pins stay where they are. If the new revision changes the layout a lot, check that each pin still points at the right spot.</p>
        <ErrorLine e={err} />
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- first steps for a new project

export function GettingStarted({ state, onInvite, onNewIssue, onAddSheet, onClose }: { state: ProjectState; onInvite: () => void; onNewIssue: () => void; onAddSheet: () => void; onClose: () => void }) {
  const steps: [boolean, string, string, () => void][] = [
    [state.project.sheets.length > 0, 'Upload a drawing', 'Add sheet', onAddSheet],
    [state.members.length > 1, 'Invite a reviewer', 'Invite', onInvite],
    [state.pins.length > 0, 'Pin your first question', 'New issue', onNewIssue],
  ];
  const now = steps.findIndex(s => !s[0]);
  if (now === -1) return null;
  return (
    <div className="tracker">
      <div className="row"><span className="h-sec">Get started · {steps.filter(s => s[0]).length} of {steps.length}</span><span className="grow" /><button className="tool sm" onClick={onClose} aria-label="Dismiss"><Icon name="x" size="sm" /></button></div>
      <div className="progress" style={{ marginTop: 8 }}><i style={{ width: `${(steps.filter(s => s[0]).length / steps.length) * 100}%` }} /></div>
      <div className="steps">{steps.map(([done, label], i) => <div key={label} className={`step ${done ? 'done' : i === now ? 'now' : ''}`}><span className="n">{done ? <Icon name="check" size="sm" /> : i + 1}</span>{label}</div>)}</div>
      <button className="btn btn-ink block" style={{ marginTop: 12 }} onClick={steps[now][3]}>{steps[now][2]}</button>
    </div>
  );
}

