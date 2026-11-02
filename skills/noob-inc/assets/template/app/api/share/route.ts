import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { guarded } from "@/lib/guard";
import { MODE } from "@/lib/mode";

export const dynamic = "force-dynamic";

export const GET = guarded(async () => {
  const [s] = await sql<{ share_token: string | null }[]>`select share_token from noob.settings where id = 1`;
  return NextResponse.json({ token: s?.share_token ?? null });
});

/** create: a fresh link (the old one stops working at once). off: nobody can watch. */
export const POST = guarded(async (req: Request) => {
  const { action } = (await req.json().catch(() => ({}))) as { action?: string };
  if (MODE !== "both") return NextResponse.json({ error: "sharing is off for this office" }, { status: 404 });
  if (action !== "create" && action !== "off") return NextResponse.json({ error: "unknown action" }, { status: 400 });
  const token = action === "create" ? randomBytes(24).toString("base64url") : null;
  await sql`update noob.settings set share_token = ${token} where id = 1`;
  return NextResponse.json({ token });
});
