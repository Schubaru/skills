/*
  Runnable check for the Flow view's graph builder (src/review/flow-graph.ts).
  Run:  npx tsx src/review/flow-graph.test.ts
  No test framework — plain assert, exits non-zero on failure. Same style as
  screen-versions.test.ts.

  What has to hold: the chart is authored LANES (Rita, 2026-08-18 second pass),
  each its own small graph with its own ending, and a screen may appear in as
  many lanes as need it; a flow no lane touches keeps its canvas order as an
  auto-chain, so an un-authored page still shows every screen; screens from
  charted flows that no lane places are surfaced under "Not placed yet", never
  silently dropped; bad edges (off-page, self-loop, duplicate) are dropped and
  reported rather than drawn from nowhere; cycles are reported but everything
  still gets a position; and the layered layout puts a branch's targets in the
  column after their source, without overlaps.
*/
import assert from "node:assert";
import { buildFlowGraph, NODE_GAP_Y } from "./flow-graph";
import type { Page, ReviewProject, Screen } from "./model";

const screen = (id: string): Screen => ({ id, title: id, source: { kind: "image", src: `/${id}.png` } });
const project = (page: Page): ReviewProject => ({ name: "t", slug: "t", pages: [page], screen: { w: 100, h: 200 } });

const build = (page: Page) => {
  const g = buildFlowGraph(project(page), page);
  return { g, nodes: g.components.flatMap((c) => c.nodes), edges: g.components.flatMap((c) => c.edges) };
};

// --- un-authored page: lanes survive as chains --------------------------------
{
  const page: Page = {
    id: "p",
    title: "p",
    flows: [
      { id: "f1", title: "F1", screens: [screen("a"), screen("b"), screen("c")] },
      { id: "f2", title: "F2", screens: [screen("d"), screen("e")] },
    ],
  };
  const { g, nodes, edges } = build(page);
  assert.equal(nodes.length, 5, "every screen appears");
  assert.equal(g.components.length, 2, "one component per un-authored flow");
  assert.deepEqual(
    edges.map((e) => `${e.from}>${e.to}`),
    ["a>b", "b>c", "d>e"],
    "auto-chains follow lane order",
  );
  assert.ok(edges.every((e) => e.auto), "chain edges are marked auto");
  assert.equal(g.problems.length, 0, "nothing to report");
  const [c1, c2] = g.components;
  const xs = c1!.nodes.map((n) => n.x);
  assert.ok(xs[0]! < xs[1]! && xs[1]! < xs[2]!, "chain lays out left to right");
  assert.ok(c2!.y > c1!.y, "components stack vertically");
  assert.equal(c1!.title, "F1", "an un-authored flow keeps its own title");
}

// --- an authored lane with a fork ----------------------------------------------
{
  const page: Page = {
    id: "p",
    title: "p",
    flows: [
      { id: "f1", title: "F1", section: "S", screens: [screen("a"), screen("b"), screen("c")] },
      { id: "f2", title: "F2", section: "S", screens: [screen("d")] },
    ],
    branchLanes: [
      {
        id: "l1",
        title: "Lane one",
        section: "Alpha",
        edges: [
          { from: "a", to: "b", label: "yes" },
          { from: "a", to: "c", label: "no" },
          { from: "c", to: "d" },
        ],
      },
    ],
  };
  const { g, nodes, edges } = build(page);
  assert.equal(g.components.length, 1, "one authored lane, and both flows are touched so no chains");
  assert.equal(g.components[0]!.title, "Lane one");
  assert.equal(g.components[0]!.eyebrow, "Alpha", "the lane's section is the eyebrow");
  assert.equal(nodes.length, 4);
  assert.ok(edges.every((e) => !e.auto), "an authored lane has no auto-arrows");
  assert.equal(edges.length, 3, "exactly the authored edges");
  const at = (id: string) => nodes.find((n) => n.screen.id === id)!;
  assert.ok(at("b").x > at("a").x && at("c").x > at("a").x, "branch targets sit right of the source");
  assert.equal(at("b").x, at("c").x, "siblings share a column");
  assert.ok(at("d").x > at("c").x, "the chain continues past the fork");
  assert.ok(Math.abs(at("b").y - at("c").y) >= 200 + NODE_GAP_Y, "siblings don't overlap");
  assert.equal(g.problems.length, 0);
}

// --- a screen may appear in MANY lanes (Rita: "feel free to duplicate") --------
{
  const page: Page = {
    id: "p",
    title: "p",
    flows: [{ id: "f1", title: "F1", screens: [screen("a"), screen("b"), screen("c")] }],
    branchLanes: [
      { id: "l1", title: "L1", edges: [{ from: "a", to: "b" }] },
      { id: "l2", title: "L2", edges: [{ from: "a", to: "c" }] },
    ],
  };
  const { g, nodes } = build(page);
  assert.equal(g.components.length, 2, "one component per lane");
  assert.equal(nodes.filter((n) => n.screen.id === "a").length, 2, "the shared screen renders in both lanes");
  assert.equal(g.problems.length, 0, "duplication across lanes is the design, not a problem");
}

// --- bad edges: dropped and reported, never drawn ------------------------------
{
  const page: Page = {
    id: "p",
    title: "p",
    flows: [{ id: "f1", title: "F1", screens: [screen("a"), screen("b")] }],
    branchLanes: [
      {
        id: "l1",
        title: "Lane one",
        edges: [
          { from: "a", to: "nope" },
          { from: "a", to: "a" },
          { from: "a", to: "b" },
          { from: "a", to: "b" }, // duplicate
        ],
      },
    ],
  };
  const { g, edges } = build(page);
  assert.equal(edges.length, 1, "off-page, self-loop and duplicate all collapse to the one real edge");
  assert.equal(g.problems.filter((p) => p.includes("isn't on this page")).length, 1);
  assert.equal(g.problems.filter((p) => p.includes("self-loop")).length, 1);
  assert.ok(g.problems.every((p) => p.includes("Lane one")), "problems name the lane they're in");
}

// --- unplaced screens from charted flows are surfaced, never dropped -----------
{
  const page: Page = {
    id: "p",
    title: "p",
    flows: [{ id: "f1", title: "F1", screens: [screen("a"), screen("b"), screen("x"), screen("y")] }],
    branchLanes: [{ id: "l1", title: "L1", edges: [{ from: "a", to: "b" }] }],
  };
  const { g, nodes } = build(page);
  assert.equal(nodes.length, 4, "the unplaced screens still render");
  const last = g.components[g.components.length - 1]!;
  assert.equal(last.title, "Not placed yet");
  assert.equal(last.nodes.length, 2);
  assert.equal(last.edges.length, 0, "no arrows — no order is implied");
  assert.ok(last.nodes[0]!.x !== last.nodes[1]!.x, "an edgeless component lays out as a row, not a stack");
  assert.equal(g.problems.filter((p) => p.includes("Not placed yet")).length, 1);
}

// --- a cycle is reported, everything still gets a position ---------------------
{
  const page: Page = {
    id: "p",
    title: "p",
    flows: [{ id: "f1", title: "F1", screens: [screen("a"), screen("b"), screen("c")] }],
    branchLanes: [
      {
        id: "l1",
        title: "L1",
        edges: [
          { from: "a", to: "b" },
          { from: "b", to: "c" },
          { from: "c", to: "b" }, // back edge
        ],
      },
    ],
  };
  const { g, nodes, edges } = build(page);
  assert.equal(nodes.length, 3);
  assert.equal(edges.length, 3, "the back edge still draws");
  assert.equal(g.problems.filter((p) => p.includes("cycle")).length, 1);
  assert.ok(nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y)));
}

// --- longest path decides the column (a diamond) -------------------------------
{
  const page: Page = {
    id: "p",
    title: "p",
    flows: [{ id: "f1", title: "F1", screens: [screen("a"), screen("b"), screen("c"), screen("d")] }],
    branchLanes: [
      {
        id: "l1",
        title: "L1",
        edges: [
          { from: "a", to: "b" },
          { from: "b", to: "d" },
          { from: "a", to: "d" }, // the shortcut must not pull d leftwards
          { from: "a", to: "c" },
        ],
      },
    ],
  };
  const { nodes } = build(page);
  const at = (id: string) => nodes.find((n) => n.screen.id === id)!;
  assert.ok(at("d").x > at("b").x, "d sits after b, not beside it");
  assert.equal(at("b").x, at("c").x);
}

// --- lanes and chains coexist; bounds contain every node -----------------------
{
  const page: Page = {
    id: "p",
    title: "p",
    flows: [
      { id: "f1", title: "F1", screens: [screen("a"), screen("b"), screen("c")] },
      { id: "f2", title: "Shelf", section: "Reference", screens: [screen("d"), screen("e")] },
    ],
    branchLanes: [
      {
        id: "l1",
        title: "L1",
        edges: [
          { from: "a", to: "b" },
          { from: "a", to: "c" },
        ],
      },
    ],
  };
  const { g } = build(page);
  assert.equal(g.components.length, 2, "the untouched flow keeps its chain beside the lane");
  assert.equal(g.components[1]!.title, "Shelf");
  assert.equal(g.components[1]!.eyebrow, "Reference");
  for (const c of g.components) {
    for (const n of c.nodes) {
      assert.ok(c.x + n.x + n.w <= g.bounds.w, "bounds contain every node horizontally");
      assert.ok(c.y + n.y + n.h <= g.bounds.h, "bounds contain every node vertically");
    }
  }
  assert.equal(g.problems.length, 0);
}

console.log("flow-graph.test.ts: all assertions passed");
