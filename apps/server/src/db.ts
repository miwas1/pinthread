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
`;

export async function migrate(db: Sql = sql) {
  await db.unsafe(SCHEMA);
}
