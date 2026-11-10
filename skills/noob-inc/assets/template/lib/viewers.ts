import { sql } from "@/lib/db";
import { EMOTE_PER_MIN, EMOTES } from "@/lib/types";

const LINK_EMOTE_PER_MIN = 40;

/** 2–20 letters, numbers, spaces, dots, dashes or underscores; inner spaces collapsed. Null when it doesn't fit. */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim().replace(/\s+/g, " ");
  return name.length >= 2 && name.length <= 20 && /^[\p{L}\p{N} ._-]+$/u.test(name) ? name : null;
}

/** The name behind a viewer's key on this link, or null when the key is unknown (new link, cleared storage). */
export async function viewerName(token: string, key: unknown): Promise<string | null> {
  if (typeof key !== "string" || !/^[0-9a-f-]{36}$/i.test(key)) return null;
  const [v] = await sql<{ name: string }[]>`select name from noob.viewers where key = ${key} and token = ${token}`;
  return v?.name ?? null;
}

type Result = { status: number; body: Record<string, unknown> };

/** Join (claim a name, or come back with a key) and emote. Both are log lines only: nothing reaches an agent. */
export async function viewerAct(token: string, body: { act?: unknown; key?: unknown; name?: unknown; emoji?: unknown }): Promise<Result> {
  if (body.act === "join") {
    let key = typeof body.key === "string" ? body.key : null;
    let name = key ? await viewerName(token, key) : null;
    if (!name) {
      name = cleanName(body.name);
      if (!name) return { status: 400, body: { error: "name" } };
      const [v] = await sql<{ key: string }[]>`
        insert into noob.viewers (token, name) values (${token}, ${name}) on conflict (token, lower(name)) do nothing returning key`;
      if (!v) return { status: 409, body: { error: "taken" } };
      key = v.key;
    }
    // One arrival line per person per ten minutes, so reloads don't spam the log.
    await sql`insert into noob.events (agent_id, kind, summary, payload)
      select null, 'viewer', ${`${name} entered the office`}, ${sql.json({ kind: "join", by: name })}
      where not exists (select 1 from noob.events where kind = 'viewer' and payload->>'kind' = 'join' and payload->>'by' = ${name} and created_at > now() - interval '10 minutes')`;
    return { status: 200, body: { ok: true, key, name } };
  }

  if (body.act === "emote") {
    const name = await viewerName(token, body.key);
    if (!name) return { status: 401, body: { error: "who" } };
    if (typeof body.emoji !== "string" || !(EMOTES as readonly string[]).includes(body.emoji)) return { status: 400, body: { error: "bad request" } };
    // ponytail: count-then-insert, so a burst in the same instant can slip one or two past the cap; a per-viewer counter row if that matters.
    const [n] = await sql<{ mine: number; all: number }[]>`
      select count(*) filter (where payload->>'by' = ${name})::int as mine, count(*)::int as all
      from noob.events where kind = 'viewer' and payload->>'kind' = 'emote' and created_at > now() - interval '1 minute'`;
    if (n.mine >= EMOTE_PER_MIN || n.all >= LINK_EMOTE_PER_MIN) return { status: 429, body: { error: "slow down" } };
    await sql`insert into noob.events (agent_id, kind, summary, payload) values (null, 'viewer', ${`${name} ${body.emoji}`}, ${sql.json({ kind: "emote", by: name, emoji: body.emoji })})`;
    return { status: 200, body: { ok: true } };
  }

  return { status: 400, body: { error: "bad request" } };
}
