# N00B Inc

A private command center for Claude Code agents: every session, subagent, and permission prompt on one board, plus a pixel office where each agent is an employee at a desk.

## How it works

- **Bridge** (`public/bridge/bridge.mjs`): a Claude Code hook script. Install it once per machine from Settings; it registers hooks in `~/.claude/settings.json` and posts events to the dashboard. Permission prompts and questions are held for the dashboard while it is open, so you can allow, deny, or answer from anywhere.
- **Dashboard**: Next.js on Vercel. GitHub sign-in, one allowed account, 15-minute idle sign-out.
- **Data**: Supabase Postgres, schema `noob`, accessed through a dedicated role.

## Run locally

```bash
cp .env.example .env.local   # fill in values
npm install
npm run dev
```

`bridge/replay.mjs` fires a realistic hook sequence at a running dashboard (needs `DATABASE_URL`).
