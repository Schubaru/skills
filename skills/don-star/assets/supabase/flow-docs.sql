-- Flow-chart documents for a "flows" project (2026-08-13).
--
-- One row per diagram. The canvas at /flows reads and writes these directly,
-- so an edit made by one person is what the next person opens — that is the
-- whole point of the surface, and the reason it isn't a file in the repo like
-- a review board's config.
--
-- ACCESS IS THE SAME QUESTION THE BOARD ALREADY ANSWERS: can this account open
-- this project? So the policies call can_access_project() from
-- project-access.sql rather than inventing a second rule. Apply that file
-- first; this one depends on it.
--
-- Editing is not scoped per person on purpose. Everyone who can open the
-- project can move the boxes: it is a shared thinking surface for a handful of
-- named people behind an email gate, and a read-only tier would just mean the
-- feedback arrives somewhere else. `rev` is what keeps two of them from
-- silently overwriting each other (see src/flows/db.ts).

create table if not exists public.flow_docs (
  id text primary key,
  project_slug text not null,
  title text not null default 'Untitled',
  summary text,
  -- { nodes: [...], edges: [...] } — the whole diagram, written as one unit.
  doc jsonb not null default '{"nodes":[],"edges":[]}'::jsonb,
  -- Bumped by every save. A conditional update on this is how the client finds
  -- out someone else got there first, instead of quietly winning.
  rev integer not null default 0,
  -- Sidebar order. Named `sort` because `order` is reserved.
  sort integer not null default 0,
  updated_at timestamptz not null default now(),
  -- Display name, not an address: it shows up in the UI ("the reviewer saved a newer
  -- version"), and the snapshot convention in this repo keeps emails out of
  -- anything that can be read by everyone on the project.
  updated_by text
);

create index if not exists flow_docs_project_idx on public.flow_docs (project_slug, sort);

alter table public.flow_docs enable row level security;

drop policy if exists "flow_docs_select" on public.flow_docs;
drop policy if exists "flow_docs_insert" on public.flow_docs;
drop policy if exists "flow_docs_update" on public.flow_docs;
drop policy if exists "flow_docs_delete" on public.flow_docs;

create policy "flow_docs_select" on public.flow_docs
  for select to authenticated
  using (public.can_access_project(auth.jwt()->>'email', project_slug));

create policy "flow_docs_insert" on public.flow_docs
  for insert to authenticated
  with check (public.can_access_project(auth.jwt()->>'email', project_slug));

-- Both sides checked: `using` says which rows you may edit, `with check` stops
-- an edit from moving a row into a project you can't open.
create policy "flow_docs_update" on public.flow_docs
  for update to authenticated
  using (public.can_access_project(auth.jwt()->>'email', project_slug))
  with check (public.can_access_project(auth.jwt()->>'email', project_slug));

create policy "flow_docs_delete" on public.flow_docs
  for delete to authenticated
  using (public.can_access_project(auth.jwt()->>'email', project_slug));

grant select, insert, update, delete on public.flow_docs to authenticated;

-- Live updates between browsers (the canvas subscribes per project).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'flow_docs'
  ) then
    alter publication supabase_realtime add table public.flow_docs;
  end if;
end $$;

-- A flow-chart project needs a project_access row like any other — without it
-- my_project_slugs() never returns the slug and even an admin can't see it:
--   insert into public.project_access (project_slug, kind, value, note)
--     values ('<flows-slug>', 'domain', '__DS_ADMIN_DOMAIN__', 'Admins only')
--     on conflict do nothing;
