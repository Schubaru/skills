import { NextResponse } from "next/server";
import { housekeeping, sql } from "@/lib/db";
import type { Agent, AgentEvent, OfficeLook, StateResponse } from "@/lib/types";
import { MODE, PUBLIC_TOKEN } from "@/lib/mode";
import { viewerAct, viewerName } from "@/lib/viewers";

export const dynamic = "force-dynamic";

/** A viewer reads the task, not the prompt: no leading /command, first letter up. */
function taskOf(title: string | null): string | null {
  if (!title) return null;
  const t = title.replace(/^\/[\w:-]+\s*/, "") || title.slice(1);
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** What a viewer may know about an agent: who, what task, model, time, tokens, state. Never paths, branches, details, or controls.
 *  A session goes by its staff name; its task rides underneath. A subagent keeps its title, which messages are routed by. */
function scrubAgent(a: Agent): Agent {
  return {
    id: a.id,
    machine_id: null,
    session_id: "",
    parent_id: a.parent_id,
    kind: a.kind,
    title: a.kind === "session" ? null : a.title,
    task: a.kind === "session" ? taskOf(a.title) : null,
    name: a.name,
    model: a.model,
    cwd: null,
    git_branch: null,
    status: a.status,
    // Only the office's two canned exits, so a reload there keeps let-go and gone-home subagents out of the break area.
    status_detail: a.status_detail === "let go by HR" || a.status_detail === "went home with its session" ? a.status_detail : null,
    started_at: a.started_at,
    ended_at: a.ended_at,
    updated_at: a.updated_at,
    input_tokens: a.input_tokens,
    output_tokens: a.output_tokens,
    cache_read_tokens: a.cache_read_tokens,
    cache_write_tokens: a.cache_write_tokens,
    turns: a.turns,
    tool_calls: a.tool_calls,
    livery: a.livery,
    allowed_tools: [],
    stop_requested: false,
    dismissed: a.dismissed,
    hold_until: null,
    status_ts: a.status_ts,
  };
}

/** Only the events the office animates and the visitor log reads, with agents' words removed: a bubble, not what was said. */
function scrubEvents(events: AgentEvent[]): AgentEvent[] {
  const out: AgentEvent[] = [];
  for (const e of events) {
    const p = (e.payload ?? {}) as { to?: string | null; report?: boolean; kind?: string; by?: string; emoji?: string };
    const base = { id: e.id, agent_id: e.agent_id, kind: e.kind, tool: null, created_at: e.created_at };
    if (e.kind === "message") out.push({ ...base, summary: "…", payload: { to: p.to ?? null, text: "…", report: !!p.report } });
    else if (e.kind === "spawn") out.push({ ...base, summary: "", payload: null });
    else if (e.kind === "command" && (p.kind === "letgo" || p.kind === "harass" || p.kind === "coffee")) out.push({ ...base, summary: "", payload: { kind: p.kind, by: p.by } });
    else if (e.kind === "viewer") out.push({ ...base, summary: "", payload: { kind: p.kind, by: p.by, emoji: p.emoji } });
  }
  return out;
}

/** The office look when the link is live, so viewers see the room the owner picked. */
async function shared(token: string | undefined) {
  if (MODE === "admin" || !token) return null;
  // A public office answers only to its fixed token; a shared one only to the owner's current link.
  if (MODE === "view" ? token !== PUBLIC_TOKEN : token.length < 20) return null;
  const [on] =
    MODE === "view"
      ? await sql<{ office_look: OfficeLook }[]>`select office_look from noob.settings where id = 1`
      : await sql<{ office_look: OfficeLook }[]>`select office_look from noob.settings where id = 1 and share_token = ${token}`;
  return on?.office_look ?? null;
}

// Read-only by construction: no auth session, no heartbeat (a viewer must never make agents hold for the owner), no writes beyond upkeep.
export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const look = await shared(token);
  if (!look) return NextResponse.json({ error: "not shared" }, { status: 404 });

  const since = new URL(req.url).searchParams.get("since");
  await housekeeping();
  const [now] = await sql<{ now: string }[]>`select now()::text as now`;
  const sinceTs = since ? new Date(since) : null;
  const full = !sinceTs || isNaN(sinceTs.getTime());
  const agents = full
    ? await sql<Agent[]>`select * from noob.agents where dismissed = false and (status not in ('done','stopped') or ended_at > now() - interval '24 hours') order by started_at`
    : await sql<Agent[]>`select * from noob.agents where updated_at > ${sinceTs!} order by started_at`;
  const events = full
    ? await sql<AgentEvent[]>`select * from noob.events where kind in ('message','spawn','command','viewer') and created_at > now() - interval '15 minutes' order by id desc limit 300`
    : await sql<AgentEvent[]>`select * from noob.events where kind in ('message','spawn','command','viewer') and created_at > ${sinceTs!} order by id desc limit 300`;

  const body: StateResponse = { now: now.now, full, agents: agents.map(scrubAgent), events: scrubEvents(events.reverse()), blockers: [], machines: [], settings: null, look };
  return NextResponse.json(body, { headers: { "cache-control": "no-store", "x-robots-tag": "noindex" } });
}

/** A viewer joining, emoting, or tapping Harass / Get coffee. All theater and log lines: nothing reaches an agent. */
export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (!(await shared(token))) return NextResponse.json({ error: "not shared" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { agent?: unknown; act?: unknown; key?: unknown; name?: unknown; emoji?: unknown };
  const { agent, act } = body;
  if (act === "join" || act === "emote") {
    const r = await viewerAct(token, body);
    return NextResponse.json(r.body, { status: r.status });
  }
  if (typeof agent !== "string" || agent.length > 200 || (act !== "harass" && act !== "coffee")) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const [a] = await sql<{ id: string }[]>`select id from noob.agents where id = ${agent} and dismissed = false and status not in ('done','stopped')`;
  if (!a) return NextResponse.json({ error: "not here" }, { status: 404 });
  const by = await viewerName(token, body.key);
  if (!by) return NextResponse.json({ error: "who" }, { status: 401 });
  // One skit per person at a time, and a cap for the whole link so it can't flood the owner's feed.
  // ponytail: two taps in the same instant can both pass; the office ignores the second while the first plays.
  const [busy] = await sql<{ mine: number; all: number }[]>`
    select count(*) filter (where agent_id = ${agent} and created_at > now() - interval '15 seconds')::int as mine, count(*)::int as all
    from noob.events where kind = 'command' and payload->>'kind' in ('harass','coffee') and created_at > now() - interval '1 minute'`;
  if (busy.mine > 0 || busy.all >= 20) return NextResponse.json({ error: "busy" }, { status: 429 });
  const summary = act === "harass" ? `${by} harassed them; HR stepped in` : `${by} sent them for coffee`;
  await sql`insert into noob.events (agent_id, kind, summary, payload) values (${agent}, 'command', ${summary}, ${sql.json({ kind: act, by })})`;
  return NextResponse.json({ ok: true });
}
