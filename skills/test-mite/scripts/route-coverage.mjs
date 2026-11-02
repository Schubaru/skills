#!/usr/bin/env node
// Route coverage reporter. Diffs tests/routing/routes.manifest.json against
// @route:<path> and @behavior:<slug> tags found in *.spec.* / *.test.* files
// in the same directory tree. Exit 1 if any route or declared behavior is uncovered.
//
// Usage: node route-coverage.mjs [dir]   (dir defaults to the script's own directory)

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = process.argv[2] ?? dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(dir, "routes.manifest.json"), "utf8"));

const specFiles = [];
(function walk(d) {
  for (const name of readdirSync(d)) {
    const p = join(d, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(spec|test)\.[cm]?[jt]sx?$/.test(name)) specFiles.push(p);
  }
})(dir);

const taggedRoutes = new Set();
const taggedBehaviors = new Set();
// A table-driven spec generates its @route tags at runtime from the manifest, so grep
// can't see them. If any spec consumes the manifest, every entry with a non-null
// `expect` is covered by that spec's own construction.
let tableDriven = false;
for (const f of specFiles) {
  const src = readFileSync(f, "utf8");
  if (src.includes("routes.manifest.json")) tableDriven = true;
  for (const [, r] of src.matchAll(/@route:(\S+)/g)) taggedRoutes.add(r);
  for (const [, b] of src.matchAll(/@behavior:(\S+)/g)) taggedBehaviors.add(b);
}

const covered = [], uncovered = [], untestedBehaviors = [];
for (const route of manifest.routes) {
  const isCovered = taggedRoutes.has(route.path) || (tableDriven && route.expect != null);
  (isCovered ? covered : uncovered).push(route);
  // behaviors are slugs (or {slug, note} objects); the slug is the contract a test tags
  for (const b of route.behaviors ?? []) {
    const slug = typeof b === "string" ? b : b.slug;
    if (!taggedBehaviors.has(slug)) untestedBehaviors.push({ path: route.path, behavior: slug });
  }
}

console.log(`Spec files scanned: ${specFiles.length}`);
console.log(`\nRoutes covered (${covered.length}/${manifest.routes.length}):`);
for (const r of covered) console.log(`  ✓ ${r.path}`);
console.log(`\nRoutes MISSING coverage (${uncovered.length}):`);
for (const r of uncovered) console.log(`  ✗ ${r.path}${r.expect ? "" : "   (no expect declared in manifest)"}`);
console.log(`\nDeclared behaviors with no @behavior tag (${untestedBehaviors.length}):`);
for (const { path, behavior } of untestedBehaviors) console.log(`  ✗ ${path} — ${behavior}`);

process.exit(uncovered.length || untestedBehaviors.length ? 1 : 0);
