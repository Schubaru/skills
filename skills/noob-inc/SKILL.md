---
name: noob-inc
description: Builds N00B Inc, a live office for your Claude Code agents. It has a 16-bit pixel office where every session and subagent works at a desk, a board with each agent's task, model, time and tokens, an inbox where you answer permission prompts and questions from anywhere (phone included), and an optional public view-only link that friends can watch. It deploys the exact N00B Inc app (Next.js on Vercel, Supabase Postgres, GitHub sign-in, and a Claude Code hook bridge) into the user's own accounts. Use this skill whenever someone asks to build, set up, install, deploy or clone N00B Inc or "noob inc", or wants an "agent office", a dashboard or command center for their Claude Code sessions, a way to watch or unblock their agents from their phone, a pixel-art office of their agents, or a page where other people can watch their agents work, even if they don't name N00B Inc.
---

# Build N00B Inc

N00B Inc is a finished app. This skill deploys it into the user's own Vercel, Supabase and GitHub accounts **exactly as it is**. The full source is in `assets/template/`. Don't redesign it, re-implement it, "improve" it or swap the stack. The person sharing this skill wants every copy to look and work like theirs. Two things change per user, and both are environment variables: which sides are built, and the label next to the wordmark.

How it works, so you can explain it and fix problems:

- **Bridge** (`public/bridge/bridge.mjs`): a Claude Code hook script, installed once per machine into `~/.claude/settings.json`. It posts every session event to the app. On the admin side, while the dashboard is open, it holds permission prompts and questions so they can be answered there (Claude's own dialog stays up too, and whichever side answers first wins).
- **App**: Next.js 15 on Vercel. All state lives in Supabase Postgres in schema `noob`, reached only through a dedicated login role `noob` over the transaction pooler.
- **Admin side**: GitHub sign-in limited to one allowed account, a sliding 15-minute idle sign-out, a blockers inbox, nudge and stop controls, and settings.
- **View-only side**: the same office and board with paths, prompts and agents' words removed. Visitors pick a name, emote, and can "harass" an agent or send it for coffee. Those are animations only and never reach an agent.

## Step 1: Ask what to build

Before anything else, ask with AskUserQuestion. Put these in one call:

1. **Which sides?** The user must be able to pick either one or both:
   - **Admin and view-only (both)**: a private dashboard for the owner, plus a Share button that makes a view-only link they can send to others (and turn off or replace at any time).
   - **Admin only**: the private dashboard with no sharing at all.
   - **View-only only**: a public office at the site's root URL. There is no sign-in and no controls. Anyone with the URL can watch, the agents never wait on it, and GitHub sign-in isn't needed.
2. **Office label.** The top bar reads "N00B Inc" and then a label. The default is "<first name>'s agent office", so ask for their first name. They can also type a different label. The name N00B Inc itself stays the same.
3. **GitHub username** (only if the admin side is included). This is the only account that can sign in.

Map the answer to `NEXT_PUBLIC_NOOB_MODE`:

| Choice | `NEXT_PUBLIC_NOOB_MODE` | GitHub OAuth app needed |
| --- | --- | --- |
| Both | `both` | yes |
| Admin only | `admin` | yes |
| View-only only | `view` | no |

## Step 2: Check what they have

Check these, and say plainly what's missing before you start:

- Node 20+ and npm (`node -v`), git, curl. The bridge installer is a POSIX shell script, so on Windows use WSL.
- A **Vercel** account. Use the CLI through `npx vercel@latest`. Logging in is interactive, so the user runs it: `npx vercel@latest login`. (In Claude Code they can type `! npx vercel@latest login`.)
- A **Supabase** account. If the Supabase MCP connector is available, use it. If not, the user creates the project at supabase.com and pastes SQL into the SQL editor.
- A **GitHub** account (admin side only).

## Step 3: Copy the app

Copy `assets/template/` to where the user wants the project (default `~/noob-inc`), then run `git init` and `npm install` there. Don't edit the source files. If the user asks for changes later, that's a separate task after the build.

## Step 4: Database (Supabase)

1. **Project.** With the MCP: `list_organizations` → `get_cost` → `confirm_cost` (tell the user the cost first) → `create_project` (name `noob-inc`, a region near them). Without it, the user creates the project in the dashboard. Note the project ref.
2. **Role password.** Generate it with `openssl rand -hex 24`. Hex avoids URL-escaping problems. Treat it as a secret: write it to files and commands, never repeat it in chat.
3. **Schema.** Take `db/schema.sql`, replace `<NOOB_ROLE_PASSWORD>`, and apply it as the project owner. With the MCP, use `apply_migration` with name `noob_schema`. Without it, the user pastes the SQL into the SQL editor. This creates the tables, the single settings row, and the `noob` role. The Supabase MCP never hands out the database password, which is why the app has its own role.
4. **View-only only:** also run `update noob.settings set hold_mode = 'never' where id = 1;`. Without an owner dashboard, nothing should ever hold an agent's question.
5. **Connection string.** Use the transaction pooler (port 6543), with the user written as `noob.<ref>`:
   `postgres://noob.<ref>:<password>@<pooler-host>:6543/postgres`
   The pooler host is region-specific and looks like `aws-0-us-east-1.pooler.supabase.com` (sometimes `aws-1-…`). The user can copy it from Dashboard → Connect → Transaction pooler. If you guess it, prove it works before moving on:
   `DATABASE_URL=… node -e "import('postgres').then(async m=>{const s=m.default(process.env.DATABASE_URL,{prepare:false,ssl:'require'});console.log(await s\`select count(*) from noob.settings\`);await s.end()})"`
6. Write `.env.local` from `.env.example` with `DATABASE_URL`, a fresh `AUTH_SECRET` (`openssl rand -base64 32`), `AUTH_TRUST_HOST=true`, `NEXT_PUBLIC_NOOB_MODE`, `NEXT_PUBLIC_OFFICE_NAME`, and `ALLOWED_GITHUB_LOGIN` (admin side). For local work on the admin side, `DEV_BYPASS_AUTH=1` skips GitHub sign-in on localhost only. Don't `source` this file in a shell, because an apostrophe in the label ("Sam's") breaks it. To read one value, use `grep '^NAME=' .env.local | cut -d= -f2-`.

## Step 5: Deploy (Vercel)

Run everything from the project folder with `npx vercel@latest`. The Vercel MCP connector can't write env vars, so use the CLI.

1. `npx vercel@latest link --yes` creates and links a project named after the folder (that's why the default folder is `noob-inc`).
2. Add production env vars by piping each value, so secrets never sit in shell history or chat:
   `printf '%s' "$VALUE" | npx vercel@latest env add NAME --environment production`
   - Every mode: `DATABASE_URL`, `AUTH_SECRET`, `AUTH_TRUST_HOST=true`, `NEXT_PUBLIC_NOOB_MODE`, `NEXT_PUBLIC_OFFICE_NAME`
   - Admin side, also: `ALLOWED_GITHUB_LOGIN`. Add `AUTH_GITHUB_ID` and `AUTH_GITHUB_SECRET` in step 6.
   - `NEXT_PUBLIC_*` values are baked in at build time. After changing one, redeploy.
3. `npx vercel@latest deploy --prod --yes`. Take the production URL from the "Aliased" line, usually `https://<name>.vercel.app`.
4. **The bridge must reach the app without a Vercel login.** Check with `curl -s -o /dev/null -w '%{http_code}' <url>/bridge/install.sh`. If you get 401, the user goes to Vercel → project → Settings → Deployment Protection and sets Vercel Authentication to preview deployments only (or off). The admin side stays behind GitHub sign-in either way.

## Step 6: GitHub sign-in (admin side only)

The user creates an OAuth app: GitHub → Settings → Developer settings → OAuth Apps → New OAuth App.

| Field | Value |
| --- | --- |
| Application name | N00B Inc |
| Homepage URL | `<url>` |
| Authorization callback URL | `<url>/api/auth/callback/github` |

They generate a client secret. The client ID isn't secret, so you can add it yourself (`AUTH_GITHUB_ID`). Have the user add the secret themselves so it never passes through chat: `! npx vercel@latest env add AUTH_GITHUB_SECRET --environment production` prompts for it. Then redeploy with `npx vercel@latest deploy --prod --yes`.

## Step 7: Install the bridge

Make a token for this machine and print its install command:

`DATABASE_URL=… node bridge/add-machine.mjs <url> "<machine name>"`

Before running the printed `curl … | sh` command, tell the user it adds N00B Inc hooks to `~/.claude/settings.json`. It keeps their existing hooks and writes a backup to `settings.json.noob-backup`. Then run it. On the admin side, they can add more machines later from Settings → Add machine. In view-only mode, run `add-machine.mjs` again for each machine.

To remove the bridge: `node ~/.claude/noob-inc/bridge.mjs --uninstall-hooks`.

## Step 8: Check it, then hand over

- Open `<url>`. On the admin side, sign in with the allowed GitHub account and confirm the board loads. In view-only mode, `/` shows the "Pick a name" gate, and `/settings` and `/login` redirect back to `/`.
- Ask the user to start a new Claude Code session. It should appear on the board and in the office within seconds. For a quick check that doesn't need a real session, `DATABASE_URL=… node bridge/replay.mjs <url>` plays three sample sessions. They show up under the machine "replay-mac". Remove it afterwards: on the admin side, revoke it in Settings. In view-only mode, which has no Settings page, run `delete from noob.machines where name = 'replay-mac';`.
- Finish with a short summary: the URL, which sides were built, how to share (both: the Share button in the top bar; view-only only: the URL itself), how to change the label or mode (change the env var, then redeploy), and how to remove the bridge. Suggest they save the project's IDs (Vercel project, Supabase ref, OAuth client ID) somewhere they'll find them again.

## When something's off

- **Nothing shows up on the board:** check `~/.claude/noob-inc/config.json` (URL and token), confirm the install.sh URL returns 200, and confirm the session started *after* the install, because hooks load when a session starts.
- **401 from `/api/bridge/*`:** Vercel Deployment Protection is on for production (see step 5.4).
- **Database errors on Vercel:** the URL must use port 6543 with user `noob.<ref>`. The code already turns off prepared statements for the pooler.
- **Sign-in says "AccessDenied":** `ALLOWED_GITHUB_LOGIN` must match the GitHub username exactly. Redeploy after fixing it.
- **Changing the bridge code:** deploy first, then re-run the install command. Each hook runs a fresh copy of `~/.claude/noob-inc/bridge.mjs`, so open sessions pick it up without restarting.
