#!/usr/bin/env node
// Makes a bridge token for one machine without the dashboard (the only way in view mode) and prints its install command.
// Usage: DATABASE_URL=... node bridge/add-machine.mjs <dashboardUrl> [machine name]
import { createHash, randomBytes } from "node:crypto";
import postgres from "postgres";

const url = (process.argv[2] || "").replace(/\/+$/, "");
if (!url || !process.env.DATABASE_URL) {
  console.error("usage: DATABASE_URL=... node bridge/add-machine.mjs <dashboardUrl> [machine name]");
  process.exit(1);
}
const name = (process.argv[3] || "my mac").trim().slice(0, 60);
const sql = postgres(process.env.DATABASE_URL, { prepare: false, ssl: "require" });
// Same shape and hash as Settings → Add machine; the token is shown once and never stored in clear.
const token = "nb_" + randomBytes(24).toString("base64url");
await sql`insert into noob.machines (name, token_hash) values (${name}, ${createHash("sha256").update(token).digest("hex")})`;
await sql.end();
console.log(`curl -fsSL ${url}/bridge/install.sh | sh -s -- ${token} ${url}`);
