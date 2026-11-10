import { NextResponse } from "next/server";
import { bridgeWait, machineFromRequest } from "@/lib/ingest";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const machine = await machineFromRequest(req);
  if (!machine) return NextResponse.json({ error: "bad token" }, { status: 401 });
  const u = new URL(req.url);
  // `wait=1` holds the request open for up to 20s, so an answer reaches the agent within a quarter second.
  const waitMs = u.searchParams.get("wait") ? 20_000 : 0;
  return NextResponse.json(await bridgeWait({ blocker: u.searchParams.get("blocker") ?? undefined, agent: u.searchParams.get("agent") ?? undefined }, waitMs));
}
