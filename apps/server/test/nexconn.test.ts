// Nexconn Platform Chat API client: request signing, endpoints, bodies, failover. fetch is stubbed (no network).
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNexconnGateway, NexconnError } from '../src/chat/nexconn';

const cfg = { appKey: 'k3y', appSecret: 's3cr3t', domains: ['api.sg-light-api.com', 'api-b.sg-light-api.com'] as [string, string] };
type Call = { url: string; headers: Record<string, string>; body: any };

function stub(responses: Array<(c: Call) => Response | Promise<Response>>) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const c = { url, headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) };
    calls.push(c);
    const r = responses[Math.min(calls.length - 1, responses.length - 1)];
    return r(c);
  }));
  return calls;
}
const ok = (result?: unknown) => () => new Response(JSON.stringify({ code: 0, ...(result ? { result } : {}) }), { status: 200, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('Nexconn gateway', () => {
  it('signs requests as the docs specify and issues tokens', async () => {
    const calls = stub([ok({ userId: 'u1', accessToken: 'tok' })]);
    const g = createNexconnGateway(cfg);
    expect(await g.issueToken('u1', 'Dana Okafor')).toBe('tok');
    const c = calls[0];
    expect(c.url).toBe('https://api.sg-light-api.com/v4/auth/access-token/issue');
    expect(c.body).toEqual({ userId: 'u1', name: 'Dana Okafor' });
    expect(c.headers['App-Key']).toBe('k3y');
    expect(c.headers.Nonce).toHaveLength(18);
    expect(c.headers.Timestamp).toMatch(/^\d{13}$/);
    expect(c.headers.Signature).toBe(createHash('sha1').update('s3cr3t' + c.headers.Nonce + c.headers.Timestamp).digest('hex'));
    expect(c.headers['Content-Type']).toBe('application/json');
  });

  it('creates communities and private subchannels with valid ids', async () => {
    const calls = stub([ok()]);
    const g = createNexconnGateway(cfg);
    await g.createCommunity('cabc123', 'usite', 'Meridian Tower');
    await g.createSubchannel('cabc123', 'pxyz', true);
    await g.addPrivateMembers('cabc123', 'pxyz', ['a', 'b']);
    expect(calls.map(c => c.url.replace('https://api.sg-light-api.com', ''))).toEqual([
      '/v4/community-channel/create', '/v4/community-channel/subchannel/create', '/v4/community-channel/private-subchannel/member/add',
    ]);
    expect(calls[1].body).toEqual({ channelId: 'cabc123', subchannelId: 'pxyz', channelVisibility: 1 });
    await expect(g.createSubchannel('cabc123', 'disc_mep', false)).rejects.toThrow(/Invalid subchannel/);
  });

  it('sends custom cards with metadata, mentions and transient status messages', async () => {
    const calls = stub([ok({ messageIds: [{ channelId: 'c1', messageId: 'MSG-1' }] })]);
    const g = createNexconnGateway(cfg);
    const r = await g.send({ communityId: 'c1', subchannelId: 'p1', fromUserId: 'umep', messageType: 'pt:proposal', content: { v: 1, summary: 'x' }, metadata: { st: 'current' } });
    expect(r.messageId).toBe('MSG-1');
    expect(calls[0].url).toMatch(/\/v4\/community-channel\/message\/send$/);
    expect(calls[0].body).toMatchObject({ fromUserId: 'umep', toChannelIds: ['c1'], subchannelId: 'p1', messageType: 'pt:proposal', shouldPersist: 1, isCounted: 1, hasMetadata: true, metadata: { st: 'current' } });
    expect(JSON.parse(calls[0].body.content)).toEqual({ v: 1, summary: 'x' });
    await g.send({ communityId: 'c1', subchannelId: 'board', fromUserId: 'ptbot', messageType: 'pt:pinstate', content: { v: 1 }, transient: true });
    expect(calls[1].body).toMatchObject({ shouldPersist: 0, isCounted: 0 });
    await g.send({ communityId: 'c1', subchannelId: 'discstruct', fromUserId: 'ptbot', messageType: 'pt:jump', content: { v: 1 }, mentionUserIds: ['ustruct'], pushContent: 'Marco needs Structural' });
    expect(calls[2].body).toMatchObject({ hasMention: 1, pushContent: 'Marco needs Structural' });
  });

  it('rejects custom content over 10 KB before calling Nexconn', async () => {
    const calls = stub([ok()]);
    const g = createNexconnGateway(cfg);
    await expect(g.send({ communityId: 'c1', subchannelId: 'p1', fromUserId: 'u', messageType: 'pt:proposal', content: { s: 'x'.repeat(11_000) } })).rejects.toThrow(/10 KB/);
    expect(calls).toHaveLength(0);
  });

  it('fails over to the backup domain on network errors and 5xx', async () => {
    const calls = stub([() => { throw new TypeError('fetch failed'); }, () => new Response('', { status: 502 }), ok({ accessToken: 't' })]);
    const g = createNexconnGateway(cfg);
    await g.issueToken('u', 'n');
    expect(calls.map(c => new URL(c.url).host)).toEqual(['api.sg-light-api.com', 'api-b.sg-light-api.com', 'api.sg-light-api.com']);
  });

  it('surfaces business errors without retrying', async () => {
    const calls = stub([() => new Response(JSON.stringify({ code: 24406, errorMessage: 'user not in community' }), { status: 200 })]);
    const g = createNexconnGateway(cfg);
    await expect(g.addPrivateMembers('c', 's', ['x'])).rejects.toBeInstanceOf(NexconnError);
    expect(calls).toHaveLength(1);
  });

  it('chunks metadata updates at 20 keys and private members at 20 users', async () => {
    const calls = stub([ok()]);
    const g = createNexconnGateway(cfg);
    await g.setMetadata('c', 's', 'M', Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`k${i}`, 'v'])));
    await g.addPrivateMembers('c', 's', Array.from({ length: 21 }, (_, i) => `u${i}`));
    expect(calls.map(c => Object.keys(c.body.metadata ?? {}).length || c.body.userIds.length)).toEqual([20, 5, 20, 1]);
    expect(calls[0].body).toMatchObject({ messageId: 'M', channelId: 'c', subchannelId: 's', userId: 'ptbot' });
  });
});
