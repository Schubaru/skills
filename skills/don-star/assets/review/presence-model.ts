// The pure half of review-board presence (presence.ts): types, colour, the
// avatar row, and the camera maths for follow mode. No DOM, no Supabase, so
// presence.test.ts runs under plain tsx.

import { isAgent } from "./model";
import type { BoardMode } from "./nav";

/** Number of presence colours (`--rv-p0` … in review.css). Fifteen, so a busy
 *  board rarely puts two people in one colour; the picker's sixteenth cell is
 *  a custom colour. */
export const PRESENCE_COLORS = 15;
/** Up to this many people, every avatar shows; past it, AVATARS_COLLAPSED + "+N". */
export const AVATARS_MAX = 3;
export const AVATARS_COLLAPSED = 2;
/** Where someone is on the board. */
export type Place = {
  pageId: string;
  mode: BoardMode;
  /** The slide on screen; null outside slides. */
  screenId: string | null;
};

/** What a presence entry carries. `tab` is the session (a person can have two). */
export type PeerMeta = Place & {
  tab: string;
  uid: string;
  name: string;
  color: PresenceColor;
  /** Shown in the avatar in place of the initial; null = the initial. */
  emoji: string | null;
  /** The tab this session is following, or null. */
  following: string | null;
  at: number;
};

/** One person in the avatar row: their latest tab wins. */
export type Peer = PeerMeta;

/** The camera, in surface units: the centre of what's visible and its size.
 *  Size, not zoom — a follower fits the same AREA into their own window. */
export type View = { cx: number; cy: number; w: number; h: number };

export type ViewMessage = Place & { tab: string; view: View | null; slideZoom: number };

export type Cursor = { tab: string; surface: string | null; x: number; y: number; at: number };

/** Surface key for a place: slides are per screen, canvas/flow per page. */
export function surfaceKey(place: Place): string {
  return place.mode === "slides" ? `slides:${place.screenId ?? ""}` : `${place.mode}:${place.pageId}`;
}

/** A hidden viewer ("Show me to others" off) is still an audience: it tracks
 *  this, with no name and no account, so senders know someone is watching
 *  without anyone being shown. */
export type Watcher = Place & { tab: string; watcher: true; at: number };
export const isWatcher = (e: unknown): e is Watcher => Boolean(e && (e as Watcher).watcher === true);

/** Every broadcast costs one message sent plus one per tab that receives it,
 *  and Realtime caps a project's messages a second (Pro: 500). A sender spends
 *  at most this many a second on cursor moves, so the rate falls as the
 *  audience grows: ten people all moving stay near 400 a second in all. */
export const CURSOR_BUDGET = 40;
/** And never more often than this, alone with one other person included. */
export const CURSOR_MIN_MS = 100;
/** How long to wait between cursor sends with this many listening on my
 *  surface; Infinity with nobody there (nothing is sent). */
export function cursorInterval(listeners: number): number {
  if (listeners <= 0) return Infinity;
  return Math.max(CURSOR_MIN_MS, Math.ceil(((1 + listeners) * 1000) / CURSOR_BUDGET));
}
/** Other tabs (people and hidden watchers) looking at this surface. */
export function listenersOn(surface: string, audience: Iterable<string>): number {
  let n = 0;
  for (const s of audience) if (s === surface) n++;
  return n;
}

/** A person's colour: from their account id alone, so it never changes between
 *  sessions, tabs or boards. FNV-1a, so the low bits the modulo reads are mixed. */
export function colorIndex(uid: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < uid.length; i++) h = Math.imul(h ^ uid.charCodeAt(i), 0x01000193);
  return (h >>> 0) % PRESENCE_COLORS;
}

/** Everyone here: one entry per person, their most recent tab, never me, never
 *  an agent. A to Z (the flyout's order; the row re-sorts with byActivity). */
export function peersFrom(entries: PeerMeta[], myUid: string): Peer[] {
  const byUid = new Map<string, PeerMeta>();
  for (const e of entries) {
    if (!e || e.uid === myUid || isAgent(e.name)) continue;
    const prev = byUid.get(e.uid);
    if (!prev || e.at > prev.at) byUid.set(e.uid, e);
  }
  return [...byUid.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** A palette index, or a custom colour as `#rrggbb`. */
export type PresenceColor = number | string;

const HEX = /^#[0-9a-f]{6}$/i;

/** A colour someone sent, or null if it is neither a palette index nor a
 *  `#rrggbb` hex (lower-cased, so one colour has one spelling). */
export function validColor(c: unknown): PresenceColor | null {
  if (typeof c === "number") return Number.isInteger(c) && c >= 0 && c < PRESENCE_COLORS ? c : null;
  return typeof c === "string" && HEX.test(c) ? c.toLowerCase() : null;
}

/** Whether a colour needs dark text on it. The palette is chosen to carry
 *  white; a custom colour is measured (relative luminance, WCAG), so a pale
 *  pick still has a readable initial. */
export function needsDarkInk(c: PresenceColor): boolean {
  if (typeof c === "number") return false;
  const lin = (i: number) => {
    const v = parseInt(c.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * lin(1) + 0.7152 * lin(3) + 0.0722 * lin(5);
  // White wins while its contrast beats black's: (1.05)/(l+.05) vs (l+.05)/.05.
  return l > 0.179;
}

/** A colour as CSS: a palette index is its `--rv-p<i>` token, a custom one its hex. */
export const colorCss = (c: PresenceColor): string => (typeof c === "number" ? `var(--rv-p${c})` : c);
/** The ink on a colour: a pale custom colour gets dark text. */
export const inkOn = (c: PresenceColor): string => (needsDarkInk(c) ? "rgba(0, 0, 0, 0.8)" : "#fff");

/** A colour as stored in the people directory (text: "12" or "#rrggbb"). */
export function storedColor(t: unknown): PresenceColor | null {
  if (typeof t !== "string") return null;
  return /^\d{1,2}$/.test(t) ? validColor(Number(t)) : validColor(t);
}

/** The avatar's emoji: the first character (grapheme) of what was typed or
 *  pasted, or null. Letters and digits are refused: the initial already
 *  covers those. */
export function cleanEmoji(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (!t) return null;
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment(s: string): Iterable<{ segment: string }> } }).Segmenter;
  const first = Seg ? ([...new Seg(undefined, { granularity: "grapheme" }).segment(t)][0]?.segment ?? "") : [...t][0] ?? "";
  if (!first || first.length > 16 || /^[\p{L}\p{N}\p{P}\s]/u.test(first)) return null;
  return first;
}

/** Suggested emoji for the avatar picker; any other can be pasted. */
export const EMOJI_SUGGESTIONS = ["🦊", "🐙", "🦉", "🐳", "🐝", "🦋", "🌵", "🍋", "🚀", "🎧", "🎨", "⚡", "🌈", "🔥", "⭐"];

/** Most recently active first (`lastActive` by uid); ties keep the incoming order. */
export function byActivity(peers: Peer[], lastActive: ReadonlyMap<string, number>): Peer[] {
  return peers
    .map((p, i) => ({ p, i, t: lastActive.get(p.uid) ?? 0 }))
    .sort((a, b) => b.t - a.t || a.i - b.i)
    .map((x) => x.p);
}

/** The header row: everyone up to AVATARS_MAX, else the first
 *  AVATARS_COLLAPSED and a count of the rest. The person I follow (`leadUid`)
 *  leads it, so they are never folded into the count. */
export function avatarRow(all: Peer[], leadUid: string | null = null): { shown: Peer[]; rest: number } {
  const lead = leadUid ? all.find((p) => p.uid === leadUid) : undefined;
  const peers = lead ? [lead, ...all.filter((p) => p !== lead)] : all;
  const shown = peers.length <= AVATARS_MAX ? peers : peers.slice(0, AVATARS_COLLAPSED);
  return { shown, rest: peers.length - shown.length };
}

/** Untouched (or in a background tab) this long, you leave the board's row. */
export const AWAY_MS = 10 * 60_000;

/** Away: no input for AWAY_MS. Watching someone you follow on screen counts as
 *  being here (a presentation can run ten minutes without a touch); following
 *  from a background tab does not. */
export function isAway(s: { lastInput: number; now: number; visible: boolean; following: boolean }): boolean {
  if (s.visible && s.following) return false;
  return s.now - s.lastInput >= AWAY_MS;
}

/** Tabs following `tab`. */
export function followersOf(entries: PeerMeta[], tab: string): PeerMeta[] {
  return entries.filter((e) => e.following === tab && !isAgent(e.name));
}

/** A canvas/flow camera → the View it shows. */
export function viewOf(t: { x: number; y: number; scale: number }, size: { w: number; h: number }): View {
  return {
    cx: (size.w / 2 - t.x) / t.scale,
    cy: (size.h / 2 - t.y) / t.scale,
    w: size.w / t.scale,
    h: size.h / t.scale,
  };
}

/** Fit someone else's View into my window: same centre, same area visible
 *  (the tighter axis wins), zoom clamped to what my board allows. */
export function fitView(
  v: View,
  size: { w: number; h: number },
  minScale: number,
  maxScale: number,
): { x: number; y: number; scale: number } {
  const raw = Math.min(size.w / Math.max(v.w, 1), size.h / Math.max(v.h, 1));
  const scale = Math.min(maxScale, Math.max(minScale, raw));
  return { scale, x: size.w / 2 - v.cx * scale, y: size.h / 2 - v.cy * scale };
}

/** Two views are the same camera, within a rounding pixel. */
export function sameView(a: View | null, b: View | null): boolean {
  if (!a || !b) return a === b;
  return Math.abs(a.cx - b.cx) < 0.5 && Math.abs(a.cy - b.cy) < 0.5 && Math.abs(a.w - b.w) < 0.5 && Math.abs(a.h - b.h) < 0.5;
}

// --- cursor chat and reactions ---------------------------------------------------

/** A cursor chat message is at most this long: a few lines in the bubble. */
export const CHAT_MAX = 240;
/** A sent message stays on the cursor this long after Enter. */
export const CHAT_SENT_MS = 5000;

/** What a cursor carries while its owner chats: the line being typed (live,
 *  as they type) and the last line they sent. Never stored. */
export type ChatMessage = { tab: string; text: string; sent: string | null; at: number };

/** Chat text as received: a string, control characters out, capped. */
export function cleanChat(raw: unknown): string {
  if (typeof raw !== "string") return "";
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, CHAT_MAX);
}

/** What a remote cursor shows: the live line while they type, else their
 *  last sent line for CHAT_SENT_MS, else nothing (the name label). */
export function chatShown(c: ChatMessage | undefined, now: number): string | null {
  if (!c) return null;
  if (c.text) return c.text;
  if (c.sent && now - c.at < CHAT_SENT_MS) return c.sent;
  return null;
}

/** The reaction wheel, in order (keys 1 to 8). Only these travel: a reaction
 *  is picked, never typed. */
export const REACTIONS = ["👍", "❤️", "😂", "💯", "🔥", "👀", "🤔", "👎"] as const;
export type ReactionEmoji = (typeof REACTIONS)[number];
export const isReaction = (e: unknown): e is ReactionEmoji => REACTIONS.includes(e as ReactionEmoji);

/** A reaction, where it was fired: surface space, like a cursor. */
export type Reaction = { tab: string; emoji: ReactionEmoji; surface: string; x: number; y: number };
/** At most this many reactions a second leave one tab (a held key repeats). */
export const REACTIONS_PER_SEC = 4;
/** At most this many of one sender's emoji on screen at once; a burst past it
 *  is trimmed, so a held key can't pile up hundreds. */
export const MAX_FLOATS_PER_TAB = 30;
/** One reaction is a burst: this many of the emoji float up, one after another. */
export const BURST_MIN = 5;
export const BURST_MAX = 10;
/** Not a celebration: one, still, that dips and goes. */
export const QUIET_REACTIONS: readonly ReactionEmoji[] = ["👎"];
/** How many of a reaction to draw (`rand` in [0, 1)). */
export function burstSize(emoji: ReactionEmoji, rand: number): number {
  if (QUIET_REACTIONS.includes(emoji)) return 1;
  return BURST_MIN + Math.min(BURST_MAX - BURST_MIN, Math.floor(rand * (BURST_MAX - BURST_MIN + 1)));
}
