#!/usr/bin/env node
// N00B Inc bridge — runs as a Claude Code hook and forwards session events to your dashboard.
// Install: curl -fsSL https://<dashboard>/bridge/install.sh | sh -s -- <token> https://<dashboard>
// Commands: --install-hooks | --uninstall-hooks | --send <file> (internal)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);
const DIR = process.env.NOOB_BRIDGE_DIR || path.join(os.homedir(), ".claude", "noob-inc");
const SETTINGS = path.join(os.homedir(), ".claude", "settings.json");
// Declared up here: the hook code below runs at top level and would otherwise reach it before it exists.
const DOWN = path.join(DIR, "down");
const EVENTS = ["SessionStart", "SessionEnd", "UserPromptSubmit", "PreToolUse", "PostToolUse", "SubagentStart", "SubagentStop", "PermissionRequest", "Notification", "Stop"];
// Seconds Claude Code waits for the hook. The bridge itself stays fast except while holding a prompt for the dashboard.
const TIMEOUTS = { PreToolUse: 3600, PermissionRequest: 3600, Stop: 3600, SessionEnd: 10 };
// The server holds each wait request open until something changes, so this is only the gap between requests.
const POLL_MS = 300;

const argv = process.argv.slice(2);
if (argv[0] === "--install-hooks") {
  installHooks();
  process.exit(0);
}
if (argv[0] === "--uninstall-hooks") {
  uninstallHooks();
  process.exit(0);
}

const CFG = readConfig();

if (argv[0] === "--send") {
  const file = argv[1];
  let body = "";
  try {
    body = fs.readFileSync(file, "utf8");
    fs.unlinkSync(file);
  } catch {}
  if (body) await post("/api/bridge/event", body, 15000).catch(() => {});
  process.exit(0);
}

const payload = parse(await readStdin());
if (!payload) process.exit(0);
const ev = payload.hook_event_name;
const body = normalize(payload);

try {
  switch (ev) {
    case "PreToolUse": {
      const r = await post("/api/bridge/event", body, 4000);
      // Stopped from the dashboard: halt right here instead of letting the model write a wrap-up.
      if (r.deny) out({ continue: false, stopReason: "Stopped from N00B Inc.", hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: r.deny } });
      else if (r.context) out({ hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: r.context } });
      break;
    }
    case "PermissionRequest": {
      // Claude shows its own prompt (or question) while this hook waits; whichever side answers first wins.
      const r = await post("/api/bridge/event", body, 6000);
      let decision = r.decision;
      if (!decision && r.blockerId && r.hold) {
        const d = await waitFor(`/api/bridge/wait?blocker=${r.blockerId}&wait=1`, r.holdSeconds, (x) => x.status && x.status !== "open");
        if (d.status === "resolved") decision = d.decision;
      }
      if (decision?.answers) decision = { behavior: "allow", updatedInput: { ...payload.tool_input, answers: decision.answers } };
      if (decision?.behavior) out({ hookSpecificOutput: { hookEventName: "PermissionRequest", decision } });
      break;
    }
    case "Stop": {
      const r = await post("/api/bridge/event", body, 6000);
      if (r.reason) out({ decision: "block", reason: r.reason });
      else if (r.hold) {
        const d = await waitFor(`/api/bridge/wait?agent=${encodeURIComponent(r.agentId)}&wait=1`, r.holdSeconds, (x) => x.nudge || x.released);
        if (d.nudge) out({ decision: "block", reason: d.nudge });
      }
      break;
    }
    default:
      detach(body);
  }
} catch {
  // Never let a dashboard outage block an agent.
}
process.exit(0);

// ---------------------------------------------------------------------------

function normalize(p) {
  const b = {
    ts: Date.now(),
    event: p.hook_event_name,
    session_id: p.session_id,
    agent_id: p.agent_id,
    agent_type: p.agent_type,
    cwd: p.cwd,
    permission_mode: p.permission_mode,
    tool_name: p.tool_name,
    tool_input: clip(p.tool_input),
    prompt: typeof p.prompt === "string" ? p.prompt.slice(0, 2000) : undefined,
    notification_type: p.notification_type,
    message: typeof p.message === "string" ? p.message.slice(0, 500) : undefined,
    source: p.source,
    reason: p.reason,
    model: p.model,
    session_title: p.session_title,
    stop_hook_active: p.stop_hook_active,
    last_assistant_message: typeof p.last_assistant_message === "string" ? p.last_assistant_message.slice(0, 600) : undefined,
  };
  if (["PostToolUse", "Stop", "SubagentStop", "SessionEnd", "UserPromptSubmit", "SubagentStart"].includes(b.event)) {
    const t = transcriptFor(p);
    if (t) {
      const u = readUsage(t);
      if (u) {
        b.usage = u;
        if (u.gitBranch) b.git_branch = u.gitBranch;
      }
    }
  }
  return b;
}

function transcriptFor(p) {
  if (p.hook_event_name === "SubagentStop" && p.agent_transcript_path) return p.agent_transcript_path;
  if (p.agent_id && p.transcript_path && p.session_id) {
    const nested = path.join(path.dirname(p.transcript_path), p.session_id, "subagents", `agent-${p.agent_id}.jsonl`);
    if (fs.existsSync(nested)) return nested;
    if (p.transcript_path.includes("/subagents/")) return p.transcript_path;
    return null; // Unknown subagent transcript: do not charge the parent's usage to it.
  }
  return p.transcript_path || null;
}

// Incrementally sums token usage from a transcript, once per API request id.
function readUsage(file) {
  try {
    const stateDir = path.join(DIR, "state");
    fs.mkdirSync(stateDir, { recursive: true });
    const stateFile = path.join(stateDir, Buffer.from(file).toString("base64url").slice(-80) + ".json");
    let st = { offset: 0, input: 0, output: 0, cache_read: 0, cache_write: 0, model: null, seen: [], gitBranch: null };
    try {
      st = { ...st, ...JSON.parse(fs.readFileSync(stateFile, "utf8")) };
    } catch {}
    const size = fs.statSync(file).size;
    if (size < st.offset) st = { ...st, offset: 0, input: 0, output: 0, cache_read: 0, cache_write: 0, seen: [] };
    if (size === st.offset) return st;
    const fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(size - st.offset);
    fs.readSync(fd, buf, 0, buf.length, st.offset);
    fs.closeSync(fd);
    const text = buf.toString("utf8");
    const lastNl = text.lastIndexOf("\n");
    if (lastNl < 0) return st;
    const seen = new Set(st.seen);
    for (const line of text.slice(0, lastNl).split("\n")) {
      if (!line.includes('"usage"')) continue;
      let j;
      try {
        j = JSON.parse(line);
      } catch {
        continue;
      }
      const u = j?.message?.usage;
      if (j.type !== "assistant" || !u) continue;
      const key = j.requestId || j.uuid;
      if (seen.has(key)) continue;
      seen.add(key);
      st.input += u.input_tokens | 0;
      st.output += u.output_tokens | 0;
      st.cache_read += u.cache_read_input_tokens | 0;
      st.cache_write += u.cache_creation_input_tokens | 0;
      if (j.message.model && !String(j.message.model).includes("synthetic")) st.model = j.message.model;
      if (j.gitBranch) st.gitBranch = j.gitBranch;
    }
    st.offset += Buffer.byteLength(text.slice(0, lastNl + 1), "utf8");
    st.seen = [...seen].slice(-64);
    fs.writeFileSync(stateFile, JSON.stringify(st));
    return st;
  } catch {
    return null;
  }
}

function clip(v, depth = 0) {
  if (v == null) return v;
  if (typeof v === "string") return v.length > 1500 ? v.slice(0, 1500) + "…" : v;
  if (Array.isArray(v)) return depth > 5 ? "[…]" : v.slice(0, 20).map((x) => clip(x, depth + 1));
  if (typeof v === "object") {
    if (depth > 5) return "{…}";
    const o = {};
    for (const [k, x] of Object.entries(v).slice(0, 40)) o[k] = clip(x, depth + 1);
    return o;
  }
  return v;
}

// If the dashboard is unreachable, remember it for a minute so agents are not slowed by every hook retrying.
function isDown() {
  try {
    return Date.now() - fs.statSync(DOWN).mtimeMs < 60_000;
  } catch {
    return false;
  }
}
function markDown() {
  try {
    fs.writeFileSync(DOWN, "");
  } catch {}
}

async function post(route, body, timeoutMs) {
  if (isDown()) return {};
  let res;
  try {
    res = await fetch(CFG.url + route, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${CFG.token}` },
      body: typeof body === "string" ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    markDown();
    throw e;
  }
  if (!res.ok) return {};
  return res.json().catch(() => ({}));
}

async function get(route, timeoutMs) {
  const res = await fetch(CFG.url + route, { headers: { authorization: `Bearer ${CFG.token}` }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) return {};
  return res.json().catch(() => ({}));
}

async function waitFor(route, seconds, done) {
  const deadline = Date.now() + Math.max(10, seconds | 0) * 1000;
  let last = {};
  while (Date.now() < deadline) {
    try {
      last = await get(route, 30000);
      if (done(last)) return last;
    } catch {}
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  return last;
}

function detach(body) {
  const q = path.join(DIR, "queue");
  fs.mkdirSync(q, { recursive: true });
  const file = path.join(q, `${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(file, JSON.stringify(body));
  spawn(process.execPath, [SELF, "--send", file], { detached: true, stdio: "ignore" }).unref();
}

function out(obj) {
  process.stdout.write(JSON.stringify(obj));
}

function parse(s) {
  try {
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

async function readStdin() {
  if (process.stdin.isTTY) return "";
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

function readConfig() {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(DIR, "config.json"), "utf8"));
    if (!c.url || !c.token) throw new Error("incomplete");
    return { ...c, url: String(c.url).replace(/\/+$/, "") };
  } catch {
    process.stderr.write(`N00B Inc bridge: missing or invalid ${path.join(DIR, "config.json")}\n`);
    process.exit(0);
  }
}

function hookEntry(event) {
  return { hooks: [{ type: "command", command: `node "${path.join(DIR, "bridge.mjs")}"`, timeout: TIMEOUTS[event] ?? 20 }] };
}

function isOurs(group) {
  return (group?.hooks ?? []).some((h) => typeof h?.command === "string" && h.command.includes("noob-inc/bridge.mjs"));
}

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS, "utf8"));
  } catch {
    return {};
  }
}

function saveSettings(s) {
  if (fs.existsSync(SETTINGS)) fs.copyFileSync(SETTINGS, SETTINGS + ".noob-backup");
  fs.mkdirSync(path.dirname(SETTINGS), { recursive: true });
  fs.writeFileSync(SETTINGS, JSON.stringify(s, null, 2) + "\n");
}

function installHooks() {
  const s = loadSettings();
  s.hooks = s.hooks && typeof s.hooks === "object" ? s.hooks : {};
  for (const ev of EVENTS) {
    const groups = Array.isArray(s.hooks[ev]) ? s.hooks[ev].filter((g) => !isOurs(g)) : [];
    groups.push(hookEntry(ev));
    s.hooks[ev] = groups;
  }
  saveSettings(s);
  console.log(`Hooks written to ${SETTINGS} (backup at ${SETTINGS}.noob-backup).`);
}

function uninstallHooks() {
  const s = loadSettings();
  if (s.hooks) {
    for (const ev of Object.keys(s.hooks)) {
      s.hooks[ev] = (s.hooks[ev] ?? []).filter((g) => !isOurs(g));
      if (!s.hooks[ev].length) delete s.hooks[ev];
    }
  }
  saveSettings(s);
  console.log("N00B Inc hooks removed.");
}
