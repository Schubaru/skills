#!/usr/bin/env node
// The doctor: is the review board completely installed in this app?
//
//   node check.mjs <app-dir> [--build] [--test]
//
// Every line is one wiring point install.sh is responsible for. A ✗ means the
// board will misbehave in a specific way (named on the line), so fix it rather
// than shrugging: an unseeded frame shows the wrong screen, a missing capture
// hook makes exports empty, a missing alias fails the build. Exit 1 on any ✗.
// --build runs the app's build; --test runs the harness's own tests.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const APP = path.resolve(argv.find((a) => !a.startsWith("--")) ?? ".");
const p = (...s) => path.join(APP, ...s);
const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "");
let bad = 0;
const ok = (cond, what, why) => {
  console.log(`${cond ? "✓" : "✗"} ${what}${cond || !why ? "" : "\n    → " + why}`);
  if (!cond) bad++;
};

// Files
const files = [
  "src/review/app.tsx", "src/review/review.config.tsx", "src/review/projects.ts", "src/review/brand.ts", "src/review/logo.svg",
  "src/review/admin/index.tsx", "src/review/vite-plugin-review-snapshot.ts", "src/review/vite-plugin-screen-versions.ts",
  "src/auth/AuthProvider.tsx", "src/auth/LoginGate.tsx", "src/auth/client.ts",
  "src/dev/index.ts", "src/dev/overlay.tsx", "src/flows/app.tsx", "src/flows/seed.ts",
  "src/review-seed.ts", "src/review-capture.ts", "src/review-routes.tsx",
  "src/pages/Review.tsx", "src/pages/Projects.tsx", "src/pages/Flows.tsx",
  "middleware.ts", "DEV.md", "review-board.json", "review-triage.json",
  "supabase/review-comments.sql", "supabase/auth-access.sql", "supabase/project-access.sql", "supabase/access-sharing.sql",
  "supabase/functions/notify-review/index.ts", "supabase/functions/request-access/index.ts", "supabase/functions/review-triage/index.ts",
  "scripts/build-shots.ts", "scripts/review-shots.mjs", "scripts/triage-reply.mjs", "scripts/review-test.mjs",
];
const missing = files.filter((f) => !fs.existsSync(p(f)));
ok(missing.length === 0, `harness files present (${files.length - missing.length}/${files.length})`, missing.length ? "missing: " + missing.join(", ") + " — re-run install.sh --force" : "");

// Placeholders
const leftovers = [];
for (const dir of ["src/review", "src/auth", "src/dev", "src/flows", "supabase", "scripts", "src/pages"]) {
  for (const f of walk(p(dir))) if (/__DS_[A-Z_]+__/.test(read(f))) leftovers.push(path.relative(APP, f));
}
ok(leftovers.length === 0, "no unfilled __DS_*__ placeholders", leftovers.join(", "));

// package.json
const pkg = JSON.parse(read(p("package.json")) || "{}");
const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
for (const d of ["html-to-image", "@supabase/supabase-js", "@xyflow/react", "nanoid", "jose", "react-router-dom", "tsx", "playwright-core"]) {
  ok(Boolean(deps[d]), `dependency ${d}`, `npm install ${d}`);
}
ok(fs.existsSync(p("node_modules/html-to-image")), "node_modules installed", "npm install");
ok(Boolean(pkg.scripts?.["review:test"]), "npm script review:test", "wire.mjs adds it");

// main.tsx
const main = read(p("src/main.tsx")) || read(p("src/main.jsx"));
const firstImport = main.indexOf("import ");
ok(firstImport >= 0 && main.slice(firstImport).startsWith("import { applySeedFromUrl }"), "main.tsx: review-seed is the FIRST import", "ES imports hoist; anything imported before it can read storage before the seed lands, and sibling frames then show the same screen");
ok(/applySeedFromUrl\(\)/.test(main), "main.tsx calls applySeedFromUrl()", "seeded mid-flow frames won't boot in their state");
ok(/installReviewCapture\(\)/.test(main), "main.tsx calls installReviewCapture()", "previews never cache and PNG exports come out empty");
ok(/installDevMode\(\)/.test(main), "main.tsx calls installDevMode()", "the </> inspector has nothing to talk to inside a frame");
const seedCall = main.indexOf("applySeedFromUrl()");
const rootCall = main.search(/createRoot|render\(/);
ok(seedCall >= 0 && rootCall > seedCall, "main.tsx: seed call runs before the app renders");

// router
const appFiles = walk(p("src")).filter((f) => /\.(tsx|jsx)$/.test(f) && !isHarness(f));
ok(appFiles.some((f) => read(f).includes("reviewRoutes")), "router mounts {reviewRoutes}", "/review, /projects, /flows and /projects/access have no route");
ok(appFiles.some((f) => /<Routes[\s>]/.test(read(f)) || /createBrowserRouter|RouterProvider/.test(read(f))), "a react-router tree exists in the app", "the board's pages use useNavigate/useSearchParams");
ok(appFiles.some((f) => /BrowserRouter|createBrowserRouter/.test(read(f))), "a BrowserRouter (or data router) wraps the app");

// vite.config
const vite = read(p("vite.config.ts")) || read(p("vite.config.js"));
ok(/reviewSnapshotPlugin\(/.test(vite), "vite.config: reviewSnapshotPlugin()", "the board can't autosave review-board.json in dev");
ok(/screenVersionsPlugin\(/.test(vite), "vite.config: screenVersionsPlugin()", "no /screen-versions.json → the preview cache runs OFF and every visit reboots every screen");
ok(/review-board/.test(vite) && /ignored/.test(vite), "vite.config: server.watch.ignored covers review-board*.json", "every autosave full-reloads the page and kills live frames mid-review");
ok(/keepNames/.test(vite), "vite.config: build keepNames", "dev mode shows minified component names on the deployed site");
ok(/alias:\s*\{[^}]*['"]@['"]/.test(vite), "vite.config: '@' alias → ./src", "src/pages/Review.tsx imports '@/review' and the build fails");

// tsconfig
const ts = read(p("tsconfig.app.json")) || read(p("tsconfig.json"));
ok(/"@\/\*"/.test(ts), "tsconfig: paths \"@/*\"", "tsc can't resolve '@/review'");
ok(/vite\/client/.test(ts), "tsconfig: types include vite/client", "import.meta.env is untyped");

// config ↔ registry ↔ board file
const cfg = read(p("src/review/review.config.tsx"));
const reg = read(p("src/review/projects.ts"));
const slug = (reg.match(/slug:\s*"([^"]+)"/) ?? [])[1];
ok(Boolean(slug), "projects.ts registers a project");
ok(slug && cfg.includes(`slug: "${slug}"`), "review.config.tsx slug matches the registry", "the board opens on a config whose slug isn't granted");
ok(/url\(/.test(cfg) || /kind:\s*"url"/.test(cfg), "review.config.tsx has at least one live screen");
try {
  const b = JSON.parse(read(p("review-board.json")));
  ok(b.version === 1 && Array.isArray(b.comments), "review-board.json is a version-1 board");
} catch {
  ok(false, "review-board.json parses", "fix or delete it and re-run install.sh");
}
ok(read(p(".gitignore")).includes(".shots"), ".gitignore ignores .shots/");
ok(read(p(".env.example")).includes("VITE_SUPABASE_URL"), ".env.example documents the board variables");

// workflows at the repo root
let repo = APP;
const git = spawnSync("git", ["-C", APP, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
if (git.status === 0) repo = git.stdout.trim();
ok(fs.existsSync(path.join(repo, ".github/workflows/review-shots.yml")), ".github/workflows/review-shots.yml at the repo root");
ok(fs.existsSync(path.join(repo, ".github/workflows/triage-reply.yml")), ".github/workflows/triage-reply.yml at the repo root");

if (argv.includes("--build")) {
  const r = spawnSync("npm", ["run", "build"], { cwd: APP, encoding: "utf8" });
  ok(r.status === 0, "npm run build", (r.stdout + r.stderr).split("\n").filter((l) => /error/i.test(l)).slice(0, 8).join("\n    "));
}
if (argv.includes("--test")) {
  const r = spawnSync("node", ["scripts/review-test.mjs"], { cwd: APP, encoding: "utf8" });
  ok(r.status === 0, "harness tests (npm run review:test)", (r.stdout + r.stderr).split("\n").slice(-12).join("\n    "));
}

console.log(bad ? `\n${bad} problem(s). The board is not fully installed.` : "\nReview board fully installed.");
process.exit(bad ? 1 : 0);

function isHarness(f) {
  const r = f.replace(/\\/g, "/");
  return /\/src\/(review|flows|dev|auth)\//.test(r) || /\/src\/(review-seed\.ts|review-capture\.ts|review-routes\.tsx)$/.test(r) || /\/src\/pages\/(Review|Projects|Flows)\.tsx$/.test(r);
}

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "node_modules") out.push(...walk(f));
    } else out.push(f);
  }
  return out;
}
