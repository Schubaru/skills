/*
  Builds the review board's PREBUILT PREVIEW SHOTS and uploads them to the
  public bucket every reviewer reads from (src/review/shot-store.ts).

    npx tsx scripts/build-shots.ts --out .shots        # local, no upload
    npx tsx scripts/build-shots.ts                     # build + upload
    npx tsx scripts/build-shots.ts --all               # ignore the index, reshoot everything

  WHY THIS EXISTS. Board captures used to be taken in the reviewer's own browser
  and kept only there, so every person, device and browser profile paid a full
  ~190-screen boot sweep of its own and nothing anyone warmed ever helped anyone
  else. This shoots each screen ONCE, on a push, for everybody.

  WHY IT CAN RUN LATE. Shots are a cache, not a build artifact — nothing about
  the deploy waits on them. A screen with no shot yet simply boots live in the
  board and self-captures, which is exactly how the whole board behaved before
  any of this existed. So the window between a push and this job finishing is a
  slower board, never a broken one.

  WHY IT IS USUALLY CHEAP. Names are content-addressed (shot-name.ts): a shot
  folds in the route's content hash, so only screens whose CODE moved get a new
  name, and only names missing from the bucket get shot. A typical push
  photographs a handful of screens. That is only true while the version hash
  stays narrow — see the shell-split note in vite-plugin-screen-versions.ts;
  if App.tsx ever goes back to being hashed whole, every push reshoots all ~390.
*/
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { LIVE_VIEWPORTS, MOBILE_FRAME, screenSize, type ReviewProject } from "../src/review/model";
import { PROJECTS } from "../src/review/projects";
import { seededSrc, type ScreenSeed } from "../src/review-seed";
import { SHOT_EXT, SHOT_INDEX_FILE, shotName, type ShotIndex } from "../src/review/shot-name";
import { computeScreenVersions } from "../src/review/vite-plugin-screen-versions";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// --- arguments + environment ---------------------------------------------------

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const opt = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const OUT_DIR = opt("out");
const FORCE_ALL = flag("all");
const LIMIT = Number(opt("limit") ?? 0) || Infinity;
const LANES = Number(opt("concurrency") ?? 6);

const SUPABASE_URL = process.env.SHOTS_SUPABASE_URL?.replace(/\/+$/, "") ?? "";
const SERVICE_KEY = process.env.SHOTS_SERVICE_KEY ?? "";
const BUCKET = process.env.SHOTS_BUCKET || "review-shots";
/** Folder inside the bucket. Keeps the index beside the shots it describes. */
const PREFIX = "shots";
/** Store generation — see shotName(). Bump it to rename (and therefore truly
 *  re-serve) every shot, which is the ONLY way past a year-long immutable
 *  cache. Needed when shots are WRONG rather than merely old: the content hash
 *  already covers code changes, and what it cannot see is time. */
const GENERATION = Number(process.env.SHOTS_GENERATION ?? "1") || 1;

const uploading = !OUT_DIR;
if (uploading && (!SUPABASE_URL || !SERVICE_KEY)) {
  console.error("build-shots: set SHOTS_SUPABASE_URL and SHOTS_SERVICE_KEY, or pass --out <dir>");
  process.exit(2);
}

/** Settle before the shutter: fonts, images and the page's own entrance
 *  animations. Matches SETTLE_MS in export-png.ts — a capture taken earlier is
 *  a half-played reveal, and this one is the picture everyone sees. */
const SETTLE_MS = 900;
const NAV_TIMEOUT_MS = 30_000;

// --- what to shoot -------------------------------------------------------------

type Shot = {
  name: string;
  project: string;
  title: string;
  /** Route with its mid-flow seed in the hash, exactly as a frame loads it. */
  liveSrc: string;
  /** The cache key's viewport width — 1440 or 390. */
  viewportW: number;
  /** CSS px the page is laid out at: the board's live viewport width, at this
   *  frame's own aspect, so the shot frames what the frame frames. */
  viewport: { w: number; h: number };
};

function shotsFor(project: ReviewProject, slug: string, versionOf: (src: string) => string | null): Shot[] {
  const out: Shot[] = [];
  for (const page of project.pages) {
    for (const flow of page.flows) {
      for (const screen of flow.screens) {
        if (screen.source.kind !== "url") continue;
        const liveSrc = seededSrc(screen.source.src, screen.source.seed as ScreenSeed | undefined);
        const version = versionOf(liveSrc);
        for (const device of ["desktop", "mobile"] as const) {
          const live = project.viewports?.[device] ?? LIVE_VIEWPORTS[device];
          // Mobile mode forces every frame to the phone frame (app.tsx); on
          // desktop a screen may set its own size, and the shot follows it.
          const frame = device === "mobile" ? MOBILE_FRAME : screenSize(project, screen);
          const name = shotName(liveSrc, live.w, version, GENERATION);
          if (!name) continue;
          out.push({
            name,
            project: slug,
            title: screen.title,
            liveSrc,
            viewportW: live.w,
            viewport: { w: live.w, h: Math.max(1, Math.round((frame.h * live.w) / frame.w)) },
          });
        }
      }
    }
  }
  return out;
}

// --- the preview server --------------------------------------------------------

function startPreview(): Promise<{ port: number; stop: () => void }> {
  return new Promise((resolve, reject) => {
    // Bound to 127.0.0.1 explicitly: vite's default `localhost` can resolve to
    // ::1, and every page then fails with ERR_CONNECTION_REFUSED against a
    // server that is demonstrably up and printing its URL.
    // `detached` puts vite in its OWN process group, so stop() can kill the
    // group rather than just the `npx` wrapper. Killing npx alone leaves the
    // real vite process orphaned, holding the inherited stdio pipes — which
    // hung the CI job for 25 minutes AFTER all 388 shots had uploaded, and
    // ended a completely successful run as a red ✗ on the 30-minute timeout.
    // (It exited fine locally, so only CI ever showed it.)
    const child: ChildProcess = spawn("npx", ["vite", "preview", "--host", "127.0.0.1", "--port", "0"], {
      cwd: APP,
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
      detached: true,
    });
    let log = "";
    const timer = setTimeout(() => reject(new Error(`vite preview never came up:\n${log}`)), 60_000);
    const watch = (buf: Buffer) => {
      // ANSI stripped before matching: vite bolds the port itself, so the
      // escape codes land BETWEEN the colon and the digits and a plain regex
      // silently never matches — the run then dies on the 60s timeout with the
      // URL it was looking for printed right there in the error.
      log += buf.toString().replace(/\[[0-9;]*m/g, "");
      const m = log.match(/Local:\s+https?:\/\/[^:]+:(\d+)/);
      if (!m) return;
      clearTimeout(timer);
      // unref, or the child's open stdio pipes keep our event loop alive and
      // the script hangs after its last line instead of exiting.
      child.unref();
      resolve({
        port: Number(m[1]),
        stop: () => {
          // Negative pid = the whole group. Falls back to the plain kill if the
          // group is already gone, so stop() is always safe to call.
          try {
            if (child.pid) process.kill(-child.pid, "SIGTERM");
          } catch {
            child.kill();
          }
        },
      });
    };
    child.stdout?.on("data", watch);
    child.stderr?.on("data", watch);
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`vite preview exited (${code}):\n${log}`));
    });
  });
}

// --- the bucket ----------------------------------------------------------------

const objectUrl = (name: string) => `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${PREFIX}/${name}`;
const publicUrl = (name: string) => `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${PREFIX}/${name}`;

async function readIndex(): Promise<Set<string>> {
  if (FORCE_ALL) return new Set();
  try {
    const res = uploading
      ? await fetch(`${publicUrl(SHOT_INDEX_FILE)}?t=${Date.now()}`)
      : ({ ok: fs.existsSync(path.join(OUT_DIR!, SHOT_INDEX_FILE)) } as Response);
    if (!res.ok) return new Set();
    const idx: ShotIndex = uploading
      ? await (res as Response).json()
      : JSON.parse(fs.readFileSync(path.join(OUT_DIR!, SHOT_INDEX_FILE), "utf8"));
    return new Set(idx.names ?? []);
  } catch {
    return new Set();
  }
}

async function put(name: string, body: Buffer | string, contentType: string, cacheControl: string): Promise<void> {
  const res = await fetch(objectUrl(name), {
    method: "POST",
    headers: {
      authorization: `Bearer ${SERVICE_KEY}`,
      "content-type": contentType,
      "cache-control": cacheControl,
      // Re-runs (a retried job, a forced rebuild) must not fail on an object
      // that is byte-identical anyway — the name IS the content hash.
      "x-upsert": "true",
    },
    body: body as BodyInit,
  });
  if (!res.ok) throw new Error(`upload ${name}: ${res.status} ${await res.text()}`);
}

// --- main ----------------------------------------------------------------------

async function main() {
  if (!fs.existsSync(path.join(APP, "dist", "index.html"))) {
    console.error("build-shots: no dist/ — run `npm run build` first");
    process.exit(2);
  }

  const versions = computeScreenVersions(APP);
  const matchers = Object.keys(versions.routes)
    .map((p) => ({
      path: p,
      re: new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/:\w+/g, "[^/]+").replace(/\*/g, ".*")}/?$`),
      specificity: p.replace(/:\w+/g, "").length,
    }))
    .sort((a, b) => b.specificity - a.specificity);
  // Same resolution the board uses (screen-versions.ts) — a shot named by a
  // different rule than the one that looks it up is a shot nobody ever finds.
  const versionOf = (liveSrc: string): string => {
    const pathname = liveSrc.split("#")[0].split("?")[0] || "/";
    for (const m of matchers) if (m.re.test(pathname)) return versions.routes[m.path];
    return versions.global;
  };

  // Board projects only. A "flows" project has no `load` and no screens — its
  // canvas is a document in the database, and there is nothing here to shoot.
  const boards = PROJECTS.filter((p) => typeof p.load === "function");
  const wanted: Shot[] = [];
  for (const entry of boards) wanted.push(...shotsFor(await entry.load!(), entry.slug, versionOf));

  // Two projects can legitimately frame the same seeded route at the same
  // viewport; that is ONE shot, not two.
  const byName = new Map<string, Shot>();
  for (const s of wanted) if (!byName.has(s.name)) byName.set(s.name, s);

  const have = await readIndex();
  const missing = [...byName.values()].filter((s) => !have.has(s.name));
  const todo = missing.slice(0, LIMIT);

  console.error(
    `build-shots: ${byName.size} shots wanted (${boards.length} board projects × 2 viewports), ` +
      `${byName.size - missing.length} already built, ${missing.length} missing` +
      (todo.length < missing.length ? `, ${todo.length} in this run (--limit)` : ""),
  );
  if (flag("dry-run")) {
    for (const s of todo) console.error(`  ${s.name}  ${s.viewport.w}×${s.viewport.h}  ${s.liveSrc.split("#")[0]}`);
    return;
  }
  if (OUT_DIR) fs.mkdirSync(OUT_DIR, { recursive: true });

  // A build server and a browser cost ~15s to start, so a run with nothing to
  // shoot (a docs-only push under __DS_APP_DIR__/, a re-run) skips straight to the
  // index — which still has to be written, since it is also what PRUNES names
  // that no screen wants any more.
  const built: string[] = [];
  if (todo.length) await shootAll(todo, built);
  await writeIndex(byName, have, built);
}

/** Boots the preview server + browser, shoots every spec, and tears both down.
 *  Names of what landed are pushed into `built`. */
async function shootAll(todo: Shot[], built: string[]): Promise<void> {
  const { chromium } = await import(path.join(APP, "node_modules", "playwright-core", "index.mjs"));
  const { port, stop } = await startPreview();
  const browser = await chromium.launch();
  // Playwright encodes PNG and JPEG only, and JPEG rings badly around UI type.
  // Chromium itself encodes WebP, so a scratch page does the conversion — the
  // same encoder the board's own in-browser captures use, and no native dep.
  const encoder = await browser.newPage();
  await encoder.goto("about:blank");

  const toWebp = (png: Buffer): Promise<Buffer> =>
    encoder
      .evaluate(async (b64: string) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext("2d")!.drawImage(img, 0, 0);
        return canvas.toDataURL("image/webp", 0.82).split(",")[1];
      }, png.toString("base64"))
      .then((b64: string) => Buffer.from(b64, "base64"));

  let done = 0;
  let failed = 0;

  const shoot = async (shot: Shot): Promise<void> => {
    const page = await browser.newPage({
      viewport: { width: shot.viewport.w, height: shot.viewport.h },
      // 1.5× matches CAPTURE_PIXEL_RATIO: enough that a bitmap still reads when
      // the board is zoomed near 100%, without doubling every file.
      deviceScaleFactor: 1.5,
    });
    try {
      const res = await page.goto(`http://127.0.0.1:${port}${shot.liveSrc}`, {
        waitUntil: "domcontentloaded",
        timeout: NAV_TIMEOUT_MS,
      });
      if (res && res.status() >= 400) throw new Error(`HTTP ${res.status()}`);
      // Wait for PAINTED CONTENT, not networkidle: the network goes quiet once
      // before the SPA has mounted, and a shot taken there is a white rectangle
      // that then gets cached for everybody.
      await page.waitForFunction(() => document.body?.innerText.trim().length > 0, null, { timeout: NAV_TIMEOUT_MS });
      await page.evaluate(() => document.fonts?.ready);
      await page.waitForTimeout(SETTLE_MS);
      const webp = await toWebp(await page.screenshot({ type: "png" }));
      if (OUT_DIR) fs.writeFileSync(path.join(OUT_DIR, `${shot.name}.${SHOT_EXT}`), webp);
      else await put(`${shot.name}.${SHOT_EXT}`, webp, "image/webp", "max-age=31536000, immutable");
      built.push(shot.name);
    } catch (err) {
      // One screen failing must not cost the run. It simply stays absent from
      // the index, so the board boots it live and the next job tries again.
      failed++;
      console.error(`  ✗ ${shot.title} (${shot.viewport.w}px): ${(err as Error).message.split("\n")[0]}`);
    } finally {
      done++;
      if (done % 20 === 0) console.error(`  … ${done}/${todo.length}`);
      await page.close();
    }
  };

  let next = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(LANES, todo.length)) }, async () => {
      for (;;) {
        const shot = todo[next++];
        if (!shot) return;
        await shoot(shot);
      }
    }),
  );

  await browser.close();
  stop();
  console.error(`build-shots: ${built.length} shot, ${failed} failed`);
  // A partial run is still a good run — the missing screens boot live and the
  // next push retries them. Only a total wipeout is worth failing CI over.
  if (built.length === 0) {
    console.error("build-shots: every shot failed — not writing an index");
    process.exit(1);
  }
}

/** The index is the set of shots that SHOULD exist and do — not a running
 *  union. A name that drops out of the board (a deleted screen, a changed route
 *  hash) leaves the index even though its object lingers, so nothing keeps
 *  pointing at a screen that no longer exists. */
async function writeIndex(byName: Map<string, Shot>, have: Set<string>, built: string[]): Promise<void> {
  const names = [...byName.keys()].filter((n) => have.has(n) || built.includes(n));
  const body = JSON.stringify({ generatedAt: Date.now(), gen: GENERATION, names } satisfies ShotIndex);
  if (OUT_DIR) fs.writeFileSync(path.join(OUT_DIR, SHOT_INDEX_FILE), body);
  // Short max-age, and the ONLY mutable object here: a reviewer must see a new
  // shot within a minute of the job landing, while the shots themselves are
  // immutable and cached for a year.
  else await put(SHOT_INDEX_FILE, body, "application/json", "max-age=60");
  console.error(
    `build-shots: ${names.length}/${byName.size} in the index` +
      (OUT_DIR ? ` → ${OUT_DIR}` : ` → ${BUCKET}/${PREFIX}`),
  );
}

main().then(
  // Explicit, and not a formality: Playwright and the preview server both leave
  // handles that can outlive their own teardown, and a script that has finished
  // its work but never exits burns the job's whole timeout and then reports the
  // successful run as a failure. Exiting is the last thing this does.
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
