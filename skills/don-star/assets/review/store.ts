// Client-side state for the review board. Comments sync to Supabase when
// VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY are set (shared across clients);
// otherwise they stay in localStorage, seeded from the committed snapshot JSON
// so a board is still shareable with no backend. Reviewer name is blank until
// the person leaves their first comment — then we ask once and remember it.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  announceSelf,
  deleteRemoteThread,
  fetchPeople,
  fetchReads,
  markRemoteRead,
  fetchRemoteReviews,
  fetchRemoteThreads,
  isRemoteConfigured,
  logRemoteEvent,
  replaceRemoteReviews,
  subscribeRemoteReviews,
  subscribeRemoteThreads,
  upsertRemoteReview,
  upsertRemoteThread,
  upsertRemoteThreads,
} from "./db";
import {
  coerceReviewState,
  lastActivityAt,
  uid,
  type AgentMeta,
  type CommentAnchor,
  type CommentThread,
  type Person,
  type ReviewEntry,
  type ReviewSnapshot,
  type ReviewState,
} from "./model";

export { isRemoteConfigured };

// --- reviewer identity --------------------------------------------------------

/** Who is acting. With Supabase auth (src/auth/), `name` is the account's
 *  display name and `email`/`id` are the verified identity stamped onto every
 *  write. In the offline localStorage mode only `name` exists (see below). */
export type ReviewerIdentity = { name: string; email?: string; id?: string };

// OFFLINE MODE ONLY: with auth, the display name lives on the Supabase user.
// Name is blank until the first comment. Composer / reply UI ask once; we then
// persist so later comments from this browser carry the same name.
export function useReviewerName(slug: string) {
  const key = `rv:${slug}:reviewer`;
  const [name, setName] = useState(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem(key) ?? "";
  });
  const commit = useCallback(
    (next: string) => {
      const trimmed = next.trim();
      setName(trimmed);
      try {
        if (trimmed) window.localStorage.setItem(key, trimmed);
        else window.localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    },
    [key],
  );
  return [name, commit] as const;
}

// --- comments -------------------------------------------------------------------

/** Merge a seed (committed JSON / agent replies) into a base list without
 *  dropping either side's messages. Pin position + resolved stay with base;
 *  authored content + unseen replies always surface. */
function mergeThreads(base: CommentThread[], seed: CommentThread[]): CommentThread[] {
  const seedById = new Map(seed.map((t) => [t.id, t]));
  const merged = base.map((t) => {
    const file = seedById.get(t.id);
    if (!file) return t;
    const seen = new Set(t.replies.map((r) => r.id));
    const incoming = file.replies.filter((r) => !seen.has(r.id));
    return {
      ...t,
      author: file.author || t.author,
      body: file.body || t.body,
      meta: file.meta ?? t.meta,
      image: t.image ?? file.image,
      replies: incoming.length ? [...t.replies, ...incoming].sort((a, b) => a.at - b.at) : t.replies,
    };
  });
  const baseIds = new Set(base.map((t) => t.id));
  return [...merged, ...seed.filter((t) => !baseIds.has(t.id))];
}

function loadLocalThreads(key: string, seed: ReviewSnapshot): CommentThread[] {
  if (typeof window === "undefined") return seed.comments;
  let local: CommentThread[] | null = null;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw !== null) local = JSON.parse(raw) as CommentThread[];
  } catch {
    local = null;
  }
  if (local === null) return seed.comments;
  return mergeThreads(local, seed.comments);
}

export function useComments(slug: string, seed: ReviewSnapshot, identity: ReviewerIdentity) {
  const reviewerName = identity.name;
  const key = `rv:${slug}:comments`;
  const remote = isRemoteConfigured();
  const [threads, setThreads] = useState<CommentThread[]>(() =>
    remote ? seed.comments : loadLocalThreads(key, seed),
  );
  const [remoteReady, setRemoteReady] = useState(!remote);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  // Generation token so a stale fetch can't overwrite a newer one.
  const syncGen = useRef(0);
  // Threads this session deleted: a Realtime refresh or seed merge racing the
  // remote delete must not resurrect them.
  const deletedIds = useRef<Set<string>>(new Set());

  // Hydrate from Supabase (and one-time seed push when the table is empty).
  useEffect(() => {
    if (!remote) return;
    let cancelled = false;
    const gen = ++syncGen.current;
    void (async () => {
      const remoteThreads = await fetchRemoteThreads(slug);
      if (cancelled || gen !== syncGen.current) return;
      if (remoteThreads === null) {
        setRemoteError("Couldn't reach the comment server.");
        setThreads(loadLocalThreads(key, seed));
        setRemoteReady(true);
        return;
      }
      setRemoteError(null);
      const merged = mergeThreads(remoteThreads, seed.comments);
      setThreads(merged);
      // Committed agent threads/replies exist only in the JSON until some
      // browser pushes them up. Persisting the delta makes the DB the true
      // superset — and lets the reply-notification trigger see agent work
      // (supabase/review-notify.sql). Idempotent, so every client doing it
      // on boot is harmless.
      //
      // This is also the empty-table seed path. There used to be a separate
      // `remoteThreads.length === 0` branch that pushed seed.comments wholesale;
      // it was exactly equivalent (mergeThreads against an empty base returns the
      // seed, and every thread is then `!r`), but it upserted full rows by id with
      // no floor, so one bad read could write `replies: []` over live replies. The
      // delta filter below is that floor: a thread already in remote is only ever
      // pushed when the local copy has MORE replies, never fewer.
      const remoteById = new Map(remoteThreads.map((t) => [t.id, t]));
      const changed = merged.filter((t) => {
        const r = remoteById.get(t.id);
        return !r || t.replies.length > r.replies.length;
      });
      if (changed.length > 0) void upsertRemoteThreads(slug, changed);
      setRemoteReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, remote, key, seed]);

  // Live updates from other browsers.
  useEffect(() => {
    if (!remote || !remoteReady) return;
    return subscribeRemoteThreads(slug, (next) => {
      // Prefer the fresher of remote vs in-flight local (we may have just
      // optimistically added a thread the refresh hasn't caught yet).
      setThreads((prev) => mergeThreads(next, prev).filter((t) => !deletedIds.current.has(t.id)));
    });
  }, [slug, remote, remoteReady]);

  // Mirror to localStorage so a reload still has something if the network
  // blips, and so the offline/dev path stays unchanged.
  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(threads));
    } catch {
      /* ignore */
    }
  }, [key, threads]);

  const persist = useCallback(
    (thread: CommentThread) => {
      if (!remote) return;
      void upsertRemoteThread(slug, thread);
    },
    [remote, slug],
  );

  const add = useCallback(
    // `meta` marks special thread species — a doc note carries meta.docKind
    // (the docs section's + button) and rides everything else unchanged.
    (
      anchor: CommentAnchor,
      author: string,
      body: string,
      image?: string,
      meta?: AgentMeta,
      mentions?: string[],
    ): string => {
      const id = uid();
      const thread: CommentThread = {
        id,
        anchor,
        author,
        body,
        at: Date.now(),
        resolved: false,
        replies: [],
        image,
        meta,
        authorEmail: identity.email,
        authorId: identity.id,
        mentions: mentions?.length ? mentions : undefined,
      };
      setThreads((prev) => [...prev, thread]);
      persist(thread);
      logRemoteEvent(
        slug,
        meta?.docKind ? "doc-added" : "comment-added",
        id,
        author,
        {
          body: body.slice(0, 300),
          anchor: anchor.type === "screen" ? anchor.screenId : anchor.type,
          ...(meta?.docKind ? { docKind: meta.docKind } : null),
        },
        identity.email,
      );
      return id;
    },
    [persist, slug, identity.email, identity.id],
  );

  const reply = useCallback(
    (id: string, author: string, body: string, image?: string, mentions?: string[]) => {
      setThreads((prev) => {
        const next = prev.map((t) =>
          t.id === id
            ? {
                ...t,
                resolved: false,
                replies: [
                  ...t.replies,
                  {
                    id: uid(),
                    author,
                    body,
                    at: Date.now(),
                    image,
                    email: identity.email,
                    mentions: mentions?.length ? mentions : undefined,
                  },
                ],
              }
            : t,
        );
        const updated = next.find((t) => t.id === id);
        if (updated) persist(updated);
        return next;
      });
      logRemoteEvent(slug, "reply-added", id, author, { body: body.slice(0, 300) }, identity.email);
    },
    [persist, slug, identity.email],
  );

  const removeReply = useCallback(
    (id: string, replyId: string) => {
      setThreads((prev) => {
        const next = prev.map((t) =>
          t.id === id ? { ...t, replies: t.replies.filter((r) => r.id !== replyId) } : t,
        );
        const updated = next.find((t) => t.id === id);
        if (updated) persist(updated);
        return next;
      });
      logRemoteEvent(slug, "reply-deleted", id, reviewerName, { replyId }, identity.email);
    },
    [persist, slug, reviewerName, identity.email],
  );

  const setResolved = useCallback(
    (id: string, resolved: boolean) => {
      setThreads((prev) => {
        const next = prev.map((t) => (t.id === id ? { ...t, resolved } : t));
        const updated = next.find((t) => t.id === id);
        if (updated) persist(updated);
        return next;
      });
      logRemoteEvent(slug, resolved ? "comment-resolved" : "comment-reopened", id, reviewerName, undefined, identity.email);
    },
    [persist, slug, reviewerName, identity.email],
  );

  /** Delete a whole thread. Remembered for the session so a Realtime refresh
   *  racing the remote delete can't merge the thread back in. */
  const remove = useCallback(
    (id: string) => {
      deletedIds.current.add(id);
      setThreads((prev) => prev.filter((t) => t.id !== id));
      if (remote) void deleteRemoteThread(id);
      logRemoteEvent(slug, "comment-deleted", id, reviewerName, undefined, identity.email);
    },
    [remote, slug, reviewerName, identity.email],
  );

  /** Nudge a pin: deltas arrive in anchor units (screen-space px). */
  const move = useCallback(
    (id: string, ddx: number, ddy: number) => {
      setThreads((prev) => {
        const next = prev.map((t) =>
          t.id === id && t.anchor.type === "screen"
            ? { ...t, anchor: { ...t.anchor, dx: t.anchor.dx + ddx, dy: Math.max(0, t.anchor.dy + ddy) } }
            : t,
        );
        const updated = next.find((t) => t.id === id);
        if (updated) persist(updated);
        return next;
      });
      logRemoteEvent(slug, "comment-moved", id, reviewerName, undefined, identity.email);
    },
    [persist, slug, reviewerName, identity.email],
  );

  const replaceAll = useCallback(
    (next: CommentThread[]) => {
      setThreads(next);
      if (remote) void upsertRemoteThreads(slug, next);
      logRemoteEvent(slug, "comments-imported", null, reviewerName, { count: next.length }, identity.email);
    },
    [remote, slug, reviewerName, identity.email],
  );

  return {
    threads,
    add,
    reply,
    removeReply,
    setResolved,
    remove,
    move,
    replaceAll,
    remoteReady,
    remoteError,
    remote,
  };
}

// --- the people directory (who can be tagged) ------------------------------------

/** Everyone who has signed in — the @ menu's contents. Publishes your own row
 *  on the way in, so being taggable costs nothing but arriving. YOU are in the
 *  list: the picker drops you, but rendering an existing "@Jane" needs your
 *  name to resolve. Empty offline, which is right — with no server there is
 *  nobody to notify. */
export function usePeople(identity: ReviewerIdentity): Person[] {
  const [people, setPeople] = useState<Person[]>([]);
  const email = identity.email?.toLowerCase();
  const name = identity.name;

  useEffect(() => {
    if (!isRemoteConfigured() || !email || !name) return;
    let cancelled = false;
    announceSelf(email, name, identity.id);
    void fetchPeople().then((list) => {
      if (cancelled || !list) return;
      setPeople(list);
    });
    return () => {
      cancelled = true;
    };
  }, [email, name, identity.id]);

  return people;
}

// --- per-person read state -------------------------------------------------------

/** Which threads I've seen, and how far into each. Stored per verified email
 *  in Supabase so it follows me between browsers, mirrored to localStorage so
 *  a reload is instant and the offline board still works. Values are ACTIVITY
 *  timestamps, so `max` is always the correct merge of two copies. */
export function useReads(slug: string, identity: ReviewerIdentity) {
  const email = identity.email?.toLowerCase();
  // Namespaced by email as well as board: two people on one browser (it
  // happens on a shared demo machine) must not inherit each other's marks.
  const key = `rv:${slug}:reads:${email ?? "local"}`;
  const [seen, setSeen] = useState<Record<string, number>>(() => {
    if (typeof window === "undefined") return {};
    try {
      return JSON.parse(window.localStorage.getItem(key) ?? "{}") as Record<string, number>;
    } catch {
      return {};
    }
  });

  // Re-read the local copy when the key changes (sign-in resolves the email
  // after first render), then fold in whatever the server has.
  useEffect(() => {
    let cancelled = false;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) setSeen((prev) => mergeSeen(prev, JSON.parse(raw) as Record<string, number>));
    } catch {
      /* ignore */
    }
    if (!isRemoteConfigured() || !email) return;
    void fetchReads(email).then((remote) => {
      if (cancelled || !remote) return;
      setSeen((prev) => mergeSeen(prev, remote));
    });
    return () => {
      cancelled = true;
    };
  }, [key, email]);

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(seen));
    } catch {
      /* ignore */
    }
  }, [key, seen]);

  /** Mark a thread seen up to its newest activity. Idempotent — re-opening a
   *  thread nothing has happened in writes nothing. */
  const markRead = useCallback(
    (thread: CommentThread) => {
      const at = lastActivityAt(thread);
      setSeen((prev) => {
        if ((prev[thread.id] ?? 0) >= at) return prev;
        if (email) markRemoteRead(email, thread.id, at);
        return { ...prev, [thread.id]: at };
      });
    },
    [email],
  );

  const markAllRead = useCallback(
    (threads: CommentThread[]) => {
      setSeen((prev) => {
        const next = { ...prev };
        for (const t of threads) {
          const at = lastActivityAt(t);
          if ((next[t.id] ?? 0) >= at) continue;
          next[t.id] = at;
          if (email) markRemoteRead(email, t.id, at);
        }
        return next;
      });
    },
    [email],
  );

  return { seen, markRead, markAllRead };
}

function mergeSeen(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const out = { ...a };
  for (const [id, at] of Object.entries(b)) out[id] = Math.max(out[id] ?? 0, at);
  return out;
}

// --- review triage ---------------------------------------------------------------

function loadReviews(key: string, seed: ReviewSnapshot): ReviewState {
  const fromSeed = () => ({
    screens: seed.reviews.screens ?? {},
    flows: seed.reviews.flows ?? {},
  });
  if (typeof window === "undefined") return fromSeed();
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fromSeed();
    const parsed = JSON.parse(raw) as Partial<ReviewState>;
    return coerceReviewState(parsed);
  } catch {
    return { screens: {}, flows: {} };
  }
}

export function useReviews(slug: string, seed: ReviewSnapshot, identity: ReviewerIdentity) {
  const reviewerName = identity.name;
  const key = `rv:${slug}:reviews`;
  const remote = isRemoteConfigured();
  const [state, setState] = useState<ReviewState>(() =>
    remote ? (seed.reviews ?? { screens: {}, flows: {} }) : loadReviews(key, seed),
  );
  const reviewsGen = useRef(0);

  // Hydrate triage from Supabase (one-time seed push when the table is empty),
  // then follow other browsers' changes live. Statuses are simple last-write
  // rows, so remote state replaces wholesale — no per-entry merging.
  useEffect(() => {
    if (!remote) return;
    let cancelled = false;
    const gen = ++reviewsGen.current;
    void (async () => {
      const remoteState = await fetchRemoteReviews(slug);
      if (cancelled || gen !== reviewsGen.current) return;
      if (remoteState === null) {
        setState(loadReviews(key, seed));
        return;
      }
      const empty = Object.keys(remoteState.screens).length === 0 && Object.keys(remoteState.flows).length === 0;
      const seedState = seed.reviews ?? { screens: {}, flows: {} };
      const seedHas = Object.keys(seedState.screens ?? {}).length > 0 || Object.keys(seedState.flows ?? {}).length > 0;
      if (empty && seedHas) {
        await replaceRemoteReviews(slug, seedState);
        if (cancelled || gen !== reviewsGen.current) return;
        setState(seedState);
      } else {
        setState(remoteState);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, remote, key, seed]);

  useEffect(() => {
    if (!remote) return;
    return subscribeRemoteReviews(slug, setState);
  }, [slug, remote]);

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(state));
    } catch {
      // Full or unavailable storage: keep the in-memory copy, nothing to do.
    }
  }, [key, state]);

  const patch = useCallback(
    (scope: "screens" | "flows", id: string, next: ReviewEntry) => {
      setState((prev) => {
        // A status change carries attribution; clearing drops the entry whole.
        const stamped: ReviewEntry = next.status
          ? { ...next, by: reviewerName.trim() || undefined, at: Date.now(), byEmail: identity.email }
          : next;
        const merged = { ...prev[scope][id], ...stamped };
        // Drop empty entries so counts and the committed JSON stay clean.
        const cleaned = { ...prev[scope] };
        const cleared = !merged.status && !merged.note;
        if (cleared) delete cleaned[id];
        else cleaned[id] = merged;
        if (remote) void upsertRemoteReview(slug, scope, id, cleared ? null : merged);
        return { ...prev, [scope]: cleaned };
      });
      // Outside the updater: StrictMode double-invokes updaters in dev, and
      // the log is append-only — a duplicate row would be a lie.
      logRemoteEvent(
        slug,
        next.status ? "status-set" : "status-cleared",
        id,
        reviewerName,
        {
          scope,
          ...(next.status ? { status: next.status } : null),
        },
        identity.email,
      );
    },
    [remote, slug, reviewerName, identity.email],
  );

  const setScreen = useCallback((id: string, next: ReviewEntry) => patch("screens", id, next), [patch]);
  const setFlow = useCallback((id: string, next: ReviewEntry) => patch("flows", id, next), [patch]);
  const resetAll = useCallback(() => {
    const empty = { screens: {}, flows: {} };
    setState(empty);
    if (remote) void replaceRemoteReviews(slug, empty);
    logRemoteEvent(slug, "reviews-cleared", null, reviewerName, undefined, identity.email);
  }, [remote, slug, reviewerName, identity.email]);
  const replaceAll = useCallback(
    (next: ReviewState) => {
      const clean = { screens: next.screens ?? {}, flows: next.flows ?? {} };
      setState(clean);
      if (remote) void replaceRemoteReviews(slug, clean);
      logRemoteEvent(
        slug,
        "reviews-replaced",
        null,
        reviewerName,
        {
          screens: Object.keys(clean.screens).length,
          flows: Object.keys(clean.flows).length,
        },
        identity.email,
      );
    },
    [remote, slug, reviewerName, identity.email],
  );

  return { reviews: state, setScreen, setFlow, resetAll, replaceAll };
}

// --- layout overrides (dragged flow lanes) -----------------------------------------

export type Point = { x: number; y: number };

export function useLayoutOverrides(slug: string) {
  const key = `rv:${slug}:layout`;
  const [overrides, setOverrides] = useState<Record<string, Point>>(() => {
    if (typeof window === "undefined") return {};
    try {
      return JSON.parse(window.localStorage.getItem(key) ?? "{}") as Record<string, Point>;
    } catch {
      return {};
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(overrides));
    } catch {
      /* ignore */
    }
  }, [key, overrides]);

  const move = useCallback((flowId: string, p: Point) => {
    setOverrides((prev) => ({ ...prev, [flowId]: p }));
  }, []);

  const reset = useCallback(() => setOverrides({}), []);

  return { overrides, move, reset };
}
