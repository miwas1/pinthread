// Local chat mode: a stand-in for Nexconn when no App Key/Secret is configured (development and automated tests).
// Messages live in Postgres and are streamed to browsers over Server-Sent Events. Same wire shape as the Nexconn client SDK.
import { config } from '../config';
import { sql } from '../db';
import { hmac, newLongId, safeEqual } from '../util';
import type { ChatGateway, SendSpec } from './gateway';

export interface WireMessage {
  id: string; communityId: string; subId: string; type: string; senderId: string;
  sentAt: number; content: Record<string, unknown>; metadata: Record<string, string>;
}
type Event = { kind: 'message' | 'metadata'; message: WireMessage };
type Listener = (e: Event) => void;

const listeners = new Map<string, Set<Listener>>();

export const localHub = {
  subscribe(userId: string, fn: Listener) {
    if (!listeners.has(userId)) listeners.set(userId, new Set());
    listeners.get(userId)!.add(fn);
    return () => listeners.get(userId)?.delete(fn);
  },
  online(userId: string) { return (listeners.get(userId)?.size ?? 0) > 0; },
};

export const localToken = (userId: string) => `local.${userId}.${hmac(config.sessionSecret, `local:${userId}`)}`;
export function verifyLocalToken(token: string): string | null {
  const [, userId, sig] = token.split('.');
  if (!userId || !sig) return null;
  return safeEqual(sig, hmac(config.sessionSecret, `local:${userId}`)) ? userId : null;
}

/** Users allowed to see a subchannel: its private member list if it has one, otherwise the whole community. */
export async function recipients(communityId: string, subId: string): Promise<string[]> {
  const priv = await sql<{ user_id: string }[]>`select user_id from local_members where community_id = ${communityId} and subchannel_id = ${subId}`;
  if (priv.length) return priv.map(r => r.user_id);
  const all = await sql<{ user_id: string }[]>`select user_id from local_members where community_id = ${communityId} and subchannel_id = ''`;
  return all.map(r => r.user_id);
}

export async function canAccess(userId: string, communityId: string, subId: string) {
  return (await recipients(communityId, subId)).includes(userId);
}

const toRow = (r: any): WireMessage => ({
  id: r.message_id, communityId: r.community_id, subId: r.subchannel_id, type: r.type, senderId: r.sender_id,
  sentAt: Number(r.sent_at), content: r.content, metadata: r.metadata ?? {},
});

/** Convert Nexconn server-API content for built-in types into the client SDK shape. */
function clientContent(type: string, c: Record<string, unknown>): Record<string, unknown> {
  if (type === 'RC:TxtMsg') return { text: c.content, ...(c.mentionedInfo ? { mentionedInfo: c.mentionedInfo } : {}) };
  if (type === 'RC:ImgMsg') return { remoteUrl: c.imageUri, thumbnailBase64: c.content };
  return c;
}

export async function storeAndPublish(m: Omit<WireMessage, 'id' | 'sentAt'> & { transient?: boolean }): Promise<WireMessage> {
  const msg: WireMessage = { ...m, id: `L${newLongId()}`, sentAt: Date.now() };
  if (!m.transient) {
    await sql`insert into local_messages (message_id, community_id, subchannel_id, sender_id, type, content, metadata, sent_at)
      values (${msg.id}, ${msg.communityId}, ${msg.subId}, ${msg.senderId}, ${msg.type}, ${sql.json(msg.content as never)}, ${sql.json(msg.metadata)}, ${msg.sentAt})`;
  }
  for (const uid of await recipients(msg.communityId, msg.subId)) listeners.get(uid)?.forEach(fn => fn({ kind: 'message', message: msg }));
  return msg;
}

export async function localHistory(communityId: string, subId: string, before: number, limit: number): Promise<WireMessage[]> {
  const rows = await sql`select * from local_messages where community_id = ${communityId} and subchannel_id = ${subId} and sent_at < ${before}
    order by sent_at desc, seq desc limit ${limit}`;
  return rows.map(toRow).reverse();
}

export function createLocalGateway(): ChatGateway {
  return {
    mode: 'local',
    async issueToken(userId) { return localToken(userId); },
    async createCommunity(communityId, owner) {
      await sql`insert into local_members (community_id, subchannel_id, user_id) values (${communityId}, '', ${owner}) on conflict do nothing`;
    },
    async joinCommunity(communityId, userId) {
      await sql`insert into local_members (community_id, subchannel_id, user_id) values (${communityId}, '', ${userId}) on conflict do nothing`;
    },
    async createSubchannel() { /* public by default; private lists are added explicitly */ },
    async addPrivateMembers(communityId, subId, userIds) {
      for (const u of userIds) await sql`insert into local_members values (${communityId}, ${subId}, ${u}) on conflict do nothing`;
    },
    async send(spec: SendSpec) {
      const m = await storeAndPublish({
        communityId: spec.communityId, subId: spec.subchannelId, type: spec.messageType, senderId: spec.fromUserId,
        content: clientContent(spec.messageType, spec.content), metadata: spec.metadata ?? {}, transient: spec.transient,
      });
      return { messageId: spec.transient ? null : m.id };
    },
    async setMetadata(_c, _s, messageId, metadata) {
      const [row] = await sql`update local_messages set metadata = metadata || ${sql.json(metadata)} where message_id = ${messageId} returning *`;
      if (!row) throw new Error(`local message ${messageId} not found`);
      const msg = toRow(row);
      for (const uid of await recipients(msg.communityId, msg.subId)) listeners.get(uid)?.forEach(fn => fn({ kind: 'metadata', message: msg }));
    },
    async dismissCommunity(communityId) {
      await sql`delete from local_members where community_id = ${communityId}`;
      await sql`delete from local_messages where community_id = ${communityId}`;
    },
  };
}
