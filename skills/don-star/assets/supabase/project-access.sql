-- Per-project access for the /review board (2026-08-13).
--
-- Two questions, kept separate on purpose:
--   1. CAN YOU SIGN IN AT ALL?  →  access_rules (auth-access.sql, unchanged in
--      shape; this file only adds the `is_admin` flag and the admin policies
--      that let an __DS_ADMIN_DOMAIN__ account edit the table from the UI instead of
--      the Supabase dashboard).
--   2. WHICH PROJECTS CAN YOU OPEN?  →  project_access, below. A project is a
--      code-defined canvas (src/review/projects.ts); the DB only ever holds
--      grants, keyed by that project's pinned slug.
--
-- The boundary this enforces is BOARD-LEVEL (the reviewer, 2026-08-13): you cannot
-- read or write another project's comments, statuses or events, and the folder
-- only lists what you hold. The product routes the frames iframe (/intake,
-- /enroll, /account…) stay reachable by anyone who can sign in — the same as
-- before this file existed. This is preview protection, not product auth.
--
-- Applied in one window: parts A–C are additive; D re-creates the board-data
-- policies, and from the moment it lands a signed-in user with no grant for a
-- slug can no longer read it.

-- === A. Admins ==============================================================

-- Who may DEFINE access. A flag on the existing allowlist rather than a second
-- table: "who gets in" and "who decides who gets in" are the same list, and a
-- flag lets a single email be promoted later without a schema change.
alter table public.access_rules
  add column if not exists is_admin boolean not null default false;

-- the reviewer's call: any __DS_ADMIN_DOMAIN__ address administers access.
update public.access_rules
  set is_admin = true
  where kind = 'domain' and value = '__DS_ADMIN_DOMAIN__';

create or replace function public.is_admin(email text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.access_rules
    where is_admin
      and ((kind = 'email'  and value = lower($1))
        or (kind = 'domain' and value = lower(split_part($1, '@', 2))))
  );
$$;

revoke execute on function public.is_admin(text) from public, anon;
grant execute on function public.is_admin(text) to authenticated, supabase_auth_admin;

/** The signed-in caller's own admin bit — what the UI asks. Argument-less so a
 *  client can never ask about someone else. */
create or replace function public.my_is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_admin(coalesce(auth.jwt()->>'email', ''));
$$;

revoke execute on function public.my_is_admin() from public, anon;
grant execute on function public.my_is_admin() to authenticated;

-- access_rules had RLS on and NO policies (invisible to everyone but the auth
-- hook). It stays invisible to ordinary accounts; admins get full CRUD so the
-- Manage access screen can add a domain or an email without the dashboard.
drop policy if exists "access_rules_admin_select" on public.access_rules;
drop policy if exists "access_rules_admin_insert" on public.access_rules;
drop policy if exists "access_rules_admin_update" on public.access_rules;
drop policy if exists "access_rules_admin_delete" on public.access_rules;

create policy "access_rules_admin_select" on public.access_rules
  for select to authenticated using (public.is_admin(auth.jwt()->>'email'));
create policy "access_rules_admin_insert" on public.access_rules
  for insert to authenticated with check (public.is_admin(auth.jwt()->>'email'));
create policy "access_rules_admin_update" on public.access_rules
  for update to authenticated
  using (public.is_admin(auth.jwt()->>'email'))
  with check (public.is_admin(auth.jwt()->>'email'));
create policy "access_rules_admin_delete" on public.access_rules
  for delete to authenticated using (public.is_admin(auth.jwt()->>'email'));

grant select, insert, update, delete on public.access_rules to authenticated;

-- === B. Project grants ======================================================

-- One row = one rule granting one project. `kind`:
--   'all'    — everyone who can sign in (value null). What the partner carries.
--   'domain' — everyone at a domain that can also sign in.
--   'email'  — one address.
-- A grant never widens sign-in: is_email_allowed() is still required, so
-- de-listing someone in access_rules cuts them off from every project at once.
create table if not exists public.project_access (
  id bigint generated always as identity primary key,
  project_slug text not null,
  kind text not null check (kind in ('all', 'domain', 'email')),
  value text, -- lowercase; null only for 'all'
  note text,
  created_at timestamptz not null default now(),
  created_by text,
  check ((kind = 'all') = (value is null))
);

-- coalesce, because a unique index treats nulls as distinct — without it the
-- 'all' row could be inserted twice and "open to everyone" would have two
-- switches.
create unique index if not exists project_access_rule_uniq
  on public.project_access (project_slug, kind, coalesce(value, ''));

alter table public.project_access enable row level security;

drop policy if exists "project_access_admin_all" on public.project_access;
drop policy if exists "project_access_select" on public.project_access;

-- Admins only, in every direction. An ordinary account never reads this table
-- — it asks my_project_slugs() below, which answers about the caller alone and
-- so can't be used to enumerate who else is on a project.
create policy "project_access_admin_all" on public.project_access
  for all to authenticated
  using (public.is_admin(auth.jwt()->>'email'))
  with check (public.is_admin(auth.jwt()->>'email'));

grant select, insert, update, delete on public.project_access to authenticated;

create or replace function public.can_access_project(email text, slug text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_email_allowed($1) and (
    -- Admins hold every project: they can grant themselves any of it anyway,
    -- and a locked door you carry the key to is theatre.
    public.is_admin($1)
    or exists (
      select 1 from public.project_access pa
      where pa.project_slug = $2
        and (pa.kind = 'all'
          or (pa.kind = 'domain' and pa.value = lower(split_part($1, '@', 2)))
          or (pa.kind = 'email'  and pa.value = lower($1)))
    )
  );
$$;

revoke execute on function public.can_access_project(text, text) from public, anon;
grant execute on function public.can_access_project(text, text) to authenticated;

/** Every slug the caller can open — the folder page's whole query. Returns
 *  grants only; the app intersects them with the code-defined registry, so a
 *  grant for a project that no longer exists is inert rather than an error.
 *  Admins get every slug that appears in the table, plus nothing else — the
 *  registry is the list of what exists, and this function can't know it. */
create or replace function public.my_project_slugs()
returns setof text
language sql stable security definer set search_path = public
as $$
  select distinct pa.project_slug
  from public.project_access pa
  where public.can_access_project(coalesce(auth.jwt()->>'email', ''), pa.project_slug);
$$;

revoke execute on function public.my_project_slugs() from public, anon;
grant execute on function public.my_project_slugs() to authenticated;

-- === C. The projects ======================================================

-- The default project: open to everyone who can sign in. ⚠ Consequence worth
-- knowing before adding a domain to access_rules: a new sign-in domain gets
-- this project automatically. Narrow it by deleting this row and adding
-- per-domain or per-email rows (or from /projects/access).
insert into public.project_access (project_slug, kind, value, note)
  values ('__DS_PROJECT_SLUG__', 'all', null, 'Open to everyone who can sign in')
  on conflict do nothing;

-- Every further project needs a row here (or a grant made in /projects/access)
-- before anyone but an admin sees it. Restricted-by-default shape:
--   insert into public.project_access (project_slug, kind, value, note)
--     values ('<slug>', 'domain', '__DS_ADMIN_DOMAIN__', 'Admins only')
--     on conflict do nothing;

-- === D. Board data, scoped by project ======================================

-- ⚠ THE ONE STEP THAT CAN TAKE ACCESS AWAY. Everything above only adds. From
-- here, a signed-in account with no grant for a slug can no longer read it —
-- so this refuses to run unless the the partner board is still granted to everyone.
-- Without the guard, running D on its own (a partial paste, a re-run against a
-- database where part C was edited) locks every existing reviewer out of the
-- only board there is, and only a dashboard hand-edit brings them back.
do $$
begin
  if not exists (
    select 1 from public.project_access
    where project_slug = '__DS_PROJECT_SLUG__' and kind = 'all'
  ) then
    raise exception
      'Refusing to scope board data: no open grant for __DS_PROJECT_SLUG__. Run part C first, or add the grant you intend.';
  end if;
end $$;

-- Was: select using (true) — any signed-in account read every project's board.
-- Now every row is gated on the project it belongs to. Writes keep the
-- allowlist check they had, folded into can_access_project().

drop policy if exists "review_threads_select" on public.review_threads;
drop policy if exists "review_threads_insert" on public.review_threads;
drop policy if exists "review_threads_update" on public.review_threads;
drop policy if exists "review_threads_delete" on public.review_threads;

create policy "review_threads_select" on public.review_threads
  for select to authenticated
  using (public.can_access_project(auth.jwt()->>'email', project_slug));
create policy "review_threads_insert" on public.review_threads
  for insert to authenticated
  with check (public.can_access_project(auth.jwt()->>'email', project_slug));
create policy "review_threads_update" on public.review_threads
  for update to authenticated
  using (public.can_access_project(auth.jwt()->>'email', project_slug))
  with check (public.can_access_project(auth.jwt()->>'email', project_slug));
create policy "review_threads_delete" on public.review_threads
  for delete to authenticated
  using (public.can_access_project(auth.jwt()->>'email', project_slug));

drop policy if exists "review_statuses_select" on public.review_statuses;
drop policy if exists "review_statuses_insert" on public.review_statuses;
drop policy if exists "review_statuses_update" on public.review_statuses;
drop policy if exists "review_statuses_delete" on public.review_statuses;

create policy "review_statuses_select" on public.review_statuses
  for select to authenticated
  using (public.can_access_project(auth.jwt()->>'email', project_slug));
create policy "review_statuses_insert" on public.review_statuses
  for insert to authenticated
  with check (public.can_access_project(auth.jwt()->>'email', project_slug));
create policy "review_statuses_update" on public.review_statuses
  for update to authenticated
  using (public.can_access_project(auth.jwt()->>'email', project_slug))
  with check (public.can_access_project(auth.jwt()->>'email', project_slug));
create policy "review_statuses_delete" on public.review_statuses
  for delete to authenticated
  using (public.can_access_project(auth.jwt()->>'email', project_slug));

drop policy if exists "review_events_select" on public.review_events;
drop policy if exists "review_events_insert" on public.review_events;

create policy "review_events_select" on public.review_events
  for select to authenticated
  using (public.can_access_project(auth.jwt()->>'email', project_slug));
create policy "review_events_insert" on public.review_events
  for insert to authenticated
  with check (public.can_access_project(auth.jwt()->>'email', project_slug));

-- Not scoped, deliberately:
--   review_thread_reads — own rows only already, and a read mark for a thread
--     you can no longer see is inert.
--   review_people       — the @ directory. It holds name + email, the same
--     pair on every comment byline, and a person can belong to several
--     projects. ⚠ Open item: the @ menu therefore lists everyone on the board,
--     not everyone on THIS project.
--   review_notify_prefs — own rows only. Project filtering of the "every new
--     comment" fan-out happens in the notify-review function, which runs as
--     service role and so must apply can_access_project() itself.
