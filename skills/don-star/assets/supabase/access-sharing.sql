-- Sharing a project, and asking for one (2026-09-18). Additive to
-- project-access.sql: nothing here takes access away, and every statement is
-- re-runnable.
--
-- THE ONE NEW IDEA: there is exactly ONE project level. Anyone who can open a
-- project may manage access FOR THAT PROJECT — no role column, no owner, no
-- editor. Admins (access_rules.is_admin) manage everything, everywhere. the reviewer's
-- call: a board is a shared room, and whoever is in it can hold the door.
--
-- THE GUARDRAIL that makes that safe: a non-admin can only share with someone
-- who could ALREADY sign in. project_access never widens access_rules, so the
-- two questions project-access.sql kept separate stay separate:
--   "can you sign in at all?"   → access_rules, admins only
--   "which projects can you open?" → project_access, anyone on the project
-- A non-admin naming an unknown domain gets told to ask an admin, rather than
-- silently inviting the internet.
--
-- Why functions and not policies: project_access stays admin-only at the table
-- level (part B of project-access.sql), so a client can never enumerate or
-- edit grants directly. Every non-admin path below is a security definer
-- function that derives the caller from the JWT — the caller's email is never
-- an argument, so no call can be made "as" someone else.
--
-- Parts:
--   A. display_name on access_rules
--   B. access_requests (a person asking to be let in)
--   C. the functions the Manage access screen calls
--
-- The EMAIL for a request is Wave 1 (an Edge Function, service role). A
-- request from someone who cannot sign in at all therefore cannot reach these
-- functions — that path posts through the Edge Function instead, which is why
-- access_requests.project_slug is nullable: null means "let me sign in", a
-- slug means "let me onto this board".

-- === A. A name to go with an address ========================================

-- Only meaningful on 'email' rows: the name a person's comments should carry
-- before they have ever signed in and upserted their own review_people row.
alter table public.access_rules
  add column if not exists display_name text;

-- === B. Requests ============================================================

create table if not exists public.access_requests (
  id bigint generated always as identity primary key,
  email text not null, -- stored lowercase
  name text,
  -- null = "let me sign in at all" (admins decide). A slug = "let me onto this
  -- board" (anyone already on that board can decide).
  project_slug text,
  message text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  created_at timestamptz not null default now(),
  decided_by text,
  decided_at timestamptz
);

-- One OPEN request per person per project. coalesce, because a unique index
-- treats nulls as distinct and the sign-in request (slug null) needs the same
-- protection. Partial, so a denied request doesn't block asking again later.
create unique index if not exists access_requests_pending_uniq
  on public.access_requests (email, coalesce(project_slug, ''))
  where status = 'pending';

alter table public.access_requests enable row level security;

drop policy if exists "access_requests_select" on public.access_requests;
drop policy if exists "access_requests_admin_all" on public.access_requests;

-- Read: admins, your own rows, and rows for a project you can open — the last
-- is what puts the request in front of the people who can act on it. There is
-- deliberately NO insert/update/delete policy for anyone but an admin: writes
-- go through the functions below, so the guardrail can't be stepped around.
create policy "access_requests_select" on public.access_requests
  for select to authenticated
  using (
    public.is_admin(auth.jwt()->>'email')
    or lower(coalesce(auth.jwt()->>'email', '')) = email
    or (project_slug is not null
        and public.can_access_project(auth.jwt()->>'email', project_slug))
  );

create policy "access_requests_admin_all" on public.access_requests
  for all to authenticated
  using (public.is_admin(auth.jwt()->>'email'))
  with check (public.is_admin(auth.jwt()->>'email'));

grant select, insert, update, delete on public.access_requests to authenticated;

-- === C. The functions =======================================================

/** Who is on a project, for the Manage access screen. Gated on the CALLER
 *  being able to open it: you can never learn who is on a board you can't see.
 *  Names come from the @ directory first (a person who has signed in renamed
 *  themselves there), falling back to the name whoever invited them typed. */
create or replace function public.project_members(slug text)
returns table (id bigint, kind text, value text, note text, display_name text)
language plpgsql stable security definer set search_path = public
as $$
declare
  caller text := lower(coalesce(auth.jwt()->>'email', ''));
begin
  if not public.can_access_project(caller, slug) then
    raise exception 'You do not have access to this project.';
  end if;
  return query
    select pa.id, pa.kind, pa.value, pa.note,
           coalesce(rp.name, ar.display_name)
    from public.project_access pa
    left join public.review_people rp
      on pa.kind = 'email' and rp.email = pa.value
    left join public.access_rules ar
      on ar.kind = 'email' and ar.value = pa.value
    where pa.project_slug = project_members.slug
    order by pa.kind, pa.value;
end;
$$;

revoke execute on function public.project_members(text) from public, anon;
grant execute on function public.project_members(text) to authenticated;

/** Add one person or one domain to a project. Returns the grant's id — the
 *  existing one when the grant is already there, so inviting twice is not an
 *  error the UI has to explain.
 *
 *  A NON-ADMIN may only name someone who could already sign in. An ADMIN may
 *  name anyone, and the sign-in row is created for them in the same call —
 *  that is the whole difference between the two, and it is the only place the
 *  allowlist widens. */
create or replace function public.share_project(
  slug text,
  kind text,
  value text,
  display_name text default null
)
returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  caller text := lower(coalesce(auth.jwt()->>'email', ''));
  admin boolean := public.is_admin(caller);
  v text := lower(btrim(coalesce(value, '')));
  n text := nullif(btrim(coalesce(display_name, '')), '');
  allowed boolean;
  grant_id bigint;
begin
  if not public.can_access_project(caller, slug) then
    raise exception 'You do not have access to this project.';
  end if;
  if kind not in ('domain', 'email') then
    raise exception 'Choose a person or a domain.';
  end if;
  if v = '' then
    raise exception 'Enter an email address or a domain.';
  end if;

  -- Already able to sign in? For an email that is is_email_allowed (an email
  -- row OR its domain); for a domain it is the domain row itself, since a
  -- domain grant is only meaningful when the whole domain can get in.
  if kind = 'email' then
    allowed := public.is_email_allowed(v);
  else
    allowed := exists (
      select 1 from public.access_rules ar where ar.kind = 'domain' and ar.value = v
    );
  end if;

  if not allowed then
    if not admin then
      raise exception 'That domain isn''t allowed yet. Ask an admin.';
    end if;
    insert into public.access_rules as ar (kind, value, note, display_name)
      values (share_project.kind, v, 'Added while sharing ' || share_project.slug,
              case when share_project.kind = 'email' then n end)
      on conflict (kind, value) do nothing;
  end if;

  insert into public.project_access (project_slug, kind, value, created_by)
    values (slug, kind, v, caller)
    on conflict do nothing;

  select pa.id into grant_id
  from public.project_access pa
  where pa.project_slug = share_project.slug and pa.kind = share_project.kind and pa.value = v;

  -- A name typed while inviting becomes that person's default byline, in both
  -- places the board looks for one. Never overwrites the @ directory: once
  -- someone signs in, the name they chose for themselves wins.
  if n is not null and kind = 'email' then
    update public.access_rules ar
      set display_name = n
      where ar.kind = 'email' and ar.value = v and ar.display_name is null;
    insert into public.review_people (email, name)
      values (v, n)
      on conflict (email) do nothing;
  end if;

  return grant_id;
end;
$$;

revoke execute on function public.share_project(text, text, text, text) from public, anon;
grant execute on function public.share_project(text, text, text, text) to authenticated;

/** Remove one grant. The caller must be on the project the grant belongs to —
 *  the grant id alone is not authority, since ids are guessable.
 *
 *  ⚠ The self-lockout guard: removing the row that is holding your own door
 *  open would end the session you are managing access from, with no way back
 *  but an admin. Admins are exempt because they hold every project anyway. */
create or replace function public.unshare_project(grant_id bigint)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  caller text := lower(coalesce(auth.jwt()->>'email', ''));
  slug text;
begin
  select project_slug into slug from public.project_access where id = grant_id;
  if slug is null then
    return; -- already gone; removing twice is not an error
  end if;
  if not public.can_access_project(caller, slug) then
    raise exception 'You do not have access to this project.';
  end if;

  delete from public.project_access where id = grant_id;

  if not public.is_admin(caller) and not public.can_access_project(caller, slug) then
    raise exception 'That would remove your own access to this project.';
  end if;
end;
$$;

revoke execute on function public.unshare_project(bigint) from public, anon;
grant execute on function public.unshare_project(bigint) to authenticated;

/** The "anyone who can sign in" switch — the kind='all' row, added or removed.
 *  Same caller check, and the same self-lockout guard when closing: if 'all'
 *  is the only thing holding your door open, closing it locks you out. */
create or replace function public.set_project_open(slug text, open boolean)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  caller text := lower(coalesce(auth.jwt()->>'email', ''));
  -- Copied out of the parameter: OPEN is a plpgsql cursor statement, so a bare
  -- `if open then` is worth not writing.
  wanted boolean := open;
begin
  if not public.can_access_project(caller, slug) then
    raise exception 'You do not have access to this project.';
  end if;

  if wanted then
    insert into public.project_access (project_slug, kind, value, note, created_by)
      values (slug, 'all', null, 'Open to everyone who can sign in', caller)
      on conflict do nothing;
  else
    delete from public.project_access
      where project_slug = slug and kind = 'all';
    if not public.is_admin(caller) and not public.can_access_project(caller, slug) then
      raise exception 'That would remove your own access to this project.';
    end if;
  end if;
end;
$$;

revoke execute on function public.set_project_open(text, boolean) from public, anon;
grant execute on function public.set_project_open(text, boolean) to authenticated;

/** "Let me onto this board." A signed-in caller only — someone who cannot sign
 *  in at all reaches the Edge Function instead (see the header). Asking twice
 *  returns the request already open rather than making a second one. */
create or replace function public.request_project_access(slug text, message text default null)
returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  caller text := lower(coalesce(auth.jwt()->>'email', ''));
  who text;
  req_id bigint;
begin
  if caller = '' then
    raise exception 'Sign in first.';
  end if;
  select rp.name into who from public.review_people rp where rp.email = caller;

  insert into public.access_requests (email, name, project_slug, message)
    values (caller, who, slug, nullif(btrim(coalesce(message, '')), ''))
    on conflict do nothing;

  select ar.id into req_id
  from public.access_requests ar
  where ar.email = caller
    and coalesce(ar.project_slug, '') = coalesce(slug, '')
    and ar.status = 'pending';
  return req_id;
end;
$$;

revoke execute on function public.request_project_access(text, text) from public, anon;
grant execute on function public.request_project_access(text, text) to authenticated;

/** Say yes or no to a request. A PROJECT request can be decided by anyone on
 *  that project; a SIGN-IN request (slug null) is admins only, because saying
 *  yes to it widens the allowlist. Approving a project request obeys the same
 *  guardrail as share_project: a non-admin cannot approve someone who could
 *  not already sign in. */
create or replace function public.decide_access_request(request_id bigint, approve boolean)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  caller text := lower(coalesce(auth.jwt()->>'email', ''));
  admin boolean := public.is_admin(caller);
  req public.access_requests%rowtype;
begin
  select * into req from public.access_requests where id = request_id;
  if req.id is null then
    raise exception 'That request is no longer there.';
  end if;
  if req.status <> 'pending' then
    raise exception 'That request has already been decided.';
  end if;

  if req.project_slug is null then
    if not admin then
      raise exception 'Only an admin can approve a new sign-in.';
    end if;
  elsif not admin and not public.can_access_project(caller, req.project_slug) then
    raise exception 'You do not have access to this project.';
  end if;

  if approve then
    if req.project_slug is null then
      insert into public.access_rules (kind, value, note, display_name)
        values ('email', req.email, 'Approved request', req.name)
        on conflict (kind, value) do nothing;
    else
      -- share_project re-derives the caller from the JWT, so the guardrail and
      -- the admin exemption are applied once, in one place.
      perform public.share_project(req.project_slug, 'email', req.email, req.name);
    end if;
  end if;

  update public.access_requests
    set status = case when approve then 'approved' else 'denied' end,
        decided_by = caller,
        decided_at = now()
    where id = request_id;
end;
$$;

revoke execute on function public.decide_access_request(bigint, boolean) from public, anon;
grant execute on function public.decide_access_request(bigint, boolean) to authenticated;

/** The name to put in the comment box before the caller has typed one. The
 *  invited name first, then whatever they last called themselves. */
create or replace function public.my_default_name()
returns text
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select ar.display_name from public.access_rules ar
      where ar.kind = 'email' and ar.value = lower(coalesce(auth.jwt()->>'email', ''))),
    (select rp.name from public.review_people rp
      where rp.email = lower(coalesce(auth.jwt()->>'email', '')))
  );
$$;

revoke execute on function public.my_default_name() from public, anon;
grant execute on function public.my_default_name() to authenticated;

-- The request-access Edge Function asks this as service role before recording
-- a sign-in request, so an address that can already sign in isn't queued.
grant execute on function public.is_email_allowed(text) to service_role;

-- ============================================================================
-- FOLDERS (2026-09-18). Additive to everything above: nothing here takes
-- access away, and every statement is re-runnable.
--
-- THE IDEA: projects are code-defined (src/review/projects.ts holds the list of
-- what exists); FOLDERS live here, in the database. Flat, one level, a project
-- in one folder or none. A folder is two things at once:
--   1. how the folder page GROUPS the projects, and
--   2. a grant surface — a grant on a folder gives every project in it,
--      including projects moved in later.
--
-- ARCHIVE is a built-in folder, flagged is_archive. It cannot be renamed,
-- deleted or shared: it is where finished work goes, and a folder grant that
-- silently included it would hand out every retired board at once. It replaces
-- ProjectEntry.archived as the source of truth; the code flag stays as the
-- OFFLINE fallback (no Supabase = no folder rows to read).
--
-- WHY MOVING IS ADMIN-ONLY: moving a project between folders CHANGES WHO CAN
-- SEE IT. Sharing a folder is one level, like sharing a project — but deciding
-- what is in the folder is the sharper power, so it stays with admins.
-- Renaming and deleting are admin-only for the same reason (a delete un-files
-- its projects, which is a revocation for anyone holding only a folder grant).

-- === D. Folders =============================================================

create table if not exists public.project_folders (
  id bigint generated always as identity primary key,
  name text not null,
  -- The one built-in. Flagged rather than matched by name, so renaming is
  -- refused on a fact and not on a string.
  is_archive boolean not null default false,
  position int not null default 0,
  created_at timestamptz not null default now(),
  created_by text
);

-- Exactly one Archive, ever. Partial, because the flag is false on every
-- ordinary folder and a plain unique index would allow only one of those too.
create unique index if not exists project_folders_archive_uniq
  on public.project_folders (is_archive) where is_archive;

-- Two folders that differ only in case are two folders nobody can tell apart.
create unique index if not exists project_folders_name_uniq
  on public.project_folders (lower(name));

-- Which folder a project sits in. The slug is the primary key, which IS the
-- "one folder or none" rule: there is nowhere to put a second row. No foreign
-- key to the registry, because the registry is code — a row for a project that
-- no longer exists is inert, the same as a stale grant.
create table if not exists public.project_folder_items (
  project_slug text primary key,
  folder_id bigint not null references public.project_folders (id) on delete cascade,
  moved_at timestamptz not null default now(),
  moved_by text
);

-- A grant on a folder, the same three kinds as project_access. It gives every
-- project in the folder, and keeps giving as projects move in.
create table if not exists public.folder_access (
  id bigint generated always as identity primary key,
  folder_id bigint not null references public.project_folders (id) on delete cascade,
  kind text not null check (kind in ('all', 'domain', 'email')),
  value text, -- lowercase; null only for 'all'
  note text,
  created_at timestamptz not null default now(),
  created_by text,
  check ((kind = 'all') = (value is null))
);

create unique index if not exists folder_access_rule_uniq
  on public.folder_access (folder_id, kind, coalesce(value, ''));

/** Archive holds no grants. A check constraint can't reach another table, so
 *  the rule is a trigger — and it is a rule worth enforcing in the database
 *  rather than only in the functions: an admin editing the table directly
 *  would otherwise open every retired board with one row. */
create or replace function public.folder_access_not_archive()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if exists (select 1 from public.project_folders f
             where f.id = new.folder_id and f.is_archive) then
    raise exception 'Archive cannot be shared.';
  end if;
  return new;
end;
$$;

drop trigger if exists folder_access_not_archive on public.folder_access;
create trigger folder_access_not_archive
  before insert or update on public.folder_access
  for each row execute function public.folder_access_not_archive();

-- === E. Reading a folder ====================================================

/** Does this address hold this folder? Archive is never held: it has no grants
 *  (the trigger above), and admins reach it through is_admin anyway.
 *  ⚠ Deliberately does NOT call can_access_project — that function calls this
 *  one, and the folder rule must terminate. */
create or replace function public.can_access_folder(email text, folder_id bigint)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_email_allowed($1) and (
    public.is_admin($1)
    or exists (
      select 1 from public.folder_access fa
      join public.project_folders f on f.id = fa.folder_id
      where fa.folder_id = $2
        and not f.is_archive
        and (fa.kind = 'all'
          or (fa.kind = 'domain' and fa.value = lower(split_part($1, '@', 2)))
          or (fa.kind = 'email'  and fa.value = lower($1)))
    )
  );
$$;

revoke execute on function public.can_access_folder(text, bigint) from public, anon;
grant execute on function public.can_access_folder(text, bigint) to authenticated;

/** REPLACES the function of the same name in project-access.sql. Same
 *  signature, same grants — every RLS policy in that file depends on it, so
 *  this is a create or replace and never a drop.
 *
 *  What changed: a project is also yours when it sits in a NON-ARCHIVE folder
 *  you hold a grant for. Archive is excluded on purpose, in the one place it
 *  matters: a folder grant must never become a key to retired work. */
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
    -- …or the folder it is filed in is one you hold.
    or exists (
      select 1 from public.project_folder_items pfi
      join public.project_folders f on f.id = pfi.folder_id
      join public.folder_access fa on fa.folder_id = f.id
      where pfi.project_slug = $2
        and not f.is_archive
        and (fa.kind = 'all'
          or (fa.kind = 'domain' and fa.value = lower(split_part($1, '@', 2)))
          or (fa.kind = 'email'  and fa.value = lower($1)))
    )
  );
$$;

revoke execute on function public.can_access_project(text, text) from public, anon;
grant execute on function public.can_access_project(text, text) to authenticated;

/** REPLACES project-access.sql's version. Same signature. It used to read
 *  project_access alone, which now misses every project reachable ONLY through
 *  a folder — so the candidate list is the union of both tables. The filter is
 *  still can_access_project(), so the rule itself lives in one place. */
create or replace function public.my_project_slugs()
returns setof text
language sql stable security definer set search_path = public
as $$
  select slug from (
    select pa.project_slug as slug from public.project_access pa
    union
    select pfi.project_slug from public.project_folder_items pfi
  ) s
  where public.can_access_project(coalesce(auth.jwt()->>'email', ''), s.slug);
$$;

revoke execute on function public.my_project_slugs() from public, anon;
grant execute on function public.my_project_slugs() to authenticated;

-- === F. Row-level security for the folder tables ============================

alter table public.project_folders enable row level security;
alter table public.project_folder_items enable row level security;
alter table public.folder_access enable row level security;

drop policy if exists "project_folders_select" on public.project_folders;
drop policy if exists "project_folders_admin_all" on public.project_folders;

-- You see a folder you hold, and a folder that is filing a project you can
-- already open — including Archive, which is how a retired board still shows
-- up under a heading. Nothing else: a folder whose every project is closed to
-- you is not even a name you can learn.
create policy "project_folders_select" on public.project_folders
  for select to authenticated
  using (
    public.can_access_folder(auth.jwt()->>'email', id)
    or exists (
      select 1 from public.project_folder_items pfi
      where pfi.folder_id = project_folders.id
        and public.can_access_project(auth.jwt()->>'email', pfi.project_slug)
    )
  );

create policy "project_folders_admin_all" on public.project_folders
  for all to authenticated
  using (public.is_admin(auth.jwt()->>'email'))
  with check (public.is_admin(auth.jwt()->>'email'));

grant select, insert, update, delete on public.project_folders to authenticated;

drop policy if exists "project_folder_items_select" on public.project_folder_items;
drop policy if exists "project_folder_items_admin_all" on public.project_folder_items;

-- Where a project is filed is readable by anyone who can open the project.
-- Moving it is admin-only, because moving changes who can see it.
create policy "project_folder_items_select" on public.project_folder_items
  for select to authenticated
  using (public.can_access_project(auth.jwt()->>'email', project_slug));

create policy "project_folder_items_admin_all" on public.project_folder_items
  for all to authenticated
  using (public.is_admin(auth.jwt()->>'email'))
  with check (public.is_admin(auth.jwt()->>'email'));

grant select, insert, update, delete on public.project_folder_items to authenticated;

drop policy if exists "folder_access_admin_all" on public.folder_access;

-- Admins only, in every direction — the same posture as project_access. Anyone
-- else asks folder_members(), which checks the caller first and so cannot be
-- used to enumerate who is on a folder you can't open.
create policy "folder_access_admin_all" on public.folder_access
  for all to authenticated
  using (public.is_admin(auth.jwt()->>'email'))
  with check (public.is_admin(auth.jwt()->>'email'));

grant select, insert, update, delete on public.folder_access to authenticated;

-- === G. The functions the folder screens call ===============================

/** The folders the caller can see, in the order the folder page lists them.
 *  Same rule as the select policy, written out so the client gets one round
 *  trip and the empty case is an empty set rather than an error. */
drop function if exists public.my_folders();
create or replace function public.my_folders()
returns table (id bigint, name text, is_archive boolean, "position" int, held boolean)
language sql stable security definer set search_path = public
as $$
  -- `held` tells the caller which folders they may share: seeing a heading
  -- because a project of yours is filed there is not holding the folder.
  select f.id, f.name, f.is_archive, f."position",
         public.can_access_folder(coalesce(auth.jwt()->>'email', ''), f.id)
  from public.project_folders f
  where public.can_access_folder(coalesce(auth.jwt()->>'email', ''), f.id)
     or exists (
       select 1 from public.project_folder_items pfi
       where pfi.folder_id = f.id
         and public.can_access_project(coalesce(auth.jwt()->>'email', ''), pfi.project_slug)
     )
  order by f.is_archive, f."position", lower(f.name);
$$;

revoke execute on function public.my_folders() from public, anon;
grant execute on function public.my_folders() to authenticated;

/** Where each project the caller can open is filed. Projects they cannot open
 *  are simply absent, so the answer never says a board exists. */
create or replace function public.my_folder_items()
returns table (project_slug text, folder_id bigint)
language sql stable security definer set search_path = public
as $$
  select pfi.project_slug, pfi.folder_id
  from public.project_folder_items pfi
  where public.can_access_project(coalesce(auth.jwt()->>'email', ''), pfi.project_slug);
$$;

revoke execute on function public.my_folder_items() from public, anon;
grant execute on function public.my_folder_items() to authenticated;

/** Who is on a folder. Gated on the CALLER holding it, exactly like
 *  project_members: you can never learn who is on a folder you can't see.
 *  Being filed in a folder is not holding it, so this is stricter than
 *  my_folders() on purpose. */
create or replace function public.folder_members(folder_id bigint)
returns table (id bigint, kind text, value text, note text, display_name text)
language plpgsql stable security definer set search_path = public
as $$
declare
  caller text := lower(coalesce(auth.jwt()->>'email', ''));
begin
  if not public.can_access_folder(caller, folder_id) then
    raise exception 'You do not have access to this folder.';
  end if;
  return query
    select fa.id, fa.kind, fa.value, fa.note,
           coalesce(rp.name, ar.display_name)
    from public.folder_access fa
    left join public.review_people rp
      on fa.kind = 'email' and rp.email = fa.value
    left join public.access_rules ar
      on ar.kind = 'email' and ar.value = fa.value
    where fa.folder_id = folder_members.folder_id
    order by fa.kind, fa.value;
end;
$$;

revoke execute on function public.folder_members(bigint) from public, anon;
grant execute on function public.folder_members(bigint) to authenticated;

/** The allowlist half of sharing, in one place because share_project and
 *  share_folder must agree to the letter. Raises the non-admin message; for an
 *  admin, creates the sign-in row instead — the only place the allowlist
 *  widens. `note` says which thing was being shared when it happened. */
create or replace function public.ensure_can_sign_in(
  p_kind text,
  p_value text,
  p_admin boolean,
  p_note text,
  p_display_name text default null
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  allowed boolean;
begin
  if p_kind = 'email' then
    allowed := public.is_email_allowed(p_value);
  else
    allowed := exists (
      select 1 from public.access_rules ar
      where ar.kind = 'domain' and ar.value = p_value
    );
  end if;
  if allowed then
    return;
  end if;
  if not p_admin then
    raise exception 'That domain isn''t allowed yet. Ask an admin.';
  end if;
  insert into public.access_rules (kind, value, note, display_name)
    values (p_kind, p_value, p_note, case when p_kind = 'email' then p_display_name end)
    on conflict (kind, value) do nothing;
end;
$$;

-- ⚠ INTERNAL ONLY. `p_admin` is the caller's word for it, so this must never be
-- callable from a client: anyone could pass true and widen sign-in. The definer
-- functions that call it run as the owner and need no grant. Parameters are
-- p_-prefixed because `value` collides with access_rules.value in plpgsql.
revoke execute on function public.ensure_can_sign_in(text, text, boolean, text, text) from public, anon, authenticated;

/** REPLACES the version above, with the allowlist half factored out. Behaviour
 *  is unchanged, message for message. */
create or replace function public.share_project(
  slug text,
  kind text,
  value text,
  display_name text default null
)
returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  caller text := lower(coalesce(auth.jwt()->>'email', ''));
  admin boolean := public.is_admin(caller);
  v text := lower(btrim(coalesce(value, '')));
  n text := nullif(btrim(coalesce(display_name, '')), '');
  grant_id bigint;
begin
  if not public.can_access_project(caller, slug) then
    raise exception 'You do not have access to this project.';
  end if;
  if kind not in ('domain', 'email') then
    raise exception 'Choose a person or a domain.';
  end if;
  if v = '' then
    raise exception 'Enter an email address or a domain.';
  end if;

  perform public.ensure_can_sign_in(
    share_project.kind, v, admin, 'Added while sharing ' || share_project.slug, n);

  insert into public.project_access (project_slug, kind, value, created_by)
    values (slug, kind, v, caller)
    on conflict do nothing;

  select pa.id into grant_id
  from public.project_access pa
  where pa.project_slug = share_project.slug and pa.kind = share_project.kind and pa.value = v;

  -- A name typed while inviting becomes that person's default byline, in both
  -- places the board looks for one. Never overwrites the @ directory: once
  -- someone signs in, the name they chose for themselves wins.
  if n is not null and kind = 'email' then
    update public.access_rules ar
      set display_name = n
      where ar.kind = 'email' and ar.value = v and ar.display_name is null;
    insert into public.review_people (email, name)
      values (v, n)
      on conflict (email) do nothing;
  end if;

  return grant_id;
end;
$$;

revoke execute on function public.share_project(text, text, text, text) from public, anon;
grant execute on function public.share_project(text, text, text, text) to authenticated;

/** Add one person or one domain to a folder — and so to every project in it,
 *  now and later. Same one-level rule as a project: holding the folder is
 *  being able to share it. Same guardrail, from the same helper. */
create or replace function public.share_folder(
  folder_id bigint,
  kind text,
  value text,
  display_name text default null
)
returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  caller text := lower(coalesce(auth.jwt()->>'email', ''));
  admin boolean := public.is_admin(caller);
  v text := lower(btrim(coalesce(value, '')));
  n text := nullif(btrim(coalesce(display_name, '')), '');
  fname text;
  archive boolean;
  grant_id bigint;
begin
  -- Access first, always: a folder you don't hold answers the same way whether
  -- it exists or not, so the id space can't be walked.
  if not public.can_access_folder(caller, folder_id) then
    raise exception 'You do not have access to this folder.';
  end if;
  select f.name, f.is_archive into fname, archive
  from public.project_folders f where f.id = folder_id;
  if fname is null then
    raise exception 'That folder is no longer there.';
  end if;
  if archive then
    raise exception 'Archive cannot be shared.';
  end if;
  if kind not in ('domain', 'email') then
    raise exception 'Choose a person or a domain.';
  end if;
  if v = '' then
    raise exception 'Enter an email address or a domain.';
  end if;

  perform public.ensure_can_sign_in(
    share_folder.kind, v, admin, 'Added while sharing ' || fname, n);

  insert into public.folder_access (folder_id, kind, value, created_by)
    values (folder_id, kind, v, caller)
    on conflict do nothing;

  select fa.id into grant_id
  from public.folder_access fa
  where fa.folder_id = share_folder.folder_id and fa.kind = share_folder.kind and fa.value = v;

  if n is not null and kind = 'email' then
    update public.access_rules ar
      set display_name = n
      where ar.kind = 'email' and ar.value = v and ar.display_name is null;
    insert into public.review_people (email, name)
      values (v, n)
      on conflict (email) do nothing;
  end if;

  return grant_id;
end;
$$;

revoke execute on function public.share_folder(bigint, text, text, text) from public, anon;
grant execute on function public.share_folder(bigint, text, text, text) to authenticated;

/** Remove one folder grant. The grant id alone is not authority — the caller
 *  must hold the folder it belongs to — and the same self-lockout guard
 *  applies: you cannot pull the row that is holding your own door open. */
create or replace function public.unshare_folder(grant_id bigint)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  caller text := lower(coalesce(auth.jwt()->>'email', ''));
  fid bigint;
begin
  select fa.folder_id into fid from public.folder_access fa where fa.id = grant_id;
  if fid is null then
    return; -- already gone; removing twice is not an error
  end if;
  if not public.can_access_folder(caller, fid) then
    raise exception 'You do not have access to this folder.';
  end if;

  delete from public.folder_access where id = grant_id;

  if not public.is_admin(caller) and not public.can_access_folder(caller, fid) then
    raise exception 'That would remove your own access to this folder.';
  end if;
end;
$$;

revoke execute on function public.unshare_folder(bigint) from public, anon;
grant execute on function public.unshare_folder(bigint) to authenticated;

/** The "anyone who can sign in" switch for a folder. Same caller check, same
 *  self-lockout guard when closing. */
create or replace function public.set_folder_open(folder_id bigint, open boolean)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  caller text := lower(coalesce(auth.jwt()->>'email', ''));
  -- Copied out of the parameter: OPEN is a plpgsql cursor statement, so a bare
  -- `if open then` is worth not writing.
  wanted boolean := open;
  archive boolean;
begin
  if not public.can_access_folder(caller, folder_id) then
    raise exception 'You do not have access to this folder.';
  end if;
  select f.is_archive into archive from public.project_folders f where f.id = folder_id;
  if archive is null then
    raise exception 'That folder is no longer there.';
  end if;
  if archive then
    raise exception 'Archive cannot be shared.';
  end if;

  if wanted then
    insert into public.folder_access (folder_id, kind, value, note, created_by)
      values (folder_id, 'all', null, 'Open to everyone who can sign in', caller)
      on conflict do nothing;
  else
    delete from public.folder_access fa
      where fa.folder_id = set_folder_open.folder_id and fa.kind = 'all';
    if not public.is_admin(caller) and not public.can_access_folder(caller, folder_id) then
      raise exception 'That would remove your own access to this folder.';
    end if;
  end if;
end;
$$;

revoke execute on function public.set_folder_open(bigint, boolean) from public, anon;
grant execute on function public.set_folder_open(bigint, boolean) to authenticated;

-- === H. Managing the folders themselves (admins only) =======================

/** A new folder, empty and shared with nobody. Returns its id. Naming it after
 *  one that exists returns that one rather than failing — creating twice is not
 *  an error the UI has to explain. */
create or replace function public.create_folder(name text)
returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  caller text := lower(coalesce(auth.jwt()->>'email', ''));
  n text := nullif(btrim(coalesce(name, '')), '');
  fid bigint;
begin
  if not public.is_admin(caller) then
    raise exception 'Only an admin can manage folders.';
  end if;
  if n is null then
    raise exception 'Give the folder a name.';
  end if;

  select f.id into fid from public.project_folders f where lower(f.name) = lower(n);
  if fid is not null then
    return fid;
  end if;

  insert into public.project_folders (name, created_by)
    values (n, caller)
    returning id into fid;
  return fid;
end;
$$;

revoke execute on function public.create_folder(text) from public, anon;
grant execute on function public.create_folder(text) to authenticated;

/** Rename a folder. Archive is refused: it is a built-in, and the code that
 *  falls back to it offline knows it by that name. */
create or replace function public.rename_folder(folder_id bigint, name text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  caller text := lower(coalesce(auth.jwt()->>'email', ''));
  n text := nullif(btrim(coalesce(name, '')), '');
  archive boolean;
begin
  if not public.is_admin(caller) then
    raise exception 'Only an admin can manage folders.';
  end if;
  if n is null then
    raise exception 'Give the folder a name.';
  end if;
  select f.is_archive into archive from public.project_folders f where f.id = folder_id;
  if archive is null then
    raise exception 'That folder is no longer there.';
  end if;
  if archive then
    raise exception 'Archive cannot be renamed.';
  end if;

  update public.project_folders f set name = n where f.id = folder_id;
end;
$$;

revoke execute on function public.rename_folder(bigint, text) from public, anon;
grant execute on function public.rename_folder(bigint, text) to authenticated;

/** Delete a folder. Its projects are UN-FILED, never deleted, and their own
 *  grants are untouched — so the worst a delete can do is take away access
 *  that came from the folder. Archive is refused. */
create or replace function public.delete_folder(folder_id bigint)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  caller text := lower(coalesce(auth.jwt()->>'email', ''));
  archive boolean;
begin
  if not public.is_admin(caller) then
    raise exception 'Only an admin can manage folders.';
  end if;
  select f.is_archive into archive from public.project_folders f where f.id = folder_id;
  if archive is null then
    return; -- already gone; deleting twice is not an error
  end if;
  if archive then
    raise exception 'Archive cannot be deleted.';
  end if;

  -- The cascade on project_folder_items would do this anyway; written out so
  -- "delete un-files, it does not delete" is a statement and not a footnote.
  delete from public.project_folder_items pfi where pfi.folder_id = delete_folder.folder_id;
  delete from public.project_folders f where f.id = folder_id;
end;
$$;

revoke execute on function public.delete_folder(bigint) from public, anon;
grant execute on function public.delete_folder(bigint) to authenticated;

/** File a project, or un-file it (folder_id null). Admin-only precisely
 *  because this is the call that changes who can see a board: moving it into a
 *  shared folder hands it to everyone on that folder, and moving it to Archive
 *  takes the folder's grants away.
 *
 *  The database cannot know whether the slug is in the code registry, so it
 *  does not try: a row for a slug that does not exist is inert, the same as a
 *  stale grant. */
create or replace function public.move_project(slug text, folder_id bigint default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  caller text := lower(coalesce(auth.jwt()->>'email', ''));
  s text := nullif(btrim(coalesce(slug, '')), '');
begin
  if not public.is_admin(caller) then
    raise exception 'Only an admin can manage folders.';
  end if;
  if s is null then
    raise exception 'Which project?';
  end if;

  if move_project.folder_id is null then
    delete from public.project_folder_items pfi where pfi.project_slug = s;
    return;
  end if;

  if not exists (select 1 from public.project_folders f where f.id = move_project.folder_id) then
    raise exception 'That folder is no longer there.';
  end if;

  insert into public.project_folder_items as pfi (project_slug, folder_id, moved_by)
    values (s, move_project.folder_id, caller)
    on conflict (project_slug) do update
      set folder_id = excluded.folder_id,
          moved_at = now(),
          moved_by = excluded.moved_by;
end;
$$;

revoke execute on function public.move_project(text, bigint) from public, anon;
grant execute on function public.move_project(text, bigint) to authenticated;

-- === I. Seed ================================================================

-- The one built-in folder, and today's archived projects moved into it. After
-- this runs the DATABASE is the source of truth for what is archived;
-- ProjectEntry.archived stays in code as the offline fallback.
insert into public.project_folders (name, is_archive, position, created_by)
  select 'Archive', true, 100, 'seed'
  where not exists (select 1 from public.project_folders where is_archive);

-- Projects archived at the time of this migration would be moved into it here:
--   insert into public.project_folder_items (project_slug, folder_id, moved_by)
--     select s.slug, f.id, 'seed' from public.project_folders f, (values ('<slug>')) as s(slug)
--     where f.is_archive on conflict (project_slug) do nothing;
