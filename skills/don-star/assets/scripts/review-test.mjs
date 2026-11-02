// Runs every harness test (src/review/*.test.ts, src/flows/*.test.ts) through
// tsx, one process each, and fails on the first failure. `npm run review:test`.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const dirs = ["src/review", "src/flows"];
const files = dirs.flatMap((d) => {
  try {
    return readdirSync(d).filter((f) => f.endsWith(".test.ts")).map((f) => join(d, f));
  } catch {
    return [];
  }
});
let failed = 0;
for (const f of files) {
  const r = spawnSync("npx", ["tsx", f], { stdio: "inherit" });
  if (r.status !== 0) {
    failed++;
    console.error(`FAIL ${f}`);
  } else console.log(`ok   ${f}`);
}
console.log(`${files.length - failed}/${files.length} passed`);
process.exit(failed ? 1 : 0);
