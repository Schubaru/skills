// The canvas's state: what's loaded, what's selected, what's unsaved, and what
// happens when two people edit the same diagram.
//
// Autosave is debounced rather than manual — a Save button on a thinking tool
// is a way to lose work — and every save is CONDITIONAL on the revision we
// read. When it fails, the answer is never to pick a winner silently: both
// versions are held and the person is asked. Losing a branch someone drew
// yesterday is exactly the failure this tool would be blamed for.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  deleteDoc as deleteRemote,
  fetchDocs,
  isRemoteConfigured,
  readLocal,
  saveDoc,
  seedIfEmpty,
  subscribeDocs,
  writeLocal,
} from "./db";
import { duplicate, emptyDoc, sameContent, type FlowDoc } from "./model";
import { seedDocs } from "./seed";

export type SaveState =
  | { kind: "loading" }
  /** No Supabase configured: this browser only, and the header says so. */
  | { kind: "local" }
  | { kind: "saved"; at: number }
  | { kind: "saving" }
  | { kind: "dirty" }
  | { kind: "error"; message: string };

/** Both versions of a diagram that was edited in two places. Nothing is
 *  written while this is set — the person decides. */
export type Conflict = { mine: FlowDoc; server: FlowDoc };

const SAVE_DEBOUNCE = 700;
const HISTORY_LIMIT = 60;

export function useFlowStore(slug: string, me: string | null) {
  const [docs, setDocs] = useState<FlowDoc[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [save, setSave] = useState<SaveState>({ kind: "loading" });
  const [conflict, setConflict] = useState<Conflict | null>(null);

  const remote = isRemoteConfigured();
  const docsRef = useRef<FlowDoc[] | null>(null);
  docsRef.current = docs;

  // Undo is a stack of whole documents, which is what pure ops buy us. Keyed
  // by doc id so switching iterations doesn't let you undo into the other one.
  const history = useRef<Record<string, { past: FlowDoc[]; future: FlowDoc[] }>>({});

  // Ids this browser has written, so our own realtime echo doesn't read as
  // someone else's edit and yank the canvas mid-drag.
  const ownWrites = useRef(new Set<string>());

  // --- load -----------------------------------------------------------------

  const load = useCallback(async () => {
    if (!remote) {
      const local = readLocal(slug) ?? seedDocs(slug);
      setDocs(local);
      setActiveId((cur) => cur ?? local[0]?.id ?? null);
      setSave({ kind: "local" });
      return;
    }
    const rows = await fetchDocs(slug);
    if (rows === null) {
      // Couldn't reach the server. NOT the same as an empty project: fall back
      // to whatever this browser has and write nothing.
      const local = readLocal(slug);
      setDocs(local ?? []);
      setActiveId((cur) => cur ?? local?.[0]?.id ?? null);
      setSave({ kind: "error", message: "Can't reach the server — showing this browser's copy" });
      return;
    }
    let next = rows;
    if (rows.length === 0) {
      const seeded = await seedIfEmpty(seedDocs(slug), me);
      next = seeded ?? seedDocs(slug);
    }
    setDocs(next);
    setActiveId((cur) => (cur && next.some((d) => d.id === cur) ? cur : (next[0]?.id ?? null)));
    setSave({ kind: "saved", at: Date.now() });
  }, [slug, remote, me]);

  useEffect(() => {
    void load();
  }, [load]);

  // --- live from other browsers --------------------------------------------

  const dirtyRef = useRef(false);
  useEffect(() => {
    if (!remote) return;
    return subscribeDocs(slug, () => {
      void (async () => {
        const rows = await fetchDocs(slug);
        if (!rows) return;
        setDocs((cur) => {
          if (!cur) return rows;
          // Never overwrite the diagram being edited right now: the save will
          // conflict and ask. Everything else follows the server.
          return rows.map((r) => {
            const mine = cur.find((d) => d.id === r.id);
            if (!mine) return r;
            if (mine.id === activeIdRef.current && dirtyRef.current) return mine;
            return r;
          });
        });
      })();
    });
  }, [slug, remote]);

  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;

  const active = useMemo(() => docs?.find((d) => d.id === activeId) ?? null, [docs, activeId]);

  // --- autosave -------------------------------------------------------------

  const pending = useRef<FlowDoc | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(async () => {
    const doc = pending.current;
    if (!doc) return;
    pending.current = null;
    if (!remote) {
      const all = docsRef.current ?? [];
      writeLocal(slug, all);
      dirtyRef.current = false;
      setSave({ kind: "local" });
      return;
    }
    setSave({ kind: "saving" });
    const res = await saveDoc(doc, me);
    if (res.ok) {
      ownWrites.current.add(res.doc.id);
      dirtyRef.current = false;
      // Take back only the bookkeeping. Replacing nodes/edges wholesale would
      // discard anything typed during the round trip.
      setDocs((cur) =>
        (cur ?? []).map((d) =>
          d.id === res.doc.id ? { ...d, rev: res.doc.rev, updatedAt: res.doc.updatedAt, updatedBy: res.doc.updatedBy } : d,
        ),
      );
      setSave({ kind: "saved", at: Date.now() });
      return;
    }
    if (res.conflict) {
      setConflict({ mine: doc, server: res.server });
      setSave({ kind: "error", message: "Edited in two places" });
      return;
    }
    setSave({ kind: "error", message: res.error });
  }, [remote, slug, me]);

  const schedule = useCallback(
    (doc: FlowDoc) => {
      pending.current = doc;
      dirtyRef.current = true;
      setSave({ kind: "dirty" });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), SAVE_DEBOUNCE);
    },
    [flush],
  );

  // A close mid-edit shouldn't drop the last 700ms of work.
  useEffect(() => {
    const onHide = () => {
      if (pending.current) void flush();
    };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [flush]);

  // --- editing --------------------------------------------------------------

  /** Every change to the active diagram goes through here. `record: false` is
   *  for the tail of a drag, where one history entry per pixel is useless. */
  const mutate = useCallback(
    (fn: (doc: FlowDoc) => FlowDoc, opts?: { record?: boolean }) => {
      const cur = docsRef.current?.find((d) => d.id === activeIdRef.current);
      if (!cur) return;
      const next = fn(cur);
      if (sameContent(cur, next) && next.title === cur.title) return;
      if (opts?.record !== false) {
        const h = (history.current[cur.id] ??= { past: [], future: [] });
        h.past.push(cur);
        if (h.past.length > HISTORY_LIMIT) h.past.shift();
        h.future = [];
      }
      setDocs((all) => (all ?? []).map((d) => (d.id === next.id ? next : d)));
      schedule(next);
    },
    [schedule],
  );

  const step = useCallback(
    (dir: "undo" | "redo") => {
      const id = activeIdRef.current;
      if (!id) return;
      const h = history.current[id];
      const cur = docsRef.current?.find((d) => d.id === id);
      if (!h || !cur) return;
      const from = dir === "undo" ? h.past : h.future;
      const to = dir === "undo" ? h.future : h.past;
      const prev = from.pop();
      if (!prev) return;
      to.push(cur);
      // Keep the CURRENT revision: the history entry's rev is from before the
      // saves in between, and writing it back would conflict against ourselves.
      const restored = { ...prev, rev: cur.rev };
      setDocs((all) => (all ?? []).map((d) => (d.id === id ? restored : d)));
      schedule(restored);
    },
    [schedule],
  );

  const canUndo = Boolean(activeId && history.current[activeId]?.past.length);
  const canRedo = Boolean(activeId && history.current[activeId]?.future.length);

  // --- diagrams -------------------------------------------------------------

  const nextOrder = () => Math.max(-1, ...(docsRef.current ?? []).map((d) => d.order)) + 1;

  const addDoc = useCallback(
    (title: string) => {
      const doc = emptyDoc(slug, title, nextOrder());
      setDocs((all) => [...(all ?? []), doc]);
      setActiveId(doc.id);
      schedule(doc);
      return doc.id;
    },
    [slug, schedule],
  );

  const forkDoc = useCallback(
    (id: string, title: string) => {
      const src = docsRef.current?.find((d) => d.id === id);
      if (!src) return null;
      const doc = duplicate(src, title, nextOrder());
      setDocs((all) => [...(all ?? []), doc]);
      setActiveId(doc.id);
      schedule(doc);
      return doc.id;
    },
    [schedule],
  );

  const removeDoc = useCallback(
    async (id: string) => {
      setDocs((all) => (all ?? []).filter((d) => d.id !== id));
      setActiveId((cur) => {
        if (cur !== id) return cur;
        const rest = (docsRef.current ?? []).filter((d) => d.id !== id);
        return rest[0]?.id ?? null;
      });
      delete history.current[id];
      if (remote) {
        const err = await deleteRemote(id);
        if (err) setSave({ kind: "error", message: err });
      } else {
        writeLocal(slug, (docsRef.current ?? []).filter((d) => d.id !== id));
      }
    },
    [remote, slug],
  );

  /** Resolve a two-places edit. "theirs" adopts the server copy; "mine"
   *  re-saves this browser's content on top of it. Either way the other
   *  version is gone, which is why it is a decision and not a default. */
  const resolve = useCallback(
    (keep: "mine" | "theirs") => {
      if (!conflict) return;
      const winner =
        keep === "theirs" ? conflict.server : { ...conflict.mine, rev: conflict.server.rev };
      setDocs((all) => (all ?? []).map((d) => (d.id === winner.id ? winner : d)));
      setConflict(null);
      if (keep === "theirs") {
        dirtyRef.current = false;
        setSave({ kind: "saved", at: Date.now() });
      } else {
        schedule(winner);
      }
    },
    [conflict, schedule],
  );

  return {
    docs,
    active,
    activeId,
    setActiveId,
    save,
    remote,
    conflict,
    resolve,
    mutate,
    undo: () => step("undo"),
    redo: () => step("redo"),
    canUndo,
    canRedo,
    addDoc,
    forkDoc,
    removeDoc,
    reload: load,
  };
}
