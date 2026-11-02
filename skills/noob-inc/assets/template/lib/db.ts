import postgres from "postgres";

type Sql = ReturnType<typeof postgres>;
const g = globalThis as unknown as { __noobSql?: Sql };

export const sql: Sql =
  g.__noobSql ??
  (g.__noobSql = postgres(process.env.DATABASE_URL!, {
    prepare: false, // Supabase transaction pooler
    ssl: "require",
    // Serverless instances keep a tiny pool; the transaction pooler does the real multiplexing.
    max: process.env.VERCEL ? 2 : 8,
    idle_timeout: 20,
    connect_timeout: 10,
  }));

/** Upkeep run by every state read (owner or shared view): ages out old rows, closes silent agents, expires holds. */
export async function housekeeping() {
  const [s] = await sql<{ retain_days: number; stale: boolean }[]>`
    select retain_days, (cleaned_at is null or cleaned_at < now() - interval '1 hour') as stale from noob.settings where id = 1`;
  if (!s?.stale) return;
  await sql`update noob.settings set cleaned_at = now() where id = 1`;
  await sql`delete from noob.agents where kind = 'session' and ended_at < now() - make_interval(days => ${s.retain_days})`;
  await sql`delete from noob.events where created_at < now() - make_interval(days => ${s.retain_days})`;
  // Agents whose bridge went silent mid-task are marked done after 6 hours without an event.
  await sql`update noob.agents set status = 'done', ended_at = now(), status_detail = 'no events for 6 hours'
    where status not in ('done','stopped') and updated_at < now() - interval '6 hours'`;
  // Expire holds that ran out.
  await sql`update noob.blockers b set status = 'expired', resolved_at = now() from noob.agents a
    where b.agent_id = a.id and b.status = 'open' and a.hold_until is not null and a.hold_until < now() - interval '1 minute'`;
}
