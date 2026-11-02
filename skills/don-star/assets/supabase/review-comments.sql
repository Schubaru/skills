-- Shared /review board comments.
-- ⚠ Superseded in part by auth-access.sql: since the email+OTP gate, the
-- permissive anon policies below are replaced (stage D) with authenticated +
-- allowlist policies, and the table gains author_email/author_id columns.
--
-- Apply in the Supabase SQL editor, or: supabase db execute -f supabase/review-comments.sql

create table if not exists public.review_threads (
  id text primary key,
  project_slug text not null,
  anchor jsonb not null,
  author text not null,
  body text not null default '',
  at bigint not null,
  resolved boolean not null default false,
  image text,
  meta jsonb,
  replies jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists review_threads_project_slug_idx
  on public.review_threads (project_slug);

create index if not exists review_threads_at_idx
  on public.review_threads (project_slug, at desc);

alter table public.review_threads enable row level security;

drop policy if exists "review_threads_select" on public.review_threads;
drop policy if exists "review_threads_insert" on public.review_threads;
drop policy if exists "review_threads_update" on public.review_threads;
drop policy if exists "review_threads_delete" on public.review_threads;

create policy "review_threads_select"
  on public.review_threads for select to anon, authenticated
  using (true);

create policy "review_threads_insert"
  on public.review_threads for insert to anon, authenticated
  with check (true);

create policy "review_threads_update"
  on public.review_threads for update to anon, authenticated
  using (true)
  with check (true);

create policy "review_threads_delete"
  on public.review_threads for delete to anon, authenticated
  using (true);

-- Realtime so open boards see new client comments without a refresh.
do $$
begin
  alter publication supabase_realtime add table public.review_threads;
exception
  when duplicate_object then null;
end $$;
