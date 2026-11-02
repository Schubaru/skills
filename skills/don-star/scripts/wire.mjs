#!/usr/bin/env node
// Wire the review board into a Vite + React app. Called by install.sh after
// the assets are copied and filled; safe to re-run (every edit is guarded by a
// presence check). Prints what it changed and what it could not do.
//
//   node wire.mjs <app-dir> --slug <slug> --name <name> --deps <deps.json>
//
// What it touches, and why each one is required (none is optional decoration):
//   package.json      the harness's dependencies + npm scripts
//   src/main.tsx      applySeedFromUrl / installReviewCapture / installDevMode,
//                     FIRST — seeds must land before any module reads storage
//   src/App.tsx       `{reviewRoutes}` inside the <Routes> tree (or a minimal
//                     router when the app is still the untouched Vite template)
//   vite.config.ts    the two plugins, the board-file watch ignore, keepNames,
//                     the `@` alias
//   tsconfig          `@/*` paths + vite/client types
//   review.config.tsx a first board generated from the router's static routes
//   .gitignore        .shots/
//   .env.example      the Supabase / gate variables
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const opt = (k) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const positional = argv.filter((a, i) => !a.startsWith("--") && !(argv[i - 1] ?? "").startsWith("--"));
const APP = path.resolve(positional[0] ?? ".");
const SLUG = opt("slug") ?? "my-project";
const NAME = opt("name") ?? SLUG;
const DEPS = JSON.parse(fs.readFileSync(opt("deps"), "utf8"));

const changed = [];
const manual = [];
const p = (...s) => path.join(APP, ...s);
const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8") : null);
const write = (f, s, what) => {
  fs.writeFileSync(f, s);
  changed.push(what);
};

// --- package.json -------------------------------------------------------------
{
  const f = p("package.json");
  const pkg = JSON.parse(read(f));
  pkg.dependencies ??= {};
  pkg.devDependencies ??= {};
  let touched = false;
  for (const [k, v] of Object.entries(DEPS.dependencies)) if (!pkg.dependencies[k] && !pkg.devDependencies[k]) (pkg.dependencies[k] = v), (touched = true);
  for (const [k, v] of Object.entries(DEPS.devDependencies)) if (!pkg.devDependencies[k] && !pkg.dependencies[k]) (pkg.devDependencies[k] = v), (touched = true);
  pkg.scripts ??= {};
  const scripts = {
    "review:test": "node scripts/review-test.mjs",
    
    shots: "node scripts/review-shots.mjs",
    "shots:build": "npx tsx scripts/build-shots.ts",
  };
  for (const [k, v] of Object.entries(scripts)) if (!pkg.scripts[k]) (pkg.scripts[k] = v), (touched = true);
  if (touched) write(f, JSON.stringify(pkg, null, 2) + "\n", "package.json: dependencies + scripts");
}

// --- src/main.tsx -------------------------------------------------------------
const MAIN = fs.existsSync(p("src/main.tsx")) ? p("src/main.tsx") : p("src/main.jsx");
let usesRouter = false;
{
  let s = read(MAIN);
  if (!s.includes("applySeedFromUrl")) {
    s =
      `// Review board (don-star): these run FIRST, before any module can read storage —
// a seeded review frame's state has to land before the page hydrates.
import { applySeedFromUrl } from './review-seed'
import { installReviewCapture } from './review-capture'
import { installDevMode } from './dev'
applySeedFromUrl()
installReviewCapture()
installDevMode()

` + s;
    write(MAIN, s, "src/main.tsx: seed + capture + dev-mode calls (first)");
  }
}

// --- router: App.tsx ----------------------------------------------------------
{
  const srcFiles = walk(p("src")).filter((f) => /\.(tsx|jsx|ts|js)$/.test(f) && !isHarness(f));
  const routerFile = srcFiles.find((f) => /<Routes[\s>]/.test(read(f)));
  usesRouter = srcFiles.some((f) => /react-router/.test(read(f)) && !f.endsWith("main.tsx"));
  const APP_TSX = fs.existsSync(p("src/App.tsx")) ? p("src/App.tsx") : p("src/App.jsx");
  if (routerFile) {
    let s = read(routerFile);
    if (!s.includes("reviewRoutes")) {
      const rel = path.relative(path.dirname(routerFile), p("src/review-routes")).replace(/\\/g, "/");
      const imp = `import { reviewRoutes } from '${rel.startsWith(".") ? rel : "./" + rel}'\n`;
      const lastImport = s.lastIndexOf("\nimport ");
      const endOfImports = lastImport >= 0 ? s.indexOf("\n", s.indexOf("\n", lastImport + 1)) + 1 : 0;
      s = s.slice(0, endOfImports) + imp + s.slice(endOfImports);
      const close = s.lastIndexOf("</Routes>");
      s = s.slice(0, close) + "{reviewRoutes}\n" + " ".repeat(Math.max(0, s.slice(0, close).length - s.lastIndexOf("\n", close) - 1)) + s.slice(close);
      write(routerFile, s, `${path.relative(APP, routerFile)}: {reviewRoutes} inside <Routes>`);
    }
  } else if (!usesRouter && read(APP_TSX) && /vite\.svg|count is/.test(read(APP_TSX))) {
    // The untouched create-vite template: replace it with the smallest routed app.
    write(
      APP_TSX,
      `import { Route, Routes } from 'react-router-dom'
import { reviewRoutes } from './review-routes'

function Home() {
  return (
    <main style={{ padding: 32, fontFamily: 'system-ui, sans-serif' }}>
      <h1>${NAME.replace(/'/g, "\\'")}</h1>
      <p>
        The design-review board lives at <a href="/review">/review</a>.
      </p>
    </main>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      {reviewRoutes}
    </Routes>
  )
}
`,
      "src/App.tsx: replaced the Vite template with a routed app",
    );
    let m = read(MAIN);
    if (!m.includes("BrowserRouter")) {
      m = m.replace(/(import .*\n)(?![\s\S]*\nimport )/, `$1import { BrowserRouter } from 'react-router-dom'\n`);
      m = m.replace(/<App \/>/, "<BrowserRouter>\n      <App />\n    </BrowserRouter>");
      write(MAIN, m, "src/main.tsx: wrapped <App /> in <BrowserRouter>");
    }
  } else {
    manual.push("Add `{reviewRoutes}` (from src/review-routes.tsx) inside your <Routes> tree — no <Routes> element was found. For a data router, mount the same pages under /review, /projects, /flows and /projects/access.");
  }
}

// --- vite.config.ts -----------------------------------------------------------
{
  const f = fs.existsSync(p("vite.config.ts")) ? p("vite.config.ts") : p("vite.config.js");
  let s = read(f);
  const before = s;
  if (!s.includes("vite-plugin-review-snapshot")) {
    s = s.replace(/(import [^\n]*\n)(?![\s\S]*\nimport )/, `$1import { reviewSnapshotPlugin } from './src/review/vite-plugin-review-snapshot.ts'\nimport { screenVersionsPlugin } from './src/review/vite-plugin-screen-versions.ts'\n`);
  }
  if (!s.includes("reviewSnapshotPlugin(")) {
    if (/plugins:\s*\[/.test(s)) s = s.replace(/plugins:\s*\[/, "plugins: [\n    // don-star: dev autosave of the board file, and /screen-versions.json for the preview cache\n    reviewSnapshotPlugin('review-board.json'),\n    screenVersionsPlugin(),\n   ");
    else manual.push("vite.config: add reviewSnapshotPlugin('review-board.json') and screenVersionsPlugin() to `plugins`.");
  }
  const blocks = [];
  if (!/watch:\s*\{[^}]*review-board/.test(s)) {
    if (/\bserver:\s*\{/.test(s)) s = s.replace(/\bserver:\s*\{/, "server: {\n    // don-star: the board autosaves into these; watching them would reload live frames mid-review\n    watch: { ignored: ['**/review-board.json', '**/review-board-*.json'] },");
    else blocks.push("  server: {\n    // don-star: the board autosaves into these; watching them would reload live frames mid-review\n    watch: { ignored: ['**/review-board.json', '**/review-board-*.json'] },\n  },");
  }
  if (!/keepNames/.test(s)) {
    if (/\bbuild:\s*\{/.test(s)) manual.push("vite.config: add `rollupOptions: { output: { keepNames: true } }` under `build` (dev mode names components off React's fiber).");
    else blocks.push("  build: {\n    // don-star: dev mode names the component behind an element; keep names through minification\n    rollupOptions: { output: { keepNames: true } },\n  },");
  }
  if (!/alias:\s*\{[^}]*['"]@['"]/.test(s)) {
    if (/\bresolve:\s*\{/.test(s)) manual.push("vite.config: add `'@': path.resolve(__dirname, './src')` to `resolve.alias`.");
    else {
      if (!/from ['"]node:path['"]|from ['"]path['"]/.test(s)) s = "import path from 'node:path'\n" + s;
      blocks.push("  resolve: {\n    alias: { '@': path.resolve(__dirname, './src') },\n  },");
    }
  }
  if (blocks.length) {
    // defineConfig({ … }), or the function forms defineConfig(() => ({ … })) and defineConfig(async ({ mode }) => ({ … }))
    const m = s.match(/defineConfig\(\s*(?:(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>\s*\(\s*)?\{/);
    if (m) s = s.slice(0, m.index + m[0].length) + "\n" + blocks.join("\n") + s.slice(m.index + m[0].length);
    else manual.push("vite.config: add the server.watch / build.keepNames / resolve.alias blocks by hand (no `defineConfig({` or `defineConfig(() => ({` found).");
  }
  if (s !== before) write(f, s, `${path.basename(f)}: plugins, watch ignore, keepNames, @ alias`);
}

// --- tsconfig -----------------------------------------------------------------
{
  const f = fs.existsSync(p("tsconfig.app.json")) ? p("tsconfig.app.json") : p("tsconfig.json");
  let s = read(f);
  if (s) {
    const before = s;
    if (!/"paths"/.test(s)) s = s.replace(/"compilerOptions":\s*\{/, `"compilerOptions": {\n    "paths": { "@/*": ["./src/*"] },`);
    else if (!/"@\/\*"/.test(s)) manual.push("tsconfig: add \"@/*\": [\"./src/*\"] to compilerOptions.paths.");
    if (!/"types"/.test(s)) s = s.replace(/"compilerOptions":\s*\{/, `"compilerOptions": {\n    "types": ["vite/client"],`);
    else if (!/vite\/client/.test(s)) manual.push("tsconfig: add \"vite/client\" to compilerOptions.types (the harness reads import.meta.env).");
    if (s !== before) write(f, s, `${path.basename(f)}: @/* paths + vite/client types`);
  }
}

// --- review.config.tsx from the router ----------------------------------------
{
  const f = p("src/review/review.config.tsx");
  const s = read(f);
  if (s && s.includes('url("home", "Home", "/")') && s.includes("Pages")) {
    const routes = new Set();
    for (const file of walk(p("src")).filter((x) => /\.(tsx|jsx)$/.test(x) && !isHarness(x))) {
      for (const m of read(file).matchAll(/<Route\b[^>]*\bpath=["']([^"']+)["']/g)) {
        const r = m[1];
        if (r.includes(":") || r.includes("*") || /^\/?(review|projects|flows)(\/|$)/.test(r)) continue;
        routes.add(r.startsWith("/") ? r : "/" + r);
      }
    }
    if (!routes.size) routes.add("/");
    const flows = new Map();
    for (const r of [...routes].sort()) {
      const seg = r.split("/").filter(Boolean)[0] ?? "home";
      if (!flows.has(seg)) flows.set(seg, []);
      flows.get(seg).push(r);
    }
    const id = (r) => (r === "/" ? "home" : r.replace(/^\//, "").replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase());
    const title = (r) => (r === "/" ? "Home" : r.split("/").filter(Boolean).pop().replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()));
    const cap = (x) => x.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    const body = [...flows]
      .map(([seg, rs]) => `      {\n        id: ${JSON.stringify(seg)},\n        title: ${JSON.stringify(cap(seg))},\n        screens: [\n${rs.map((r) => `          url(${JSON.stringify(id(r))}, ${JSON.stringify(title(r))}, ${JSON.stringify(r)}),`).join("\n")}\n        ],\n      },`)
      .join("\n");
    const out = s.replace(/    flows: \[[\s\S]*?\n    \],\n  \},\n\];/, `    flows: [\n${body}\n    ],\n  },\n];`);
    if (out !== s) write(f, out, `src/review/review.config.tsx: ${routes.size} route(s) in ${flows.size} flow(s), from the router`);
  }
}

// --- .gitignore + .env.example ------------------------------------------------
{
  const f = p(".gitignore");
  const s = read(f) ?? "";
  if (!/^\.shots\/?$/m.test(s)) write(f, s.replace(/\n?$/, "\n") + "# don-star: before/after capture sheets\n.shots/\n", ".gitignore: .shots/");
}
{
  const f = p(".env.example");
  const s = read(f) ?? "";
  if (!s.includes("VITE_SUPABASE_URL")) {
    write(
      f,
      s.replace(/\n?$/, s ? "\n\n" : "") +
        `# Review board (don-star). Leave unset for the local, single-browser board:
# comments in localStorage + review-board.json, no sign-in. Set both and the
# board becomes shared (Supabase) and gated (email + code sign-in). Setup order:
# see the skill's references/supabase-setup.md.
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
# Public bucket folder of prebuilt preview shots (tier 2 of the preview cache).
# Read at BUILD time. Unset = off; the board boots screens live instead.
# VITE_SHOTS_URL=https://<ref>.supabase.co/storage/v1/object/public/review-shots/shots
# Vercel-only (middleware.ts): the secret the 30-day gate cookie is signed with.
# Rotate it to sign everyone out.
# GATE_SECRET=
`,
      ".env.example: review-board variables",
    );
  }
}

// --- report ---------------------------------------------------------------------
for (const c of changed) console.log("  wired  " + c);
if (manual.length) {
  console.log("\nDo by hand (check.mjs will fail until done):");
  for (const m of manual) console.log("  ✗ " + m);
}

/** Files install.sh wrote — never evidence of what the APP does. */
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
