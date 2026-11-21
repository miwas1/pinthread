// Nexconn Chat SDK transport (@nexconn/chat 26.5.1). Loaded on demand so the drawing paints first.
import { PT_MESSAGE_REGISTRATIONS } from '@pinthread/shared';
import { makeEmitter, quoteMeta, type ChatClient, type ChatMessage } from './types';

type SDK = typeof import('@nexconn/chat');

export function createNexconnClient(appKey: string, area: 'SG' | 'NA' | 'SAU'): ChatClient {
  const em = makeEmitter();
  let sdk: SDK | null = null;
  let started = false;

  const norm = (m: any): ChatMessage => {
    const ident = m.channelIdentifier ?? {};
    let content = m.content;
    if (typeof content === 'string') { try { content = JSON.parse(content); } catch { content = { text: content }; } }
    const meta: Record<string, string> = {};
    if (m.metadata instanceof Map) m.metadata.forEach((v: string, k: string) => { meta[k] = v; });
    else if (m.metadata && typeof m.metadata === 'object') Object.assign(meta, m.metadata);
    return { id: String(m.messageId ?? m.clientId), communityId: ident.channelId ?? '', subId: ident.subChannelId ?? '', type: m.messageType, senderId: m.senderUserId, sentAt: Number(m.sentTime ?? Date.now()), content: content ?? {}, metadata: meta };
  };

  const load = async () => {
    if (sdk) return sdk;
    sdk = await import('@nexconn/chat');
    return sdk;
  };

  return {
    mode: 'nexconn',
    async connect(token) {
      const s = await load();
      if (!started) {
        started = true;
        s.NCEngine.initialize({ appKey, areaCode: s.AreaCode[area === 'SAU' ? 'SA' : area], logLevel: s.LogLevel.WARN });
        s.NCEngine.registerCustomMessages(PT_MESSAGE_REGISTRATIONS); // must precede connect
        s.NCEngine.addConnectionStatusHandler('pt', new s.ConnectionStatusHandler({
          onConnectionStatusChanged: ({ status, code }: { status: number; code?: number }) => {
            const C = s.ConnectionStatus as any;
            if (status === C.CONNECTED) em.emit({ kind: 'status', status: 'connected' });
            else if (status === C.KICKED_OFFLINE_BY_OTHER_CLIENT || (status === C.DISCONNECTED && code === 31010)) em.emit({ kind: 'status', status: 'kicked', code });
            else if (status === C.CONNECTING) em.emit({ kind: 'status', status: 'reconnecting', code });
            else em.emit({ kind: 'status', status: navigator.onLine ? 'reconnecting' : 'offline', code });
          },
        } as any));
        s.NCEngine.addMessageHandler('pt', new s.MessageHandler({
          onMessageReceived: ({ messages }: { messages: any[] }) => messages.forEach(m => em.emit({ kind: 'message', message: norm(m) })),
          onCommunityChannelMessageMetadataChanged: ({ messages }: { messages: any[] }) => messages.forEach(m => em.emit({ kind: 'metadata', message: norm(m) })),
          onMessageMetadataUpdated: (e: any) => { if (e?.message) em.emit({ kind: 'metadata', message: norm(e.message) }); },
        } as any));
      }
      em.emit({ kind: 'status', status: 'connecting' });
      const r = await s.NCEngine.connect({ token });
      if (!r.isOk) { em.emit({ kind: 'status', status: 'offline', code: r.code }); throw new Error(`Nexconn connect failed (${r.code})`); }
      em.emit({ kind: 'status', status: 'connected' });
      return r.data!.userId;
    },
    async disconnect() { if (sdk) await sdk.NCEngine.disconnect(); },
    on: em.on,
    async history(c, sub, o = {}) {
      const s = await load();
      const q = s.BaseChannel.createMessagesQuery({ channelIdentifier: new s.CommunitySubChannelIdentifier(c, sub), startTime: o.before ?? Date.now(), pageSize: o.limit ?? 50, isAscending: false });
      const r = await q.loadNextPage();
      if (!r.isOk) throw new Error(`History failed (${r.code})`);
      return (r.data?.data ?? []).map(norm).reverse();
    },
    async sendText(c, sub, text, quote) {
      const s = await load();
      const p = new s.SendTextMessageParams({ text });
      const meta = quoteMeta(quote);
      if (Object.keys(meta).length) p.metadata = meta;
      const r = await new s.CommunitySubChannel(c, sub).sendMessage(p);
      if (!r.isOk) throw new Error(`Send failed (${r.code})`);
      return norm(r.data);
    },
    async sendImage(c, sub, file, onProgress) {
      const s = await load();
      const r = await s.Helper.createSendImageMessageParams(file);
      if (!r.isOk) throw new Error(`Image rejected (${r.code})`);
      let remote = '';
      r.data!.onUploadProgress = (pct: number) => onProgress?.(pct);
      r.data!.onUploadComplete = (url: string) => { remote = url; };
      const sent = await new s.CommunitySubChannel(c, sub).sendMediaMessage(r.data!);
      if (!sent.isOk) throw new Error(`Upload failed (${sent.code})`);
      const m = norm(sent.data);
      return { ...m, imageUrl: m.content?.remoteUrl || remote };
    },
    async unreadCount(c, sub) {
      const s = await load();
      const r = await new s.CommunitySubChannel(c, sub).reload();
      return r.isOk ? (r.data as any).unreadCount ?? 0 : 0;
    },
    async clearUnread(c, sub) {
      const s = await load();
      await new s.CommunitySubChannel(c, sub).clearUnreadCount();
    },
  };
}
