import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { guarded } from "@/lib/guard";
import type { AgentEvent, Blocker } from "@/lib/types";
import { STOPPED } from "@/lib/ingest";

type Ctx = { params: Promise<{ id: string }> };

export const GET = guarded(async (_req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const events = await sql<AgentEvent[]>`select * from noob.events where agent_id = ${id} order by id desc limit 200`;
  const blockers = await sql<Blocker[]>`select * from noob.blockers where agent_id = ${id} order by created_at desc limit 20`;
  return NextResponse.json({ events: events.reverse(), blockers });
});

export const POST = guarded(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = (await req.json()) as { action: string; text?: string; title?: string };
  const [agent] = await sql<{ id: string; status: string; kind: string }[]>`select id, status, kind from noob.agents where id = ${id}`;
  if (!agent) return NextResponse.json({ error: "no such agent" }, { status: 404 });

  switch (body.action) {
    case "nudge": {
      const text = (body.text ?? "").trim().slice(0, 2000);
      if (!text) return NextResponse.json({ error: "empty message" }, { status: 400 });
      await sql`insert into noob.commands (agent_id, kind, text) values (${id}, 'nudge', ${text})`;
      await sql`update noob.agents set updated_at = now() where id = ${id}`;
      return NextResponse.json({ ok: true, delivery: agent.status === "holding" ? "now" : "next tool call or turn end" });
    }
    case "stop": {
      await sql`insert into noob.commands (agent_id, kind) values (${id}, 'stop')`;
      // Its subagents stop with it. Each one halts at its next tool call or prompt.
      const targets = await sql<{ id: string; status: string }[]>`update noob.agents set stop_requested = true, updated_at = now()
        where (id = ${id} or parent_id = ${id}) and status not in ('done','stopped') returning id, status`;
      const ids = targets.map((t) => t.id);
      // Anything waiting on you is answered "no" and the turn is interrupted on the spot.
      await sql`update noob.blockers set status = 'resolved', decision = ${sql.json({ behavior: "deny", message: STOPPED, interrupt: true })}, resolved_at = now()
        where agent_id in ${sql(ids.length ? ids : [id])} and status = 'open'`;
      // Waiting, paused, or idle agents have nothing left to run, so they are stopped now; busy ones finish the current step first.
      await sql`update noob.agents set status = case when status in ('blocked','holding','idle') then 'stopped' else status end,
        status_detail = case when status in ('blocked','holding','idle') then 'stopped from the dashboard' else 'stopping after this step' end,
        hold_until = null, status_ts = ${Date.now()}, updated_at = now()
        where id in ${sql(ids.length ? ids : [id])}`;
      return NextResponse.json({ ok: true, stopped: targets.filter((t) => ["blocked", "holding", "idle"].includes(t.status)).length === targets.length });
    }
    case "release": {
      await sql`update noob.agents set status = 'done', status_detail = 'finished its turn', ended_at = now(), hold_until = null, updated_at = now() where id = ${id} and status = 'holding'`;
      return NextResponse.json({ ok: true });
    }
    case "rename": {
      const title = (body.title ?? "").trim().slice(0, 120);
      // A session is renamed by its title; a subagent by its staff name (its title is the task it was given).
      if (agent.kind === "subagent") {
        if (title) await sql`update noob.agents set name = ${title}, updated_at = now() where id = ${id}`;
      } else await sql`update noob.agents set title = ${title || null}, updated_at = now() where id = ${id}`;
      return NextResponse.json({ ok: true });
    }
    case "letgo": {
      // A finished subagent waiting in the break area only leaves the office: its row is already done, so nothing stops.
      if (agent.kind === "subagent" && agent.status === "done") {
        const [sub] = await sql<{ id: string }[]>`update noob.agents set status_detail = 'let go by HR', updated_at = now()
          where id = ${id} and status = 'done' and status_detail is distinct from 'let go by HR' returning id`;
        if (!sub) return NextResponse.json({ error: "already let go" }, { status: 409 });
        await sql`insert into noob.events (agent_id, kind, summary, payload) values (${id}, 'command', 'let go by HR', ${sql.json({ kind: "letgo" })})`;
        return NextResponse.json({ ok: true });
      }
      // HR walks an idle session (and anything still running under it) out. Its next prompt hires it back.
      const [root] = await sql<{ id: string }[]>`update noob.agents set status = 'done', status_detail = 'let go by HR', ended_at = now(),
        hold_until = null, status_ts = ${Date.now()}, updated_at = now() where id = ${id} and status = 'idle' returning id`;
      if (!root) return NextResponse.json({ error: "only an idle agent can be let go" }, { status: 409 });
      await sql`update noob.agents set status = 'done', ended_at = now(), updated_at = now() where parent_id = ${id} and status not in ('done','stopped')`;
      await sql`insert into noob.events (agent_id, kind, summary, payload) values (${id}, 'command', 'let go by HR', ${sql.json({ kind: "letgo" })})`;
      return NextResponse.json({ ok: true });
    }
    case "dismiss": {
      await sql`update noob.agents set dismissed = true, updated_at = now() where id = ${id} and status in ('done','stopped')`;
      return NextResponse.json({ ok: true });
    }
    case "revoke_allows": {
      await sql`update noob.agents set allowed_tools = '{}', updated_at = now() where id = ${id}`;
      return NextResponse.json({ ok: true });
    }
    default:
      return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }
});
