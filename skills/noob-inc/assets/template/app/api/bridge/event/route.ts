import { NextResponse } from "next/server";
import { handleBridgeEvent, machineFromRequest, type BridgeBody } from "@/lib/ingest";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const machine = await machineFromRequest(req);
  if (!machine) return NextResponse.json({ error: "bad token" }, { status: 401 });
  let body: BridgeBody;
  try {
    body = (await req.json()) as BridgeBody;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  if (!body?.session_id || !body?.event) return NextResponse.json({ error: "missing fields" }, { status: 400 });
  try {
    return NextResponse.json(await handleBridgeEvent(machine.id, body));
  } catch (e) {
    console.error("bridge event failed", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
