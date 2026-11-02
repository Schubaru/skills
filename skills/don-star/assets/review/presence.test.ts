/*
  Runnable check for review-board presence (src/review/presence-model.ts).
  Run:  npx tsx src/review/presence.test.ts
  No test framework — plain assert, exits non-zero on failure.

    §1  THE AVATAR ROW IS PEOPLE, NOT TABS. Two tabs of one person are one avatar
        (the latest), I never see myself, and an agent never appears.
    §1b THE ROW COLLAPSES PAST THREE. Three people show three avatars; four
        show the two most recently active and "+2". Whoever I follow leads.
    §1c AWAY AFTER TEN MINUTES. Untouched or backgrounded for ten minutes, you
        leave the row; watching someone you follow on screen keeps you.
    §1d YOUR LOOK IS CHECKED ON ARRIVAL. A colour is a palette index or a
        #rrggbb hex, anything else falls back; a pale custom colour gets dark
        ink; an avatar is one emoji, never a letter or a sentence.
    §2  FOLLOW SHOWS THE SAME AREA, NOT THE SAME ZOOM. A follower on a smaller
        window sees what the leader sees, centred, within the board's zoom range.
    §3  A CURSOR BELONGS TO A SURFACE. Canvas and flow are per page, slides per
        screen, so a pointer is only ever drawn over the thing it points at.
    §4  CHAT AND REACTIONS ARE CHECKED ON ARRIVAL. A chat line is capped text
        with no control characters; the bubble shows the live line, then the
        sent one for five seconds, then goes. A reaction is one of the wheel's,
        drawn as a burst of five to ten; a thumbs down is one, quiet.
    §5  NOTHING IS SENT TO AN EMPTY ROOM, AND A BUSY ONE STAYS UNDER THE CAP.
        A cursor goes out only with someone on the surface (a hidden watcher
        counts), and its rate falls as they multiply: ten people all moving
        stay under Realtime's 500 messages a second.
*/
import assert from 'node:assert'
import { cursorInterval, listenersOn, isWatcher, CURSOR_BUDGET, MAX_FLOATS_PER_TAB, REACTIONS_PER_SEC, burstSize, QUIET_REACTIONS, AWAY_MS, avatarRow, byActivity, cleanEmoji, colorIndex, isAway, needsDarkInk, validColor, fitView, followersOf, peersFrom, sameView, surfaceKey, viewOf, PRESENCE_COLORS, CHAT_MAX, CHAT_SENT_MS, chatShown, cleanChat, isReaction, BURST_MIN, BURST_MAX, REACTIONS, type PeerMeta } from './presence-model'

const base = { pageId: 'p1', mode: 'canvas' as const, screenId: null, following: null, color: 0, emoji: null }
const e = (tab: string, uid: string, name: string, at: number, extra: Partial<PeerMeta> = {}): PeerMeta => ({ ...base, tab, uid, name, at, ...extra });

// §1
{
  const rows = peersFrom(
    [e('t1', 'u-ana', 'Ana', 1), e('t2', 'u-ana', 'Ana', 5, { pageId: 'p2' }), e('t3', 'u-me', 'Me', 9), e('t4', 'u-bot', '/review-triage', 9), e('t5', 'u-bo', 'Bo', 2)],
    'u-me',
  )
  assert.deepStrictEqual(rows.map((r) => r.name), ['Ana', 'Bo'], 'one avatar per person, no me, no agents')
  assert.strictEqual(rows[0]!.tab, 't2', 'latest tab wins')
  assert.strictEqual(rows[0]!.pageId, 'p2')

  assert.strictEqual(colorIndex('u-ana'), colorIndex('u-ana'), 'colour is stable')
  for (const id of ['a', 'bb', 'c-c-c', 'ffffffff-ffff']) {
    const c = colorIndex(id)
    assert.ok(c >= 0 && c < PRESENCE_COLORS, 'colour in palette')
  }

  const f = followersOf([e('t1', 'u-a', 'A', 1, { following: 'mine' }), e('t2', 'u-b', 'B', 1), e('t3', 'u-c', '/bot', 1, { following: 'mine' })], 'mine')
  assert.deepStrictEqual(f.map((x) => x.tab), ['t1'], 'followers are people following this tab')
}

// §1b
{
  const ps = ['Ana', 'Bo', 'Cy', 'Di'].map((n, i) => e(`t${i}`, `u-${n}`, n, 1))
  const three = avatarRow(ps.slice(0, 3))
  assert.strictEqual(three.shown.length, 3)
  assert.strictEqual(three.rest, 0)
  const recent = byActivity(ps, new Map([['u-Cy', 30], ['u-Ana', 20]]))
  assert.deepStrictEqual(recent.map((p) => p.name), ['Cy', 'Ana', 'Bo', 'Di'], 'most recent first, ties keep A to Z')
  const four = avatarRow(recent)
  assert.deepStrictEqual(four.shown.map((p) => p.name), ['Cy', 'Ana'])
  assert.strictEqual(four.rest, 2)
  const led = avatarRow(recent, 'u-Di')
  assert.deepStrictEqual(led.shown.map((p) => p.name), ['Di', 'Cy'], 'whoever I follow leads the row, never folded')
  assert.strictEqual(led.rest, 2)
  assert.deepStrictEqual(avatarRow(recent, 'u-gone').shown.map((p) => p.name), ['Cy', 'Ana'], 'a lead who left changes nothing')

  // Fifteen colours, spread: 200 ids land in at least 13 of them.
  const used = new Set(Array.from({ length: 200 }, (_, i) => colorIndex(`${i}-a1b2c3d4-uid`)))
  assert.ok(used.size >= 13, `colours spread (${used.size})`)
}

// §1c
{
  const t0 = 1_000_000
  assert.strictEqual(AWAY_MS, 600_000)
  assert.ok(!isAway({ lastInput: t0, now: t0 + AWAY_MS - 1, visible: true, following: false }), 'still here at 9:59')
  assert.ok(isAway({ lastInput: t0, now: t0 + AWAY_MS, visible: true, following: false }), 'untouched 10 min')
  assert.ok(isAway({ lastInput: t0, now: t0 + AWAY_MS, visible: false, following: false }), 'backgrounded 10 min')
  assert.ok(!isAway({ lastInput: t0, now: t0 + 3 * AWAY_MS, visible: true, following: true }), 'watching a follow on screen')
  assert.ok(isAway({ lastInput: t0, now: t0 + AWAY_MS, visible: false, following: true }), 'following from a background tab')
}

// §1d
{
  assert.strictEqual(validColor(3), 3)
  assert.strictEqual(validColor(PRESENCE_COLORS), null)
  assert.strictEqual(validColor(1.5), null)
  assert.strictEqual(validColor('3'), null)
  assert.strictEqual(validColor('#2563EB'), '#2563eb', 'a custom colour, one spelling')
  assert.strictEqual(validColor('#fff'), null, 'six digits only')
  assert.strictEqual(validColor('red'), null)
  assert.strictEqual(validColor('url(x)'), null, 'never a CSS injection')
  assert.ok(!needsDarkInk(3), 'the palette carries white')
  assert.ok(!needsDarkInk('#1e40af'), 'dark custom: white ink')
  assert.ok(needsDarkInk('#fde047'), 'pale custom: dark ink')
  assert.ok(needsDarkInk('#ffffff'))
  assert.strictEqual(cleanEmoji(' 🦊 '), '🦊')
  assert.strictEqual(cleanEmoji('🦊🐙'), '🦊', 'first one only')
  assert.strictEqual(cleanEmoji('👩‍💻'), '👩‍💻', 'a joined emoji is one')
  assert.strictEqual(cleanEmoji('R'), null)
  assert.strictEqual(cleanEmoji('hello'), null)
  assert.strictEqual(cleanEmoji(''), null)
  assert.strictEqual(cleanEmoji(42), null)
}

// §2
{
  const leader = { x: 100, y: 50, scale: 0.5 }
  const v = viewOf(leader, { w: 1600, h: 1000 })
  assert.deepStrictEqual(v, { cx: 1400, cy: 900, w: 3200, h: 2000 })

  // Same window: identical camera.
  assert.deepStrictEqual(fitView(v, { w: 1600, h: 1000 }, 0.1, 2), leader)

  // Half the width: half the zoom, same centre.
  const half = fitView(v, { w: 800, h: 1000 }, 0.1, 2)
  assert.strictEqual(half.scale, 0.25)
  assert.strictEqual((400 - half.x) / half.scale, 1400, 'centre x kept')
  assert.strictEqual((500 - half.y) / half.scale, 900, 'centre y kept')

  // Clamped to the board's range, centre still kept.
  const tiny = fitView(v, { w: 80, h: 50 }, 0.14, 1.6)
  assert.strictEqual(tiny.scale, 0.14)
  assert.ok(Math.abs((40 - tiny.x) / tiny.scale - 1400) < 1e-9)

  assert.ok(sameView(v, { ...v, cx: v.cx + 0.2 }))
  assert.ok(!sameView(v, { ...v, cx: v.cx + 3 }))
  assert.ok(sameView(null, null) && !sameView(v, null))
}

// §3
{
  assert.strictEqual(surfaceKey({ pageId: 'p1', mode: 'canvas', screenId: 's9' }), 'canvas:p1')
  assert.strictEqual(surfaceKey({ pageId: 'p1', mode: 'flow', screenId: null }), 'flow:p1')
  assert.strictEqual(surfaceKey({ pageId: 'p1', mode: 'slides', screenId: 's9' }), 'slides:s9')
  assert.notStrictEqual(surfaceKey({ pageId: 'p1', mode: 'canvas', screenId: null }), surfaceKey({ pageId: 'p1', mode: 'flow', screenId: null }))
}

// §4
{
  assert.strictEqual(cleanChat('hi\nthere'), 'hi there', 'no control characters')
  assert.strictEqual(cleanChat(42), '')
  assert.strictEqual(cleanChat('x'.repeat(500)).length, CHAT_MAX)
  const c = { tab: 't1', text: '', sent: 'Looks good', at: 1000 }
  assert.strictEqual(chatShown({ ...c, text: 'typing' }, 1000), 'typing', 'the live line wins')
  assert.strictEqual(chatShown(c, 1000 + CHAT_SENT_MS - 1), 'Looks good')
  assert.strictEqual(chatShown(c, 1000 + CHAT_SENT_MS), null, 'a sent line goes after five seconds')
  assert.strictEqual(chatShown(undefined, 0), null)
  assert.ok(REACTIONS.every(isReaction))
  assert.ok(!isReaction('💩') && !isReaction('hello') && !isReaction(null))
  assert.ok(BURST_MIN === 5 && BURST_MAX === 10, 'a reaction is a burst of five to ten')
  assert.strictEqual(burstSize('👍', 0), 5)
  assert.strictEqual(burstSize('👍', 0.999999), 10)
  assert.ok(REACTIONS.includes('👎') && QUIET_REACTIONS.includes('👎'), 'there is a thumbs down')
  assert.strictEqual(burstSize('👎', 0.999999), 1, 'a thumbs down is one, not a celebration')
}

// §5
{
  assert.strictEqual(cursorInterval(0), Infinity, 'alone: nothing is sent')
  assert.strictEqual(cursorInterval(1), 100, 'one listener: ten a second at most')
  assert.strictEqual(cursorInterval(9), 250, 'nine listeners: four a second')
  // Ten people on one surface, all moving: each send costs 1 + 9 messages.
  const total = 10 * (1000 / cursorInterval(9)) * 10
  assert.ok(total <= 400 && total <= CURSOR_BUDGET * 10, `ten moving stay under the cap (${total}/s)`)
  // The same ten all holding a reaction key.
  assert.ok(10 * REACTIONS_PER_SEC * 10 <= 400, 'ten holding a key stay under the cap')
  assert.strictEqual(listenersOn('slides:s1', ['slides:s1', 'canvas:p1', 'slides:s1']), 2, 'only tabs on my surface listen')
  assert.ok(isWatcher({ tab: 't', watcher: true, at: 1, pageId: 'p', mode: 'canvas', screenId: null }))
  assert.ok(!isWatcher(e('t1', 'u', 'Ana', 1)), 'a person is not a watcher')
  assert.ok(MAX_FLOATS_PER_TAB >= 10, 'the cap still fits a whole burst')
}

console.log('presence: all assertions passed')
