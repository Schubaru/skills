-- Append-only audit log of every comment/triage change on the /review board:
-- who did what, when. Insert + select only — the log can't be edited or
-- trimmed from the client. ⚠ Superseded in part by auth-access.sql: policies
-- move to authenticated + allowlist (stage D) and the table gains actor_email.
--
-- Apply in the Supabase SQL editor, or via the Supabase MCP apply_migration.

create table if not exists public.review_events (
  id bigint generated always as identity primary key,
  project_slug text not null,
  kind text not null,
  target_id text,
  actor text,
  detail jsonb,
  at timestamptz not null default now()
);

create index if not exists review_events_slug_at_idx
  on public.review_events (project_slug, at desc);

alter table public.review_events enable row level security;

drop policy if exists "review_events_select" on public.review_events;
drop policy if exists "review_events_insert" on public.review_events;

create policy "review_events_select"
  on public.review_events for select to anon, authenticated
  using (true);

create policy "review_events_insert"
  on public.review_events for insert to anon, authenticated
  with check (true);
