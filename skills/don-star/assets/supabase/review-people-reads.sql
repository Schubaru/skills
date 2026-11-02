-- Mentions + per-person read state for the /review board (2026-08-12).
-- Pairs with: src/review/db.ts (client reads/writes), store.ts (the hooks),
-- and supabase/functions/notify-review/index.ts (mentions become recipients).
--
-- Three pieces:
--   1. review_people        — WHO can be tagged. Display names live in
--                             auth.users.user_metadata, which one signed-in
--                             browser cannot read for anyone else, so the
--                             board keeps its own directory: every client
--                             upserts ITS OWN row on boot, and everyone reads
--                             the table. Tag someone before they have ever
--                             commented (the reviewer's ask) without exposing auth.
--   2. review_thread_reads  — WHO HAS SEEN WHAT, one row per (person, thread).
--                             `seen_at` is the newest activity timestamp the
--                             person had seen, not the moment they clicked:
--                             a reply that lands while the popover is open is
--                             then still unread, and no clock skew between two
--                             browsers can mark a future reply seen.
--   3. review_threads.mentions — emails named in the TOP-LEVEL body. A reply's
--                             mentions ride inside the existing replies jsonb,
--                             so replies need no schema change.

-- === 1. The directory =======================================================

create table if not exists public.review_people (
  email text primary key,
  user_id uuid,
  name text not null,
  last_seen_at timestamptz not null default now()
);

alter table public.review_people enable row level security;

drop policy if exists "people_select_all" on public.review_people;
drop policy if exists "people_upsert_own" on public.review_people;
drop policy if exists "people_update_own" on public.review_people;

-- Everyone signed in reads the whole directory — that IS the @ menu. It holds
-- name + email only, the same pair already visible on every comment byline.
create policy "people_select_all" on public.review_people
  for select to authenticated using (true);
create policy "people_upsert_own" on public.review_people
  for insert to authenticated
  with check (auth.jwt()->>'email' = email and public.is_email_allowed(email));
create policy "people_update_own" on public.review_people
  for update to authenticated using (auth.jwt()->>'email' = email)
  with check (auth.jwt()->>'email' = email and public.is_email_allowed(email));

-- Seed from people who have already written on the board, so the menu isn't
-- empty on day one and nobody has to sign in again to become taggable.
-- distinct on + this order = the most RECENT name each address wrote under,
-- since people rename themselves. Agents ("/norm-dog") are excluded: they hold
-- no address and can't be tagged. `name` is not null, so blank authors are
-- filtered rather than allowed to fail the whole seed.
insert into public.review_people (email, name)
  select distinct on (lower(author_email)) lower(author_email), author
  from public.review_threads
  where author_email is not null
    and btrim(author_email) <> ''
    and author is not null
    and btrim(author) <> ''
    and author not like '/%'
  order by lower(author_email), at desc
  on conflict (email) do nothing;

-- === 2. Read state ==========================================================

create table if not exists public.review_thread_reads (
  email text not null,
  thread_id text not null,
  -- Activity timestamp seen (ms, matching review_threads.at), NOT "when I
  -- clicked". See the header note.
  seen_at bigint not null,
  primary key (email, thread_id)
);

alter table public.review_thread_reads enable row level security;

drop policy if exists "reads_select_own" on public.review_thread_reads;
drop policy if exists "reads_insert_own" on public.review_thread_reads;
drop policy if exists "reads_update_own" on public.review_thread_reads;

-- Own rows only, in every direction: read state is personal, and one reviewer
-- must never be able to see — or clear — another's (the whole point of the
-- feature is that opening a comment changes it for you alone).
create policy "reads_select_own" on public.review_thread_reads
  for select to authenticated using (auth.jwt()->>'email' = email);
create policy "reads_insert_own" on public.review_thread_reads
  for insert to authenticated
  with check (auth.jwt()->>'email' = email and public.is_email_allowed(email));
create policy "reads_update_own" on public.review_thread_reads
  for update to authenticated using (auth.jwt()->>'email' = email)
  with check (auth.jwt()->>'email' = email and public.is_email_allowed(email));

-- === 3. Mentions on the thread row ==========================================

alter table public.review_threads add column if not exists mentions jsonb;

-- Everything that exists predates mentions and predates read state. Threads
-- stay unread for everyone, which is honest — nobody has opened one THROUGH
-- this feature yet, and a board that starts all-read would hide the backlog
-- the feature exists to surface.
