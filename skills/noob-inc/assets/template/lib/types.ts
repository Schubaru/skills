export type AgentStatus = "idle" | "thinking" | "working" | "blocked" | "holding" | "done" | "stopped";

export interface Agent {
  id: string;
  machine_id: string | null;
  session_id: string;
  parent_id: string | null;
  kind: "session" | "subagent";
  title: string | null;
  /** View-only feed only: a session's tidied task, shown under its staff name in place of its title. */
  task?: string | null;
  /** Staff name picked at check-in. A session shows it until it has a title; a subagent always goes by it. */
  name: string | null;
  model: string | null;
  cwd: string | null;
  git_branch: string | null;
  status: AgentStatus;
  status_detail: string | null;
  started_at: string;
  ended_at: string | null;
  updated_at: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  turns: number;
  tool_calls: number;
  livery: number;
  allowed_tools: string[];
  stop_requested: boolean;
  dismissed: boolean;
  hold_until: string | null;
  status_ts: number;
}

export type EventKind = "prompt" | "tool" | "message" | "spawn" | "note" | "blocker" | "command" | "end" | "viewer";

export interface AgentEvent {
  id: number;
  /** Null only for kind "viewer" (a visitor joining or emoting belongs to no agent). */
  agent_id: string | null;
  kind: EventKind;
  tool: string | null;
  summary: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
}

export type BlockerKind = "permission" | "question" | "elicitation";
export type BlockerStatus = "open" | "resolved" | "released" | "expired";

/** One AskUserQuestion question, as Claude Code sends it. `kind` defaults to "choice". */
export interface Question {
  question: string;
  header?: string;
  kind?: "choice" | "text" | "number";
  description?: string;
  multiSelect?: boolean;
  options?: { label: string; description?: string }[];
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  defaultValue?: number;
  unit?: string;
}

export interface Blocker {
  id: string;
  agent_id: string;
  kind: BlockerKind;
  tool: string | null;
  input: Record<string, unknown> | null;
  prompt: string | null;
  status: BlockerStatus;
  decision: Record<string, unknown> | null;
  created_at: string;
  resolved_at: string | null;
}

export interface Machine {
  id: string;
  name: string;
  created_at: string;
  last_seen_at: string | null;
}

export interface Settings {
  hold_mode: "open" | "always" | "never";
  hold_seconds: number;
  hold_on_stop: boolean;
  retain_days: number;
  dashboard_seen_at: string | null;
  office_look: OfficeLook;
}

/** Which room the office draws. The owner picks it; the shared view shows the same one. */
export type OfficeLook = "office" | "studio";

export interface StateResponse {
  now: string;
  full: boolean;
  agents: Agent[];
  events: AgentEvent[];
  blockers: Blocker[];
  machines: Machine[];
  settings: Settings | null;
  look: OfficeLook;
}

export const LIVERY_COUNT = 8;

/** The five emotes a viewer can float over the office, and how many each viewer may send a minute. */
export const EMOTES = ["☕", "📎", "🚀", "❤️", "😴"] as const;
export const EMOTE_PER_MIN = 10;
