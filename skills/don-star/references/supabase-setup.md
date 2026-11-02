# Shared board: Supabase, sign-in, notifications

With no env vars the board is a local tool: comments in localStorage plus the
committed `review-board.json`, no sign-in, name asked at the first comment.
This file is the order of operations for turning the same install into a
shared, gated board. Every SQL file and function it names is already in the
app (`supabase/`), written by install.sh with the project's own slug and admin
domain filled in.

Do the stages in order; each is additive until the one marked ⚠.

## 1. Create the project and apply the schema

In the Supabase SQL editor (or `supabase db push`), run in this order:

| # | File | Creates |
| --- | --- | --- |
| 1 | `review-comments.sql` | `review_threads` + realtime |
| 2 | `review-statuses.sql` | `review_statuses` + realtime |
| 3 | `review-events.sql` | `review_events` (append-only audit log) |
| 4 | `auth-access.sql` stages A–C | `access_rules` (seeded with the admin domain), `is_email_allowed()`, the Before User Created hook, attribution columns |
| 5 | `project-access.sql` parts A–C | `is_admin`, `can_access_project`, `my_project_slugs`, `project_access` seeded with the default project open to everyone who can sign in |
| 6 | `review-people-reads.sql` | `review_people` (the @ directory), `review_thread_reads` |
| 7 | `review-presence.sql` | realtime RLS for presence + the trigger that mirrors names into the directory |
| 8 | `access-sharing.sql` | folders, `access_requests`, the share/unshare/request/decide RPCs, `my_default_name`; seeds the Archive folder |
| 9 | `review-notify.sql` | notification prefs, ledger, config row (site URL + sender), the pg_net trigger |
| 10 | `flow-docs.sql` | `flow_docs` for `flows` projects |
| 11 | `review-shots.sql` | the public `review-shots` bucket (only if you run the shots workflow) |

Then, **in the same window as deploying the gated build**, run the two ⚠ parts:
`auth-access.sql` stage D and `project-access.sql` part D. They flip RLS from
anon to authenticated-and-granted; from that moment an ungated build can no
longer write. Part D refuses to run unless the default project still has its
`all` grant, so a partial paste can't lock everyone out.

The seed rows are the ones to review before applying: the admin domain in
`access_rules` (that domain administers everything), the default project's
open grant, the site URL and sender in `review_notify_config`.

## 2. Dashboard settings (no SQL for these)

- **Authentication → Hooks → Before User Created** → Postgres function
  `public.hook_before_user_created`. Until this is registered any email can
  create an account (RLS still limits what it can do after stage D).
- **Authentication → Email**: enable email OTP; set custom SMTP (Resend works)
  and an OTP template — the login page shows a 6-digit code field.
- **Realtime**: `review_threads`, `review_statuses`, `flow_docs` are added to the
  publication by their SQL; presence uses `realtime.messages` policies.

## 3. Env vars

```
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<publishable key>
```

Locally that is `.env`; on Vercel add the same two plus `GATE_SECRET` (any long
random string — the edge middleware signs its 30-day cookie with it; rotating it
signs everyone out). The middleware fails closed without all three.

The moment the two `VITE_` vars are set, every board surface is behind the
email + code gate (`src/auth/` locally, `middleware.ts` on Vercel), comments
go to Postgres and arrive over realtime, and the committed JSON becomes the
seed and the agent's inbox rather than the store: the client upserts the
merged committed delta, so the database is a superset, never a fork.

## 4. Edge functions

```bash
supabase functions deploy notify-review
supabase functions deploy request-access --no-verify-jwt
supabase functions deploy review-triage  --no-verify-jwt
supabase secrets set RESEND_API_KEY=re_…
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected by the platform.
`request-access` and `review-triage` are called without a user session (from the
login door, and from CI), which is why they run with JWT verification off and
authenticate their own way: rate limits and a never-reveal policy for the
first, a dedicated `triage_token` column in `review_notify_config` for the
second. The `notify-review` trigger URL in `review-notify.sql` carries the
project ref — check it after install.

## 5. Grant the first people

Sign in as an address on the admin domain, open `/projects/access`, and add
people or domains under **Users**; project grants under **Projects** (or the
Share pill on any board). A domain rule admits everyone on it; the default
project's `all` grant means a newly admitted domain sees it immediately — narrow
that from the project's sharing page if it shouldn't.

## What each table is for (quick reference)

- `review_threads` — comments, replies (jsonb), events (`meta.docKind`), mentions.
- `review_statuses` — per-screen / per-flow verdicts (hidden in the UI by default).
- `review_events` — the append-only audit log of board actions.
- `access_rules` — who may sign in; `is_admin`; `display_name` for invitees.
- `project_access`, `project_folders`, `project_folder_items`, `folder_access` —
  who may open what.
- `access_requests` — "let me in" rows from the login door and the request screen.
- `review_people`, `review_thread_reads` — the @ directory, per-person read state.
- `review_notify_prefs`, `review_notifications`, `review_notify_config` — email.
- `flow_docs` — one row per flow-chart diagram, `rev`-guarded.
- Storage bucket `review-shots` — prebuilt previews, public-read by design (names
  are content hashes; contents are fixture screens). Flip it private and serve
  signed URLs if that ever stops being true; the board only needs `VITE_SHOTS_URL`
  to point somewhere else.
