/*
  Runnable check for the review board's mention parsing and per-person read state
  (src/review/model.ts).
  Run:  npx tsx src/review/mentions-reads.test.ts
  No test framework — plain assert, exits non-zero on failure. Same style as journey.test.ts.

  These two are worth asserting because both are quietly load-bearing:
    §1  THE MENTION IS THE PERSON YOU PICKED, not the text you typed. Highlighting
        (and, one layer up, notifying) reads the stored emails — so a hand-typed
        "@Rita" from someone who never opened the picker must stay plain text.
    §2  UNREAD IS PERSONAL AND FORWARD-ONLY. A thread is unread when something has
        happened in it since I last opened it — and never because of something I
        did myself. Getting this wrong either nags people about their own comments
        or silently hides a reply, and neither is visible until it happens to you.
*/
import assert from 'node:assert'
import {
  applyMention,
  isUnread,
  lastActivityAt,
  matchPeople,
  mentionQueryAt,
  mentionSegments,
  type CommentThread,
  type Person,
} from './model'

const PEOPLE: Person[] = [
  { email: 'rita@__DS_ADMIN_DOMAIN__', name: 'Rita' },
  { email: 'rita.d@client.example', name: 'Rita Delmar' },
  { email: 'aldo@__DS_ADMIN_DOMAIN__', name: 'Aldo Schuler' },
]

// === §1 mentions ===========================================================

// The picker only opens on a real word boundary — an email address in prose
// ("write to aldo@__DS_ADMIN_DOMAIN__") must not turn into a half-typed mention.
assert.deepEqual(mentionQueryAt('hey @ri', 7), { query: 'ri', start: 4 })
assert.deepEqual(mentionQueryAt('@', 1), { query: '', start: 0 })
assert.equal(mentionQueryAt('write to aldo@__DS_ADMIN_DOMAIN__', 24), null)
// Names have spaces, so a query may too — but not a newline, and not forever.
assert.deepEqual(mentionQueryAt('@Aldo Schu', 10), { query: 'Aldo Schu', start: 0 })
assert.equal(mentionQueryAt('@one\ntwo', 8), null)
assert.equal(mentionQueryAt(`@${'x'.repeat(40)}`, 41), null)

// Prefix beats substring, so typing "ri" offers Rita before Rita Delmar.
assert.deepEqual(
  matchPeople(PEOPLE, 'rita').map((p) => p.name),
  ['Rita', 'Rita Delmar'],
)
assert.equal(matchPeople(PEOPLE, '').length, 3)

// Picking replaces the query and leaves the caret past the trailing space.
{
  const { value, caret } = applyMention('hey @ri', 4, 7, 'Rita')
  assert.equal(value, 'hey @Rita ')
  assert.equal(caret, 10)
  // Mid-string picks keep what came after the caret.
  const mid = applyMention('hey @ri, thanks', 4, 7, 'Rita')
  assert.equal(mid.value, 'hey @Rita , thanks')
}

// THE LOAD-BEARING ONE: highlighting is driven by the item's own resolved
// names. Same text, no stored mention → no highlight.
assert.deepEqual(mentionSegments('ping @Rita please', ['Rita']), [
  { text: 'ping ', mention: false },
  { text: '@Rita', mention: true },
  { text: ' please', mention: false },
])
assert.deepEqual(mentionSegments('ping @Rita please', []), [
  { text: 'ping @Rita please', mention: false },
])
// Longest name wins, so "@Rita Delmar" can't be shredded into "@Rita" + text.
assert.deepEqual(
  mentionSegments('@Rita Delmar and @Rita', ['Rita', 'Rita Delmar']).filter((s) => s.mention),
  [{ text: '@Rita Delmar', mention: true }, { text: '@Rita', mention: true }],
)

// === §2 read state =========================================================

const thread = (over: Partial<CommentThread> = {}): CommentThread => ({
  id: 't1',
  anchor: { type: 'screen', screenId: 's1', dx: 0, dy: 0 },
  author: 'Rita',
  body: 'look at this',
  at: 1000,
  resolved: false,
  replies: [],
  authorEmail: 'rita@__DS_ADMIN_DOMAIN__',
  ...over,
})

const ME = { email: 'aldo@__DS_ADMIN_DOMAIN__', name: 'Aldo' }

assert.equal(lastActivityAt(thread()), 1000)
assert.equal(
  lastActivityAt(thread({ replies: [{ id: 'r1', author: 'Aldo', body: 'ok', at: 2000 }] })),
  2000,
)

// Never opened → unread. Opened at the time of the last activity → read.
assert.equal(isUnread(thread(), undefined, ME), true)
assert.equal(isUnread(thread(), 1000, ME), false)

// A reply after my last visit makes it unread AGAIN — the whole reason the mark
// is a timestamp rather than a boolean.
const replied = thread({ replies: [{ id: 'r1', author: 'Rita', body: 'and this', at: 3000, email: 'rita@__DS_ADMIN_DOMAIN__' }] })
assert.equal(isUnread(replied, 1000, ME), true)
assert.equal(isUnread(replied, 3000, ME), false)

// My own message never nags me, seen or not.
const mine = thread({ replies: [{ id: 'r1', author: 'Aldo', body: 'on it', at: 3000, email: ME.email }] })
assert.equal(isUnread(mine, 1000, ME), false)
// Same thread, someone else's eyes: still unread for them.
assert.equal(isUnread(mine, 1000, { email: 'rita@__DS_ADMIN_DOMAIN__', name: 'Rita' }), true)

// A thread I started, that nobody has answered, is not unread mail to me.
assert.equal(isUnread(thread({ author: 'Aldo', authorEmail: ME.email }), undefined, ME), false)

// OFFLINE BOARD: nobody has an email, so identity falls back to the name —
// otherwise every comment you leave locally comes back to you as unread.
const offlineMine = thread({ author: 'Aldo', authorEmail: undefined })
assert.equal(isUnread(offlineMine, undefined, { name: 'Aldo' }), false)
assert.equal(isUnread(offlineMine, undefined, { name: 'Rita' }), true)

console.log('review mentions + read state: all assertions passed')
