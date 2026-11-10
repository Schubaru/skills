import { createHash } from "node:crypto";
import { sql } from "./db";
import type { Agent, Settings } from "./types";
import { LIVERY_COUNT } from "./types";
import { NAMES } from "./names";

export interface BridgeBody {
  event: string;
  ts?: number;
  session_id: string;
  agent_id?: string;
  agent_type?: string;
  cwd?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  prompt?: string;
  notification_type?: string;
  message?: string;
  source?: string;
  reason?: string;
  model?: string;
  session_title?: string;
  stop_hook_active?: boolean;
  last_assistant_message?: string;
  git_branch?: string;
  usage?: { input: number; output: number; cache_read: number; cache_write: number; model?: string } | null;
}

export interface BridgeReply {
  ok: true;
  agentId: string;
  blockerId?: string;
  hold?: boolean;
  holdSeconds?: number;
  decision?: { behavior: "allow" } | { behavior: "deny"; message: string; interrupt?: boolean };
  deny?: string;
  context?: string;
  reason?: string;
}

const QUESTION_HOLD_SECONDS = 3480;

export const STOPPED = "The operator stopped this agent from the N00B Inc dashboard.";

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function machineFromRequest(req: Request) {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;
  const rows = await sql<{ id: string; name: string }[]>`
    update noob.machines set last_seen_at = now() where token_hash = ${hashToken(token)} returning id, name`;
  return rows[0] ?? null;
}

const trunc = (s: unknown, n = 140) => {
  const t = typeof s === "string" ? s : s == null ? "" : JSON.stringify(s);
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};

export function summarizeTool(tool: string | undefined, input: Record<string, unknown> | undefined): string {
  if (!input) return "";
  const i = input as Record<string, string | undefined>;
  switch (tool) {
    case "Bash":
      return trunc(i.description || i.command);
    case "Read":
    case "Write":
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return trunc(i.file_path || i.notebook_path);
    case "Glob":
    case "Grep":
      return trunc(`${i.pattern}${i.path ? "  in " + i.path : ""}`);
    case "Agent":
      return trunc(i.description || i.prompt);
    case "SendMessage":
      return trunc(i.message);
    case "WebFetch":
      return trunc(i.url);
    case "WebSearch":
      return trunc(i.query);
    case "Skill":
      return trunc(i.skill);
    case "ToolSearch":
      return trunc(i.query);
    case "TaskCreate":
      return trunc(i.subject || i.description);
    case "TaskUpdate":
      return trunc([i.subject, i.status].filter(Boolean).join(" · ") || `task ${i.taskId ?? ""}`);
    case "AskUserQuestion": {
      const qs = (input.questions as { question: string }[] | undefined) ?? [];
      return trunc(qs.map((q) => q.question).join("  /  "));
    }
    default: {
      const t = trunc(input);
      return t === "{}" ? "" : t;
    }
  }
}

async function getSettings(): Promise<Settings> {
  const [s] = await sql<Settings[]>`select hold_mode, hold_seconds, hold_on_stop, retain_days, dashboard_seen_at from noob.settings where id = 1`;
  return s;
}

function dashboardOpen(s: Settings) {
  return !!s.dashboard_seen_at && Date.now() - new Date(s.dashboard_seen_at).getTime() < 90_000;
}

function shouldHold(s: Settings) {
  if (s.hold_mode === "never") return false;
  if (s.hold_mode === "always") return true;
  return dashboardOpen(s);
}

// ponytail: concurrent check-ins can draw the same name once all 150 are in use; a unique index would fix it if it ever matters.
async function pickName(): Promise<string> {
  const [r] = await sql<{ n: string }[]>`
    select n from unnest(string_to_array(${NAMES.join(",")}, ',')) n
    left join (select name, max(started_at) as last from noob.agents group by name) u on u.name = n
    order by u.last nulls first, random() limit 1`;
  return r.n;
}

async function pickLivery(): Promise<number> {
  const rows = await sql<{ livery: number; n: number }[]>`
    select livery, count(*)::int as n from noob.agents
    where updated_at > now() - interval '12 hours' and status not in ('done','stopped')
    group by livery`;
  const used = new Map(rows.map((r) => [r.livery, r.n]));
  let best = 0;
  let bestN = Infinity;
  // Hue-spaced order so neighbours on the board never share adjacent hues.
  const order = [0, 5, 3, 7, 1, 4, 6, 2].filter((l) => l < LIVERY_COUNT);
  for (const l of order) {
    const n = used.get(l) ?? 0;
    if (n < bestN) {
      best = l;
      bestN = n;
    }
  }
  return best;
}

async function ensureAgent(machineId: string, b: BridgeBody): Promise<Agent> {
  const id = b.agent_id ? `${b.session_id}/${b.agent_id}` : b.session_id;
  const kind = b.agent_id ? "subagent" : "session";
  const parent = b.agent_id ? b.session_id : null;
  const existing = await sql<Agent[]>`select * from noob.agents where id = ${id}`;
  if (existing[0]) {
    const [a] = await sql<Agent[]>`update noob.agents set
      machine_id = ${machineId},
      cwd = coalesce(${b.cwd ?? null}, cwd),
      git_branch = coalesce(${b.git_branch ?? null}, git_branch),
      model = coalesce(${b.usage?.model ?? b.model ?? null}, model),
      updated_at = now()
      where id = ${id} returning *`;
    return a;
  }
  if (parent) {
    const p = await sql`select 1 from noob.agents where id = ${parent}`;
    if (!p.length) {
      await sql`insert into noob.agents (id, machine_id, session_id, kind, cwd, livery, name, status, status_ts)
        values (${parent}, ${machineId}, ${b.session_id}, 'session', ${b.cwd ?? null}, ${await pickLivery()}, ${await pickName()}, 'working', ${b.ts ?? 0})
        on conflict (id) do nothing`;
    }
  }
  let title: string | null = b.session_title ?? null;
  if (parent) {
    // The parent's most recent Agent spawn names the task.
    const spawn = await sql<{ summary: string | null; payload: { agent_type?: string } | null }[]>`
      select summary, payload from noob.events where agent_id = ${parent} and kind = 'spawn' order by id desc limit 1`;
    title = spawn[0]?.summary || (b.agent_type ? `${b.agent_type} agent` : null);
  }
  const [a] = await sql<Agent[]>`insert into noob.agents
    (id, machine_id, session_id, parent_id, kind, cwd, git_branch, model, livery, name, title, status, status_ts)
    values (${id}, ${machineId}, ${b.session_id}, ${parent}, ${kind}, ${b.cwd ?? null}, ${b.git_branch ?? null},
      ${b.usage?.model ?? b.model ?? null}, ${await pickLivery()}, ${await pickName()}, ${title}, 'thinking', ${b.ts ?? 0})
    on conflict (id) do update set updated_at = now() returning *`;
  return a;
}

async function setStatus(a: Agent, status: Agent["status"], detail: string | null, ts: number, ended = false) {
  // Detached hook sends can arrive out of order; never let an older event overwrite a newer status.
  if (ts && ts < Number(a.status_ts ?? 0)) return;
  await sql`update noob.agents set status = ${status}, status_detail = ${detail}, status_ts = ${ts || Date.now()},
    ended_at = ${ended ? sql`now()` : null}, hold_until = null, updated_at = now() where id = ${a.id}`;
}

async function addEvent(agentId: string, kind: string, tool: string | null, summary: string | null, payload: unknown = null) {
  await sql`insert into noob.events (agent_id, kind, tool, summary, payload) values (${agentId}, ${kind}, ${tool}, ${summary}, ${payload ? sql.json(payload as never) : null})`;
}

async function applyUsage(a: Agent, u: BridgeBody["usage"]) {
  if (!u) return;
  await sql`update noob.agents set
    input_tokens = greatest(input_tokens, ${u.input | 0}),
    output_tokens = greatest(output_tokens, ${u.output | 0}),
    cache_read_tokens = greatest(cache_read_tokens, ${u.cache_read | 0}),
    cache_write_tokens = greatest(cache_write_tokens, ${u.cache_write | 0}),
    model = coalesce(${u.model ?? null}, model)
    where id = ${a.id}`;
}

async function expireOpenBlockers(agentId: string, exceptId?: string) {
  await sql`update noob.blockers set status = 'expired', resolved_at = now()
    where agent_id = ${agentId} and status = 'open' and id is distinct from ${exceptId ?? null}`;
}

async function pendingCommand(agentId: string, kind: "stop" | "nudge") {
  const rows = await sql<{ id: string; text: string | null }[]>`
    update noob.commands set status = 'delivered', delivered_at = now()
    where id = (select id from noob.commands where agent_id = ${agentId} and kind = ${kind} and status = 'pending' order by created_at limit 1)
    returning id, text`;
  return rows[0] ?? null;
}

export async function handleBridgeEvent(machineId: string, b: BridgeBody): Promise<BridgeReply> {
  // Claude Code's own background agents (prompt suggestions, compaction) report a SubagentStop with no start. They aren't staff.
  if (b.event === "SubagentStop" && b.agent_id) {
    const id = `${b.session_id}/${b.agent_id}`;
    if (!(await sql`select 1 from noob.agents where id = ${id}`).length) return { ok: true, agentId: id };
  }
  const a = await ensureAgent(machineId, b);
  const ts = b.ts ?? Date.now();
  const reply: BridgeReply = { ok: true, agentId: a.id };
  await applyUsage(a, b.usage);

  switch (b.event) {
    case "SessionStart": {
      // Reopening a finished session doesn't bring it back; its next prompt does.
      if ((b.source === "startup" || b.source === "resume") && a.status !== "done" && a.status !== "stopped") await setStatus(a, "idle", "waiting for your prompt", ts);
      break;
    }
    case "UserPromptSubmit": {
      await expireOpenBlockers(a.id);
      const first = !a.title && b.prompt ? trunc(b.prompt.replace(/\s+/g, " ").trim(), 90) : null;
      await sql`update noob.agents set title = coalesce(title, ${first}), turns = turns + 1, stop_requested = false where id = ${a.id}`;
      await setStatus(a, "thinking", null, ts);
      // Last turn's finished subagents walked out with it; the office keeps them out of the break area from here on.
      await sql`update noob.agents set status_detail = 'went home with its session', updated_at = now()
        where parent_id = ${a.id} and status = 'done' and status_detail is null`;
      await addEvent(a.id, "prompt", null, trunc(b.prompt, 400));
      break;
    }
    case "PreToolUse": {
      const tool = b.tool_name ?? "tool";
      await expireOpenBlockers(a.id);
      await sql`update noob.agents set tool_calls = tool_calls + 1 where id = ${a.id}`;
      const summary = summarizeTool(tool, b.tool_input);
      if (tool === "Agent") await addEvent(a.id, "spawn", tool, summary, { agent_type: (b.tool_input?.subagent_type as string) ?? null });
      else if (tool === "SendMessage") await addEvent(a.id, "message", tool, summary, { to: (b.tool_input?.to as string) ?? null, text: trunc(b.tool_input?.message, 400) });
      else await addEvent(a.id, "tool", tool, summary);

      if (a.stop_requested || (await pendingCommand(a.id, "stop"))) {
        await sql`update noob.agents set stop_requested = true where id = ${a.id}`;
        await setStatus(a, "stopped", "stopped from the dashboard", ts);
        reply.deny = STOPPED;
        return reply;
      }
      const nudge = await pendingCommand(a.id, "nudge");
      if (nudge?.text) {
        reply.context = `Message from the operator via the N00B Inc dashboard: ${nudge.text}`;
        await addEvent(a.id, "command", null, trunc(nudge.text, 400), { kind: "nudge" });
      }
      await setStatus(a, "working", tool, ts);
      break;
    }
    case "PostToolUse": {
      // Answered in Claude itself: the dashboard copy of the prompt is moot.
      await expireOpenBlockers(a.id);
      if (a.status !== "stopped") await setStatus(a, "thinking", null, ts);
      break;
    }
    case "PermissionRequest": {
      const tool = b.tool_name ?? "tool";
      // AskUserQuestion reaches hooks as a permission request; answering it is a question, not an allow.
      const question = tool === "AskUserQuestion";
      if (a.stop_requested) {
        await setStatus(a, "stopped", "stopped from the dashboard", ts);
        reply.decision = { behavior: "deny", message: STOPPED, interrupt: true };
        return reply;
      }
      if (!question && a.allowed_tools.includes(tool)) {
        reply.decision = { behavior: "allow" };
        return reply;
      }
      const s = await getSettings();
      const summary = summarizeTool(tool, b.tool_input);
      const [bl] = await sql<{ id: string }[]>`insert into noob.blockers (agent_id, kind, tool, input, prompt)
        values (${a.id}, ${question ? "question" : "permission"}, ${tool}, ${sql.json((b.tool_input ?? {}) as never)}, ${summary}) returning id`;
      await setStatus(a, "blocked", question ? "asking you a question" : `needs permission: ${tool}`, ts);
      await addEvent(a.id, "blocker", tool, summary, { blocker: bl.id, kind: question ? "question" : "permission" });
      reply.blockerId = bl.id;
      // Claude shows its own copy of a question at the same time, so holding one never delays you: only "never" opts out,
      // and it stays answerable here for as long as the hook may run (the bridge registers PermissionRequest with a 3600s timeout).
      reply.hold = question ? s.hold_mode !== "never" : shouldHold(s);
      reply.holdSeconds = question ? QUESTION_HOLD_SECONDS : s.hold_seconds;
      if (reply.hold) await sql`update noob.agents set hold_until = now() + make_interval(secs => ${reply.holdSeconds}) where id = ${a.id}`;
      return reply;
    }
    case "Notification": {
      // A hold that ran out without a reply: the turn is over.
      if (b.notification_type === "idle_prompt" && a.status === "holding") await setStatus(a, "done", "finished its turn", ts, true);
      else if (b.notification_type === "elicitation_dialog" || b.notification_type === "elicitation_url_dialog") {
        await sql`insert into noob.blockers (agent_id, kind, tool, prompt) values (${a.id}, 'elicitation', null, ${trunc(b.message, 300) || "An MCP server needs input in the terminal"})`;
        await setStatus(a, "blocked", "needs input in the terminal", ts);
      }
      break;
    }
    case "SubagentStart": {
      await addEvent(a.id, "note", null, `started${b.agent_type ? ` as ${b.agent_type}` : ""}`);
      await setStatus(a, "thinking", null, ts);
      break;
    }
    case "SubagentStop": {
      await expireOpenBlockers(a.id);
      await setStatus(a, "done", null, ts, true);
      if (a.parent_id) await addEvent(a.id, "message", null, trunc(b.last_assistant_message, 300) || "reported back", { to: a.parent_id, text: trunc(b.last_assistant_message, 400), report: true });
      break;
    }
    case "Stop": {
      await expireOpenBlockers(a.id);
      if (a.stop_requested) {
        await setStatus(a, "stopped", "stopped from the dashboard", ts);
        return reply;
      }
      const nudge = await pendingCommand(a.id, "nudge");
      if (nudge?.text && !b.stop_hook_active) {
        reply.reason = `Message from the operator via the N00B Inc dashboard: ${nudge.text}`;
        await addEvent(a.id, "command", null, trunc(nudge.text, 400), { kind: "nudge" });
        await setStatus(a, "thinking", null, ts);
        return reply;
      }
      const s = await getSettings();
      if (s.hold_on_stop && shouldHold(s) && !b.stop_hook_active) {
        reply.hold = true;
        reply.holdSeconds = s.hold_seconds;
        await setStatus(a, "holding", "finished its turn, holding for your reply", ts);
        await sql`update noob.agents set hold_until = now() + make_interval(secs => ${s.hold_seconds}) where id = ${a.id}`;
        return reply;
      }
      // A finished turn is done: nothing runs until you prompt again, and that prompt reopens it.
      await setStatus(a, "done", trunc(b.last_assistant_message, 120) || "finished its turn", ts, true);
      break;
    }
    case "SessionEnd": {
      await expireOpenBlockers(a.id);
      await setStatus(a, "done", b.reason ?? null, ts, true);
      await sql`update noob.agents set status = 'done', ended_at = now() where parent_id = ${a.id} and status not in ('done','stopped')`;
      await addEvent(a.id, "end", null, b.reason ?? "session ended");
      break;
    }
  }
  return reply;
}

/** Called by the bridge while it holds a prompt or a finished turn. With waitMs, holds the request open until something changes. */
export async function bridgeWait(params: { blocker?: string; agent?: string }, waitMs = 0) {
  const until = Date.now() + waitMs;
  for (;;) {
    const r = await checkWait(params);
    if (r.done || Date.now() >= until) return r.body;
    await new Promise((res) => setTimeout(res, 250));
  }
}

async function checkWait(params: { blocker?: string; agent?: string }): Promise<{ done: boolean; body: Record<string, unknown> }> {
  if (params.blocker) {
    const [bl] = await sql<{ status: string; decision: Record<string, unknown> | null; kind: string }[]>`
      select status, decision, kind from noob.blockers where id = ${params.blocker}`;
    if (!bl) return { done: true, body: { status: "expired" } };
    return { done: bl.status !== "open", body: { status: bl.status, decision: bl.decision, kind: bl.kind } };
  }
  if (params.agent) {
    const [a] = await sql<{ status: string; stop_requested: boolean }[]>`select status, stop_requested from noob.agents where id = ${params.agent}`;
    if (!a || a.status !== "holding" || a.stop_requested) return { done: true, body: { released: true } };
    const nudge = await pendingCommand(params.agent, "nudge");
    if (nudge?.text) {
      await addEvent(params.agent, "command", null, trunc(nudge.text, 400), { kind: "nudge" });
      await sql`update noob.agents set status = 'thinking', status_detail = null, hold_until = null, status_ts = ${Date.now()}, updated_at = now() where id = ${params.agent}`;
      return { done: true, body: { nudge: `Message from the operator via the N00B Inc dashboard: ${nudge.text}` } };
    }
    return { done: false, body: { holding: true } };
  }
  return { done: true, body: {} };
}
