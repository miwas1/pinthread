// Transactional outbox: domain changes and the Nexconn calls they cause are written in one DB transaction.
// The dispatcher delivers rows in id order per project; a failing row blocks later rows for that project (so a
// card is never sent before its room exists) and is retried with backoff.
import { EventEmitter } from 'node:events';
import { gateway, type SendSpec } from './chat/gateway';
import { sql, type Q } from './db';
import { log } from './log';

export type OutboxItem =
  | { kind: 'subchannel'; communityId: string; subchannelId: string; isPrivate: boolean; members: string[]; pinId?: string }
  | { kind: 'send'; spec: SendSpec; record?: { table: 'proposals' | 'evidence'; id: string } }
  | { kind: 'metadata'; communityId: string; subchannelId: string; proposalId: string; metadata: Record<string, string> };

const bus = new EventEmitter();
export const outboxEvents = bus;

export async function enqueue(db: Q, projectId: string, dedupeKey: string, item: OutboxItem) {
  await db`insert into outbox (project_id, dedupe_key, kind, payload) values (${projectId}, ${dedupeKey}, ${item.kind}, ${db.json(item as never)})
    on conflict (dedupe_key) do nothing`;
}

async function handle(item: OutboxItem): Promise<unknown> {
  const g = gateway();
  switch (item.kind) {
    case 'subchannel': {
      await g.createSubchannel(item.communityId, item.subchannelId, item.isPrivate);
      if (item.isPrivate && item.members.length) await g.addPrivateMembers(item.communityId, item.subchannelId, item.members);
      if (item.pinId) await sql`update pins set room_ready = true where id = ${item.pinId}`;
      return { ok: true };
    }
    case 'send': {
      const r = await g.send(item.spec);
      if (item.record?.table === 'proposals' && r.messageId) await sql`update proposals set message_id = ${r.messageId} where id = ${item.record.id}`;
      if (item.record?.table === 'evidence' && r.messageId) await sql`update evidence set message_id = coalesce(message_id, ${r.messageId}) where id = ${item.record.id}`;
      return r;
    }
    case 'metadata': {
      const [p] = await sql<{ message_id: string | null }[]>`select message_id from proposals where id = ${item.proposalId}`;
      if (!p) return { skipped: 'proposal deleted' };
      if (!p.message_id) throw new Error(`proposal ${item.proposalId} card not sent yet`);
      await g.setMetadata(item.communityId, item.subchannelId, p.message_id, item.metadata);
      return { ok: true };
    }
  }
}

let running = false;
let again = false;

/** Deliver pending rows. Returns the number delivered. */
export async function dispatchOnce(onlyProject?: string): Promise<number> {
  if (running) { again = true; return 0; }
  running = true;
  let delivered = 0;
  try {
    do {
      again = false;
      const rows = onlyProject
        ? await sql`select * from outbox where sent_at is null and project_id = ${onlyProject} and next_attempt_at <= now() order by id limit 200`
        : await sql`select * from outbox where sent_at is null and next_attempt_at <= now() order by id limit 200`;
      const blocked = new Set<string>();
      for (const r of rows) {
        if (blocked.has(r.project_id)) continue;
        try {
          const result = await handle(r.payload as OutboxItem);
          await sql`update outbox set sent_at = now(), attempts = attempts + 1, result = ${sql.json((result ?? null) as never)}, last_error = null where id = ${r.id}`;
          delivered++;
          bus.emit('delivered', r);
        } catch (e) {
          blocked.add(r.project_id);
          const backoff = Math.min(60, 2 ** Math.min(r.attempts, 6));
          await sql`update outbox set attempts = attempts + 1, last_error = ${String(e).slice(0, 500)},
            next_attempt_at = now() + make_interval(secs => ${backoff}) where id = ${r.id}`;
          log.warn('outbox.retry', { id: r.id, kind: r.kind, attempts: r.attempts + 1, error: String(e) });
        }
      }
      if (rows.length === 200) again = true;
    } while (again);
  } finally {
    running = false;
  }
  return delivered;
}

/** Drain a project's queue synchronously (used by seeding). Throws if rows keep failing. */
export async function drainProject(projectId: string, timeoutMs = 60_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    await dispatchOnce(projectId);
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from outbox where project_id = ${projectId} and sent_at is null`;
    if (n === 0) return;
    await new Promise(r => setTimeout(r, 250));
    await sql`update outbox set next_attempt_at = now() where project_id = ${projectId} and sent_at is null and attempts < 4`;
  }
  throw new Error(`outbox for ${projectId} did not drain`);
}

let timer: NodeJS.Timeout | null = null;
export function kickDispatcher() { setImmediate(() => { dispatchOnce().catch(e => log.error('outbox.dispatch', { error: String(e) })); }); }
export function startDispatcher(intervalMs = 1000) {
  timer = setInterval(kickDispatcher, intervalMs);
  timer.unref();
}
export function stopDispatcher() { if (timer) clearInterval(timer); }
