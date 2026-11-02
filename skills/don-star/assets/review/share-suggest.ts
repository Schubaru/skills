// The share panel's people suggestions, a pure function so a test can pin them.

import { isAgent, type Person } from "./model";

/** Who the add field suggests as you type (2026-09-26, the reviewer: "start typing
 *  'Do' and see jane.d@client.example, who has been in other projects"). The
 *  people directory is everyone who has ever signed in to the board, so a
 *  reviewer from another project is one keystroke away rather than an address
 *  to remember. A match is a word start in the name or the address. Someone
 *  already on the subject still shows (the reviewer, 2026-09-26: "make it clear
 *  visually that they're already on the project"), marked `onProject`, in
 *  directory order so a name is where you expect it; agents never show. */
export type Suggestion = Person & { onProject: boolean };

export function suggestPeople(
  query: string,
  dir: ReadonlyMap<string, Person>,
  taken: ReadonlySet<string>,
  limit = 6,
): Suggestion[] {
  const q = query.trim().toLowerCase();
  if (!q || q.includes(",") || q.includes(" ") || q.startsWith("@")) return [];
  // A picked (or fully typed) address is done: nothing left to suggest.
  if (dir.has(q)) return [];
  const starts = (text: string) => text.toLowerCase().split(/[\s.@_-]+/).some((w) => w.startsWith(q));
  return [...dir.values()]
    .filter((p) => !isAgent(p.name))
    .filter((p) => p.email.toLowerCase().startsWith(q) || starts(p.name) || starts(p.email))
    .map((p) => ({ ...p, onProject: taken.has(p.email) }))
    .slice(0, limit);
}

