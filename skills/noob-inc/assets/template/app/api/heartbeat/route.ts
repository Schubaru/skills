import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { guarded } from "@/lib/guard";

export const POST = guarded(async () => {
  await sql`update noob.settings set dashboard_seen_at = now() where id = 1`;
  return NextResponse.json({ ok: true });
});
