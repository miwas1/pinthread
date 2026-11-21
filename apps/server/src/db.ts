import postgres from 'postgres';
import { config } from './config';

export type Sql = postgres.Sql<Record<string, unknown>>;
export type Tx = postgres.TransactionSql<Record<string, unknown>>;
export type Q = Sql | Tx;

export let sql: Sql = postgres(config.databaseUrl, { max: 10, onnotice: () => {}, idle_timeout: 30 });

/** Tests point the app at another database. */
export function useDatabase(url: string) {
  sql = postgres(url, { max: 10, onnotice: () => {}, idle_timeout: 30 });
  return sql;
}

const SCHEMA = /* sql */ `
create table if not exists projects (
  id text primary key, kind text not null default 'demo', name text not null,
  community_id text not null unique, sheet_number text not null, sheet_title text not null, revision text not null,
  pin_seq int not null default 0, ready boolean not null default false, claimed_at timestamptz,
  exported_at timestamptz, created_at timestamptz not null default now(), expires_at timestamptz);
create table if not exists users (
  id text primary key, project_id text not null references projects(id) on delete cascade,
  role text not null, name text not null, firm text not null, initials text not null,
  can_hold boolean not null default false, token text, first_connected_at timestamptz,
  created_at timestamptz not null default now());
alter table projects add column if not exists chat_mode text not null default 'local';
create index if not exists users_project on users(project_id);
create table if not exists pins (
  id text primary key, project_id text not null references projects(id) on delete cascade, number int not null,
  x double precision not null, y double precision not null, grid_ref text not null,
  title text not null, question text not null, discipline text not null, severity text not null,
  subchannel_id text not null, created_by text not null, created_at timestamptz not null default now(),
  status text not null default 'open', status_label text not null default 'Open', state_seq int not null default 1,
  current_proposal_id text, waiting_since timestamptz default now(), room_ready boolean not null default false,
  unique (project_id, number));
create table if not exists pin_reviewers (
  pin_id text not null references pins(id) on delete cascade, user_id text not null references users(id) on delete cascade,
  ord int not null default 0, primary key (pin_id, user_id));
create table if not exists proposals (
  id text primary key, pin_id text not null references pins(id) on delete cascade, version int not null,
  author_id text not null, summary text not null, route jsonb, cost_impact text, schedule_impact text,
  revision text not null, message_id text, created_at timestamptz not null default now(), unique (pin_id, version));
create table if not exists signoffs (
  id text primary key, pin_id text not null references pins(id) on delete cascade,
  proposal_id text not null references proposals(id) on delete cascade, reviewer_id text not null,
  revision text not null, verdict text not null, comment text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (proposal_id, reviewer_id, revision));
create table if not exists holds (
  id text primary key, pin_id text not null references pins(id) on delete cascade, placed_by text not null,
  reason text not null, clear_condition text not null, status text not null default 'active',
  cleared_by text, cleared_at timestamptz, note text, created_at timestamptz not null default now());
create table if not exists evidence (
  id text primary key, pin_id text not null references pins(id) on delete cascade,
  hold_id text references holds(id) on delete cascade, author_id text not null, image_url text not null,
  caption text not null, message_id text, created_at timestamptz not null default now());
create table if not exists events (
  id bigserial primary key, project_id text not null, pin_id text, type text not null, actor_id text,
  payload jsonb, created_at timestamptz not null default now());
create table if not exists outbox (
  id bigserial primary key, project_id text not null, dedupe_key text not null unique, kind text not null,
  payload jsonb not null, attempts int not null default 0, next_attempt_at timestamptz not null default now(),
  sent_at timestamptz, result jsonb, last_error text, created_at timestamptz not null default now());
create index if not exists outbox_pending on outbox (id) where sent_at is null;
alter table outbox add column if not exists locked_until timestamptz;
create table if not exists idempotency (
  key text not null, user_id text not null, response jsonb not null, created_at timestamptz not null default now(),
  primary key (key, user_id));
create table if not exists presence (id bigserial primary key, user_id text not null, status text not null, os text, at timestamptz not null default now());
create table if not exists analytics (
  id bigserial primary key, project_id text, project_kind text, user_id text, name text not null,
  props jsonb, at timestamptz not null default now());
create table if not exists local_members (community_id text not null, subchannel_id text not null default '', user_id text not null, primary key (community_id, subchannel_id, user_id));
create table if not exists local_messages (
  seq bigserial primary key, message_id text not null unique, community_id text not null, subchannel_id text not null,
  sender_id text not null, type text not null, content jsonb not null, metadata jsonb not null default '{}',
  sent_at bigint not null);
create index if not exists local_messages_sub on local_messages (community_id, subchannel_id, sent_at);
create table if not exists uploads (id text primary key, mime text not null, bytes bytea not null, created_at timestamptz not null default now());

-- Accounts and team projects ------------------------------------------------------------------------------------
create table if not exists accounts (
  id text primary key, email text not null unique, name text not null, firm text not null default '',
  password_hash text not null, created_at timestamptz not null default now(), last_login_at timestamptz);
alter table accounts add column if not exists sessions_valid_after timestamptz not null default '2000-01-01';
alter table users add column if not exists account_id text references accounts(id) on delete set null;
alter table users add column if not exists is_admin boolean not null default false;
alter table users add column if not exists active boolean not null default true;
alter table users add column if not exists email text;
create unique index if not exists users_project_account on users (project_id, account_id) where account_id is not null;
create index if not exists users_account on users (account_id);
alter table projects add column if not exists owner_account_id text;
alter table projects add column if not exists updated_at timestamptz not null default now();
alter table projects alter column sheet_number drop not null;
alter table projects alter column sheet_title drop not null;
alter table projects alter column revision drop not null;
update projects set kind = 'team' where kind = 'pilot';

-- Drawing files uploaded by an account. Never served publicly: sheet images are read through a membership check.
create table if not exists files (
  id text primary key, account_id text not null, mime text not null, bytes bytea not null,
  width int not null, height int not null, created_at timestamptz not null default now());
create table if not exists sheets (
  id text primary key, project_id text not null references projects(id) on delete cascade,
  number text not null, title text not null, revision text not null, source text not null default 'vector',
  file_id text, width int not null default 1400, height int not null default 990, ord int not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create index if not exists sheets_project on sheets (project_id, ord);
alter table sheets add column if not exists thumb_file_id text;
create table if not exists sheet_revisions (
  id bigserial primary key, sheet_id text not null references sheets(id) on delete cascade, revision text not null,
  file_id text, created_by text, created_at timestamptz not null default now());
alter table pins add column if not exists sheet_id text references sheets(id) on delete cascade;
-- Projects created before sheets existed get their one built-in sheet.
insert into sheets (id, project_id, number, title, revision, source)
  select 's' || p.id, p.id, p.sheet_number, p.sheet_title, p.revision, 'vector' from projects p
  where p.sheet_number is not null and not exists (select 1 from sheets s where s.project_id = p.id);
insert into sheet_revisions (sheet_id, revision)
  select s.id, s.revision from sheets s where not exists (select 1 from sheet_revisions r where r.sheet_id = s.id);
-- Pins without a sheet (made before sheets existed, or by an older instance during a deploy) go on the project's first sheet.
update pins p set sheet_id = (select s.id from sheets s where s.project_id = p.project_id order by s.ord, s.created_at limit 1)
  where p.sheet_id is null;
create index if not exists pins_sheet on pins (sheet_id);

-- A Nexconn community holds at most 50 subchannels (5 fixed + one per pin), so large projects add overflow communities.
create table if not exists project_communities (
  community_id text primary key, project_id text not null references projects(id) on delete cascade, ord int not null,
  created_at timestamptz not null default now());
insert into project_communities (community_id, project_id, ord) select community_id, id, 0 from projects on conflict do nothing;
alter table pins add column if not exists community_id text;
update pins set community_id = p.community_id from projects p where pins.project_id = p.id and pins.community_id is null;

create table if not exists invites (
  id text primary key, token text not null unique, project_id text not null references projects(id) on delete cascade,
  role text not null, created_by text not null, created_at timestamptz not null default now(),
  expires_at timestamptz not null, revoked_at timestamptz, uses int not null default 0);
create index if not exists invites_project on invites (project_id);
`;

export async function migrate(db: Sql = sql) {
  await db.unsafe(SCHEMA);
}
