import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { guarded } from "@/lib/guard";

export const PATCH = guarded(async (req: Request) => {
  const b = (await req.json()) as { hold_mode?: string; hold_seconds?: number; hold_on_stop?: boolean; retain_days?: number; office_look?: string };
  const hold_mode = ["open", "always", "never"].includes(b.hold_mode ?? "") ? b.hold_mode! : null;
  const hold_seconds = Number.isFinite(b.hold_seconds) ? Math.min(3600, Math.max(30, Math.round(b.hold_seconds!))) : null;
  const retain_days = Number.isFinite(b.retain_days) ? Math.min(90, Math.max(1, Math.round(b.retain_days!))) : null;
  const hold_on_stop = typeof b.hold_on_stop === "boolean" ? b.hold_on_stop : null;
  const office_look = b.office_look === "office" || b.office_look === "studio" ? b.office_look : null;
  await sql`update noob.settings set
    hold_mode = coalesce(${hold_mode}, hold_mode),
    hold_seconds = coalesce(${hold_seconds}, hold_seconds),
    retain_days = coalesce(${retain_days}, retain_days),
    hold_on_stop = coalesce(${hold_on_stop}, hold_on_stop),
    office_look = coalesce(${office_look}, office_look)
    where id = 1`;
  return NextResponse.json({ ok: true });
});
