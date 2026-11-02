// The people directory as every surface reads it: one fetch of review_people
// per page, kept current by a trigger on the account (supabase/
// review-presence.sql, part B), re-read after my own profile changes and when
// the tab returns. person.tsx draws the avatar from it.

import { useSyncExternalStore } from "react";
import { getSupabase, isRemoteConfigured } from "../auth/client";
import { fetchPeople } from "./db";
import { isAgent, type Person } from "./model";
import { cleanEmoji, colorIndex, storedColor, type PresenceColor } from "./presence-model";

// --- the directory, one fetch per page, shared by every surface ---------------

let byEmail = new Map<string, Person>();
const listeners = new Set<() => void>();
let started = false;

function load(): void {
  void fetchPeople().then((list) => {
    if (!list) return;
    byEmail = new Map(list.map((p) => [p.email, p]));
    for (const l of listeners) l();
  });
}

/** Re-read after my own profile changes (the trigger has already written it)
 *  and when the tab comes back, for everyone else's. */
function start(): void {
  if (started || !isRemoteConfigured()) return;
  started = true;
  load();
  getSupabase()?.auth.onAuthStateChange((event) => {
    if (event === "USER_UPDATED") load();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") load();
  });
}

function subscribe(l: () => void): () => void {
  start();
  listeners.add(l);
  return () => listeners.delete(l);
}

/** The people directory by lower-case email (empty offline). */
export function useDirectory(): ReadonlyMap<string, Person> {
  return useSyncExternalStore(subscribe, () => byEmail);
}

// --- one person -------------------------------------------------------------

export type Look = { name: string; color: PresenceColor | null; emoji: string | null };

/** How a person shows: their CURRENT name, colour and emoji when the directory
 *  knows their email; else the name that was written down, uncoloured. A
 *  default colour is the one presence hashes from their account id, so a
 *  person is one colour on the canvas and in every list. Agents keep theirs. */
export function lookOf(dir: ReadonlyMap<string, Person>, email: string | null | undefined, fallbackName: string): Look {
  const p = email ? dir.get(email.toLowerCase()) : undefined;
  if (!p || isAgent(fallbackName)) return { name: fallbackName, color: null, emoji: null };
  return {
    name: p.name || fallbackName,
    color: storedColor(p.color) ?? (p.userId ? colorIndex(p.userId) : null),
    emoji: cleanEmoji(p.emoji),
  };
}

/** A person's current name (a rename shows everywhere, old comments included). */
export function usePersonName(email: string | null | undefined, fallbackName: string): string {
  return lookOf(useDirectory(), email, fallbackName).name;
}
