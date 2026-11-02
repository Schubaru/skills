/*
  POST the board replies for a merged triage PR.

  WHY IT RUNS AT MERGE, NOT AT PR TIME. the reviewer's standing rule (2026-07-30): a review thread is
  answered once the change has SHIPPED, never while it's still a proposal. So the triage routine
  writes the reply text into the ledger when it opens the PR, and nothing is posted until the
  merge — this script, driven by .github/workflows/triage-reply.yml.

  It carries no judgement of its own. The reply body was written by the routine that made the
  change; this only delivers it. That keeps the merge path deterministic: no model runs here,
  so what lands on the board is exactly what was reviewable in the PR diff.

  Reads __DS_APP_DIR__/review-triage.json and posts, for every entry matching this PR:

    "<threadId>": {
      "at": …, "activityCount": …, "status": "fixed", "pr": 51,
      "reply": "What shipped, in one short paragraph.",   ← required, or the entry is skipped
      "files": ["__DS_APP_DIR__/src/pages/Enroll.tsx"],           ← optional, becomes the byline
      "verified": "lint + build clean; walked at 390px",   ← optional, becomes the byline
      "resolve": true                                      ← reserved (documentation-event
    }                                                        threads only); unused today

  Idempotent by construction: the function derives the reply id from (pr, thread), so re-running
  a workflow re-posts nothing. Nothing is written back to git.

  Env: TRIAGE_TOKEN (required) · PR_NUMBER (required) · TRIAGE_URL (optional override).
*/

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const LEDGER = join(APP, 'review-triage.json')
const URL_DEFAULT = 'https://__DS_SUPABASE_REF__.supabase.co/functions/v1/review-triage'

const token = process.env.TRIAGE_TOKEN
const pr = Number(process.env.PR_NUMBER)
const endpoint = process.env.TRIAGE_URL || URL_DEFAULT

if (!token) {
  console.error('triage-reply: TRIAGE_TOKEN is not set — add it as the REVIEW_TRIAGE_TOKEN repo secret')
  process.exit(1)
}
if (!Number.isFinite(pr)) {
  console.error('triage-reply: PR_NUMBER is not set')
  process.exit(1)
}

let ledger
try {
  ledger = JSON.parse(readFileSync(LEDGER, 'utf8'))
} catch (err) {
  console.error(`triage-reply: could not read ${LEDGER}: ${err.message}`)
  process.exit(1)
}

const items = Object.entries(ledger?.handled ?? {})
  .filter(([, e]) => e?.pr === pr && typeof e?.reply === 'string' && e.reply.trim())
  .map(([thread_id, e]) => ({
    thread_id,
    body: e.reply.trim(),
    // The byline a reviewer reads to see where the change came from without leaving the board
    // (CLAUDE.md: agents carry `meta` on anything they write).
    meta: {
      command: 'triage',
      ...(Array.isArray(e.files) && e.files.length ? { files: e.files } : {}),
      ...(e.verified ? { verified: String(e.verified) } : {}),
    },
    // Reserved for documentation-event threads (never comment threads — the reviewer's
    // never-resolve rule stands): resolving archives an event off the canvas.
    ...(e.resolve === true ? { resolve: true } : {}),
  }))

if (!items.length) {
  // Not an error: a PR whose entries are all "discussion", or a triage branch merged by hand
  // with no ledger reply text, has nothing to say. Silence is the correct outcome.
  console.log(`triage-reply: no replies to post for PR #${pr}`)
  process.exit(0)
}

const res = await fetch(endpoint, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-triage-token': token },
  body: JSON.stringify({ op: 'reply', key: String(pr), author: '/triage', items }),
})
const out = await res.json().catch(() => ({}))

if (!res.ok && res.status !== 207) {
  console.error(`triage-reply: ${res.status} ${JSON.stringify(out)}`)
  process.exit(1)
}

console.log(
  `triage-reply: posted ${out.posted?.length ?? 0}, already present ${out.skipped?.length ?? 0}` +
    (out.failed?.length ? `, failed ${out.failed.length}: ${JSON.stringify(out.failed)}` : ''),
)
// A thread that has since been deleted shouldn't fail the run; a token or endpoint problem
// already exited above.
if (out.failed?.length) process.exitCode = 0
