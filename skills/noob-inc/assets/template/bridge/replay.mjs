#!/usr/bin/env node
// Replays a realistic Claude Code session through the bridge against a running dashboard.
// Usage: DATABASE_URL=... node bridge/replay.mjs [dashboardUrl]
// Creates a throwaway machine token, a fake transcript, and fires the hook sequence a real session would.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import postgres from "postgres";

const URL_ = (process.argv[2] || "http://localhost:3000").replace(/\/+$/, "");
const sql = postgres(process.env.DATABASE_URL, { prepare: false, ssl: "require" });
const token = "nb_replay_" + randomBytes(8).toString("hex");
await sql`insert into noob.machines (name, token_hash) values ('replay-mac', ${createHash("sha256").update(token).digest("hex")})`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "noob-bridge-"));
fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ url: URL_, token }));
const bridge = path.resolve("public/bridge/bridge.mjs");
const transcriptDir = fs.mkdtempSync(path.join(os.tmpdir(), "noob-transcripts-"));

let req = 0;
function appendUsage(file, model, inTok, outTok, cacheRead) {
  req++;
  const line = { type: "assistant", requestId: "req_" + req, uuid: "u" + req, gitBranch: "main", message: { model, usage: { input_tokens: inTok, output_tokens: outTok, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: 1200 } } };
  fs.appendFileSync(file, JSON.stringify(line) + "\n");
}

function hook(payload, opts = {}) {
  const r = spawnSync(process.execPath, [bridge], { input: JSON.stringify(payload), env: { ...process.env, NOOB_BRIDGE_DIR: dir }, encoding: "utf8", timeout: opts.timeout ?? 20000 });
  if (r.stderr) process.stderr.write(r.stderr);
  return r.stdout;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const sessions = [
  { id: "s-" + randomBytes(3).toString("hex"), cwd: "/Users/you/noob-inc", prompt: "Build the agent dashboard with GitHub sign-in and a pixel office", model: "claude-fable-5-1" },
  { id: "s-" + randomBytes(3).toString("hex"), cwd: "/Users/you/acme-store", prompt: "Fix the flaky checkout test and tighten the retry logic", model: "claude-opus-5-5" },
  { id: "s-" + randomBytes(3).toString("hex"), cwd: "/Users/you/b43-v2", prompt: "Write release notes for 2.4 from the merged PRs", model: "claude-sonnet-5-5" },
];
for (const s of sessions) {
  s.transcript = path.join(transcriptDir, s.id + ".jsonl");
  fs.writeFileSync(s.transcript, "");
}
const base = (s, extra) => ({ session_id: s.id, transcript_path: s.transcript, cwd: s.cwd, permission_mode: "default", ...extra });

console.log("replaying into", URL_);
for (const s of sessions) {
  hook(base(s, { hook_event_name: "SessionStart", source: "startup", model: s.model }));
  await sleep(300);
  hook(base(s, { hook_event_name: "UserPromptSubmit", prompt: s.prompt }));
  appendUsage(s.transcript, s.model, 1800, 420, 24000);
}
await sleep(1200);
const [a, b, c] = sessions;

// a: works, spawns a subagent, gets a message back
hook(base(a, { hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: "/Users/you/noob-inc/app/page.tsx" } }));
hook(base(a, { hook_event_name: "PostToolUse", tool_name: "Read", tool_input: {}, tool_response: "ok" }));
appendUsage(a.transcript, a.model, 2200, 900, 41000);
hook(base(a, { hook_event_name: "PreToolUse", tool_name: "Agent", tool_input: { description: "Verify hook contracts", prompt: "Check docs", subagent_type: "claude-code-guide" } }));
const sub = "agent-" + randomBytes(3).toString("hex");
const subTranscript = path.join(transcriptDir, a.id, "subagents", sub + ".jsonl");
fs.mkdirSync(path.dirname(subTranscript), { recursive: true });
fs.writeFileSync(subTranscript, "");
hook(base(a, { hook_event_name: "SubagentStart", agent_id: sub, agent_type: "claude-code-guide" }));
await sleep(800);
hook(base(a, { hook_event_name: "PreToolUse", agent_id: sub, agent_type: "claude-code-guide", tool_name: "WebFetch", tool_input: { url: "https://code.claude.com/docs/en/hooks" } }));
appendUsage(subTranscript, "claude-sonnet-5-5", 900, 300, 8000);
hook(base(a, { hook_event_name: "PostToolUse", agent_id: sub, agent_type: "claude-code-guide", tool_name: "WebFetch", tool_input: {}, tool_response: "ok" }));

// b: edits then hits a permission prompt (held if the dashboard is open)
hook(base(b, { hook_event_name: "PreToolUse", tool_name: "Edit", tool_input: { file_path: "/Users/you/acme-store/tests/checkout.spec.ts", old_string: "x", new_string: "y" } }));
hook(base(b, { hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: {}, tool_response: "ok" }));
appendUsage(b.transcript, b.model, 5200, 1900, 90000);

// c: thinking, then idle at the coffee machine
hook(base(c, { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "gh pr list --state merged --limit 30", description: "List merged PRs" } }));
hook(base(c, { hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: {}, tool_response: "ok" }));
appendUsage(c.transcript, c.model, 3100, 2400, 12000);
await sleep(1500);
hook(base(c, { hook_event_name: "Stop", stop_hook_active: false, last_assistant_message: "Drafted the notes in RELEASE.md. Want me to open a PR?" }), { timeout: 8000 });
hook(base(c, { hook_event_name: "Notification", notification_type: "idle_prompt", message: "Claude is waiting for your input" }));

// subagent messages the parent and reports back
hook(base(a, { hook_event_name: "PreToolUse", agent_id: sub, agent_type: "claude-code-guide", tool_name: "SendMessage", tool_input: { to: a.id, message: "PermissionRequest deny needs the nested decision shape" } }));
await sleep(2500);
hook(base(a, { hook_event_name: "SubagentStop", agent_id: sub, agent_type: "claude-code-guide", agent_transcript_path: subTranscript, last_assistant_message: "Verified all eight items against the docs." }));
hook(base(a, { hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: "/Users/you/noob-inc/lib/ingest.ts", content: "..." } }));
appendUsage(a.transcript, a.model, 2600, 1500, 61000);
hook(base(a, { hook_event_name: "PostToolUse", tool_name: "Write", tool_input: {}, tool_response: "ok" }));
hook(base(a, { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "npx tsc --noEmit", description: "Type-check the project" } }));

console.log("permission prompt for session b (held up to 90s if the dashboard is open)…");
const out = hook(base(b, { hook_event_name: "PermissionRequest", tool_name: "Bash", tool_input: { command: "rm -rf node_modules && npm install", description: "Reinstall dependencies" } }), { timeout: 120000 });
console.log("PermissionRequest hook returned:", out || "(nothing: terminal would prompt)");
if (out) {
  const decision = JSON.parse(out).hookSpecificOutput.decision;
  if (decision.behavior === "allow") console.log("dashboard allowed it");
  else console.log("dashboard denied it:", decision.message);
}
hook(base(b, { hook_event_name: "Stop", stop_hook_active: false, last_assistant_message: "Done." }), { timeout: 8000 });

await sleep(800);
console.log("replay complete. token", token, "— revoke 'replay-mac' from Settings when done.");
await sql.end();
