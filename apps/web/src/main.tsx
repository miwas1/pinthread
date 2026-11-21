import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Switch, useLocation } from 'wouter';
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
import type { ClientConfig } from '@pinthread/shared';
import { ChatProvider } from './chat/ChatContext';
import { Spinner, ToastProvider } from './components/ui';
import { api, getSession } from './lib/api';
import { Join } from './pages/Join';
import { Landing } from './pages/Landing';
import { Workspace } from './workspace/Workspace';

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 2_000 } } });

function ProjectRoute({ projectId }: { projectId: string }) {
  const [, navigate] = useLocation();
  const [config, setConfig] = useState<ClientConfig | null>(null);
  const session = getSession();
  useEffect(() => { api.config().then(setConfig).catch(() => setConfig({ chatMode: 'local', appKey: null, areaCode: 'SG' })); }, []);
  useEffect(() => { if (!session || session.projectId !== projectId) navigate('/', { replace: true }); }, [session, projectId, navigate]);
  if (!session || session.projectId !== projectId) return null;
  if (!config) return <div className="center-page"><Spinner /></div>;
  return (
    <ChatProvider token={session.nexconnToken} config={config}>
      <Workspace session={session} />
    </ChatProvider>
  );
}

function App() {
  return (
    <Switch>
      <Route path="/"><Landing /></Route>
      <Route path="/p/:projectId">{p => <ProjectRoute projectId={p.projectId} />}</Route>
      <Route path="/j/:projectId/:role">{p => <Join projectId={p.projectId} role={p.role} />}</Route>
      <Route><div className="center-page"><div className="card pad"><h1 className="h-title">Page not found</h1><a className="btn btn-ink lg" href="/" style={{ marginTop: 12 }}>Go to PinThread</a></div></div></Route>
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
