-- N00B Inc schema: everything lives in schema `noob`, reached only by the dedicated login role `noob`.
-- Run as the project owner (Supabase MCP apply_migration or the SQL editor). Put the role's password in the `create role` line first.

create schema if not exists noob;

create table noob.machines (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);

create table noob.agents (
  id text primary key,
  machine_id uuid references noob.machines(id) on delete cascade,
  session_id text not null,
  parent_id text references noob.agents(id) on delete set null,
  kind text not null default 'session',
  title text,
  model text,
  cwd text,
  git_branch text,
  status text not null default 'idle',
  status_detail text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  updated_at timestamptz not null default now(),
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cache_read_tokens bigint not null default 0,
  cache_write_tokens bigint not null default 0,
  turns integer not null default 0,
  tool_calls integer not null default 0,
  livery smallint not null default 0,
  allowed_tools text[] not null default '{}',
  stop_requested boolean not null default false,
  dismissed boolean not null default false,
  status_ts bigint not null default 0,
  hold_until timestamptz,
  name text,
  app text not null default 'code',
  scheduled boolean not null default false
);
create index agents_updated_idx on noob.agents (updated_at);

create table noob.blockers (
  id uuid primary key default gen_random_uuid(),
  agent_id text not null references noob.agents(id) on delete cascade,
  kind text not null,
  tool text,
  input jsonb,
  prompt text,
  status text not null default 'open',
  decision jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index blockers_status_idx on noob.blockers (status, created_at desc);

create table noob.commands (
  id uuid primary key default gen_random_uuid(),
  agent_id text not null references noob.agents(id) on delete cascade,
  kind text not null,
  text text,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);
create index commands_pending_idx on noob.commands (agent_id, status);

create table noob.events (
  id bigserial primary key,
  agent_id text references noob.agents(id) on delete cascade,
  kind text not null,
  tool text,
  summary text,
  payload jsonb,
  created_at timestamptz not null default now()
);
create index events_agent_idx on noob.events (agent_id, id desc);
create index events_created_idx on noob.events (created_at);
create index events_viewer_recent on noob.events (created_at) where kind = 'viewer';

create table noob.settings (
  id integer primary key default 1 check (id = 1),
  hold_mode text not null default 'open',
  hold_seconds integer not null default 600,
  hold_on_stop boolean not null default false,
  retain_days integer not null default 7,
  dashboard_seen_at timestamptz,
  cleaned_at timestamptz,
  share_token text,
  office_look text not null default 'office' check (office_look in ('office', 'studio'))
);
insert into noob.settings (id) values (1);

create table noob.viewers (
  key uuid primary key default gen_random_uuid(),
  token text not null,
  name text not null,
  created_at timestamptz not null default now()
);
create unique index viewers_token_name on noob.viewers (token, lower(name));

-- The app's only way in. It can read and write these tables and nothing else in the project.
create role noob login password '<NOOB_ROLE_PASSWORD>';
grant usage on schema noob to noob;
grant select, insert, update, delete on all tables in schema noob to noob;
grant usage, select on all sequences in schema noob to noob;
-- Keep the tables out of Supabase's public REST API.
revoke all on schema noob from anon, authenticated;
