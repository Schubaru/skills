import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { guarded } from "@/lib/guard";
import { hashToken } from "@/lib/ingest";

export const POST = guarded(async (req: Request) => {
  const { name } = (await req.json()) as { name?: string };
  const clean = (name ?? "").trim().slice(0, 60) || "my mac";
  const token = "nb_" + randomBytes(24).toString("base64url");
  const [m] = await sql<{ id: string }[]>`insert into noob.machines (name, token_hash) values (${clean}, ${hashToken(token)}) returning id`;
  // The token is shown once and never stored in clear.
  return NextResponse.json({ id: m.id, name: clean, token });
});
