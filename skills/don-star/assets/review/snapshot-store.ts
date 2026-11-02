// IndexedDB backing for the review board's preview captures.
//
// Captures used to live in a module-scope Map, so every reload re-booted every
// screen — ~140 full app boots to look at a board. They persist here instead,
// keyed the same way, each stamped with the route version it was taken at
// (screen-versions.ts) so a changed screen can never show yesterday's picture.
//
// Two stores on purpose: `meta` is read whole at boot (a few KB — it answers
// "what do I already have, and is it still valid?"), while `blobs` is read one
// entry at a time, only for frames that actually mount.

const DB_NAME = "rv-snapshots";
const DB_VERSION = 1;
const META = "meta";
const BLOBS = "blobs";

export type ShotMeta = {
  key: string;
  version: string;
  capturedAt: number;
  bytes: number;
};

let dbp: Promise<IDBDatabase | null> | null = null;

/** Resolves null wherever IndexedDB isn't usable (private modes, blocked
 *  storage) — the board then runs memory-only, exactly as it did before. */
function openDb(): Promise<IDBDatabase | null> {
  dbp ??= new Promise<IDBDatabase | null>((resolve) => {
    try {
      if (typeof indexedDB === "undefined") {
        resolve(null);
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: "key" });
        if (!db.objectStoreNames.contains(BLOBS)) db.createObjectStore(BLOBS);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbp;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
}

export async function loadAllMeta(): Promise<ShotMeta[]> {
  const db = await openDb();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const req = db.transaction(META, "readonly").objectStore(META).getAll();
      req.onsuccess = () => resolve((req.result as ShotMeta[]) ?? []);
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

export async function readShot(key: string): Promise<Blob | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = db.transaction(BLOBS, "readonly").objectStore(BLOBS).get(key);
      req.onsuccess = () => resolve((req.result as Blob) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function writeShot(meta: ShotMeta, blob: Blob): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction([META, BLOBS], "readwrite");
    tx.objectStore(META).put(meta);
    tx.objectStore(BLOBS).put(blob, meta.key);
    await done(tx);
  } catch {
    /* quota, or the store went away mid-session: the frame still has its
       in-memory capture, so nothing visible breaks */
  }
}

export async function deleteShots(keys: string[]): Promise<void> {
  if (!keys.length) return;
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction([META, BLOBS], "readwrite");
    for (const k of keys) {
      tx.objectStore(META).delete(k);
      tx.objectStore(BLOBS).delete(k);
    }
    await done(tx);
  } catch {
    /* nothing to do: a failed prune only costs disk */
  }
}

export async function clearShots(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction([META, BLOBS], "readwrite");
    tx.objectStore(META).clear();
    tx.objectStore(BLOBS).clear();
    await done(tx);
  } catch {
    /* see above */
  }
}
