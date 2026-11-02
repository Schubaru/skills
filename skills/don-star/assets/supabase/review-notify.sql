-- Email notifications for /review comments (replies + new threads), opt-in.
-- Applied 2026-07-30 as migration `review_notify` via MCP; this file is the
-- canonical copy. Pair: supabase/functions/notify-review/index.ts (deployed
-- Edge Function; RESEND_API_KEY must be set as a function secret).
--
-- Shape: triggers on review_threads → pg_net POST { thread_id } to the Edge
-- Function → it re-reads the row, diffs against the review_notifications
-- ledger, resolves opt-in recipients (review_notify_prefs), sends via Resend.
-- The payload is a hint only — the function trusts the DB, so replays and
-- forgeries can't double-send, and a failed run self-heals on the thread's
-- next change. Committed agent replies reach the DB via the store's
-- merge-persist step (store.ts hydrate), so they notify too.
--
-- After (re)creating review_notify_config: confirm from_email matches a
-- Resend-verified sender domain (same account that sends the OTP codes):
--   update public.review_notify_config set from_email = '...';

create extension if not exists pg_net;

-- === Who wants what ==========================================================
-- on_replies: replies in threads I participate in (authored or replied in).
--   Opt-OUT (the reviewer, 2026-07-30): no row = on. The Edge Function treats a
--   missing row as on_replies=true; only an explicit false row silences it.
-- on_new_threads: every new top-level comment anywhere on the board. Opt-IN:
--   only an explicit true row subscribes.
create table if not exists public.review_notify_prefs (
  email text primary key,
  user_id uuid,
  on_replies boolean not null default true,
  on_new_threads boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.review_notify_prefs enable row level security;

drop policy if exists "notify_prefs_select_own" on public.review_notify_prefs;
drop policy if exists "notify_prefs_insert_own" on public.review_notify_prefs;
drop policy if exists "notify_prefs_update_own" on public.review_notify_prefs;

create policy "notify_prefs_select_own" on public.review_notify_prefs
  for select to authenticated using (auth.jwt()->>'email' = email);
create policy "notify_prefs_insert_own" on public.review_notify_prefs
  for insert to authenticated
  with check (auth.jwt()->>'email' = email and public.is_email_allowed(email));
create policy "notify_prefs_update_own" on public.review_notify_prefs
  for update to authenticated using (auth.jwt()->>'email' = email)
  with check (auth.jwt()->>'email' = email and public.is_email_allowed(email));

-- === Idempotency ledger (service-role only) =================================
-- One row per notified item ever: the thread itself, or one reply. The PK is
-- the send-at-most-once guarantee. status: pending | sent | stale |
-- no-recipients | backfill | error: …
create table if not exists public.review_notifications (
  kind text not null check (kind in ('thread', 'reply')),
  target_id text not null,
  thread_id text not null,
  recipients jsonb,
  status text not null default 'pending',
  at timestamptz not null default now(),
  primary key (kind, target_id)
);

alter table public.review_notifications enable row level security;
-- RLS on, no policies: invisible to anon/authenticated; the Edge Function
-- writes with the service role.

-- === Function config (service-role + trigger only) ==========================
-- token gates the webhook endpoint; generated server-side, never committed.
create table if not exists public.review_notify_config (
  id boolean primary key default true check (id),
  site_url text not null,
  from_email text not null,
  token uuid not null default gen_random_uuid()
);

alter table public.review_notify_config enable row level security;

insert into public.review_notify_config (site_url, from_email)
  values ('__DS_SITE_URL__', '__DS_FROM_EMAIL__')
  on conflict (id) do nothing;

-- === Backfill ===============================================================
-- Everything that exists when this applies predates notifications — ledger it
-- so the first prefs opt-in doesn't re-announce the whole board.
insert into public.review_notifications (kind, target_id, thread_id, status)
  select 'thread', id, id, 'backfill' from public.review_threads
  on conflict do nothing;
insert into public.review_notifications (kind, target_id, thread_id, status)
  select 'reply', r->>'id', t.id, 'backfill'
  from public.review_threads t, jsonb_array_elements(t.replies) r
  where r->>'id' is not null
  on conflict do nothing;

-- === Trigger → Edge Function ================================================
create or replace function public.notify_review_thread_changed()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  cfg public.review_notify_config%rowtype;
begin
  select * into cfg from public.review_notify_config limit 1;
  if cfg.token is null then
    return new;
  end if;
  perform net.http_post(
    url := 'https://__DS_SUPABASE_REF__.supabase.co/functions/v1/notify-review',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Notify-Token', cfg.token::text
    ),
    body := jsonb_build_object('thread_id', new.id)
  );
  return new;
end;
$$;

drop trigger if exists review_threads_notify_ins on public.review_threads;
drop trigger if exists review_threads_notify_upd on public.review_threads;

create trigger review_threads_notify_ins
  after insert on public.review_threads
  for each row execute function public.notify_review_thread_changed();

-- Only reply-array changes matter on update — resolves, pin drags, and other
-- row churn shouldn't ping the function.
create trigger review_threads_notify_upd
  after update on public.review_threads
  for each row when (old.replies is distinct from new.replies)
  execute function public.notify_review_thread_changed();
