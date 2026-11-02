import fs from "node:fs/promises";
import path from "node:path";
import type { Connect, Plugin } from "vite";

/** Dev-only endpoint that writes the review board (comments + statuses) into
 *  the committed snapshot JSON. Resolve never deletes — threads stay in the
 *  file with `resolved: true`, so the review history survives. */
const ENDPOINT = "/__dev/review-snapshot";

function readBody(req: Connect.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** One board file per project (2026-08-13). The default project keeps the
 *  original filename — it is committed under that name and the triage Edge
 *  Function reads it — and every other project gets its own, so two boards
 *  open in two tabs can't overwrite each other. Mirrors snapshotFilename() in
 *  io.ts; a plain function, because a vite plugin can't import app code. */
const DEFAULT_SLUG = "__DS_PROJECT_SLUG__";

function fileForSlug(slug: string | null, fallback: string): string {
  if (!slug || slug === DEFAULT_SLUG) return fallback;
  // Slugs come off the URL: allow only what a slug can contain, so nothing can
  // be talked into writing outside the project root.
  const safe = slug.toLowerCase().replace(/[^a-z0-9-]/g, "");
  return safe ? `review-board-${safe}.json` : fallback;
}

/** @param file Snapshot path relative to the vite root, e.g. "review-board.json". */
export function reviewSnapshotPlugin(file = "review-board.json"): Plugin {
  return {
    name: "review-snapshot",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        // Match with or without the host's base prefix ("/__review/__dev/…").
        if (!req.url?.includes(ENDPOINT)) {
          next();
          return;
        }

        const slug = new URL(req.url, "http://localhost").searchParams.get("project");
        const boardFile = fileForSlug(slug, file);

        // GET: serve the current file. The app fetches this at boot instead of
        // importing the JSON — importing would either full-reload the page on
        // every autosave (watched) or serve a stale module cache (ignored).
        if (req.method === "GET") {
          try {
            const raw = await fs.readFile(path.resolve(server.config.root, boardFile), "utf8");
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json");
            res.end(raw);
          } catch {
            res.statusCode = 404;
            res.end(JSON.stringify({ ok: false, error: "no snapshot file" }));
          }
          return;
        }

        if (req.method !== "POST") {
          next();
          return;
        }

        try {
          const raw = await readBody(req);
          const parsed = JSON.parse(raw) as { version?: number; comments?: unknown };
          if (parsed.version !== 1 || !Array.isArray(parsed.comments)) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: false, error: "invalid snapshot" }));
            return;
          }

          const outPath = path.resolve(server.config.root, boardFile);
          await fs.writeFile(outPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ok: true, path: boardFile }));
        } catch (err) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              ok: false,
              error: err instanceof Error ? err.message : "write failed",
            }),
          );
        }
      });
    },
  };
}
