import { NextResponse } from "next/server";
import { housekeeping, sql } from "@/lib/db";
import { guarded } from "@/lib/guard";
import type { Agent, AgentEvent, Blocker, Machine, Settings, StateResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export const GET = guarded(async (req: Request) => {
  const since = new URL(req.url).searchParams.get("since");
  await housekeeping();
  const [now] = await sql<{ now: string }[]>`select now()::text as now`;
  const sinceTs = since ? new Date(since) : null;
  const full = !sinceTs || isNaN(sinceTs.getTime());

  const agents = full
    ? await sql<Agent[]>`select * from noob.agents where dismissed = false and (status not in ('done','stopped') or ended_at > now() - interval '24 hours') order by started_at`
    : await sql<Agent[]>`select * from noob.agents where updated_at > ${sinceTs!} order by started_at`;
  const events = full
    ? await sql<AgentEvent[]>`select * from noob.events where created_at > now() - interval '15 minutes' order by id desc limit 300`
    : await sql<AgentEvent[]>`select * from noob.events where created_at > ${sinceTs!} order by id desc limit 300`;
  const blockers = full
    ? await sql<Blocker[]>`select * from noob.blockers where status = 'open' order by created_at`
    : await sql<Blocker[]>`select * from noob.blockers where coalesce(resolved_at, created_at) > ${sinceTs!} order by created_at`;
  const machines = await sql<Machine[]>`select id, name, created_at, last_seen_at from noob.machines order by created_at`;
  const [settings] = await sql<Settings[]>`select hold_mode, hold_seconds, hold_on_stop, retain_days, dashboard_seen_at, office_look from noob.settings where id = 1`;

  const body: StateResponse = { now: now.now, full, agents, events: events.reverse(), blockers, machines, settings, look: settings?.office_look ?? "office" };
  return NextResponse.json(body, { headers: { "cache-control": "no-store" } });
});
