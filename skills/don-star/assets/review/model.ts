// Data model for the review canvas: a project is pages of flows of screens,
// reviewed with pinned comment threads and per-screen triage statuses.
// Everything serializes into one snapshot JSON committed next to the config,
// which is what lets an agent process comments asynchronously.

import type { ReactNode } from "react";

// --- project (what is being reviewed) --------------------------------------

/** Storage the app boots with, so mid-flow screens (intake step 9, checkout
 *  step 3) render for real. `null` removes the key. Carried in each frame's own
 *  URL and applied inside that frame — sessionStorage is shared per origin, so
 *  seeding from the host would let neighbouring frames overwrite each other.
 *  See `src/review-seed.ts`. */
import type { ScreenSeed } from "../review-seed";
export type { ScreenSeed };

/** What a screen shows. `url` mounts the real page from the reviewed app,
 *  proxied same-origin by the review host, at the viewport currently selected —
 *  always live, never a stand-in capture (a fixed-width PNG of a responsive
 *  design is only right by accident). `image` is for screens that genuinely
 *  ARE pictures: exported mockups, a competitor's app, a photographed
 *  whiteboard. `element` mounts a live React node — only available when the
 *  review harness runs inside the app being reviewed. */
export type ScreenSource =
  | { kind: "image"; src: string }
  | { kind: "url"; src: string; seed?: ScreenSeed }
  | { kind: "element"; render: () => ReactNode };

/** Review-host asset path (screenshots in public/) resolved against the base
 *  the host is served under (`/__review/` when the app proxy is on). App
 *  paths in `url` sources stay raw — they're proxied at the origin root. */
export function assetUrl(src: string): string {
  const base = import.meta.env.BASE_URL ?? "/";
  if (base === "/" || !src.startsWith("/") || src.startsWith(base)) return src;
  return base.replace(/\/$/, "") + src;
}

export type Screen = {
  /** Globally unique across the whole project — comment anchors key off it. */
  id: string;
  title: string;
  source: ScreenSource;
  /** Per-screen frame size; falls back to the project default. Lets portrait
   *  mobile captures sit next to desktop pages on the same board. */
  w?: number;
  h?: number;
  /** A screen that IS the phone version of a page ("… on a phone"): it stays a phone frame
   *  at the phone viewport in desktop mode too, instead of duplicating its desktop sibling. */
  device?: "phone";
};

/** One user journey: a horizontal lane of screens read left to right. */
export type Flow = {
  id: string;
  title: string;
  subtitle?: string;
  /** Optional section this flow belongs to. Consecutive flows sharing a
   *  section render under one section band on the canvas and one grouped
   *  heading in slides — the flow's own title reads as the sub-section.
   *  Flows without one are unsectioned, exactly as before. */
  section?: string;
  screens: Screen[];
};

/** A branch in the Flow view (the reviewer, 2026-08-18): screen → screen, with the
 *  condition on the arrow ("Recognized at Activate", "Video visit"). Authored
 *  manually, never derived — a guessed branch on a branching chart reads as a
 *  real one. */
export type FlowEdge = {
  from: string;
  to: string;
  /** The condition that takes this branch, shown on the arrow. */
  label?: string;
};

/** One LANE of the Flow view (the reviewer, same day, second pass: "we need to decide
 *  how we branch… account vs linking needs to be a lane, since linking ends a
 *  flow. And each of the programs should be separate lanes. Feel free to
 *  duplicate pages on the flow chart if needed"). A lane is its own small
 *  graph with its own ending — one per program, one per linking outcome, one
 *  shared checkout — instead of one merged mega-graph. A screen may appear in
 *  as many lanes as need it (the router opens every program lane; the picks
 *  re-appear at the head of checkout): duplication is what keeps each lane a
 *  complete, readable story. Its node set is exactly the screens its edges
 *  touch. Flows no lane touches render as the linear chain they are on the
 *  canvas; screens from charted flows that no lane places are surfaced under
 *  "Not placed yet" rather than silently dropped. */
export type FlowLane = {
  id: string;
  title: string;
  subtitle?: string;
  /** Eyebrow grouping, like Flow.section. */
  section?: string;
  edges: FlowEdge[];
  /** Screens that exist ONLY on the flow chart (the reviewer, third pass: "it needs to
   *  be complete" — the weight walk is ~15 pages, the canvas frames 4). The
   *  canvas stays curated to the screens worth reviewing; the chart adds the
   *  in-between steps as lane-local frames, addressable by every lane on the
   *  page. They render like any frame (live page + capture cache) but aren't
   *  on the canvas/slides, so they can't hold pins or sign-offs. */
  screens?: Screen[];
};

/** One board page (like a a design tool page). Small projects use a single page. */
export type Page = {
  id: string;
  title: string;
  subtitle?: string;
  flows: Flow[];
  /** Authored Flow-view lanes — see FlowLane. */
  branchLanes?: FlowLane[];
};

export type ReviewProject = {
  name: string;
  /** Pinned storage namespace. The slug keys every Supabase row and localStorage entry, so
   *  deriving it from `name` makes a rename silently fork the board's data (it happened:
   *  the 2026-07-30 "__DS_PROJECT_NAME__" rename stranded new comments under a fresh slug until
   *  they were migrated back). Set it once; never change it with a rename. */
  slug?: string;
  pages: Page[];
  /** Default frame size for screens that don't set their own. */
  screen?: { w?: number; h?: number };
  /** Simulated browser viewports for live `url` frames (see LIVE_VIEWPORTS). */
  viewports?: Partial<Record<ViewportMode, { w: number; h: number }>>;
};

// --- events (the documentation layer, 2026-08-03) ----------------------------
//
// What the system DOES at each moment of the journey — emails sent, push/SMS
// notifications, webhooks fired, technical notes. Nothing is authored in code
// (the reviewer, third pass): reviewers ADD EVENTS on the board and they render
// directly below the screen. An event is a comment thread whose meta carries
// `docKind` — see AgentMeta below and events-ui.tsx.

export type DocKind = "email" | "push" | "sms" | "webhook" | "api" | "note";

// --- viewport simulation (live url frames) ----------------------------------

/** Which device the board is simulating. Desktop keeps each screen's own
 *  frame size; mobile swaps every frame to a phone frame. */
export type ViewportMode = "desktop" | "mobile";

/** The LAYOUT viewport a live page is rendered at, then scaled into the
 *  frame. A frame is ~960 CSS px wide, which most apps' breakpoints read as
 *  tablet — rendering at a real desktop width and scaling down is what makes
 *  the frame show the desktop design. Mobile renders 1:1. */
export const LIVE_VIEWPORTS: Record<ViewportMode, { w: number; h: number }> = {
  desktop: { w: 1440, h: 900 },
  mobile: { w: 390, h: 844 },
};

/** Frame size used for every screen in mobile mode. */
export const MOBILE_FRAME = { w: 390, h: 844 };

export const DEFAULT_SCREEN_W = 960;
export const DEFAULT_SCREEN_H = 600;

/** Off since 2026-09-18 (the reviewer): the per-screen Sign off / Needs work pills, the
 *  flow verdict and every dot or border they drove are hidden. Stored statuses
 *  are left alone, so turning this back on brings them all back. */
export const SHOW_REVIEW_STATUS = false;

/** What a frame adds above and around its page: the 40px title bar
 *  (`.rv-frame-head` in review.css is pinned to it) plus the frame's own
 *  1.5px border, top and bottom. Change them together. */
export const FRAME_CHROME_H = 40 + 3;

/** The FRAME's outer size. A screen's authored `h` is the height of its PAGE
 *  (844 for a phone), so the frame is that plus its title bar; without it the
 *  bar pushed the page down and the frame cut its bottom off (2026-09-18). */
export function screenSize(project: ReviewProject, s: Screen): { w: number; h: number } {
  return {
    w: s.w ?? project.screen?.w ?? DEFAULT_SCREEN_W,
    h: (s.h ?? project.screen?.h ?? DEFAULT_SCREEN_H) + FRAME_CHROME_H,
  };
}

/** Stable slug for storage keys, so two projects on one machine don't collide. Prefers the
 *  project's pinned `slug`; the name-derived fallback exists only for configs that predate it. */
export function projectSlug(project: ReviewProject): string {
  if (project.slug) return project.slug;
  return project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";
}

// --- comments ---------------------------------------------------------------

/** A pin either sticks to a spot on a screen (relative offset, so it travels
 *  when the flow is dragged) or to a fixed board coordinate on a page. */
export type CommentAnchor =
  | { type: "screen"; screenId: string; dx: number; dy: number }
  | { type: "world"; x: number; y: number; pageId: string };

/** Agents (skills) are first-class participants on the board, not a special case: they pin
 *  comments and reply in threads exactly like a person does. The ONLY thing that marks one is
 *  a leading "/" on the author — "/norm-dog", the skill that did the work, rather than "Claude",
 *  the model underneath it. That reads the way the user invoked it, and it keeps the author
 *  field a plain string, so nothing else in the snapshot schema has to know about agents. */
export function isAgent(author: string): boolean {
  return author.trim().startsWith("/");
}

/** Provenance for an agent-authored comment or reply: enough to find the context the change
 *  was made in without leaving the board. All optional — a human comment simply has none. */
export type AgentMeta = {
  /** The command the skill ran, e.g. "audit" or "harden". */
  command?: string;
  /** Repo-relative files the change touched. */
  files?: string[];
  /** How it was checked — "verified live at /intake", "build + lint clean", etc. */
  verified?: string;
  /** EVENT MARKER (2026-08-03): a thread carrying this is not a comment — it's
   *  a documentation EVENT ("confirmation email fires here") added via the +
   *  button below a screen. It rides the thread machinery (sync, snapshot,
   *  notifications, the triage feed) but renders in the screen's event list,
   *  never as a pin or in the Comments tab. Resolving one archives it off the
   *  canvas (delete removes it outright). */
  docKind?: DocKind;
};

/** A thread that is a documentation event, not a discussion comment. */
export function isDocNote(t: { meta?: AgentMeta }): boolean {
  return Boolean(t.meta?.docKind);
}

/** `image`, when present, is a downscaled data URL stored inline (no backend);
 *  it travels with the committed snapshot like the rest of the thread.
 *  `email` is the signed-in author's verified address (Supabase auth) — DB-only
 *  attribution: buildSnapshot() strips it so it never lands in the committed
 *  board JSON in git. Agent replies (author "/skill") never carry one.
 *  `mentions` is the same kind of data and gets the same treatment. */
export type CommentReply = {
  id: string;
  author: string;
  body: string;
  at: number;
  image?: string;
  meta?: AgentMeta;
  email?: string;
  /** Lowercased emails named in this body (see MENTIONS below). DB-only. */
  mentions?: string[];
};

/** `authorEmail`/`authorId` mirror the reply-level `email`: verified identity
 *  from Supabase auth, stored in DB columns, stripped from snapshots. They ride
 *  on the client type so a later upsert of the thread doesn't erase them. */
export type CommentThread = {
  id: string;
  anchor: CommentAnchor;
  author: string;
  body: string;
  at: number;
  resolved: boolean;
  replies: CommentReply[];
  image?: string;
  meta?: AgentMeta;
  authorEmail?: string;
  authorId?: string;
  /** Lowercased emails named in the top-level body. DB-only, like the others. */
  mentions?: string[];
};

export function uid(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// --- mentions ---------------------------------------------------------------
//
// A mention is stored twice on purpose: as plain "@Name" inside the body (so
// the text still reads correctly anywhere it lands — an email, the triage
// feed, a committed JSON with the emails stripped) and as a list of verified
// EMAILS beside it. The email list is what notifies, so a notification can
// never be conjured by typing an "@" — only by picking someone real.

/** A taggable person: the review_people directory row (see supabase/review-people-reads.sql). */
export type Person = {
  email: string;
  name: string;
  /** Their profile look, from Edit profile (review_people, synced from the
   *  account). Absent offline or before they have signed in. */
  userId?: string | null;
  color?: string | null;
  emoji?: string | null;
};

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Split a body into plain and mentioned runs, for highlighting. `names` are
 *  the display names this item actually mentioned — resolved from its stored
 *  emails, never guessed from the text, so a typed "@someone" stays plain. */
export function mentionSegments(body: string, names: string[]): { text: string; mention: boolean }[] {
  const unique = [...new Set(names.filter(Boolean))].sort((a, b) => b.length - a.length);
  if (unique.length === 0) return [{ text: body, mention: false }];
  const re = new RegExp(`@(?:${unique.map(escapeRe).join("|")})`, "g");
  const out: { text: string; mention: boolean }[] = [];
  let last = 0;
  for (const m of body.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ text: body.slice(last, i), mention: false });
    out.push({ text: m[0], mention: true });
    last = i + m[0].length;
  }
  if (last < body.length) out.push({ text: body.slice(last), mention: false });
  return out;
}

/** Longest a half-typed "@…" can get before we stop treating it as a mention —
 *  past this the person is writing prose with an @ in it, not picking a name. */
const MENTION_QUERY_MAX = 32;

/** The mention being typed at the caret, if any. A mention starts at a word
 *  boundary and may contain spaces (names do), which is why it needs a cap. */
export function mentionQueryAt(value: string, caret: number): { query: string; start: number } | null {
  const upto = value.slice(0, caret);
  const start = upto.lastIndexOf("@");
  if (start < 0) return null;
  if (start > 0 && !/\s/.test(upto[start - 1]!)) return null;
  const query = upto.slice(start + 1);
  if (query.length > MENTION_QUERY_MAX || /\n/.test(query)) return null;
  return { query, start };
}

/** Replace the half-typed query with the picked name; returns the new value
 *  and where the caret goes (after the trailing space, ready to keep typing). */
export function applyMention(
  value: string,
  start: number,
  caret: number,
  name: string,
): { value: string; caret: number } {
  const inserted = `@${name} `;
  return {
    value: value.slice(0, start) + inserted + value.slice(caret),
    caret: start + inserted.length,
  };
}

/** Rank the directory against a half-typed query: prefix matches first, then
 *  anything containing it. An empty query lists everyone (the "@" was just typed). */
export function matchPeople(people: Person[], query: string): Person[] {
  const q = query.trim().toLowerCase();
  if (!q) return people;
  const starts: Person[] = [];
  const contains: Person[] = [];
  for (const p of people) {
    const n = p.name.toLowerCase();
    if (n.startsWith(q) || p.email.startsWith(q)) starts.push(p);
    else if (n.includes(q)) contains.push(p);
  }
  return [...starts, ...contains];
}

// --- read state -------------------------------------------------------------

/** When this thread last had something new in it. */
export function lastActivityAt(t: CommentThread): number {
  return t.replies.reduce((max, r) => Math.max(max, r.at), t.at);
}

/** Who wrote the newest message — you don't have unread mail from yourself. */
function newestActor(t: CommentThread): { email?: string; name: string } {
  let at = t.at;
  let actor = { email: t.authorEmail, name: t.author };
  for (const r of t.replies) {
    if (r.at >= at) {
      at = r.at;
      actor = { email: r.email, name: r.author };
    }
  }
  return actor;
}

/** Unread = something has happened here since you last opened it, and it
 *  wasn't you who did it. `seen` is the stored activity timestamp (see
 *  useReads); absent means never opened.
 *
 *  `me` matches on the verified email where both sides have one, and falls back
 *  to the display name: an offline (localStorage) board has no emails at all,
 *  and "your own comment is unread mail from you" is wrong in every mode, not
 *  just the signed-in one. */
export function isUnread(
  t: CommentThread,
  seen: number | undefined,
  me: { email?: string; name?: string },
): boolean {
  if ((seen ?? 0) >= lastActivityAt(t)) return false;
  const actor = newestActor(t);
  if (me.email && actor.email) return actor.email.toLowerCase() !== me.email.toLowerCase();
  return !(me.name && actor.name && actor.name.trim() === me.name.trim());
}

// --- review triage ----------------------------------------------------------

export type ReviewStatus = "good" | "needs";

export type ReviewEntry = {
  status?: ReviewStatus;
  note?: string;
  /** Attribution: who set this status, and when (ms). Surfaced as a tooltip. */
  by?: string;
  at?: number;
  /** Verified email of the setter (Supabase auth). DB-only — stripped from snapshots. */
  byEmail?: string;
};

export type ReviewState = {
  /** Keyed by screen id. */
  screens: Record<string, ReviewEntry>;
  /** Keyed by flow id. */
  flows: Record<string, ReviewEntry>;
};

/** Severity order for rolling screen statuses up into a flow verdict. */
const SEVERITY: Record<ReviewStatus, number> = { good: 1, needs: 2 };

export function worstStatus(statuses: (ReviewStatus | undefined)[]): ReviewStatus | undefined {
  let worst: ReviewStatus | undefined;
  for (const s of statuses) {
    if (!s) continue;
    if (!worst || SEVERITY[s] > SEVERITY[worst]) worst = s;
  }
  return worst;
}

/** Ordered triage vocabulary. Clicking a flow verdict pill walks this ring. */
const STATUS_CYCLE: (ReviewStatus | undefined)[] = [undefined, "good", "needs"];

export function nextStatus(current: ReviewStatus | undefined): ReviewStatus | undefined {
  const i = STATUS_CYCLE.indexOf(current);
  return STATUS_CYCLE[(i + 1) % STATUS_CYCLE.length];
}

export const STATUS_LABEL: Record<ReviewStatus | "none", string> = {
  good: "Signed off",
  needs: "Needs work",
  none: "Unreviewed",
};

/** Legacy coercion: "broken" was retired from the vocabulary (the reviewer,
 *  2026-07-30) — stored entries from any source fold into "needs". */
export function coerceStatus(s: unknown): ReviewStatus | undefined {
  if (s === "good" || s === "needs") return s;
  if (s === "broken") return "needs";
  return undefined;
}

export function coerceReviewState(state: Partial<ReviewState>): ReviewState {
  const fix = (entries: Record<string, ReviewEntry> | undefined): Record<string, ReviewEntry> =>
    Object.fromEntries(
      Object.entries(entries ?? {}).map(([id, entry]) => {
        const status = coerceStatus(entry.status);
        return [id, status ? { ...entry, status } : { ...entry, status: undefined }];
      }),
    );
  return { screens: fix(state.screens), flows: fix(state.flows) };
}

// --- snapshot (the committed board file) -------------------------------------

export type ReviewSnapshot = {
  version: 1;
  exportedAt: string | null;
  comments: CommentThread[];
  reviews: ReviewState;
};

/** Emails stay in the database; the snapshot is committed to git and exported
 *  as shareable files, so verified addresses must never travel with it. */
function stripEntryEmails(entries: Record<string, ReviewEntry>): Record<string, ReviewEntry> {
  return Object.fromEntries(
    Object.entries(entries).map(([id, { byEmail: _byEmail, ...entry }]) => [id, entry]),
  );
}

export function buildSnapshot(comments: CommentThread[], reviews: ReviewState): ReviewSnapshot {
  // Keep resolved threads — `resolved: true` is an archive flag, not a delete.
  // `mentions` goes out with the emails: it IS a list of verified addresses.
  // The "@Name" text stays in the body, so a committed thread still reads
  // right; it just loses the highlight and the notification hook, both of
  // which only ever mattered in the live board.
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    comments: comments.map(({ authorEmail: _ae, authorId: _ai, mentions: _m, ...t }) => ({
      ...t,
      replies: t.replies.map(({ email: _e, mentions: _rm, ...r }) => r),
    })),
    reviews: {
      screens: stripEntryEmails(reviews.screens ?? {}),
      flows: stripEntryEmails(reviews.flows ?? {}),
    },
  };
}

export function parseSnapshot(raw: unknown): ReviewSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Partial<ReviewSnapshot>;
  if (obj.version !== 1) return null;
  if (!Array.isArray(obj.comments)) return null;
  const reviews = (obj.reviews ?? {}) as Partial<ReviewState>;
  return {
    version: 1,
    exportedAt: typeof obj.exportedAt === "string" ? obj.exportedAt : null,
    comments: obj.comments as CommentThread[],
    reviews: coerceReviewState(reviews),
  };
}

export const EMPTY_SNAPSHOT: ReviewSnapshot = {
  version: 1,
  exportedAt: null,
  comments: [],
  reviews: { screens: {}, flows: {} },
};

// --- small shared formatters --------------------------------------------------

/** Compact relative time: "Just now", "5m", "3h", "2d", else a short date. */
export function relTime(at: number): string {
  const s = Math.max(0, Math.floor((Date.now() - at) / 1000));
  if (s < 45) return "Just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function initialOf(name: string): string {
  // Strip an agent's leading "/" so "/norm-dog" initials as N, not "/".
  const trimmed = name.trim().replace(/^\/+/, "");
  return trimmed ? trimmed[0]!.toUpperCase() : "?";
}
