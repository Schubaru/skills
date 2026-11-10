import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { guarded } from "@/lib/guard";

/** Clears the Done tab: deletes the listed agents for good. Their events, blockers, and commands go with them (on delete cascade). */
export const POST = guarded(async (req: Request) => {
  const body = (await req.json()) as { action?: string; ids?: unknown };
  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string").slice(0, 2000) : [];
  if (body.action !== "clear" || !ids.length) return NextResponse.json({ error: "nothing to clear" }, { status: 400 });
  // Only finished agents; anything that came back to life since the click stays.
  const gone = await sql`delete from noob.agents where id in ${sql(ids)} and status in ('done','stopped') returning id`;
  return NextResponse.json({ ok: true, cleared: gone.length });
});
