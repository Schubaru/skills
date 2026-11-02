// The picture on a flows project's folder card.
//
// It is THE DIAGRAM, drawn small — the same standard project-thumb.tsx holds
// itself to ("a thumbnail that isn't the thing would be worse than no
// thumbnail"). A generic flow-chart glyph would be decoration, and an empty
// canvas texture would say the project is empty when it has two diagrams in
// it. So this reads the first diagram and draws its real boxes at their real
// positions, in the same five colours the canvas uses.
//
// One query per flows project, on a page that already loads a board config per
// board project. Nothing is cached: the folder is a page you pass through.

import { useEffect, useState } from "react";
import { fetchDocs, isRemoteConfigured, readLocal } from "./db";
import type { FlowDoc, NodeKind } from "./model";
import { NODE_W } from "./seed";
import "./flows.css";

/** Boxes are drawn at a fixed height: the real one depends on how much text
 *  wraps, and at this size the difference is under a pixel. */
const NODE_H = 74;
const PAD = 120;

const FILL: Record<NodeKind, string> = {
  start: "var(--fl-start)",
  step: "var(--fl-step)",
  decision: "var(--fl-decision)",
  outcome: "var(--fl-outcome)",
  note: "var(--fl-note)",
};

export function FlowThumb({ slug }: { slug: string }) {
  const [doc, setDoc] = useState<FlowDoc | null | "none">(null);

  useEffect(() => {
    let on = true;
    void (async () => {
      const rows = isRemoteConfigured() ? await fetchDocs(slug) : readLocal(slug);
      if (!on) return;
      const first = rows?.find((d) => d.nodes.length > 0) ?? null;
      setDoc(first ?? "none");
    })();
    return () => {
      on = false;
    };
  }, [slug]);

  // Loading, or genuinely nothing drawn yet: the same empty canvas every other
  // empty project shows.
  if (doc === null || doc === "none") {
    return (
      <div className="rv-thumb is-empty" aria-hidden>
        <div className="rv-dots rv-thumb-canvas" />
      </div>
    );
  }

  const xs = doc.nodes.map((n) => n.x);
  const ys = doc.nodes.map((n) => n.y);
  const minX = Math.min(...xs) - PAD;
  const minY = Math.min(...ys) - PAD;
  const w = Math.max(...xs) + NODE_W + PAD - minX;
  const h = Math.max(...ys) + NODE_H + PAD - minY;
  const by = new Map(doc.nodes.map((n) => [n.id, n]));

  return (
    <div className="rv-thumb is-loaded fl-thumb" aria-hidden>
      <svg viewBox={`${minX} ${minY} ${w} ${h}`} preserveAspectRatio="xMidYMid meet" className="fl-thumb-svg">
        {doc.edges.map((e) => {
          const a = by.get(e.from);
          const b = by.get(e.to);
          if (!a || !b) return null;
          return (
            <line
              key={e.id}
              x1={a.x + NODE_W / 2}
              y1={a.y + NODE_H / 2}
              x2={b.x + NODE_W / 2}
              y2={b.y + NODE_H / 2}
              className="fl-thumb-edge"
            />
          );
        })}
        {doc.nodes.map((n) => (
          <rect
            key={n.id}
            x={n.x}
            y={n.y}
            width={NODE_W}
            height={NODE_H}
            rx={14}
            fill={FILL[n.kind]}
            opacity={n.kind === "note" ? 0.35 : 0.9}
          />
        ))}
      </svg>
    </div>
  );
}
