// The flow-chart document — nodes, edges, and the pure operations over them.
//
// This is a THINKING tool, not a product surface: the whole point is that the reviewer
// can drag the branching around until it's right, and that what he leaves is
// what the next person opens. So two things are load-bearing here and nowhere
// else:
//
//   1. EVERY OPERATION IS PURE. The editor holds a doc, an op returns a new
//      one. That's what makes undo a stack of docs rather than a pile of
//      inverse operations, and what lets the same op run against a doc that
//      just arrived from another browser.
//   2. AN EDGE CAN NEVER OUTLIVE ITS NODE. A dangling edge draws as a line
//      from nowhere to nowhere, and on a branching diagram that reads as a
//      branch — the exact thing this tool exists to get right. removeNodes()
//      is the only way to delete a node, and it takes the edges with it.
//
// Storage lives in db.ts (Supabase, one row per doc); this file knows nothing
// about persistence beyond `rev`, which is how two editors find out they
// disagreed.

import { nanoid } from "nanoid";

/** What a box MEANS. Five kinds, because a sixth would be decoration:
 *  - start    where a patient enters this flow
 *  - step     a screen, a section, a question — something the patient does
 *  - decision a fork the SYSTEM makes; its out-edges must be labelled
 *  - outcome  a terminal state (async 24h, video, in person)
 *  - note     an open question or an annotation; carries no flow */
export type NodeKind = "start" | "step" | "decision" | "outcome" | "note";

export const NODE_KINDS: NodeKind[] = ["start", "step", "decision", "outcome", "note"];

export type FlowNode = {
  id: string;
  kind: NodeKind;
  title: string;
  /** The detail under the title — what's asked, what's prefilled, the caveat. */
  body?: string;
  x: number;
  y: number;
};

export type FlowEdge = {
  id: string;
  from: string;
  to: string;
  /** The condition. On a decision's out-edge this is the whole point, which is
   *  why `unlabelledForks()` below reports the ones that lack it. */
  label?: string;
};

export type FlowDoc = {
  id: string;
  projectSlug: string;
  title: string;
  /** One line under the title in the iteration list — what this version tries. */
  summary?: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  /** Bumped on every save. Two browsers editing the same doc find out here. */
  rev: number;
  updatedAt: number;
  /** Display name of whoever last saved it. Null on a seeded or offline doc. */
  updatedBy: string | null;
  /** Sidebar order. Iterations read oldest-first, so a fork lands after its
   *  parent rather than at the top. */
  order: number;
};

export function newId(): string {
  return nanoid(10);
}

export function emptyDoc(projectSlug: string, title: string, order = 0): FlowDoc {
  return {
    id: newId(),
    projectSlug,
    title,
    nodes: [],
    edges: [],
    rev: 0,
    updatedAt: Date.now(),
    updatedBy: null,
    order,
  };
}

// --- node operations --------------------------------------------------------

export function addNode(doc: FlowDoc, node: Omit<FlowNode, "id"> & { id?: string }): FlowDoc {
  return { ...doc, nodes: [...doc.nodes, { ...node, id: node.id ?? newId() }] };
}

export function updateNode(doc: FlowDoc, id: string, patch: Partial<Omit<FlowNode, "id">>): FlowDoc {
  return { ...doc, nodes: doc.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) };
}

/** Positions arrive from the canvas in bulk while dragging — one pass, so a
 *  multi-node drag is a single new doc rather than one per node. */
export function moveNodes(doc: FlowDoc, moves: { id: string; x: number; y: number }[]): FlowDoc {
  if (moves.length === 0) return doc;
  const by = new Map(moves.map((m) => [m.id, m]));
  return {
    ...doc,
    nodes: doc.nodes.map((n) => {
      const m = by.get(n.id);
      return m ? { ...n, x: m.x, y: m.y } : n;
    }),
  };
}

/** THE ONLY WAY TO DELETE A NODE. Takes every edge touching it — see the
 *  header: a dangling edge on a branching diagram reads as a real branch. */
export function removeNodes(doc: FlowDoc, ids: string[]): FlowDoc {
  if (ids.length === 0) return doc;
  const gone = new Set(ids);
  return {
    ...doc,
    nodes: doc.nodes.filter((n) => !gone.has(n.id)),
    edges: doc.edges.filter((e) => !gone.has(e.from) && !gone.has(e.to)),
  };
}

// --- edge operations --------------------------------------------------------

/** Returns the doc unchanged when the connection is meaningless (a node to
 *  itself) or already there — dropping the op rather than drawing a second
 *  line on top of the first, which looks like one edge until you move a node. */
export function connect(doc: FlowDoc, from: string, to: string, label?: string): FlowDoc {
  if (from === to) return doc;
  if (!doc.nodes.some((n) => n.id === from) || !doc.nodes.some((n) => n.id === to)) return doc;
  if (doc.edges.some((e) => e.from === from && e.to === to)) return doc;
  return { ...doc, edges: [...doc.edges, { id: newId(), from, to, label }] };
}

export function updateEdge(doc: FlowDoc, id: string, patch: Partial<Omit<FlowEdge, "id">>): FlowDoc {
  return { ...doc, edges: doc.edges.map((e) => (e.id === id ? { ...e, ...patch } : e)) };
}

export function removeEdges(doc: FlowDoc, ids: string[]): FlowDoc {
  if (ids.length === 0) return doc;
  const gone = new Set(ids);
  return { ...doc, edges: doc.edges.filter((e) => !gone.has(e.id)) };
}

// --- iterating --------------------------------------------------------------

/** Fork a doc into a new iteration. Ids are REMAPPED, not reused: two docs
 *  sharing a node id would make one row's edit look like the other's, and the
 *  bug wouldn't show until someone opened both. */
export function duplicate(doc: FlowDoc, title: string, order: number): FlowDoc {
  const remap = new Map(doc.nodes.map((n) => [n.id, newId()]));
  return {
    ...doc,
    id: newId(),
    title,
    summary: undefined,
    nodes: doc.nodes.map((n) => ({ ...n, id: remap.get(n.id)! })),
    edges: doc.edges.map((e) => ({
      ...e,
      id: newId(),
      from: remap.get(e.from)!,
      to: remap.get(e.to)!,
    })),
    rev: 0,
    updatedAt: Date.now(),
    order,
  };
}

// --- what the diagram is missing -------------------------------------------

/** Decisions whose branches aren't labelled. Reported in the editor rather
 *  than blocked: a half-drawn fork is a normal state while thinking, but an
 *  unlabelled one is invisible in a screenshot and that is how a flow ships
 *  with a branch nobody can read. */
export function unlabelledForks(doc: FlowDoc): FlowNode[] {
  return doc.nodes.filter((n) => {
    if (n.kind !== "decision") return false;
    const out = doc.edges.filter((e) => e.from === n.id);
    return out.length > 1 && out.some((e) => !e.label?.trim());
  });
}

/** Boxes with nothing leading in and nothing leading out — usually a node
 *  someone added and forgot, occasionally the next branch. Notes and starts
 *  are exempt: neither is meant to be reached. */
export function orphans(doc: FlowDoc): FlowNode[] {
  const touched = new Set<string>();
  for (const e of doc.edges) {
    touched.add(e.from);
    touched.add(e.to);
  }
  return doc.nodes.filter((n) => n.kind !== "note" && n.kind !== "start" && !touched.has(n.id));
}

/** Steps and decisions with no way onward. A flow that stops mid-form is the
 *  defect this tool is for, so it's counted, but outcomes and notes are ends
 *  by definition. */
export function deadEnds(doc: FlowDoc): FlowNode[] {
  const hasOut = new Set(doc.edges.map((e) => e.from));
  return doc.nodes.filter(
    (n) => (n.kind === "step" || n.kind === "decision" || n.kind === "start") && !hasOut.has(n.id),
  );
}

// --- concurrency ------------------------------------------------------------

/** Did the server move under us? `rev` is bumped by every save, so a remote
 *  doc at a higher rev means someone else wrote after the copy we hold. */
export function isStale(local: FlowDoc, remote: FlowDoc): boolean {
  return remote.id === local.id && remote.rev > local.rev;
}

/** What actually gets compared for "is there anything to save" — everything
 *  except the bookkeeping, so a save that only bumped rev doesn't read as a
 *  new edit and start the loop again. */
export function contentOf(doc: FlowDoc): string {
  return JSON.stringify({
    title: doc.title,
    summary: doc.summary ?? "",
    nodes: doc.nodes,
    edges: doc.edges,
  });
}

export function sameContent(a: FlowDoc, b: FlowDoc): boolean {
  return contentOf(a) === contentOf(b);
}
