-- Prebuilt preview shots for the review board (2026-08-13).
--
-- The board used to capture every screen in each reviewer's own browser and keep
-- the result only there, so every person, device and browser profile paid a full
-- ~190-screen boot sweep of its own and nothing anyone warmed helped anyone
-- else. Shots are now built once per push (.github/workflows/review-shots.yml →
-- __DS_APP_DIR__/scripts/build-shots.ts) and served from the bucket below, which every
-- board reads (src/review/shot-store.ts).
--
-- ⚠ THE BUCKET IS PUBLIC-READ, AND THAT IS A DECISION, NOT A DEFAULT (the reviewer,
-- 2026-08-13). The preview app itself sits behind the email gate; these images
-- do not. What buys the loosening is the caching: object names are content
-- hashes, so every shot can be served `immutable` and the browser's own HTTP
-- cache becomes the second tier for free — signed URLs would cost a round-trip
-- per screen and break exactly that. What limits it: names are unguessable, the
-- contents are design mockups with fixture data, and nothing here is PHI. If
-- that trade ever stops holding, the fix is to flip the bucket private and
-- serve through a signed-URL endpoint — the board only ever needs
-- VITE_SHOTS_URL to point somewhere else.
--
-- ── Manual steps ──────────────────────────────────────────────────────────────
-- 1. ✓ APPLIED 2026-08-13 to `your Supabase project` (__DS_SUPABASE_REF__) as
--    migration `review_shots_bucket`. Verified live: the bucket exists, is
--    public, caps at 10MB/webp+json, the read policy is on storage.objects, and
--    an anonymous GET of the public path returns NoSuchKey (bucket resolves,
--    nothing in it yet) rather than NoSuchBucket or an auth error. Re-running is
--    harmless — the insert upserts and the policy is dropped first.
-- 2. GitHub → Settings → Secrets and variables → Actions, add:
--      SHOTS_SUPABASE_URL   https://<project>.supabase.co
--      SHOTS_SERVICE_KEY    Project Settings → API → service_role key
-- 3. Vercel → Project Settings → Environment Variables (all environments), add:
--      VITE_SHOTS_URL       https://<project>.supabase.co/storage/v1/object/public/review-shots/shots
--    ⚠ It is read at BUILD time (Vite inlines it), so redeploy after adding it.
-- 4. Push to main, or run the "Review shots" workflow by hand, and watch the
--    bucket fill. Nothing breaks while it is empty — the board boots screens
--    live and self-captures, exactly as it did before any of this.

-- The bucket. Public read; writes are service-role only (no policy below grants
-- insert to anon or authenticated, and RLS on storage.objects denies by default).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'review-shots',
  'review-shots',
  true,
  10 * 1024 * 1024,                        -- a shot is ~20–80KB; this is a runaway guard
  array['image/webp', 'application/json']  -- the shots, and the index that lists them
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Read for everyone. `public = true` above already serves the /object/public
-- path; this makes the intent explicit and survives the flag being flipped by
-- hand in the dashboard.
drop policy if exists "review shots are world readable" on storage.objects;
create policy "review shots are world readable"
  on storage.objects for select
  using (bucket_id = 'review-shots');

-- ⚠ No insert/update/delete policy on purpose. The CI job writes with the
-- service_role key, which bypasses RLS; a signed-in reviewer's browser must
-- never be able to write here, and the board never tries to.
