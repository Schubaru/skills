export function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 1 : 0) + "k";
  return (n / 1_000_000).toFixed(n < 10_000_000 ? 2 : 1) + "M";
}

export function fmtDuration(ms: number): string {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "never";
  const d = now - new Date(iso).getTime();
  if (d < 15_000) return "just now";
  if (d < 60_000) return `${Math.floor(d / 1000)}s ago`;
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return `${Math.floor(d / 86_400_000)}d ago`;
}

export function clock(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** claude-fable-5-1 → Fable 5.1 */
export function modelLabel(model: string | null | undefined): string {
  if (!model) return "—";
  const m = model.replace(/^claude-/, "").replace(/-\d{8}$/, "");
  const parts = m.split("-");
  const name = parts[0];
  const ver = parts.slice(1).filter((p) => /^\d+$/.test(p)).join(".");
  return `${name.charAt(0).toUpperCase()}${name.slice(1)}${ver ? " " + ver : ""}`;
}

export function basename(p: string | null | undefined): string {
  if (!p) return "";
  const parts = p.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || p;
}

export function totalTokens(a: { input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_write_tokens: number }) {
  return Number(a.input_tokens) + Number(a.output_tokens) + Number(a.cache_read_tokens) + Number(a.cache_write_tokens);
}

export function elapsedMs(a: { started_at: string; ended_at: string | null }, now = Date.now()) {
  const end = a.ended_at ? new Date(a.ended_at).getTime() : now;
  return end - new Date(a.started_at).getTime();
}

export const STATUS_WORD: Record<string, string> = {
  working: "Working",
  thinking: "Thinking",
  blocked: "Waiting on you",
  holding: "Holding",
  idle: "Idle",
  done: "Done",
  stopped: "Stopped",
};

export const STATUS_RANK: Record<string, number> = { blocked: 0, holding: 1, working: 2, thinking: 2, idle: 3, stopped: 4, done: 5 };

/** What the board calls an agent: a session by its task title, else its staff name; a subagent always by its name. */
export function agentName(a: { kind: string; title: string | null; name?: string | null }): string {
  return (a.kind === "session" && a.title) || a.name || a.title || (a.kind === "subagent" ? "Subagent" : "Untitled session");
}

