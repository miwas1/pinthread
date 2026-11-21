import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BOT_ONLY_TYPES, BOT_USER_ID, MT, type PinSummary, type ProjectState } from '@pinthread/shared';
import { api } from '../lib/api';
import { useChat } from '../chat/ChatContext';
import type { ChatMessage, Quote } from '../chat/types';

let lastOwnDecisionAt = 0;
export const markOwnDecision = () => { lastOwnDecisionAt = Date.now(); };
export const ownDecisionRecently = () => Date.now() - lastOwnDecisionAt < 4000;

export function useProjectState(projectId: string) {
  const { status } = useChat();
  return useQuery({
    queryKey: ['state', projectId],
    queryFn: () => api.state(projectId),
    // Polling fallback: if Nexconn is not connected, refresh every 5 s so decisions still show up.
    refetchInterval: status === 'connected' ? 20_000 : 5_000,
    refetchOnWindowFocus: true,
  });
}

export function usePinRecord(pinId: string | null) {
  return useQuery({ queryKey: ['pin', pinId], queryFn: () => api.pin(pinId!), enabled: !!pinId, refetchOnWindowFocus: true });
}

/** Turns Nexconn events into cache invalidations. Structured messages are signals; the API is the truth. */
export function useLiveSync(projectId: string, state: ProjectState | undefined, handlers: {
  onJump: (m: ChatMessage) => void; onPinChange: (pinId: string, status: string, prev: string | undefined) => void;
}) {
  const qc = useQueryClient();
  const { subscribe, status } = useChat();
  const seqs = useRef(new Map<string, number>());
  const statuses = useRef(new Map<string, string>());
  const meId = state?.me.userId;
  const h = useRef(handlers);
  h.current = handlers;

  useEffect(() => {
    state?.pins.forEach(p => {
      if ((seqs.current.get(p.id) ?? 0) < p.seq) seqs.current.set(p.id, p.seq);
      if (!statuses.current.has(p.id)) statuses.current.set(p.id, p.state.status); // transitions are driven by pt:pinstate
    });
  }, [state]);

  useEffect(() => subscribe(e => {
    if (e.kind === 'status') return;
    const m = e.message;
    if (e.kind === 'metadata') {
      const pin = state?.pins.find(p => p.subchannelId === m.subId);
      if (pin) void qc.invalidateQueries({ queryKey: ['pin', pin.id] });
      return;
    }
    if (!m.type.startsWith('pt:')) return;
    if (BOT_ONLY_TYPES.includes(m.type) && m.senderId !== BOT_USER_ID) return; // forged system card
    const c = m.content ?? {};
    if (c.projectId && c.projectId !== projectId) return;
    if (m.type === MT.jump && meId && (c.forUserIds ?? []).includes(meId)) h.current.onJump(m);
    if (!c.pinId) return;
    const known = seqs.current.get(c.pinId) ?? 0;
    if (m.type === MT.pinstate && c.seq && c.seq <= known) return; // stale
    if (c.seq) seqs.current.set(c.pinId, Math.max(known, c.seq));
    if (m.type === MT.pinstate) {
      const prev = statuses.current.get(c.pinId);
      statuses.current.set(c.pinId, c.status);
      h.current.onPinChange(c.pinId, c.status, prev);
    }
    void qc.invalidateQueries({ queryKey: ['state', projectId] });
    void qc.invalidateQueries({ queryKey: ['pin', c.pinId] });
  }), [subscribe, qc, projectId, state, meId]);

  // Converge after a reconnect (community channels have no missed-message replay).
  const was = useRef(status);
  useEffect(() => {
    if (status === 'connected' && was.current !== 'connected' && was.current !== 'connecting') void qc.invalidateQueries();
    was.current = status;
  }, [status, qc]);
}

/** Room conversation: history on open + live messages, deduped. */
export function useThread(pin: PinSummary | null, communityId: string | undefined, isMember: boolean) {
  const { client, subscribe, status } = useChat();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sub = pin?.subchannelId;
  const ready = !!pin?.roomReady;

  const merge = useCallback((incoming: ChatMessage[]) => {
    setMessages(cur => {
      const byId = new Map(cur.map(m => [m.id, m]));
      for (const m of incoming) byId.set(m.id, { ...byId.get(m.id), ...m, pending: false });
      return [...byId.values()].sort((a, b) => a.sentAt - b.sentAt);
    });
  }, []);

  useEffect(() => {
    setMessages([]); setError(null);
    if (!client || !communityId || !sub || !isMember || !ready || status !== 'connected') return;
    let cancelled = false;
    setLoading(true);
    client.history(communityId, sub, { limit: 80 })
      .then(ms => { if (!cancelled) merge(ms); })
      .catch(e => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    void client.clearUnread(communityId, sub).catch(() => {});
    return () => { cancelled = true; };
  }, [client, communityId, sub, isMember, ready, status, merge]);

  useEffect(() => subscribe(e => {
    if (e.kind === 'status' || e.message.subId !== sub || e.message.communityId !== communityId) return;
    merge([e.message]);
  }), [subscribe, sub, communityId, merge]);

  const sendText = useCallback(async (text: string, quote: Quote | null) => {
    if (!client || !communityId || !sub) return;
    const temp: ChatMessage = { id: `tmp-${Date.now()}`, communityId, subId: sub, type: 'RC:TxtMsg', senderId: '__me', sentAt: Date.now(), content: { text }, metadata: {}, pending: true };
    setMessages(m => [...m, temp]);
    try {
      const sent = await client.sendText(communityId, sub, text, quote);
      setMessages(m => m.filter(x => x.id !== temp.id));
      merge([sent]);
    } catch {
      setMessages(m => m.map(x => (x.id === temp.id ? { ...x, pending: false, failed: true } : x)));
    }
  }, [client, communityId, sub, merge]);

  const sendImage = useCallback(async (file: File, onProgress?: (p: number) => void) => {
    if (!client || !communityId || !sub) throw new Error('Room not ready');
    const sent = await client.sendImage(communityId, sub, file, onProgress);
    merge([sent]);
    return sent;
  }, [client, communityId, sub, merge]);

  const retry = useCallback((m: ChatMessage) => { setMessages(ms => ms.filter(x => x.id !== m.id)); void sendText(m.content.text, null); }, [sendText]);

  return { messages, loading, error, sendText, sendImage, retry };
}

export function useIsMobile() {
  const q = '(max-width: 767px)';
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const f = () => setM(mq.matches);
    mq.addEventListener('change', f);
    return () => mq.removeEventListener('change', f);
  }, []);
  return m;
}
