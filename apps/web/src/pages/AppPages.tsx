import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'wouter';
import { ROLES, ROLE_INFO, type Account, type ProjectListItem, type Role } from '@pinthread/shared';
import { DrawingPicker, uploadDrawing, type PickedDrawing } from '../components/DrawingPicker';
import { Avatar, Spinner } from '../components/ui';
import { useLogout, useSetAccount } from '../lib/account';
import { ApiError, api } from '../lib/api';
import { guessSheet } from '../lib/drawing';
import { ago } from '../lib/format';
import { Icon, Logo } from '../lib/icons';

const asPerson = (a: Account, role: Role = 'site') => ({ initials: a.initials, name: a.name, role });

function AccountMenu({ account }: { account: Account }) {
  const [open, setOpen] = useState(false);
  const logout = useLogout();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div className="me" style={{ position: 'relative' }} ref={ref}>
      <button className="avbtn" onClick={() => setOpen(o => !o)} aria-haspopup="menu" aria-expanded={open}>
        <span className="av acct">{account.initials}</span>
        <div className="who hide-sm"><b>{account.name}</b><span>{account.email}</span></div><Icon name="chevdown" size="sm" />
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="menu-h"><span className="av acct">{account.initials}</span><div style={{ minWidth: 0 }}><b>{account.name}</b><div className="faint small ellipsis">{account.email}</div></div></div>
          <div className="menu-sep" />
          <Link href="/app" className="menu-a" role="menuitem" onClick={() => setOpen(false)}><Icon name="layers" size="sm" />Projects</Link>
          <Link href="/app/account" className="menu-a" role="menuitem" onClick={() => setOpen(false)}><Icon name="users" size="sm" />Account settings</Link>
          <Link href="/demo" className="menu-a" role="menuitem" onClick={() => setOpen(false)}><Icon name="phone" size="sm" />Live demo</Link>
          <div className="menu-sep" />
          <button role="menuitem" onClick={() => void logout()}><Icon name="logout" size="sm" />Log out</button>
        </div>
      )}
    </div>
  );
}

export function AppShell({ account, children, title }: { account: Account; children: ReactNode; title?: string }) {
  useEffect(() => { document.title = title ? `${title} · PinThread` : 'PinThread'; }, [title]);
  return (
    <div className="shell">
      <header className="shell-top">
        <Link href="/app" className="logo" style={{ textDecoration: 'none' }}><Logo />PinThread</Link>
        <span className="grow" />
        <AccountMenu account={account} />
      </header>
      <main className="shell-main">{children}</main>
    </div>
  );
}

// ---------------------------------------------------------------- projects dashboard

function ProjectCard({ p }: { p: ProjectListItem }) {
  const thumb = p.sheets.find(s => s.imageUrl)?.imageUrl;
  const pct = p.issues ? Math.round((p.complete / p.issues) * 100) : 0;
  return (
    <Link href={`/p/${p.id}`} className="pcard">
      <div className="pcard-thumb">{thumb ? <img src={thumb} alt="" loading="lazy" /> : <Icon name="file" size="lg" />}
        {p.waitingOnMe > 0 && <span className="pcard-wait">{p.waitingOnMe} waiting on you</span>}
      </div>
      <div className="pcard-body">
        <div className="row"><b className="grow ellipsis">{p.name}</b>{p.isAdmin && <span className="tag">Admin</span>}</div>
        <div className="faint small ellipsis">{p.sheets.length} sheet{p.sheets.length === 1 ? '' : 's'}{p.sheets[0] ? ` · ${p.sheets.slice(0, 3).map(s => s.number).join(', ')}${p.sheets.length > 3 ? '…' : ''}` : ''}</div>
        <div className="pcard-stats">
          <span><b>{p.open}</b> open</span><span><b>{p.complete}</b> closed</span><span><Icon name="users" size="sm" />{p.members}</span>
          <span className="grow" /><span className="faint small">{ago(p.updatedAt)}{ago(p.updatedAt) === 'just now' ? '' : ' ago'}</span>
        </div>
        <div className="progress"><i style={{ width: `${pct}%` }} /></div>
        <div className="faint small">You're the {ROLE_INFO[p.role].title.toLowerCase()}</div>
      </div>
    </Link>
  );
}

export function ProjectsPage({ account }: { account: Account }) {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['projects'], queryFn: api.projects, refetchOnWindowFocus: true });
  const waiting = data?.reduce((n, p) => n + p.waitingOnMe, 0) ?? 0;
  return (
    <AppShell account={account} title="Projects">
      <div className="page">
        <div className="page-head">
          <div className="grow">
            <h1 className="page-h">Projects</h1>
            <p className="muted" style={{ margin: '4px 0 0' }}>{data?.length ? (waiting ? <><b style={{ color: 'var(--review-text)' }}>{waiting} issue{waiting === 1 ? '' : 's'}</b> waiting on you across your projects.</> : 'Nothing is waiting on you right now.') : `Welcome, ${account.name.split(' ')[0]}.`}</p>
          </div>
          {!!data?.length && <Link href="/app/new" className="btn btn-ink lg"><Icon name="plus" size="sm" />New project</Link>}
        </div>
        {isLoading && <div className="pgrid">{[0, 1, 2].map(i => <div key={i} className="pcard skeleton" />)}</div>}
        {error && <div className="card pad"><b>Couldn't load your projects.</b><p className="muted">{(error as Error).message}</p><button className="btn btn-outline" onClick={() => void refetch()}>Try again</button></div>}
        {data && data.length > 0 && <div className="pgrid">{data.map(p => <ProjectCard key={p.id} p={p} />)}</div>}
        {data && data.length === 0 && (
          <div className="empty-state">
            <span className="empty-ico"><Icon name="pin" size="lg" /></span>
            <h2>Start your first project</h2>
            <p className="muted">Upload a drawing, drop a pin on the first question, and invite the people who need to sign it off. It takes about two minutes.</p>
            <div className="row wrap" style={{ gap: 10, justifyContent: 'center' }}>
              <Link href="/app/new" className="btn btn-ink lg"><Icon name="plus" size="sm" />New project</Link>
              <Link href="/demo" className="btn btn-outline lg">Explore the demo project</Link>
            </div>
            <p className="faint small" style={{ marginTop: 18 }}>Got an invite link from a colleague? Open it and you'll join their project.</p>
          </div>
        )}
      </div>
    </AppShell>
  );
}

// ---------------------------------------------------------------- new project

const ROLE_HELP: Record<Role, string> = {
  site: 'Raises questions and is in every issue room.',
  mep: 'Proposes routes for services and signs off MEP issues.',
  struct: 'Signs off structural issues and can place holds.',
  arch: 'Signs off architectural issues and can place holds.',
};

export function RolePicker({ value, onChange }: { value: Role; onChange: (r: Role) => void }) {
  return (
    <div className="role-grid" role="radiogroup" aria-label="Your role">
      {ROLES.map(r => (
        <button type="button" key={r} role="radio" aria-checked={value === r} className={`role-opt ${value === r ? 'on' : ''}`} onClick={() => onChange(r)}>
          <span className={`av ${r} sm`}>{ROLE_INFO[r].label.slice(0, 2).toUpperCase()}</span>
          <span><b>{ROLE_INFO[r].title}</b><span className="faint small">{ROLE_HELP[r]}</span></span>
        </button>
      ))}
    </div>
  );
}

export function SheetFields({ number, title, revision, set }: { number: string; title: string; revision: string; set: (k: 'number' | 'title' | 'revision', v: string) => void }) {
  return (
    <div className="sheet-fields">
      <label className="field-l">Sheet number<input className="field mono" value={number} onChange={e => set('number', e.target.value)} placeholder="A-101" maxLength={24} /></label>
      <label className="field-l">Sheet title<input className="field" value={title} onChange={e => set('title', e.target.value)} placeholder="Level 03 floor plan" maxLength={80} /></label>
      <label className="field-l">Revision<input className="field mono" value={revision} onChange={e => set('revision', e.target.value)} placeholder="A" maxLength={8} /></label>
    </div>
  );
}

export function NewProjectPage({ account }: { account: Account }) {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('site');
  const [drawing, setDrawing] = useState<PickedDrawing | null>(null);
  const [sheet, setSheet] = useState({ number: '', title: '', revision: 'A' });
  const [phase, setPhase] = useState<'form' | 'uploading' | 'creating'>('form');
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const touched = useRef(false);

  const onFile = (fileName: string) => {
    if (touched.current) return;
    const g = guessSheet(fileName);
    setSheet(s => ({ ...s, number: g.number || s.number, title: g.title || s.title }));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (name.trim().length < 2) { setErr('Give the project a name.'); return; }
    if (!drawing) { setErr('Add the first drawing sheet.'); return; }
    if (!sheet.number.trim() || !sheet.title.trim() || !sheet.revision.trim()) { setErr('Fill in the sheet number, title and revision.'); return; }
    try {
      setPhase('uploading'); setProgress(0);
      const files = await uploadDrawing(drawing, setProgress);
      setPhase('creating');
      const { projectId } = await api.createProject({ name: name.trim(), role, sheet: { number: sheet.number.trim(), title: sheet.title.trim(), revision: sheet.revision.trim(), ...files } });
      void qc.invalidateQueries({ queryKey: ['projects'] });
      navigate(`/p/${projectId}?welcome=1`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Could not create the project.');
      setPhase('form');
    }
  };

  const busy = phase !== 'form';
  return (
    <AppShell account={account} title="New project">
      <div className="page narrow">
        <Link href="/app" className="backlink"><Icon name="back" size="sm" />Projects</Link>
        <h1 className="page-h">New project</h1>
        <p className="muted" style={{ margin: '4px 0 24px' }}>You'll be the project admin. You can add more sheets and invite your team once it's set up.</p>
        <form className="form card pad wide-card" onSubmit={submit} noValidate>
          <label className="field-l">Project name<input className="field" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Meridian Tower, Level 03 fit-out" autoFocus maxLength={80} /></label>
          <div className="field-l">Your role on this project<RolePicker value={role} onChange={setRole} /></div>
          <div className="field-l">First drawing sheet
            <DrawingPicker onChange={setDrawing} onFile={onFile} />
          </div>
          {drawing && <SheetFields {...sheet} set={(k, v) => { touched.current = true; setSheet(s => ({ ...s, [k]: v })); }} />}
          {err && <div className="form-error" role="alert"><Icon name="info" size="sm" />{err}</div>}
          <div className="row" style={{ justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
            {phase === 'uploading' && <span className="faint small grow">Uploading drawing… {Math.round(progress * 100)}%</span>}
            {phase === 'creating' && <span className="faint small grow">Setting up the project and its chat…</span>}
            <Link href="/app" className="btn btn-ghost lg">Cancel</Link>
            <button className="btn btn-ink lg" type="submit" disabled={busy}>{busy ? <><Spinner />Creating…</> : 'Create project'}</button>
          </div>
        </form>
      </div>
    </AppShell>
  );
}

// ---------------------------------------------------------------- account settings

export function AccountPage({ account }: { account: Account }) {
  const setAccount = useSetAccount();
  const [name, setName] = useState(account.name);
  const [firm, setFirm] = useState(account.firm);
  const [saved, setSaved] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const [pwErr, setPwErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<'profile' | 'pw' | null>(null);

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault(); setErr(null); setSaved(null); setBusy('profile');
    try { const r = await api.updateAccount({ name: name.trim(), firm: firm.trim() }); setAccount(r.account); setSaved('Saved. Your name is updated on all your projects.'); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not save.'); }
    finally { setBusy(null); }
  };
  const savePw = async (e: FormEvent) => {
    e.preventDefault(); setPwErr(null); setPwMsg(null); setBusy('pw');
    try { await api.changePassword({ current: cur, next }); setCur(''); setNext(''); setPwMsg('Password changed. Other devices have been signed out.'); }
    catch (e) { setPwErr(e instanceof ApiError ? e.message : 'Could not change the password.'); }
    finally { setBusy(null); }
  };

  return (
    <AppShell account={account} title="Account">
      <div className="page narrow">
        <Link href="/app" className="backlink"><Icon name="back" size="sm" />Projects</Link>
        <h1 className="page-h">Account settings</h1>
        <form className="form card pad wide-card" onSubmit={saveProfile} style={{ marginTop: 20 }}>
          <div className="row" style={{ gap: 12 }}><Avatar p={asPerson({ ...account, name })} size="lg" /><div><b>{account.email}</b><div className="faint small">Your email is your login.</div></div></div>
          <label className="field-l">Full name<input className="field" value={name} onChange={e => setName(e.target.value)} maxLength={80} /></label>
          <label className="field-l">Company<input className="field" value={firm} onChange={e => setFirm(e.target.value)} maxLength={80} /></label>
          {err && <div className="form-error" role="alert"><Icon name="info" size="sm" />{err}</div>}
          {saved && <div className="form-ok" role="status"><Icon name="check" size="sm" />{saved}</div>}
          <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn btn-ink lg" disabled={busy === 'profile'}>{busy === 'profile' ? <Spinner /> : null}Save</button></div>
        </form>
        <form className="form card pad wide-card" onSubmit={savePw} style={{ marginTop: 16 }}>
          <b>Change password</b>
          <label className="field-l">Current password<input className="field" type="password" autoComplete="current-password" value={cur} onChange={e => setCur(e.target.value)} /></label>
          <label className="field-l">New password<input className="field" type="password" autoComplete="new-password" value={next} onChange={e => setNext(e.target.value)} placeholder="At least 8 characters" /></label>
          {pwErr && <div className="form-error" role="alert"><Icon name="info" size="sm" />{pwErr}</div>}
          {pwMsg && <div className="form-ok" role="status"><Icon name="check" size="sm" />{pwMsg}</div>}
          <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn btn-outline lg" disabled={busy === 'pw' || !cur || next.length < 8}>{busy === 'pw' ? <Spinner /> : null}Change password</button></div>
        </form>
      </div>
    </AppShell>
  );
}
