// Local chat transport (server runs without Nexconn credentials): SSE stream + REST, same message shape as the Nexconn SDK.
import { makeEmitter, quoteMeta, type ChatClient, type ChatMessage } from './types';

export function createLocalClient(): ChatClient {
  const em = makeEmitter();
  let token = '';
  let es: EventSource | null = null;
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const json = async <T,>(r: Response): Promise<T> => { if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? `HTTP ${r.status}`); return r.json(); };

  return {
    mode: 'local',
    async connect(t) {
      token = t;
      em.emit({ kind: 'status', status: 'connecting' });
      await new Promise<void>((resolve, reject) => {
        es = new EventSource(`/api/local/stream?token=${encodeURIComponent(t)}`);
        let first = true;
        es.addEventListener('ready', () => { em.emit({ kind: 'status', status: 'connected' }); if (first) { first = false; resolve(); } });
        es.addEventListener('chat', (e: MessageEvent) => { const d = JSON.parse(e.data); em.emit({ kind: d.kind, message: d.message }); });
        es.onerror = () => {
          em.emit({ kind: 'status', status: navigator.onLine ? 'reconnecting' : 'offline' });
          if (first) { first = false; reject(new Error('Chat connection failed')); }
        };
      });
      return t.split('.')[1];
    },
    async disconnect() { es?.close(); es = null; },
    on: em.on,
    async history(c, s, o = {}) {
      const q = new URLSearchParams({ c, s, limit: String(o.limit ?? 50), ...(o.before ? { before: String(o.before) } : {}) });
      return json<ChatMessage[]>(await fetch(`/api/local/history?${q}`, { headers: auth() }));
    },
    async sendText(c, s, text, quote) {
      return json<ChatMessage>(await fetch('/api/local/send', { method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' }, body: JSON.stringify({ c, s, type: 'RC:TxtMsg', content: { text }, metadata: quoteMeta(quote) }) }));
    },
    async sendImage(c, s, file, onProgress) {
      onProgress?.(10);
      const up = await json<{ url: string }>(await fetch('/api/local/upload', { method: 'POST', headers: { ...auth(), 'Content-Type': file.type }, body: file }));
      onProgress?.(100);
      const m = await json<ChatMessage>(await fetch('/api/local/send', { method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' }, body: JSON.stringify({ c, s, type: 'RC:ImgMsg', content: { remoteUrl: up.url, thumbnailBase64: '' } }) }));
      return { ...m, imageUrl: up.url };
    },
    async unreadCount() { return 0; },
    async clearUnread() { /* not tracked in local mode */ },
  };
}
