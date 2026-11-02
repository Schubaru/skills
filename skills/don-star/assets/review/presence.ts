// Multiplayer presence for the review board (canvas-style): who else is on this
// board, where their cursor is, and a follow mode that drives your view from
// theirs. Rides the Supabase realtime socket the board already opens for
// threads and statuses (db.ts) — one channel per project, no new service.
//
// The shape of it:
//   · PRESENCE (track) says who is here and where: page, view, slide. It is the
//     avatar row. A hidden member ("Show me to others" off) tracks only a
//     nameless Watcher: counted as an audience, shown nowhere.
//   · BROADCAST `cursor` is the pointer, in the coordinates of whatever surface
//     the sender is looking at (see SURFACE below). Never stored, and never
//     sent to a surface nobody else is on; its rate falls as the audience
//     grows (`cursorInterval`), since each listener costs a message.
//   · BROADCAST `view` is the camera, sent only while someone follows you.
//   · BROADCAST `chat` is cursor chat (press /): the line being typed, live,
//     and the last line sent. BROADCAST `react` is a reaction (press E) fired
//     at a point on the surface, drawn as a burst. Both ephemeral like the cursor.
//
// Nothing here is persisted and nothing carries an email or PHI: a member is a
// user id, a display name and a colour. Agents (isAgent) never appear.
//
// SURFACE: every view mounts exactly one element carrying
// `data-presence-surface="<key>"` and `data-presence-scale="<n>"` — the canvas
// and flow worlds, the slides frame box. A cursor is (x, y) in that element's
// unscaled space, so it lands on the same pixel of the same screen for everyone
// whatever their zoom, pan or window size. A cursor on a different surface key
// is simply not drawn.

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabase } from "../auth/client";
import {
  cleanEmoji,
  cursorInterval,
  isAway,
  isWatcher,
  listenersOn,
  surfaceKey,
  isReaction,
  cleanChat,
  validColor,
  REACTIONS_PER_SEC,
  byActivity,
  colorIndex,
  followersOf,
  peersFrom,
  type ChatMessage,
  type Cursor,
  type Peer,
  type Reaction,
  type PeerMeta,
  type PresenceColor,
  type Place,
  type View,
  type ViewMessage,
  type Watcher,
} from "./presence-model";

export * from "./presence-model";

/** How often I check whether I've gone away (a background tab may stretch it
 *  to a minute; the rule is ten). */
const AWAY_CHECK_MS = 15_000;
/** How often the avatar row re-reads who was active last. */
const RANK_MS = 2000;
/** Chat send cadence: every keystroke, at most this often. (The cursor's
 *  adapts to the audience: presence-model `cursorInterval`.) */
const CHAT_MS = 100;
/** Leader camera poll while followed. */
const VIEW_MS = 100;

function newTabId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
}

// --- the DOM surface -------------------------------------------------------------

const SURFACE_SEL = "[data-presence-surface]";

/** Client point → the mounted surface's coordinates, or null off-surface. */
export function toSurface(clientX: number, clientY: number): { surface: string; x: number; y: number } | null {
  const el = document.querySelector<HTMLElement>(SURFACE_SEL);
  if (!el) return null;
  const clip = el.closest<HTMLElement>(".rv-canvas, .rv-slides-stage");
  if (clip) {
    const c = clip.getBoundingClientRect();
    if (clientX < c.left || clientX > c.right || clientY < c.top || clientY > c.bottom) return null;
  }
  const r = el.getBoundingClientRect();
  const scale = Number(el.dataset.presenceScale) || 1;
  return { surface: el.dataset.presenceSurface ?? "", x: (clientX - r.left) / scale, y: (clientY - r.top) / scale };
}

/** The mounted surface, measured: where it sits, its scale and its clip box.
 *  Measure ONCE per frame and map every point with `onBox`; measuring per
 *  point between style writes makes the browser lay the page out each time. */
export type SurfaceBox = { surface: string; left: number; top: number; scale: number; clip: DOMRect | null };
export function surfaceBox(): SurfaceBox | null {
  const el = document.querySelector<HTMLElement>(SURFACE_SEL);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    surface: el.dataset.presenceSurface ?? "",
    left: r.left,
    top: r.top,
    scale: Number(el.dataset.presenceScale) || 1,
    clip: el.closest<HTMLElement>(".rv-canvas, .rv-slides-stage")?.getBoundingClientRect() ?? null,
  };
}
/** Surface point → client point on a measured box, or null on another surface. */
export function onBox(box: SurfaceBox | null, surface: string, x: number, y: number) {
  if (!box || box.surface !== surface) return null;
  return { x: box.left + x * box.scale, y: box.top + y * box.scale, clip: box.clip };
}
/** Surface point → client point, plus the clip box it must stay inside. */
export function fromSurface(surface: string, x: number, y: number): { x: number; y: number; clip: DOMRect | null } | null {
  return onBox(surfaceBox(), surface, x, y);
}

/** The middle of the board I'm looking at (where chat opens when my pointer
 *  is off it), or null with no surface mounted. */
export function boardCenter(): { x: number; y: number } | null {
  const el = document.querySelector<HTMLElement>(SURFACE_SEL);
  if (!el) return null;
  const r = (el.closest<HTMLElement>(".rv-canvas, .rv-slides-stage") ?? el).getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

// --- the hook --------------------------------------------------------------------

export type PresenceApi = {
  /** False offline (no Supabase) — render nothing. */
  enabled: boolean;
  tab: string;
  /** Everyone else here, most recently active first (the avatar row). */
  peers: Peer[];
  /** The same people A to Z (the flyout). */
  everyone: Peer[];
  /** Latest cursor per remote tab. Read in a rAF loop, not rendered from. */
  cursorsRef: MutableRefObject<Map<string, Cursor>>;
  /** Every live entry, for colour/name lookups by tab. */
  entriesRef: MutableRefObject<Map<string, PeerMeta>>;
  /** The tab I'm following (and their latest camera), or null. */
  following: Peer | null;
  leaderView: ViewMessage | null;
  follow: (peer: Peer | null) => void;
  /** People following me right now. */
  followers: PeerMeta[];
  /** Latest chat per remote tab. Read in the cursors' rAF loop. */
  chatsRef: MutableRefObject<Map<string, ChatMessage>>;
  /** Reactions to draw, mine and everyone's; the cursors' loop drains it. */
  reactionsRef: MutableRefObject<Reaction[]>;
  /** My pointer, client coordinates (frames mapped out), or null. */
  pointerRef: MutableRefObject<{ x: number; y: number } | null>;
  /** Put my cursor at a client point without a pointer move (chat opened
   *  from the keyboard with the pointer off the board). */
  park: (clientX: number, clientY: number) => void;
  /** Say what I'm typing and what I last sent (text "" and sent null = done). */
  sendChat: (text: string, sent: string | null) => void;
  /** Fire a reaction at a client point. False off the board (nowhere to land). */
  react: (emoji: Reaction["emoji"], clientX: number, clientY: number) => boolean;
  /** Set by the cursors' layer: takes a tab's reactions off my screen NOW
   *  ("*" = everyone's), drawn or still waiting. */
  reactClearRef: MutableRefObject<((tab: string) => void) | null>;
  /** Escape: every reaction on my screen goes, and mine go on everyone's. */
  stopReactions: () => void;
};

export function usePresence({
  slug,
  me,
  hidden,
  place,
  getView,
}: {
  slug: string;
  /** Null offline. */
  /** Null offline. `color`/`emoji` null = the defaults (hashed colour, initial). */
  me: { uid: string; name: string; color: PresenceColor | null; emoji: string | null } | null;
  /** "Show me to others" off: see everyone, be seen by no one. */
  hidden: boolean;
  place: Place;
  /** The current camera, read while someone follows me. */
  getView: () => { view: View | null; slideZoom: number };
}): PresenceApi {
  const sb = me ? getSupabase() : null;
  const enabled = Boolean(sb && me);
  const tab = useMemo(newTabId, []);
  const [entries, setEntries] = useState<PeerMeta[]>([]);
  const entriesRef = useRef(new Map<string, PeerMeta>());
  const cursorsRef = useRef(new Map<string, Cursor>());
  const chatsRef = useRef(new Map<string, ChatMessage>());
  const reactionsRef = useRef<Reaction[]>([]);
  const reactClearRef = useRef<((tab: string) => void) | null>(null);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const parkRef = useRef<(x: number, y: number) => void>(() => {});
  /** When each tab last did something, on MY clock: a cursor move, or a change
   *  of place (a new presence `at`). Drives the avatar row's order. */
  const activeRef = useRef(new Map<string, number>());
  const seenAtRef = useRef(new Map<string, number>());
  const channelRef = useRef<RealtimeChannel | null>(null);
  const joinedRef = useRef(false);
  const [followTab, setFollowTab] = useState<string | null>(null);
  const [leaderView, setLeaderView] = useState<ViewMessage | null>(null);
  const followTabRef = useRef(followTab);
  followTabRef.current = followTab;

  const meta = useMemo<PeerMeta | null>(
    () =>
      me
        ? {
            tab,
            uid: me.uid,
            name: me.name,
            color: me.color ?? colorIndex(me.uid),
            emoji: me.emoji,
            following: followTab,
            at: Date.now(),
            pageId: place.pageId,
            mode: place.mode,
            screenId: place.screenId,
          }
        : null,
    [me, tab, followTab, place.pageId, place.mode, place.screenId],
  );
  const metaRef = useRef(meta);
  metaRef.current = meta;
  // Hidden, I still count as an audience, nameless (presence-model `Watcher`).
  const watcher = useMemo<Watcher>(
    () => ({ tab, watcher: true, at: Date.now(), pageId: place.pageId, mode: place.mode, screenId: place.screenId }),
    [tab, place.pageId, place.mode, place.screenId],
  );
  const watcherRef = useRef(watcher);
  watcherRef.current = watcher;
  /** Every other tab on the channel (people and hidden watchers) → the
   *  surface it looks at. Nothing is sent to a surface nobody is on. */
  const audienceRef = useRef(new Map<string, string>());
  const listeners = (surface: string) => listenersOn(surface, audienceRef.current.values());
  const hiddenRef = useRef(hidden);
  hiddenRef.current = hidden;
  const awayRef = useRef(false);

  // The channel: one per project, rebuilt only when the project or person changes.
  const uid = me?.uid;
  useEffect(() => {
    if (!sb || !uid) return;
    // Private: RLS on realtime.messages admits only people who can open this
    // project (supabase/review-presence.sql), with the signed-in session's JWT.
    const ch = sb.channel(`review-presence:${slug}`, {
      config: { private: true, presence: { key: tab }, broadcast: { self: false } },
    });
    channelRef.current = ch;
    const cursors = cursorsRef.current;
    const chats = chatsRef.current;
    const active = activeRef.current;
    const seenAt = seenAtRef.current;
    ch.on("presence", { event: "sync" }, () => {
      const state = ch.presenceState<PeerMeta | Watcher>();
      const next = new Map<string, PeerMeta>();
      const audience = new Map<string, string>();
      for (const list of Object.values(state)) {
        const top = list.reduce<PeerMeta | Watcher | null>((a, b) => (!a || b.at > a.at ? b : a), null);
        if (!top || top.tab === tab) continue;
        audience.set(top.tab, surfaceKey(top));
        if (isWatcher(top)) continue;
        const latest: PeerMeta = top;
        // A look is checked on arrival: a colour outside the palette falls back
        // to the hashed one, an avatar is one emoji or nothing.
        next.set(latest.tab, {
          ...latest,
          color: validColor(latest.color) ?? colorIndex(latest.uid),
          emoji: cleanEmoji(latest.emoji),
        });
      }
      entriesRef.current = next;
      audienceRef.current = audience;
      const now = Date.now();
      for (const [k, e] of next) {
        if (seenAt.get(k) !== e.at) active.set(k, now);
        seenAt.set(k, e.at);
      }
      for (const k of [...seenAt.keys()]) {
        if (!next.has(k)) {
          seenAt.delete(k);
          active.delete(k);
        }
      }
      // A cursor whose tab left goes with it, and its chat.
      for (const k of cursorsRef.current.keys()) if (!next.has(k)) cursorsRef.current.delete(k);
      for (const k of chatsRef.current.keys()) if (!next.has(k)) chatsRef.current.delete(k);
      setEntries([...next.values()]);
    });
    ch.on("broadcast", { event: "cursor" }, ({ payload }) => {
      const c = payload as Cursor;
      if (!c?.tab) return;
      if (c.surface == null) cursorsRef.current.delete(c.tab);
      else cursorsRef.current.set(c.tab, { ...c, at: Date.now() });
      active.set(c.tab, Date.now());
    });
    ch.on("broadcast", { event: "chat" }, ({ payload }) => {
      const m = payload as Partial<ChatMessage> | null;
      if (!m || typeof m.tab !== "string") return;
      const sent = cleanChat(m.sent);
      chatsRef.current.set(m.tab, { tab: m.tab, text: cleanChat(m.text), sent: sent || null, at: Date.now() });
      active.set(m.tab, Date.now());
    });
    // Checked like a look: a reaction is one of the wheel's, at a number.
    const heard = new Map<string, number[]>();
    ch.on("broadcast", { event: "react" }, ({ payload }) => {
      const r = payload as Partial<Reaction> | null;
      if (!r || typeof r.tab !== "string" || !isReaction(r.emoji) || typeof r.surface !== "string") return;
      if (!Number.isFinite(r.x) || !Number.isFinite(r.y)) return;
      // A flood from one tab is cut at the sender's own rate.
      const now = Date.now();
      const recent = (heard.get(r.tab) ?? []).filter((t) => now - t < 1000);
      if (recent.length >= REACTIONS_PER_SEC) return;
      heard.set(r.tab, [...recent, now]);
      reactionsRef.current.push({ tab: r.tab, emoji: r.emoji, surface: r.surface, x: r.x!, y: r.y! });
      active.set(r.tab, now);
    });
    ch.on("broadcast", { event: "react-stop" }, ({ payload }) => {
      const t = (payload as { tab?: unknown } | null)?.tab;
      if (typeof t === "string" && t !== "*") reactClearRef.current?.(t);
    });
    ch.on("broadcast", { event: "view" }, ({ payload }) => {
      const v = payload as ViewMessage;
      if (v?.tab && v.tab === followTabRef.current) setLeaderView(v);
    });
    ch.subscribe((status) => {
      if (status !== "SUBSCRIBED") return;
      joinedRef.current = true;
      if (awayRef.current || !metaRef.current) return;
      void ch.track(hiddenRef.current ? watcherRef.current : metaRef.current);
    });
    return () => {
      joinedRef.current = false;
      channelRef.current = null;
      cursors.clear();
      chats.clear();
      active.clear();
      seenAt.clear();
      entriesRef.current = new Map();
      audienceRef.current = new Map();
      setEntries([]);
      void sb.removeChannel(ch);
    };
  }, [sb, slug, uid, tab]);

  // Away: ten minutes with no input (a background tab gets none), and I leave
  // everyone's row until my next move, scroll, key or return to the tab.
  const [away, setAway] = useState(false);
  awayRef.current = away;
  const followingRef = useRef(false);
  followingRef.current = followTab !== null;
  useEffect(() => {
    if (!enabled) return;
    let lastInput = Date.now();
    const mark = () => {
      lastInput = Date.now();
      setAway(false);
    };
    const check = () =>
      setAway(
        isAway({
          lastInput,
          now: Date.now(),
          visible: document.visibilityState === "visible",
          following: followingRef.current,
        }),
      );
    const onVis = () => (document.visibilityState === "visible" ? mark() : check());
    const EVENTS = ["pointermove", "pointerdown", "wheel", "keydown"] as const;
    for (const ev of EVENTS) window.addEventListener(ev, mark, { passive: true, capture: true });
    document.addEventListener("visibilitychange", onVis);
    // Frames: the slides stage takes input inside its own document.
    const framed = new Map<Document, () => void>();
    const scan = () => {
      for (const frame of Array.from(document.querySelectorAll("iframe"))) {
        let doc: Document | null = null;
        try {
          doc = frame.contentDocument;
        } catch {
          continue;
        }
        if (!doc || framed.has(doc)) continue;
        const d = doc;
        for (const ev of EVENTS) d.addEventListener(ev, mark, { passive: true, capture: true });
        framed.set(d, () => {
          for (const ev of EVENTS) d.removeEventListener(ev, mark, { capture: true });
        });
      }
      for (const [doc, off] of framed) {
        if (!doc.defaultView) {
          off();
          framed.delete(doc);
        }
      }
    };
    scan();
    const scanId = window.setInterval(scan, 1500);
    const checkId = window.setInterval(check, AWAY_CHECK_MS);
    return () => {
      for (const ev of EVENTS) window.removeEventListener(ev, mark, { capture: true });
      document.removeEventListener("visibilitychange", onVis);
      window.clearInterval(scanId);
      window.clearInterval(checkId);
      for (const off of framed.values()) off();
    };
  }, [enabled]);

  // Keep my entry current (or absent, when hidden or away).
  useEffect(() => {
    const ch = channelRef.current;
    if (!ch || !joinedRef.current || !meta) return;
    if (away) void ch.untrack();
    else void ch.track(hidden ? watcher : meta);
  }, [meta, watcher, hidden, away]);

  // My cursor: the parent document plus every same-origin frame inside it (the
  // slides stage is interactive, so the pointer lives in the frame there).
  useEffect(() => {
    if (!enabled || hidden) return;
    let last = 0;
    let trailing: number | undefined;
    let pending: Cursor | null = null;
    // The surface my last sent cursor was on, so leaving it is said once.
    let shownOn: string | null = null;
    const flush = () => {
      trailing = undefined;
      const ch = channelRef.current;
      if (!ch || !joinedRef.current || !pending) return;
      last = Date.now();
      shownOn = pending.surface;
      void ch.send({ type: "broadcast", event: "cursor", payload: pending });
      pending = null;
    };
    const post = (c: Cursor) => {
      // Nobody on the surface: nothing to send (and it costs a message each).
      const n = c.surface ? listeners(c.surface) : shownOn ? 1 : 0;
      if (n === 0) {
        pending = null;
        if (c.surface == null) shownOn = null;
        return;
      }
      pending = c;
      const wait = cursorInterval(n) - (Date.now() - last);
      if (wait <= 0) flush();
      else if (trailing === undefined) trailing = window.setTimeout(flush, wait);
    };
    const gone = () => post({ tab, surface: null, x: 0, y: 0, at: Date.now() });
    const at = (clientX: number, clientY: number) => {
      pointerRef.current = { x: clientX, y: clientY };
      const s = toSurface(clientX, clientY);
      if (!s) gone();
      else post({ tab, surface: s.surface, x: s.x, y: s.y, at: Date.now() });
    };
    parkRef.current = at;
    const onMove = (e: PointerEvent) => at(e.clientX, e.clientY);
    const onOut = (e: MouseEvent) => {
      if (!e.relatedTarget) gone();
    };
    const onVis = () => {
      if (document.visibilityState === "hidden") gone();
    };
    window.addEventListener("pointermove", onMove, { passive: true, capture: true });
    document.addEventListener("mouseout", onOut);
    document.addEventListener("visibilitychange", onVis);

    // Frames: attach once per document (a navigation brings a new one).
    const framed = new Map<Document, () => void>();
    const scan = () => {
      for (const frame of Array.from(document.querySelectorAll("iframe"))) {
        let doc: Document | null = null;
        try {
          doc = frame.contentDocument;
        } catch {
          continue;
        }
        if (!doc || framed.has(doc)) continue;
        const f = frame;
        const move = (e: PointerEvent) => {
          const r = f.getBoundingClientRect();
          const k = f.offsetWidth ? r.width / f.offsetWidth : 1;
          at(r.left + e.clientX * k, r.top + e.clientY * k);
        };
        doc.addEventListener("pointermove", move, { passive: true });
        framed.set(doc, () => doc!.removeEventListener("pointermove", move));
      }
      for (const [doc, off] of framed) {
        if (!doc.defaultView) {
          off();
          framed.delete(doc);
        }
      }
    };
    scan();
    const scanId = window.setInterval(scan, 1500);

    return () => {
      window.removeEventListener("pointermove", onMove, { capture: true });
      document.removeEventListener("mouseout", onOut);
      document.removeEventListener("visibilitychange", onVis);
      window.clearInterval(scanId);
      for (const off of framed.values()) off();
      if (trailing !== undefined) window.clearTimeout(trailing);
      parkRef.current = () => {};
      gone();
      flush();
    };
  }, [enabled, hidden, tab]);
  const park = useCallback((x: number, y: number) => parkRef.current(x, y), []);

  // Leading: while anyone follows me, send my camera when it changes.
  const followers = useMemo(() => followersOf(entries, tab), [entries, tab]);
  const getViewRef = useRef(getView);
  getViewRef.current = getView;
  const followed = followers.length > 0 && !hidden;
  useEffect(() => {
    if (!followed) return;
    let lastSent = "";
    const tick = () => {
      const ch = channelRef.current;
      const m = metaRef.current;
      if (!ch || !joinedRef.current || !m) return;
      const { view, slideZoom } = getViewRef.current();
      const msg: ViewMessage = { tab, pageId: m.pageId, mode: m.mode, screenId: m.screenId, view, slideZoom };
      const key = JSON.stringify({ ...msg, view: view && [view.cx, view.cy, view.w, view.h].map(Math.round) });
      if (key === lastSent) return;
      lastSent = key;
      void ch.send({ type: "broadcast", event: "view", payload: msg });
    };
    // Re-run per follower count, so a new follower gets the camera at once.
    tick();
    const id = window.setInterval(tick, VIEW_MS);
    return () => window.clearInterval(id);
  }, [followed, followers.length, tab]);

  // Everyone here, A to Z (the flyout), and the same people most recently
  // active first (the avatar row). The order is re-read on a slow tick so the
  // row settles rather than flickering with every cursor move.
  const everyone = useMemo(() => (me ? peersFrom(entries, me.uid) : []), [entries, me]);
  const [rank, setRank] = useState<string>("");
  useEffect(() => {
    if (everyone.length < 2) return;
    const read = () => {
      const byUid = new Map<string, number>();
      for (const [k, t] of activeRef.current) {
        const u = entriesRef.current.get(k)?.uid;
        if (u && t > (byUid.get(u) ?? 0)) byUid.set(u, t);
      }
      const next = byActivity(everyone, byUid)
        .map((p) => p.uid)
        .join(",");
      setRank((r) => (r === next ? r : next));
    };
    read();
    const id = window.setInterval(read, RANK_MS);
    return () => window.clearInterval(id);
  }, [everyone]);
  const peers = useMemo(() => {
    const order = rank.split(",");
    const at = (uid: string) => {
      const i = order.indexOf(uid);
      return i < 0 ? order.length : i;
    };
    return [...everyone].sort((a, b) => at(a.uid) - at(b.uid));
  }, [everyone, rank]);

  // Following: by person, pinned to the tab they had when I clicked. If that
  // tab leaves, follow ends.
  const following = useMemo(
    () => (followTab ? (entries.find((e) => e.tab === followTab) ?? null) : null),
    [entries, followTab],
  );
  useEffect(() => {
    if (followTab && entries.length && !entries.some((e) => e.tab === followTab)) {
      setFollowTab(null);
      setLeaderView(null);
    }
  }, [entries, followTab]);

  const follow = useCallback((peer: Peer | null) => {
    setLeaderView(null);
    setFollowTab(peer ? peer.tab : null);
  }, []);

  // Cursor chat: every change of the line goes out (throttled, the last one
  // always lands), so others watch it being typed.
  const chatTimer = useRef<number | undefined>(undefined);
  const chatPending = useRef<ChatMessage | null>(null);
  const chatLast = useRef(0);
  const sendChat = useCallback(
    (text: string, sent: string | null) => {
      chatPending.current = { tab, text: cleanChat(text), sent: sent ? cleanChat(sent) : null, at: Date.now() };
      const flush = () => {
        chatTimer.current = undefined;
        const ch = channelRef.current;
        const m = chatPending.current;
        if (!ch || !joinedRef.current || !m || hiddenRef.current || audienceRef.current.size === 0) return;
        chatLast.current = Date.now();
        chatPending.current = null;
        void ch.send({ type: "broadcast", event: "chat", payload: m });
      };
      const wait = CHAT_MS - (Date.now() - chatLast.current);
      if (wait <= 0) flush();
      else if (chatTimer.current === undefined) chatTimer.current = window.setTimeout(flush, wait);
    },
    [tab],
  );

  // Reactions: drawn here at once, sent to everyone on the same surface.
  const reactSent = useRef<number[]>([]);
  const react = useCallback(
    (emoji: Reaction["emoji"], clientX: number, clientY: number) => {
      const s = toSurface(clientX, clientY);
      if (!s) return false;
      const now = Date.now();
      reactSent.current = reactSent.current.filter((t) => now - t < 1000);
      if (reactSent.current.length >= REACTIONS_PER_SEC) return true;
      reactSent.current.push(now);
      const r: Reaction = { tab, emoji, surface: s.surface, x: s.x, y: s.y };
      reactionsRef.current.push(r);
      const ch = channelRef.current;
      if (ch && joinedRef.current && !hiddenRef.current && listeners(s.surface) > 0)
        void ch.send({ type: "broadcast", event: "react", payload: r });
      return true;
    },
    [tab],
  );
  const stopReactions = useCallback(() => {
    reactClearRef.current?.("*");
    const ch = channelRef.current;
    if (ch && joinedRef.current && !hiddenRef.current && audienceRef.current.size > 0)
      void ch.send({ type: "broadcast", event: "react-stop", payload: { tab } });
  }, [tab]);

  return {
    enabled,
    tab,
    peers,
    everyone,
    cursorsRef,
    entriesRef,
    following,
    leaderView,
    follow,
    followers,
    chatsRef,
    reactionsRef,
    pointerRef,
    park,
    sendChat,
    react,
    reactClearRef,
    stopReactions,
  };
}
