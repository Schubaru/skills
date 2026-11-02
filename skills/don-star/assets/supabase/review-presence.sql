-- Review-board presence on a PRIVATE realtime channel (2026-09-24, Decision 347).
--
-- The board's presence (src/review/presence.ts) runs on one channel per
-- project, `review-presence:<slug>`, opened with `private: true`. A private
-- channel is authorised by RLS on realtime.messages: joining reads
-- (SELECT), and tracking presence or sending a cursor writes (INSERT). Both
-- ask the same question the board data already asks: can this signed-in
-- email open this project (can_access_project, project-access.sql)?
--
-- So a person without a grant for a slug can't see who is on that board, their
-- cursors or their camera, and can't appear on it. The anon key alone gets
-- nothing (the policies are `to authenticated`).
--
-- Additive: realtime.messages had RLS on and no policies, and public channels
-- never consult these. Only topics starting `review-presence:` are matched.

drop policy if exists "review_presence_read" on realtime.messages;
drop policy if exists "review_presence_write" on realtime.messages;

create policy "review_presence_read" on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension in ('presence', 'broadcast')
    and realtime.topic() like 'review-presence:%'
    and public.can_access_project(
      coalesce(auth.jwt()->>'email', ''),
      substring(realtime.topic() from length('review-presence:') + 1)
    )
  );

create policy "review_presence_write" on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension in ('presence', 'broadcast')
    and realtime.topic() like 'review-presence:%'
    and public.can_access_project(
      coalesce(auth.jwt()->>'email', ''),
      substring(realtime.topic() from length('review-presence:') + 1)
    )
  );

-- === B. The profile, everywhere a person is shown (2026-09-24) =============
--
-- The presence menu's Edit profile writes name, colour and emoji to
-- auth.users.user_metadata (display_name, presence_color, presence_emoji),
-- which no browser can read for anyone else. review_people is the directory
-- everyone CAN read (review-people-reads.sql), so it carries the look too, and
-- a trigger on auth.users keeps it current: a rename or a new colour shows in
-- sharing, the admin screens, @-mentions and comments without the person
-- having to open a board first (the client's announceSelf only ran there).
--
-- color: a palette index ("0".."14", the client checks the range) or a
-- "#rrggbb" custom colour; null = the default, hashed from user_id. emoji:
-- one emoji or null (the client's cleanEmoji rule; the length cap here is a
-- backstop). Both are checked again on the client, like presence payloads.

alter table public.review_people
  add column if not exists color text check (color ~ '^([0-9]{1,2}|#[0-9a-f]{6})$'),
  add column if not exists emoji text check (char_length(emoji) between 1 and 16);

create or replace function public.sync_review_person()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  addr text := lower(new.email);
  nm text := nullif(btrim(meta->>'display_name'), '');
  col text := case jsonb_typeof(meta->'presence_color')
    when 'number' then meta->>'presence_color'
    when 'string' then lower(meta->>'presence_color')
  end;
  emo text := nullif(btrim(meta->>'presence_emoji'), '');
begin
  if addr is null or addr = '' then return new; end if;
  if col is not null and col !~ '^([0-9]{1,2}|#[0-9a-f]{6})$' then col := null; end if;
  if emo is not null and char_length(emo) > 16 then emo := null; end if;

  if nm is not null and public.is_email_allowed(addr) then
    insert into public.review_people (email, user_id, name, color, emoji)
      values (addr, new.id, nm, col, emo)
      on conflict (email) do update
        set user_id = excluded.user_id, name = excluded.name,
            color = excluded.color, emoji = excluded.emoji;
  else
    -- No name yet (first sign-in, before the name screen): keep the look in
    -- step on a row that already exists, never invent one.
    update public.review_people
      set user_id = new.id, color = col, emoji = emo
      where email = addr;
  end if;
  return new;
end;
$$;

revoke execute on function public.sync_review_person() from public, anon, authenticated;

drop trigger if exists sync_review_person on auth.users;
create trigger sync_review_person
  after insert or update of raw_user_meta_data, email on auth.users
  for each row execute function public.sync_review_person();

-- Backfill: everyone who already has an account and a name. Reads auth.users
-- rather than touching it, so no other trigger on that table fires.
insert into public.review_people (email, user_id, name, color, emoji)
  select lower(u.email), u.id, btrim(u.raw_user_meta_data->>'display_name'),
    case
      when jsonb_typeof(u.raw_user_meta_data->'presence_color') in ('number', 'string')
        and lower(u.raw_user_meta_data->>'presence_color') ~ '^([0-9]{1,2}|#[0-9a-f]{6})$'
      then lower(u.raw_user_meta_data->>'presence_color')
    end,
    case
      when char_length(btrim(u.raw_user_meta_data->>'presence_emoji')) between 1 and 16
      then btrim(u.raw_user_meta_data->>'presence_emoji')
    end
  from auth.users u
  where u.email is not null
    and nullif(btrim(u.raw_user_meta_data->>'display_name'), '') is not null
    and public.is_email_allowed(lower(u.email))
  on conflict (email) do update
    set user_id = excluded.user_id, name = excluded.name,
        color = excluded.color, emoji = excluded.emoji;
