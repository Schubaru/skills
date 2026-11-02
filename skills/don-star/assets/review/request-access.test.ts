// The sign-in request's shape check (2026-09-18). Run: npx tsx src/review/request-access.test.ts
//
// Why a test at all for three lines of trimming: this helper is copied three
// times over — here, in the Edge Function (Deno can't import it) and inline in
// middleware.ts's login page (a string, not a module). The copies are allowed
// to drift in style, never in what they accept, so the rule is pinned once.

import assert from 'node:assert/strict'
import { normalizeSignInRequest, REQUEST_MESSAGE_MAX, REQUEST_NAME_MAX } from './request-access'

// --- a valid address, lowercased and trimmed -------------------------------
const ok = normalizeSignInRequest({ email: '  Jane@client.example ' })
assert.equal(ok.ok, true)
assert.deepEqual(ok.ok && ok.value, { email: 'jane@client.example' })

// Empty name and note are DROPPED rather than sent as empty strings — a blank
// note must not read as "they wrote nothing on purpose" in the email.
const blank = normalizeSignInRequest({ email: 'a@b.co', name: '   ', message: '' })
assert.deepEqual(blank.ok && blank.value, { email: 'a@b.co' })

const full = normalizeSignInRequest({ email: 'a@b.co', name: ' Jane ', message: ' let me in ' })
assert.deepEqual(full.ok && full.value, { email: 'a@b.co', name: 'Jane', message: 'let me in' })

// --- refusals ---------------------------------------------------------------
for (const bad of ['', '   ', 'jane', 'jane@', '@client.example', 'jane @client.example', 'jane@client']) {
  const res = normalizeSignInRequest({ email: bad })
  assert.equal(res.ok, false, `expected ${JSON.stringify(bad)} to be refused`)
}
assert.equal(normalizeSignInRequest({}).ok, false)
assert.equal(normalizeSignInRequest({ email: `${'a'.repeat(250)}@b.co` }).ok, false)

// --- lengths are CUT, never a refusal ---------------------------------------
// Someone writing a long note should have it shortened, not lose the whole
// request over it. The function enforces the same ceilings server side.
const long = normalizeSignInRequest({
  email: 'a@b.co',
  name: 'n'.repeat(200),
  message: 'm'.repeat(900),
})
assert.equal(long.ok, true)
assert.equal(long.ok && long.value.name?.length, REQUEST_NAME_MAX)
assert.equal(long.ok && long.value.message?.length, REQUEST_MESSAGE_MAX)

console.log('request-access: ok')
