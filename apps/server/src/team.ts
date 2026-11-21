// Team projects: real projects created by signed-in accounts, with uploaded drawing sheets and invite links.
import { FIXED_SUBCHANNELS, ROLE_INFO, communityIdFor, initialsOf, type Role } from '@pinthread/shared';
import type { AccountRow, UserRow } from './auth';
import { gateway } from './chat/gateway';
import { config } from './config';
import { sql } from './db';
import { log } from './log';
import { enqueue, kickDispatcher } from './outbox';
import { getProject, type ProjectRow } from './repo';
import { HttpError, newId, newLongId } from './util';

/** 5 fixed subchannels + 40 pin rooms keeps each community under Nexconn's 50-subchannel cap, with room for races. */
export const PINS_PER_COMMUNITY = 40;
export const INVITE_TTL_DAYS = 14;
export const MAX_MEMBERS = 100;

export const memberIdFor = () => `m${newLongId()}`;

export interface FileRow { id: string; account_id: string; mime: string; width: number; height: number; created_at: Date }

export async function ownFile(accountId: string, fileId: string): Promise<FileRow> {
  const [f] = await sql<FileRow[]>`select id, account_id, mime, width, height, created_at from files where id = ${fileId}`;
  if (!f || f.account_id !== accountId) throw new HttpError(400, 'bad_file', 'Upload the drawing again.');
  return f;
}

export interface SheetInput { number: string; title: string; revision: string; fileId: string; thumbFileId?: string | null }

async function insertSheet(t: typeof sql | any, projectId: string, s: SheetInput, file: FileRow, createdBy: string) {
  const id = newId();
  const [{ ord }] = await t`select coalesce(max(ord), -1)::int + 1 as ord from sheets where project_id = ${projectId}`;
  await t`insert into sheets (id, project_id, number, title, revision, source, file_id, thumb_file_id, width, height, ord)
    values (${id}, ${projectId}, ${s.number}, ${s.title}, ${s.revision}, 'image', ${file.id}, ${s.thumbFileId ?? null}, ${file.width}, ${file.height}, ${ord})`;
  await t`insert into sheet_revisions (sheet_id, revision, file_id, created_by) values (${id}, ${s.revision}, ${file.id}, ${createdBy})`;
  return id;
}

/** Give a member a Nexconn identity and put them in every community of the project. */
export async function connectMember(projectId: string, user: Pick<UserRow, 'id' | 'name'>) {
  const g = gateway();
  const token = await g.issueToken(user.id, user.name);
  await sql`update users set token = ${token} where id = ${user.id}`;
  const comms = await sql<{ community_id: string }[]>`select community_id from project_communities where project_id = ${projectId} order by ord`;
  for (const c of comms) {
    try { await g.joinCommunity(c.community_id, user.id); }
    catch (e) { log.warn('team.join', { projectId, community: c.community_id, error: String(e) }); }
  }
}

async function setUpCommunity(communityId: string, ownerId: string, name: string) {
  const g = gateway();
  await g.createCommunity(communityId, ownerId, name);
  for (const s of FIXED_SUBCHANNELS) await g.createSubchannel(communityId, s, false);
}

export async function createTeamProject(account: AccountRow, input: { name: string; role: Role; sheet: SheetInput }): Promise<string> {
  const file = await ownFile(account.id, input.sheet.fileId);
  if (input.sheet.thumbFileId) await ownFile(account.id, input.sheet.thumbFileId);
  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from projects where owner_account_id = ${account.id} and created_at > now() - interval '1 day'`;
  if (n >= 20) throw new HttpError(429, 'slow_down', 'You have created a lot of projects today. Try again tomorrow.');
  const projectId = newId();
  const communityId = communityIdFor(projectId);
  const memberId = memberIdFor();
  await sql.begin(async t => {
    await t`insert into projects (id, kind, name, community_id, chat_mode, owner_account_id, ready, claimed_at)
      values (${projectId}, 'team', ${input.name}, ${communityId}, ${config.chatMode}, ${account.id}, true, now())`;
    await t`insert into project_communities (community_id, project_id, ord) values (${communityId}, ${projectId}, 0)`;
    await t`insert into users (id, project_id, role, name, firm, initials, can_hold, account_id, is_admin, email)
      values (${memberId}, ${projectId}, ${input.role}, ${account.name}, ${account.firm}, ${initialsOf(account.name)}, ${ROLE_INFO[input.role].canHold}, ${account.id}, true, ${account.email})`;
    await insertSheet(t, projectId, input.sheet, file, memberId);
  });
  try {
    await setUpCommunity(communityId, memberId, input.name);
    await connectMember(projectId, { id: memberId, name: account.name });
  } catch (e) {
    log.error('team.create', { projectId, error: String(e) });
    await sql`delete from projects where id = ${projectId}`;
    throw new HttpError(502, 'chat_unavailable', "We couldn't set up the project's chat. Try again in a moment.");
  }
  log.info('team.created', { projectId });
  return projectId;
}

export async function addSheet(projectId: string, user: UserRow, s: SheetInput) {
  if (!user.account_id) throw new HttpError(403, 'forbidden', 'Sign in to add sheets.');
  const file = await ownFile(user.account_id, s.fileId);
  if (s.thumbFileId) await ownFile(user.account_id, s.thumbFileId);
  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from sheets where project_id = ${projectId}`;
  if (n >= 200) throw new HttpError(409, 'too_many_sheets', 'This project has reached its sheet limit.');
  const [dupe] = await sql`select 1 from sheets where project_id = ${projectId} and lower(number) = lower(${s.number})`;
  if (dupe) throw new HttpError(409, 'duplicate_sheet', `Sheet ${s.number} already exists. Upload a new revision of it instead.`);
  let id = '';
  await sql.begin(async t => {
    id = await insertSheet(t, projectId, s, file, user.id);
    await t`update projects set updated_at = now() where id = ${projectId}`;
  });
  return id;
}

/**
 * The community that will host a new pin's private room. Demo projects use their one community; team projects open an
 * overflow community when the current ones are full.
 */
export async function communityForNewPin(project: ProjectRow): Promise<string> {
  if (project.kind !== 'team') return project.community_id;
  const pick = async () => {
    const rows = await sql<{ community_id: string; ord: number; n: number }[]>`
      select pc.community_id, pc.ord, (select count(*)::int from pins p where p.community_id = pc.community_id) as n
      from project_communities pc where pc.project_id = ${project.id} order by pc.ord`;
    return { free: rows.find(r => r.n < PINS_PER_COMMUNITY), next: (rows.at(-1)?.ord ?? 0) + 1 };
  };
  const { free, next } = await pick();
  if (free) return free.community_id;
  const communityId = `${project.community_id}x${next}`;
  const [created] = await sql`insert into project_communities (community_id, project_id, ord) values (${communityId}, ${project.id}, ${next})
    on conflict do nothing returning community_id`;
  if (created) {
    const members = await sql<{ id: string; is_admin: boolean }[]>`select id, is_admin from users where project_id = ${project.id} and active order by is_admin desc, created_at`;
    try {
      await setUpCommunity(communityId, members[0].id, project.name);
      for (const m of members) await gateway().joinCommunity(communityId, m.id);
    } catch (e) {
      await sql`delete from project_communities where community_id = ${communityId}`;
      log.error('team.overflow', { projectId: project.id, error: String(e) });
      throw new HttpError(502, 'chat_unavailable', "We couldn't open a room for this issue. Try again in a moment.");
    }
    log.info('team.overflow.created', { projectId: project.id, communityId });
  }
  return communityId;
}

// ---------------------------------------------------------------- invites

export interface InviteRow {
  id: string; token: string; project_id: string; role: Role; created_by: string; created_at: Date; expires_at: Date; revoked_at: Date | null; uses: number;
}

export async function createInvite(projectId: string, role: Role, createdBy: string) {
  const id = newId();
  const token = `${newLongId()}${newLongId()}`;
  await sql`insert into invites (id, token, project_id, role, created_by, expires_at)
    values (${id}, ${token}, ${projectId}, ${role}, ${createdBy}, now() + make_interval(days => ${INVITE_TTL_DAYS}))`;
  const [row] = await sql<InviteRow[]>`select * from invites where id = ${id}`;
  return row;
}

export async function liveInvite(token: string): Promise<InviteRow & { project_name: string; inviter: string }> {
  const [inv] = await sql<(InviteRow & { project_name: string; inviter: string; kind: string })[]>`
    select i.*, p.name as project_name, p.kind, u.name as inviter from invites i
    join projects p on p.id = i.project_id left join users u on u.id = i.created_by where i.token = ${token}`;
  if (!inv || inv.kind !== 'team') throw new HttpError(404, 'invite_invalid', 'This invite link is not valid. Ask for a new one.');
  if (inv.revoked_at) throw new HttpError(410, 'invite_revoked', 'This invite link was turned off. Ask for a new one.');
  if (new Date(inv.expires_at).getTime() < Date.now()) throw new HttpError(410, 'invite_expired', 'This invite link has expired. Ask for a new one.');
  return inv;
}

export async function acceptInvite(token: string, account: AccountRow): Promise<string> {
  const inv = await liveInvite(token);
  const projectId = inv.project_id;
  const [existing] = await sql<UserRow[]>`select * from users where project_id = ${projectId} and account_id = ${account.id}`;
  if (existing?.active) return projectId;
  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from users where project_id = ${projectId} and active`;
  if (n >= MAX_MEMBERS) throw new HttpError(409, 'project_full', 'This project has reached its member limit.');
  let userId: string;
  if (existing) {
    userId = existing.id; // re-invited after being removed: same identity, so their earlier messages stay theirs
    await sql`update users set active = true, role = ${inv.role}, can_hold = ${ROLE_INFO[inv.role].canHold}, name = ${account.name},
      firm = ${account.firm}, initials = ${initialsOf(account.name)}, email = ${account.email} where id = ${userId}`;
  } else {
    userId = memberIdFor();
    await sql`insert into users (id, project_id, role, name, firm, initials, can_hold, account_id, email)
      values (${userId}, ${projectId}, ${inv.role}, ${account.name}, ${account.firm}, ${initialsOf(account.name)}, ${ROLE_INFO[inv.role].canHold}, ${account.id}, ${account.email})`;
  }
  await sql`update invites set uses = uses + 1 where id = ${inv.id}`;
  await sql`update projects set updated_at = now() where id = ${projectId}`;
  await connectMember(projectId, { id: userId, name: account.name });
  if (inv.role === 'site') {
    // Site leads are in every issue room.
    const pins = await sql<{ id: string; community_id: string; subchannel_id: string }[]>`select id, community_id, subchannel_id from pins where project_id = ${projectId}`;
    for (const p of pins) await enqueue(sql, projectId, `${projectId}:members:${p.id}:${userId}:${Date.now()}`, { kind: 'members', communityId: p.community_id, subchannelId: p.subchannel_id, members: [userId] });
    kickDispatcher();
  }
  await sql`insert into events (project_id, type, actor_id, payload) values (${projectId}, 'member.joined', ${userId}, ${sql.json({ role: inv.role, inviteId: inv.id } as never)})`;
  return projectId;
}

export async function deleteTeamProject(projectId: string) {
  const project = await getProject(sql, projectId);
  const comms = await sql<{ community_id: string }[]>`select community_id from project_communities where project_id = ${projectId}`;
  for (const c of comms) {
    try { await gateway().dismissCommunity(c.community_id); } catch (e) { log.warn('team.dismiss', { projectId, error: String(e) }); }
  }
  await sql.begin(async t => {
    await t`delete from files where id in (select r.file_id from sheet_revisions r join sheets s on s.id = r.sheet_id where s.project_id = ${projectId}
      union select s.file_id from sheets s where s.project_id = ${projectId} union select s.thumb_file_id from sheets s where s.project_id = ${projectId})`;
    await t`delete from projects where id = ${project.id}`;
    await t`delete from outbox where project_id = ${project.id}`;
  });
  log.info('team.deleted', { projectId });
}

/** Files uploaded but never attached to a sheet (abandoned uploads) are removed after a day. */
export async function cleanupOrphanFiles() {
  await sql`delete from files f where f.created_at < now() - interval '1 day'
    and not exists (select 1 from sheet_revisions r where r.file_id = f.id)
    and not exists (select 1 from sheets s where s.file_id = f.id or s.thumb_file_id = f.id)`;
}
