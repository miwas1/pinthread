import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ClientConfig } from '@pinthread/shared';
import { api } from '../lib/api';
import { createLocalClient } from './local';
import { createNexconnClient } from './nexconn';
import type { ChatClient, ChatEvent, ConnStatus } from './types';

export interface ActivityEntry { at: number; text: string }

interface Ctx {
  client: ChatClient | null;
  status: ConnStatus;
  userId: string | null;
  mode: 'nexconn' | 'local' | null;
  subscribe(fn: (e: ChatEvent) => void): () => void;
  activity: ActivityEntry[];
  reconnect(): Promise<void>;
}

const ChatCtx = createContext<Ctx | null>(null);
export const useChat = () => {
  const c = useContext(ChatCtx);
  if (!c) throw new Error('useChat outside ChatProvider');
  return c;
};

export function ChatProvider({ token, config, children }: { token: string; config: ClientConfig; children: ReactNode }) {
  const [status, setStatus] = useState<ConnStatus>('connecting');
  const [userId, setUserId] = useState<string | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const listeners = useRef(new Set<(e: ChatEvent) => void>());
  const client = useMemo<ChatClient>(
    () => (config.chatMode === 'nexconn' && config.appKey ? createNexconnClient(config.appKey, config.areaCode) : createLocalClient()),
    [config.chatMode, config.appKey, config.areaCode],
  );

  const log = useCallback((text: string) => setActivity(a => [{ at: Date.now(), text }, ...a].slice(0, 200)), []);

  useEffect(() => {
    const off = client.on(e => {
      if (e.kind === 'status') {
        setStatus(e.status);
        log(`connection ${e.status}${e.code ? ` (code ${e.code})` : ''}`);
      } else if (e.kind === 'message') {
        log(`onMessageReceived ${e.message.type} #${e.message.subId}${e.message.content?.seq ? ` seq ${e.message.content.seq}` : ''}`);
      } else {
        log(`onCommunityChannelMessageMetadataChanged #${e.message.subId} ${Object.keys(e.message.metadata).join(',')}`);
      }
      listeners.current.forEach(fn => fn(e));
    });
    let cancelled = false;
    log(`${client.mode === 'nexconn' ? 'NCEngine.connect' : 'local chat connect'}…`);
    client.connect(token).then(uid => {
      if (cancelled) return;
      setUserId(uid);
      log(`connected as ${uid}`);
      api.connected().catch(() => {});
    }).catch(err => { if (!cancelled) { setStatus('offline'); log(`connect failed: ${err.message}`); } });
    return () => { cancelled = true; off(); void client.disconnect(); };
  }, [client, token, log]);

  const reconnect = useCallback(async () => {
    await client.disconnect().catch(() => {});
    const uid = await client.connect(token);
    setUserId(uid);
  }, [client, token]);

  const value = useMemo<Ctx>(() => ({
    client, status, userId, mode: client.mode, activity, reconnect,
    subscribe: fn => { listeners.current.add(fn); return () => { listeners.current.delete(fn); }; },
  }), [client, status, userId, activity, reconnect]);

  return <ChatCtx.Provider value={value}>{children}</ChatCtx.Provider>;
}
