/*
  Runnable checks for the flow-chart document (src/flows/model.ts).
  Run:  npx tsx src/flows/model.test.ts
  No test framework — plain assert, exits non-zero on failure. Same style as
  journey.test.ts and mentions-reads.test.ts.

  Four things are asserted because all four are invisible until they bite, and
  three of them would corrupt the diagram rather than break it:

    §1  AN EDGE NEVER OUTLIVES ITS NODE. A dangling edge draws as a line from
        nowhere — on a branching chart that reads as a branch, which is the one
        thing this tool exists to get right.
    §2  A CONNECTION IS MEANINGFUL OR IT ISN'T MADE. Self-loops and duplicates
        are dropped: a second edge drawn over the first looks like one edge
        until someone moves a node.
    §3  A FORK GETS ITS OWN IDS. Two iterations sharing node ids would make an
        edit to one look like an edit to the other, and it wouldn't show until
        someone opened both.
    §4  THE SEED IS A VALID FLOW. It ships as the starting point, so it is held
        to what the editor reports: no orphans, no dead ends, every fork
        labelled.
*/
import assert from "node:assert";
import {
  addNode,
  connect,
  deadEnds,
  duplicate,
  emptyDoc,
  isStale,
  moveNodes,
  orphans,
  removeNodes,
  sameContent,
  unlabelledForks,
  updateEdge,
} from "./model";
import { seedDocs } from "./seed";

let checks = 0;
function ok(cond: boolean, what: string) {
  assert.ok(cond, what);
  checks++;
}
function eq<T>(a: T, b: T, what: string) {
  assert.deepStrictEqual(a, b, what);
  checks++;
}

// --- §1 an edge never outlives its node ------------------------------------

{
  let doc = emptyDoc("test", "t");
  doc = addNode(doc, { id: "a", kind: "start", title: "A", x: 0, y: 0 });
  doc = addNode(doc, { id: "b", kind: "step", title: "B", x: 0, y: 100 });
  doc = addNode(doc, { id: "c", kind: "outcome", title: "C", x: 0, y: 200 });
  doc = connect(doc, "a", "b");
  doc = connect(doc, "b", "c");
  eq(doc.edges.length, 2, "§1 two edges to start with");

  const after = removeNodes(doc, ["b"]);
  eq(after.nodes.length, 2, "§1 the node is gone");
  eq(after.edges.length, 0, "§1 BOTH incident edges went with it");

  // The op is pure — the doc we held is untouched, which is what makes undo a
  // stack of docs rather than a pile of inverses.
  eq(doc.edges.length, 2, "§1 removeNodes did not mutate the original");
  eq(removeNodes(doc, []).edges.length, 2, "§1 removing nothing changes nothing");
}

// --- §2 a connection is meaningful or it isn't made ------------------------

{
  let doc = emptyDoc("test", "t");
  doc = addNode(doc, { id: "a", kind: "step", title: "A", x: 0, y: 0 });
  doc = addNode(doc, { id: "b", kind: "step", title: "B", x: 0, y: 100 });

  eq(connect(doc, "a", "a").edges.length, 0, "§2 no self-loop");
  eq(connect(doc, "a", "ghost").edges.length, 0, "§2 no edge to a node that isn't there");

  const once = connect(doc, "a", "b", "yes");
  eq(once.edges.length, 1, "§2 the first connection lands");
  eq(connect(once, "a", "b", "no").edges.length, 1, "§2 the duplicate is dropped, not stacked");
  eq(once.edges[0]!.label, "yes", "§2 and the original keeps its label");

  // Moving is a bulk op: one drag of three nodes is one new doc.
  const moved = moveNodes(once, [
    { id: "a", x: 5, y: 6 },
    { id: "b", x: 7, y: 8 },
  ]);
  eq([moved.nodes[0]!.x, moved.nodes[1]!.y], [5, 8], "§2 both moves applied");
  eq(moveNodes(once, []), once, "§2 an empty move is the same doc");
}

// --- §3 a fork gets its own ids --------------------------------------------

{
  let doc = emptyDoc("test", "v1");
  doc = addNode(doc, { id: "a", kind: "start", title: "A", x: 0, y: 0 });
  doc = addNode(doc, { id: "b", kind: "decision", title: "B?", x: 0, y: 100 });
  doc = connect(doc, "a", "b", "go");

  const fork = duplicate(doc, "v2", 1);
  ok(fork.id !== doc.id, "§3 the fork is a different document");
  eq(fork.rev, 0, "§3 and starts unsaved");
  ok(
    fork.nodes.every((n) => !doc.nodes.some((o) => o.id === n.id)),
    "§3 no node id is shared with the parent",
  );
  ok(
    fork.edges.every((e) => !doc.edges.some((o) => o.id === e.id)),
    "§3 no edge id is shared either",
  );
  // Topology survives the remap: the fork's one edge runs start → decision.
  const from = fork.nodes.find((n) => n.id === fork.edges[0]!.from);
  const to = fork.nodes.find((n) => n.id === fork.edges[0]!.to);
  eq([from?.title, to?.title, fork.edges[0]!.label], ["A", "B?", "go"], "§3 the shape came across");

  // Concurrency: rev is the only thing that says the server moved under us.
  ok(isStale(doc, { ...doc, rev: doc.rev + 1 }), "§3 a higher remote rev is stale");
  ok(!isStale(doc, { ...doc, rev: doc.rev }), "§3 the same rev is not");
  ok(!isStale(doc, { ...doc, id: "other", rev: 99 }), "§3 a different doc is never stale-making");
  ok(sameContent(doc, { ...doc, rev: 9, updatedAt: 1, updatedBy: "x" }), "§3 bookkeeping is not content");
  ok(!sameContent(doc, updateEdge(doc, doc.edges[0]!.id, { label: "changed" })), "§3 a label is");
}

// --- §4 the seed is a valid flow -------------------------------------------

for (const doc of seedDocs("test")) {
  const where = `§4 ${doc.title}`;
  ok(doc.nodes.length > 0, `${where}: has nodes`);
  eq(
    orphans(doc).map((n) => n.title),
    [],
    `${where}: nothing is stranded`,
  );
  eq(
    deadEnds(doc).map((n) => n.title),
    [],
    `${where}: nothing stops mid-flow`,
  );
  eq(
    unlabelledForks(doc).map((n) => n.title),
    [],
    `${where}: every fork says what decides it`,
  );
  // Every edge points at a node that exists — the seed is hand-authored, so
  // this catches a typo'd id before it renders as a missing branch.
  for (const e of doc.edges) {
    ok(
      doc.nodes.some((n) => n.id === e.from) && doc.nodes.some((n) => n.id === e.to),
      `${where}: edge ${e.id} points at real nodes`,
    );
  }
  // Ids are unique inside a doc; a repeat would silently merge two boxes.
  eq(new Set(doc.nodes.map((n) => n.id)).size, doc.nodes.length, `${where}: node ids are unique`);
}

// Seeded docs are distinct rows.
{
  const docs = seedDocs("test");
  eq(new Set(docs.map((d) => d.id)).size, docs.length, "§4 seeded docs have distinct ids");
}

console.log(`ok — ${checks} checks passed`);
