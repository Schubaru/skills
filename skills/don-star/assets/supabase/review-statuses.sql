-- Shared /review triage state (sign off / needs work / broken) with
-- attribution: who set it, when. ⚠ Superseded in part by auth-access.sql:
-- the permissive anon policies below are replaced (stage D) with
-- authenticated + allowlist policies, and the table gains set_by_email.
--
-- Apply in the Supabase SQL editor, or via the Supabase MCP apply_migration.

create table if not exists public.review_statuses (
  project_slug text not null,
  scope text not null check (scope in ('screens', 'flows')),
  target_id text not null,
  status text check (status in ('good', 'needs', 'broken')),
  note text,
  set_by text,
  set_at bigint,
  updated_at timestamptz not null default now(),
  primary key (project_slug, scope, target_id)
);

alter table public.review_statuses enable row level security;

drop policy if exists "review_statuses_select" on public.review_statuses;
drop policy if exists "review_statuses_insert" on public.review_statuses;
drop policy if exists "review_statuses_update" on public.review_statuses;
drop policy if exists "review_statuses_delete" on public.review_statuses;

create policy "review_statuses_select"
  on public.review_statuses for select to anon, authenticated
  using (true);

create policy "review_statuses_insert"
  on public.review_statuses for insert to anon, authenticated
  with check (true);

create policy "review_statuses_update"
  on public.review_statuses for update to anon, authenticated
  using (true)
  with check (true);

create policy "review_statuses_delete"
  on public.review_statuses for delete to anon, authenticated
  using (true);

-- Realtime so open boards see triage changes without a refresh.
do $$
begin
  alter publication supabase_realtime add table public.review_statuses;
exception
  when duplicate_object then null;
end $$;
