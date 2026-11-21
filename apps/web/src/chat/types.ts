export interface ChatMessage {
  id: string;
  communityId: string;
  subId: string;
  /** RC:TxtMsg, RC:ImgMsg or pt:* */
  type: string;
  senderId: string;
  sentAt: number;
  content: any;
  metadata: Record<string, string>;
  pending?: boolean;
  failed?: boolean;
}

export type ConnStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline' | 'kicked';

export type ChatEvent =
  | { kind: 'message'; message: ChatMessage }
  | { kind: 'metadata'; message: ChatMessage }
  | { kind: 'status'; status: ConnStatus; code?: number };

export interface Quote { messageId: string; name: string; text: string }

export interface ChatClient {
  readonly mode: 'nexconn' | 'local';
  connect(token: string): Promise<string>;
  disconnect(): Promise<void>;
  on(fn: (e: ChatEvent) => void): () => void;
  history(communityId: string, subId: string, opts?: { before?: number; limit?: number }): Promise<ChatMessage[]>;
  sendText(communityId: string, subId: string, text: string, quote?: Quote | null): Promise<ChatMessage>;
  sendImage(communityId: string, subId: string, file: File, onProgress?: (pct: number) => void): Promise<ChatMessage & { imageUrl: string }>;
  unreadCount(communityId: string, subId: string): Promise<number>;
  clearUnread(communityId: string, subId: string): Promise<void>;
}

export const quoteMeta = (q?: Quote | null): Record<string, string> =>
  q ? { q_id: q.messageId, q_name: q.name.slice(0, 60), q_text: q.text.slice(0, 140) } : {};

export function makeEmitter() {
  const fns = new Set<(e: ChatEvent) => void>();
  return {
    on(fn: (e: ChatEvent) => void) { fns.add(fn); return () => { fns.delete(fn); }; },
    emit(e: ChatEvent) { fns.forEach(f => { try { f(e); } catch (err) { console.error(err); } }); },
  };
}
