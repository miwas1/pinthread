import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Link, Route, Switch, useLocation } from 'wouter';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-sans/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import './styles/tokens.css';
import './styles/ui.css';
import './styles/app.css';
import './styles/product.css';
import type { ClientConfig, SessionResponse } from '@pinthread/shared';
import { ChatProvider } from './chat/ChatContext';
import { Spinner, ToastProvider } from './components/ui';
import { RequireAccount } from './lib/account';
import { ApiError, api, getSession, setSession } from './lib/api';
import { AccountPage, NewProjectPage, ProjectsPage } from './pages/AppPages';
import { AuthPage } from './pages/Auth';
import { DemoPage } from './pages/Demo';
import { InvitePage } from './pages/Invite';
import { Join } from './pages/Join';
import { Landing } from './pages/Landing';
import { Workspace } from './workspace/Workspace';

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 2_000 } } });

type Opening = { phase: 'loading' } | { phase: 'ready'; session: SessionResponse } | { phase: 'error'; title: string; message: string };

/**
 * A project opens with this tab's session. Demo sessions live in the tab; team projects exchange the account cookie
 * for a fresh project session on every load.
 */
function ProjectRoute({ projectId }: { projectId: string }) {
  const [loc, navigate] = useLocation();
  const [config, setConfig] = useState<ClientConfig | null>(null);
  const [open, setOpen] = useState<Opening>({ phase: 'loading' });
  useEffect(() => { api.config().then(setConfig).catch(() => setConfig({ chatMode: 'local', appKey: null, areaCode: 'SG' })); }, []);
  useEffect(() => {
    let cancelled = false;
    const tab = getSession();
    const demo = tab && tab.projectId === projectId && (tab.kind ?? 'demo') === 'demo' ? tab : null;
    if (demo) { setOpen({ phase: 'ready', session: demo }); return; }
    api.openProject(projectId).then(s => {
      if (cancelled) return;
      setSession(s);
      setOpen({ phase: 'ready', session: s });
    }).catch(e => {
      if (cancelled) return;
      if (e instanceof ApiError && e.status === 401) { navigate(`/login?next=${encodeURIComponent(loc)}`, { replace: true }); return; }
      if (e instanceof ApiError && e.status === 403) { setOpen({ phase: 'error', title: "You don't have access to this project", message: e.message }); return; }
      setOpen({ phase: 'error', title: 'Could not open the project', message: e instanceof Error ? e.message : 'Try again.' });
    });
    return () => { cancelled = true; };
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (open.phase === 'error') {
    return <div className="center-page"><div className="card pad"><h1 className="h-title">{open.title}</h1><p className="muted">{open.message}</p><Link href="/app" className="btn btn-ink lg">Go to your projects</Link></div></div>;
  }
  if (open.phase === 'loading' || !config) return <div className="center-page"><Spinner /></div>;
  return (
    <ChatProvider token={open.session.nexconnToken} config={config}>
      <Workspace session={open.session} />
    </ChatProvider>
  );
}

function NotFound() {
  return <div className="center-page"><div className="card pad"><h1 className="h-title">Page not found</h1><Link className="btn btn-ink lg" href="/" style={{ marginTop: 12 }}>Go to PinThread</Link></div></div>;
}

function App() {
  return (
    <Switch>
      <Route path="/"><Landing /></Route>
      <Route path="/login"><AuthPage mode="login" /></Route>
      <Route path="/signup"><AuthPage mode="signup" /></Route>
      <Route path="/demo"><DemoPage /></Route>
      <Route path="/app"><RequireAccount>{a => <ProjectsPage account={a} />}</RequireAccount></Route>
      <Route path="/app/new"><RequireAccount>{a => <NewProjectPage account={a} />}</RequireAccount></Route>
      <Route path="/app/account"><RequireAccount>{a => <AccountPage account={a} />}</RequireAccount></Route>
      <Route path="/invite/:token">{p => <InvitePage token={p.token} />}</Route>
      <Route path="/p/:projectId">{p => <ProjectRoute key={p.projectId} projectId={p.projectId} />}</Route>
      <Route path="/j/:projectId/:role">{p => <Join projectId={p.projectId} role={p.role} />}</Route>
      <Route><NotFound /></Route>
    </Switch>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <App />
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
