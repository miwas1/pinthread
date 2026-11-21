// Nexconn Platform Chat API client (docs.nexconn.ai/guides/rest-apis/im-server-integration).
// Auth headers: App-Key, Nonce (≤ 18 chars), Timestamp (ms), Signature = sha1(appSecret + nonce + timestamp).
// Success: HTTP 200 with {"code": 0}. Fail over to the backup domain on timeout / 5xx.
import { randomBytes, randomUUID } from 'node:crypto';
import { Agent } from 'undici';
import { assertContentSize, isValidCommunityId, isValidSubchannelId } from '@pinthread/shared';
import type { ChatGateway, SendSpec } from './gateway';
import { sha1hex, sleep } from '../util';
import { log } from '../log';

// Docs: avoid keep-alive connections older than 55 s idle / 80 reuses.
const agent = new Agent({ keepAliveTimeout: 50_000, keepAliveMaxTimeout: 50_000, connections: 16 });

export class NexconnError extends Error {
  constructor(public path: string, public httpStatus: number, public body: { code?: number; errorMessage?: string; msg?: string } | null) {
    super(`Nexconn ${path} failed: HTTP ${httpStatus} code ${body?.code ?? '?'} ${body?.errorMessage ?? body?.msg ?? ''}`.trim());
  }
}

/** Serialises calls per key so a subchannel never exceeds ~15 msg/s (limit is 20/s), and caps global rate (~80/s, limit 100/s). */
class Throttle {
  private last = new Map<string, number>();
  private chain = new Map<string, Promise<void>>();
  async wait(key: string, intervalMs: number) {
    const prev = this.chain.get(key) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>(r => (release = r));
    this.chain.set(key, prev.then(() => mine));
    await prev;
    const wait = (this.last.get(key) ?? 0) + intervalMs - Date.now();
    if (wait > 0) await sleep(wait);
    this.last.set(key, Date.now());
    release();
  }
}

export class NexconnServer {
  private domainIdx = 0;
  private throttle = new Throttle();
  constructor(private cfg: { appKey: string; appSecret: string; domains: [string, string] }) {}

  async post<T = { code: number; result?: any }>(path: string, body: unknown, attempt = 0): Promise<T> {
    await this.throttle.wait('global', 12);
    const nonce = randomBytes(9).toString('hex'); // 18 chars
    const timestamp = String(Date.now());
    const domain = this.cfg.domains[this.domainIdx];
    let res: Response;
    try {
      res = await fetch(`https://${domain}${path}`, {
        method: 'POST',
        // @ts-expect-error undici dispatcher option on Node's fetch
        dispatcher: agent,
        signal: AbortSignal.timeout(5_000),
        headers: {
          'Content-Type': 'application/json',
          'App-Key': this.cfg.appKey,
          Nonce: nonce,
          Timestamp: timestamp,
          Signature: sha1hex(this.cfg.appSecret + nonce + timestamp),
          'X-Request-ID': randomUUID(),
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      if (attempt >= 3) throw e;
      this.domainIdx = 1 - this.domainIdx;
      log.warn('nexconn.failover', { path, domain, error: String(e) });
      return this.post(path, body, attempt + 1);
    }
    if (res.status === 429 && attempt < 4) {
      await sleep(400 * 2 ** attempt);
      return this.post(path, body, attempt + 1);
    }
    if (res.status >= 500 && attempt < 3) {
      this.domainIdx = 1 - this.domainIdx;
      return this.post(path, body, attempt + 1);
    }
    const json = (await res.json().catch(() => null)) as { code?: number } | null;
    if (!res.ok || !json || json.code !== 0) throw new NexconnError(path, res.status, json as never);
    return json as T;
  }

  throttleSubchannel(key: string) {
    return this.throttle.wait(`sub:${key}`, 70);
  }
}

const alreadyExists = (e: unknown) => e instanceof NexconnError && /exist|duplicate|already/i.test(`${e.body?.errorMessage ?? ''}${e.body?.msg ?? ''}`);

export function createNexconnGateway(cfg: { appKey: string; appSecret: string; domains: [string, string] }): ChatGateway {
  const api = new NexconnServer(cfg);
  return {
    mode: 'nexconn',
    async issueToken(userId, name, avatarUrl) {
      const r = await api.post<{ code: number; result: { accessToken: string } }>('/v4/auth/access-token/issue', { userId, name, ...(avatarUrl ? { avatarUrl } : {}) });
      return r.result.accessToken;
    },
    async createCommunity(communityId, ownerUserId, name) {
      if (!isValidCommunityId(communityId)) throw new Error(`Invalid community id ${communityId}`);
      try { await api.post('/v4/community-channel/create', { userId: ownerUserId, channelId: communityId, name }); }
      catch (e) { if (!alreadyExists(e)) throw e; }
    },
    async joinCommunity(communityId, userId) {
      await api.post('/v4/community-channel/join', { channelId: communityId, userId });
    },
    async leaveCommunity(communityId, userId) {
      await api.post('/v4/community-channel/leave', { channelId: communityId, userId });
    },
    async createSubchannel(communityId, subchannelId, isPrivate) {
      if (!isValidSubchannelId(subchannelId)) throw new Error(`Invalid subchannel id ${subchannelId}`);
      try { await api.post('/v4/community-channel/subchannel/create', { channelId: communityId, subchannelId, channelVisibility: isPrivate ? 1 : 0 }); }
      catch (e) { if (!alreadyExists(e)) throw e; }
    },
    async addPrivateMembers(communityId, subchannelId, userIds) {
      for (let i = 0; i < userIds.length; i += 20) {
        await api.post('/v4/community-channel/private-subchannel/member/add', { channelId: communityId, subchannelId, userIds: userIds.slice(i, i + 20) });
      }
    },
    async send(spec: SendSpec) {
      const custom = spec.messageType.startsWith('pt:');
      if (custom) assertContentSize(spec.content);
      await api.throttleSubchannel(`${spec.communityId}/${spec.subchannelId}`);
      const body: Record<string, unknown> = {
        fromUserId: spec.fromUserId,
        toChannelIds: [spec.communityId],
        subchannelId: spec.subchannelId,
        messageType: spec.messageType,
        content: JSON.stringify(spec.content),
        shouldPersist: spec.transient ? 0 : 1,
        isCounted: spec.transient || spec.counted === false ? 0 : 1,
      };
      if (spec.pushContent) body.pushContent = spec.pushContent;
      if (spec.mentionUserIds?.length) body.hasMention = 1;
      if (spec.metadata) { body.hasMetadata = true; body.metadata = spec.metadata; }
      const r = await api.post<{ code: number; result?: { messageIds?: { channelId: string; messageId: string }[] } }>('/v4/community-channel/message/send', body);
      return { messageId: r.result?.messageIds?.[0]?.messageId ?? null };
    },
    async setMetadata(communityId, subchannelId, messageId, metadata) {
      const entries = Object.entries(metadata);
      for (let i = 0; i < entries.length; i += 20) {
        await api.post('/v4/community-channel/message/metadata/set', {
          messageId, userId: 'ptbot', channelId: communityId, subchannelId, metadata: Object.fromEntries(entries.slice(i, i + 20)),
        });
      }
    },
    async dismissCommunity(communityId) {
      await api.post('/v4/community-channel/dismiss', { channelId: communityId });
    },
  };
}
