import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { guarded } from "@/lib/guard";

type Ctx = { params: Promise<{ id: string }> };
type Body = { decision: "allow" | "allow_session" | "deny" | "release" | "answer"; answers?: Record<string, string>; message?: string };

export const POST = guarded(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = (await req.json()) as Body;
  const [bl] = await sql<{ id: string; agent_id: string; kind: string; tool: string | null; status: string }[]>`
    select id, agent_id, kind, tool, status from noob.blockers where id = ${id}`;
  if (!bl) return NextResponse.json({ error: "no such blocker" }, { status: 404 });
  if (bl.status !== "open") return NextResponse.json({ error: "already " + bl.status }, { status: 409 });

  let decision: Record<string, unknown>;
  let status = "resolved";
  switch (body.decision) {
    case "allow":
      decision = { behavior: "allow" };
      break;
    case "allow_session":
      decision = { behavior: "allow" };
      if (bl.tool) await sql`update noob.agents set allowed_tools = array_append(array_remove(allowed_tools, ${bl.tool}), ${bl.tool}) where id = ${bl.agent_id}`;
      break;
    case "deny":
      decision = { behavior: "deny", message: (body.message ?? "Denied from the dashboard.").slice(0, 500) };
      break;
    case "answer":
      decision = { answers: body.answers ?? {} };
      break;
    case "release":
      decision = {};
      status = "released";
      break;
    default:
      return NextResponse.json({ error: "unknown decision" }, { status: 400 });
  }
  await sql`update noob.blockers set status = ${status}, decision = ${sql.json(decision as never)}, resolved_at = now() where id = ${id}`;
  const detail = status === "released" ? "waiting for you in Claude" : body.decision === "deny" ? "denied, thinking" : body.decision === "answer" ? "got your answers" : "allowed, working";
  await sql`update noob.agents set status = ${status === "released" ? "blocked" : body.decision === "deny" || body.decision === "answer" ? "thinking" : "working"},
    status_detail = ${detail}, hold_until = null, updated_at = now() where id = ${bl.agent_id}`;
  return NextResponse.json({ ok: true });
});
