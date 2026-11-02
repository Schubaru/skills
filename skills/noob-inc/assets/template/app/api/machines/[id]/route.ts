import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { guarded } from "@/lib/guard";

type Ctx = { params: Promise<{ id: string }> };

export const DELETE = guarded(async (_req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  await sql`delete from noob.machines where id = ${id}`;
  return NextResponse.json({ ok: true });
});
