// What the signed-in account holds, asked once per mount (2026-08-13).
//
// `loading` matters: rendering the folder before the answer arrives would show
// "No projects yet" to someone who has two, and redirecting on it would bounce
// a deep link. Every caller waits.

import { useCallback, useEffect, useState } from "react";
import {
  fetchFolderGrants,
  fetchIsAdmin,
  fetchMyFolderItems,
  fetchMyFolders,
  fetchMyProjectSlugs,
} from "./access";
import type { Folder, FolderGrant, FolderItem } from "./access-rules";
import { visibleProjects, type ProjectEntry } from "./projects";

export type MyAccess = {
  loading: boolean;
  /** Granted slugs, or null in offline mode (no Supabase = no gate). */
  slugs: string[] | null;
  isAdmin: boolean;
  /** The registry, filtered by the grants. */
  projects: ProjectEntry[];
  /** The folders this account can see. Empty offline, and empty on a database
   *  where the folder migration hasn't been applied — groupByFolder() reads
   *  that as "fall back to the code archived flag". */
  folders: Folder[];
  /** Where each of those projects is filed. */
  items: FolderItem[];
  /** Who holds each folder. Admins only — RLS hands everyone else an empty
   *  list, which reads as "no folder gives this away" and so never promises
   *  access the database would refuse. Used for the move confirmation. */
  folderGrants: FolderGrant[];
  /** Re-read after a mutation. A move or a rename changes what the page is a
   *  picture of, so the page asks again rather than patching state in place. */
  reload: () => Promise<void>;
};

const EMPTY = {
  loading: true,
  slugs: null,
  isAdmin: false,
  projects: [],
  folders: [],
  items: [],
  folderGrants: [],
} satisfies Omit<MyAccess, "reload">;

export function useMyAccess(): MyAccess {
  const [state, setState] = useState<Omit<MyAccess, "reload">>(EMPTY);
  // Set false on unmount so a late answer never sets state on a gone screen.
  const [live] = useState(() => ({ on: true }));

  const reload = useCallback(async () => {
    const [slugs, isAdmin, folders, items, folderGrants] = await Promise.all([
      fetchMyProjectSlugs(),
      fetchIsAdmin(),
      fetchMyFolders(),
      fetchMyFolderItems(),
      fetchFolderGrants(),
    ]);
    if (!live.on) return;
    setState({ loading: false, slugs, isAdmin, projects: visibleProjects(slugs), folders, items, folderGrants });
  }, [live]);

  useEffect(() => {
    live.on = true;
    void reload();
    return () => {
      live.on = false;
    };
  }, [live, reload]);

  return { ...state, reload };
}

// canShare lives in access-rules.ts — it is a rule, not a hook, and this file
// imports Supabase. Re-exported so callers keep asking one place.
export { canShare } from "./access-rules";
