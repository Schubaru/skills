// The diagram a flow-chart project opens with when its database has no rows.
//
// ⚠ A seed is written ONCE, on the first open of an EMPTY project; from then on
// the database is the document (see db.ts / store.ts). Adding a diagram here
// later ships it to nobody — insert it as a row instead.

import type { FlowDoc } from "./model";

/** Node width on the canvas; layout and thumbnails both read it. */
export const NODE_W = 280;

export function seedDocs(projectSlug: string): FlowDoc[] {
  const now = Date.now();
  return [
    {
      id: "seed-start",
      projectSlug,
      title: "Iteration 1",
      summary: "A starting position to argue with — fork it and move the branching.",
      nodes: [
        { id: "n1", kind: "start", title: "Entry", body: "Where the user arrives", x: 0, y: 0 },
        { id: "n2", kind: "step", title: "First screen", body: "What is asked first", x: 0, y: 160 },
        { id: "n3", kind: "decision", title: "Eligible?", body: "The system decides", x: 0, y: 320 },
        { id: "n4", kind: "outcome", title: "Continue", x: -180, y: 500 },
        { id: "n5", kind: "outcome", title: "Stop", x: 180, y: 500 },
      ],
      edges: [
        { id: "e1", from: "n1", to: "n2" },
        { id: "e2", from: "n2", to: "n3" },
        { id: "e3", from: "n3", to: "n4", label: "yes" },
        { id: "e4", from: "n3", to: "n5", label: "no" },
      ],
      rev: 0,
      updatedAt: now,
      updatedBy: null,
      order: 0,
    },
  ];
}
