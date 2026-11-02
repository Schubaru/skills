-- Email+OTP auth for the preview: who may sign in, and identity stamped onto
-- review data. Replaces the shared-password trust model (see middleware.ts).
--
-- Applied in two stages:
--   A–C (additive, safe anytime): access rules + hook fn + attribution columns.
--   D  (the RLS flip): run IN THE SAME WINDOW as deploying the auth build —
--      the moment D applies, the old anon-writing app can no longer write.
--
-- After A–B, register the hook in the dashboard:
--   Authentication → Hooks → Before User Created → Postgres function
--   → public.hook_before_user_created
-- Until it's registered, any email can create an account (RLS still limits
-- what such an account can do once D is applied).

-- === A. Access rules + shared predicate =====================================

-- Who may sign in. 'domain' rows allow a whole domain; 'email' rows allow one
-- address. Narrowing later = delete the domain row, insert email rows —
-- is_email_allowed() is also used by the RLS write policies below, so
-- de-listing someone cuts off their data access immediately, mid-session.
create table public.access_rules (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('domain', 'email')),
  value text not null, -- stored lowercase
  note text,
  created_at timestamptz not null default now(),
  unique (kind, value)
);

-- RLS on with no policies: the rules are invisible to anon/authenticated;
-- only the auth hook (via security definer) and the dashboard read them.
alter table public.access_rules enable row level security;
grant select on public.access_rules to supabase_auth_admin;

insert into public.access_rules (kind, value, note) values
  ('domain', '__DS_ADMIN_DOMAIN__', 'Admins');

create or replace function public.is_email_allowed(email text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.access_rules
    where (kind = 'email'  and value = lower(email))
       or (kind = 'domain' and value = lower(split_part(email, '@', 2)))
  );
$$;

revoke execute on function public.is_email_allowed(text) from public, anon;
grant execute on function public.is_email_allowed(text) to supabase_auth_admin, authenticated;

-- === B. Before User Created hook ============================================

-- Rejects a disallowed email BEFORE the account exists and before any OTP
-- email is sent. Registered manually in the dashboard (see header).
create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
  if public.is_email_allowed(event->'user'->>'email') then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', 'This email isn''t authorized.'
    )
  );
end;
$$;

revoke execute on function public.hook_before_user_created(jsonb) from public, anon, authenticated;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;

-- === C. Attribution columns =================================================

-- Verified identity alongside the display-name strings. Nullable: legacy rows
-- and agent-seeded rows (agents author as "/skill" and never sign in) stay null.
alter table public.review_threads
  add column if not exists author_email text,
  add column if not exists author_id uuid;
alter table public.review_statuses
  add column if not exists set_by_email text;
alter table public.review_events
  add column if not exists actor_email text;
-- Reply attribution lives inside review_threads.replies jsonb (email per reply).

-- === D. RLS flip (deploy-time — see header) =================================

-- Reads require a signed-in user; writes additionally require the email to
-- still be allowlisted. review_events stays append-only (no update/delete).

drop policy if exists "review_threads_select" on public.review_threads;
drop policy if exists "review_threads_insert" on public.review_threads;
drop policy if exists "review_threads_update" on public.review_threads;
drop policy if exists "review_threads_delete" on public.review_threads;

create policy "review_threads_select" on public.review_threads
  for select to authenticated using (true);
create policy "review_threads_insert" on public.review_threads
  for insert to authenticated with check (public.is_email_allowed(auth.jwt()->>'email'));
create policy "review_threads_update" on public.review_threads
  for update to authenticated
  using (public.is_email_allowed(auth.jwt()->>'email'))
  with check (public.is_email_allowed(auth.jwt()->>'email'));
create policy "review_threads_delete" on public.review_threads
  for delete to authenticated using (public.is_email_allowed(auth.jwt()->>'email'));

drop policy if exists "review_statuses_select" on public.review_statuses;
drop policy if exists "review_statuses_insert" on public.review_statuses;
drop policy if exists "review_statuses_update" on public.review_statuses;
drop policy if exists "review_statuses_delete" on public.review_statuses;

create policy "review_statuses_select" on public.review_statuses
  for select to authenticated using (true);
create policy "review_statuses_insert" on public.review_statuses
  for insert to authenticated with check (public.is_email_allowed(auth.jwt()->>'email'));
create policy "review_statuses_update" on public.review_statuses
  for update to authenticated
  using (public.is_email_allowed(auth.jwt()->>'email'))
  with check (public.is_email_allowed(auth.jwt()->>'email'));
create policy "review_statuses_delete" on public.review_statuses
  for delete to authenticated using (public.is_email_allowed(auth.jwt()->>'email'));

drop policy if exists "review_events_select" on public.review_events;
drop policy if exists "review_events_insert" on public.review_events;

create policy "review_events_select" on public.review_events
  for select to authenticated using (true);
create policy "review_events_insert" on public.review_events
  for insert to authenticated with check (public.is_email_allowed(auth.jwt()->>'email'));
