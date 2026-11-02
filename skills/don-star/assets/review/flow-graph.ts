// The Flow view's geometry (the reviewer, 2026-08-18): the current page as a stack of
// LANES, each lane its own small branching graph — one per program, one per
// linking outcome, one shared checkout — rather than one merged mega-graph
// (the reviewer, second pass: "we need to decide how we branch… account vs linking
// needs to be a lane, since linking ends a flow. And each of the programs
// should be separate lanes. Feel free to duplicate pages on the flow chart if
// needed"). Pure data → positions, no React, so the model is testable the way
// flows/model.ts is (`npx tsx src/review/flow-graph.test.ts`).
//
// Lanes are AUTHORED on the page (Page.branchLanes, manually). A lane's node
// set is exactly the screens its edges touch, and a screen may appear in many
// lanes — duplication is what keeps each lane a complete story. Flows no lane
// touches keep their canvas meaning — a linear chain — so an un-authored page
// still shows every screen. Screens from charted flows that no lane places are
// surfaced under "Not placed yet", never silently dropped.
//
// Layout is a small layered (Sugiyama-ish) pass per lane: columns by longest
// path from the roots, a few barycenter sweeps to keep branches from crossing,
// lanes stacked vertically. Like /flows, problems (an edge naming a screen
// that isn't on the page, a cycle) are REPORTED, not blocking — a reviewer
// fixing a chart needs to see it.

import { screenSize, type FlowEdge, type Page, type ReviewProject, type Screen } from "./model";

export const NODE_GAP_X = 220;
export const NODE_GAP_Y = 120;
export const COMPONENT_GAP_Y = 260;
export const COMPONENT_HEADER_H = 118;
export const GRAPH_ORIGIN_X = 120;
export const GRAPH_ORIGIN_Y = 96;
const GRAPH_PAD_BOTTOM = 200;

export type FlowNode = {
  screen: Screen;
  /** Title of the flow the screen belongs to (the node's home on the canvas). */
  flowTitle: string;
  section?: string;
  /** The screen's place in its own flow, for the frame's n/m header. */
  indexInFlow: number;
  flowCount: number;
  /** A chart-only screen (FlowLane.screens): not on the canvas or in slides,
   *  so it can't be opened in Single page or hold pins. */
  laneOnly?: boolean;
  /** Component-local position (header already baked into y) + frame size. */
  x: number;
  y: number;
  w: number;
  h: number;
};

export type FlowGraphEdge = FlowEdge & {
  /** True for the arrows an un-authored flow keeps from its lane order. */
  auto: boolean;
};

export type FlowComponent = {
  /** The lane's own heading (or the flow's, for an un-authored chain). */
  title: string;
  subtitle?: string;
  eyebrow: string;
  x: number;
  y: number;
  nodes: FlowNode[];
  edges: FlowGraphEdge[];
};

export type FlowGraphLayout = {
  components: FlowComponent[];
  bounds: { w: number; h: number };
  /** What this chart is missing or mis-stating — reported, never blocking. */
  problems: string[];
};

type Spec = {
  title: string;
  subtitle?: string;
  eyebrow: string;
  nodeIds: string[];
  edges: FlowGraphEdge[];
};

export function buildFlowGraph(project: ReviewProject, page: Page): FlowGraphLayout {
  const problems: string[] = [];

  // Screen index + which flow owns each screen.
  const byId = new Map<
    string,
    { screen: Screen; flowId: string; flowTitle: string; section?: string; order: number; indexInFlow: number; flowCount: number }
  >();
  let order = 0;
  for (const flow of page.flows) {
    flow.screens.forEach((screen, indexInFlow) => {
      byId.set(screen.id, {
        screen,
        flowId: flow.id,
        flowTitle: flow.title,
        section: flow.section,
        order: order++,
        indexInFlow,
        flowCount: flow.screens.length,
      });
    });
  }
  // Lane-local screens (FlowLane.screens): the chart-only in-between steps.
  // Indexed for the WHOLE page, so a lane can reference another lane's steps
  // (the checkout lane's entries duplicate the program lanes' last screens). A
  // canvas id wins a collision — shadowing a reviewed screen would detach its
  // pins and statuses from what the chart shows.
  const laneOnly = new Set<string>();
  for (const lane of page.branchLanes ?? []) {
    lane.screens?.forEach((screen, indexInFlow) => {
      if (byId.has(screen.id)) {
        problems.push(`“${lane.title}” declares screen ${screen.id}, which already exists on the page.`);
        return;
      }
      laneOnly.add(screen.id);
      byId.set(screen.id, {
        screen,
        flowId: `lane:${lane.id}`,
        flowTitle: lane.title,
        section: lane.section,
        order: order++,
        indexInFlow,
        flowCount: lane.screens!.length,
      });
    });
  }

  const specs: Spec[] = [];
  const placed = new Set<string>();

  // Authored lanes, validated. An edge naming an off-page screen is dropped
  // and reported — drawn from nowhere it would read as a real branch.
  for (const lane of page.branchLanes ?? []) {
    const edges: FlowGraphEdge[] = [];
    const nodeIds: string[] = [];
    const seen = new Set<string>();
    const addNode = (id: string) => {
      if (seen.has(id)) return;
      seen.add(id);
      nodeIds.push(id);
      placed.add(id);
    };
    for (const e of lane.edges) {
      if (!byId.has(e.from) || !byId.has(e.to)) {
        problems.push(`“${lane.title}”: edge ${e.from} → ${e.to} names a screen that isn't on this page.`);
        continue;
      }
      if (e.from === e.to) {
        problems.push(`“${lane.title}”: ${e.from} → itself is a self-loop.`);
        continue;
      }
      if (edges.some((a) => a.from === e.from && a.to === e.to)) continue; // duplicate: draw once
      addNode(e.from);
      addNode(e.to);
      edges.push({ ...e, auto: false });
    }
    if (nodeIds.length === 0) {
      problems.push(`“${lane.title}” has no drawable edges.`);
      continue;
    }
    specs.push({ title: lane.title, subtitle: lane.subtitle, eyebrow: lane.section ?? "Lane", nodeIds, edges });
  }

  // Flows no lane touches keep their canvas lane order as a chain — an
  // un-authored page still shows every screen, exactly as the canvas states it.
  const flowTouched = new Map<string, boolean>();
  for (const flow of page.flows) {
    flowTouched.set(flow.id, flow.screens.some((s) => placed.has(s.id)));
  }
  for (const flow of page.flows) {
    if (flowTouched.get(flow.id)) continue;
    if (flow.screens.length === 0) continue;
    const edges: FlowGraphEdge[] = [];
    for (let i = 0; i + 1 < flow.screens.length; i++) {
      edges.push({ from: flow.screens[i]!.id, to: flow.screens[i + 1]!.id, auto: true });
    }
    specs.push({
      title: flow.title,
      subtitle: flow.subtitle,
      eyebrow: flow.section ?? "Flow",
      nodeIds: flow.screens.map((s) => s.id),
      edges,
    });
  }

  // Screens from charted flows that no lane places: surfaced, never dropped —
  // "every page in a flow" is the promise, and a drafting gap should be
  // visible on the chart it's a gap in.
  const leftovers = [...byId.keys()].filter((id) => flowTouched.get(byId.get(id)!.flowId) && !placed.has(id));
  if (leftovers.length > 0) {
    problems.push(
      `${leftovers.length} ${leftovers.length === 1 ? "screen" : "screens"} from charted flows ${
        leftovers.length === 1 ? "isn't" : "aren't"
      } placed in any lane — shown under “Not placed yet”.`,
    );
    specs.push({ title: "Not placed yet", eyebrow: "Draft", nodeIds: leftovers, edges: [] });
  }
  // A lane-local screen no edge uses is a drafting slip — it was authored to
  // be on the chart and isn't.
  for (const lane of page.branchLanes ?? []) {
    for (const s of lane.screens ?? []) {
      if (laneOnly.has(s.id) && !placed.has(s.id)) {
        problems.push(`“${lane.title}” declares screen ${s.id} but no edge places it on the chart.`);
      }
    }
  }

  // --- layout: one component per spec, stacked vertically --------------------
  const components: FlowComponent[] = [];
  let yCursor = GRAPH_ORIGIN_Y;
  let maxRight = GRAPH_ORIGIN_X;

  for (const spec of specs) {
    const inSpec = new Set(spec.nodeIds);
    const out = new Map<string, string[]>();
    const inn = new Map<string, string[]>();
    for (const id of spec.nodeIds) {
      out.set(id, []);
      inn.set(id, []);
    }
    for (const e of spec.edges) {
      out.get(e.from)!.push(e.to);
      inn.get(e.to)!.push(e.from);
    }

    // Depth = longest path from a root (Kahn's topological pass). An edgeless
    // spec ("Not placed yet") lays out as a ROW — no arrows, so no order is
    // implied. Nodes a cycle strands are reported and given the column after
    // their deepest placed predecessor — the back edge still draws, it just
    // can't advance the layout.
    const depth = new Map<string, number>();
    if (spec.edges.length === 0) {
      spec.nodeIds.forEach((id, i) => depth.set(id, i));
    } else {
      const indeg = new Map<string, number>();
      for (const id of spec.nodeIds) indeg.set(id, inn.get(id)!.length);
      const queue = spec.nodeIds.filter((id) => indeg.get(id) === 0);
      for (const id of queue) depth.set(id, 0);
      const done = new Set<string>();
      while (queue.length) {
        const cur = queue.shift()!;
        done.add(cur);
        for (const n of out.get(cur)!) {
          depth.set(n, Math.max(depth.get(n) ?? 0, depth.get(cur)! + 1));
          indeg.set(n, indeg.get(n)! - 1);
          if (indeg.get(n) === 0) queue.push(n);
        }
      }
      const stranded = spec.nodeIds.filter((id) => !done.has(id));
      if (stranded.length > 0) {
        problems.push(`“${spec.title}”: a cycle through “${byId.get(stranded[0]!)!.screen.title}” — drawn, but it can't advance the layout.`);
        for (const id of stranded) {
          const preds = inn.get(id)!.filter((p) => depth.has(p));
          depth.set(id, preds.length ? Math.max(...preds.map((p) => depth.get(p)!)) + 1 : 0);
        }
      }
    }

    // Columns by depth; rows settled with a few barycenter sweeps so branches
    // sit near their parents.
    const cols = new Map<number, string[]>();
    for (const id of spec.nodeIds) {
      const d = depth.get(id) ?? 0;
      const col = cols.get(d) ?? [];
      col.push(id);
      cols.set(d, col);
    }
    const colKeys = [...cols.keys()].sort((a, b) => a - b);
    const row = new Map<string, number>();
    for (const k of colKeys) {
      const col = cols.get(k)!;
      col.sort((a, b) => byId.get(a)!.order - byId.get(b)!.order);
      col.forEach((id, i) => row.set(id, i));
    }
    const sweep = (keys: number[], neighbors: (id: string) => string[]) => {
      for (const k of keys) {
        const col = cols.get(k)!;
        const bary = (id: string) => {
          const ns = neighbors(id).filter((n) => inSpec.has(n));
          if (ns.length === 0) return row.get(id)!;
          return ns.reduce((s, n) => s + (row.get(n) ?? 0), 0) / ns.length;
        };
        col.sort((a, b) => bary(a) - bary(b) || byId.get(a)!.order - byId.get(b)!.order);
        col.forEach((id, i) => row.set(id, i));
      }
    };
    for (let pass = 0; pass < 3; pass++) {
      sweep(colKeys, (id) => inn.get(id)!);
      sweep([...colKeys].reverse(), (id) => out.get(id)!);
    }

    // Positions: column x by prefix of max widths; y stacked per column, each
    // column vertically centered against the tallest one. Node y is
    // component-local and already offset below the heading band, so consumers
    // place a node at (component.x + n.x, component.y + n.y).
    const sizes = new Map<string, { w: number; h: number }>();
    for (const id of spec.nodeIds) sizes.set(id, screenSize(project, byId.get(id)!.screen));
    const colX = new Map<number, number>();
    let x = 0;
    for (const k of colKeys) {
      colX.set(k, x);
      const wMax = Math.max(...cols.get(k)!.map((id) => sizes.get(id)!.w));
      x += wMax + NODE_GAP_X;
    }
    const colH = (k: number) =>
      cols.get(k)!.reduce((s, id) => s + sizes.get(id)!.h, 0) + (cols.get(k)!.length - 1) * NODE_GAP_Y;
    const tallest = Math.max(...colKeys.map(colH));

    const nodes: FlowNode[] = [];
    for (const k of colKeys) {
      const col = cols.get(k)!;
      let y = COMPONENT_HEADER_H + (tallest - colH(k)) / 2;
      for (const id of col) {
        const info = byId.get(id)!;
        const size = sizes.get(id)!;
        nodes.push({
          screen: info.screen,
          flowTitle: info.flowTitle,
          section: info.section,
          indexInFlow: info.indexInFlow,
          flowCount: info.flowCount,
          laneOnly: laneOnly.has(id) || undefined,
          x: colX.get(k)!,
          y,
          w: size.w,
          h: size.h,
        });
        y += size.h + NODE_GAP_Y;
      }
    }

    const width = x - NODE_GAP_X;
    components.push({
      title: spec.title,
      subtitle: spec.subtitle,
      eyebrow: spec.eyebrow,
      x: GRAPH_ORIGIN_X,
      y: yCursor,
      nodes,
      edges: spec.edges,
    });
    maxRight = Math.max(maxRight, GRAPH_ORIGIN_X + width);
    yCursor += COMPONENT_HEADER_H + tallest + COMPONENT_GAP_Y;
  }

  return {
    components,
    bounds: { w: maxRight + GRAPH_ORIGIN_X, h: yCursor - COMPONENT_GAP_Y + GRAPH_PAD_BOTTOM },
    problems,
  };
}
