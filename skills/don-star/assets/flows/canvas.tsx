// The canvas — boxes, arrows, and the panel that edits whichever one is
// selected.
//
// Deliberately NOT a product surface. It wears the review board's own chrome
// (rv-* tokens, light and dark) because it is a tool for arguing about
// branching, and a flow chart that looks like a designed screen invites the
// wrong conversation — the reviewer's brief was "no design yet, just flow charts".
//
// Two things here are load-bearing:
//
//  1. WHICH SIDE AN ARROW LEAVES FROM IS DERIVED, NOT AUTHORED (handlesFor).
//     A branch drawn to a box beside it should leave from the side; a step
//     below it, from the bottom; a loop back, up the flank. Storing that per
//     edge would be one more thing to get wrong by hand, and every diagram
//     would drift from every other.
//  2. DRAGGING IS LOCAL UNTIL IT STOPS. Positions live in the canvas's own
//     state while a node is moving and are committed to the document once —
//     otherwise every pixel is an undo entry and a database write.

import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  connect,
  moveNodes,
  removeEdges,
  removeNodes,
  updateEdge,
  updateNode,
  type FlowDoc,
  type FlowNode,
  type NodeKind,
} from "./model";
import { NODE_W } from "./seed";

export type Selection = { kind: "node" | "edge"; id: string } | null;

type CardData = { node: FlowNode };
type CardNode = Node<CardData, NodeKind>;

export const KIND_LABEL: Record<NodeKind, string> = {
  start: "Start",
  step: "Step",
  decision: "Decision",
  outcome: "Outcome",
  note: "Note",
};

const KIND_HINT: Record<NodeKind, string> = {
  start: "Where a patient enters this flow.",
  step: "Something the patient does — a screen, a section, a question.",
  decision: "A fork the system makes. Label every branch leaving it.",
  outcome: "A terminal state. Nothing follows it.",
  note: "An open question or an annotation. Carries no flow.",
};

// --- the box ----------------------------------------------------------------

/** Every node offers three sources and three targets; handlesFor() picks the
 *  pair per edge. They are invisible until the pointer is over the node. */
function Ports() {
  return (
    <>
      <Handle type="target" position={Position.Top} id="tt" />
      <Handle type="target" position={Position.Left} id="tl" />
      <Handle type="target" position={Position.Right} id="tr" />
      <Handle type="source" position={Position.Bottom} id="sb" />
      <Handle type="source" position={Position.Right} id="sr" />
      <Handle type="source" position={Position.Left} id="sl" />
    </>
  );
}

function Card({ data, selected }: NodeProps<CardNode>) {
  const n = data.node;
  return (
    <div className={`fl-node is-${n.kind}${selected ? " is-selected" : ""}`} style={{ width: NODE_W }}>
      <Ports />
      {n.kind === "decision" || n.kind === "outcome" || n.kind === "note" ? (
        <span className="fl-node-kind">{KIND_LABEL[n.kind]}</span>
      ) : null}
      <p className="fl-node-title">{n.title || "Untitled"}</p>
      {n.body ? <p className="fl-node-body">{n.body}</p> : null}
    </div>
  );
}

const nodeTypes = { start: Card, step: Card, decision: Card, outcome: Card, note: Card };

// --- geometry ---------------------------------------------------------------

/** Which handles an edge should use, from where the two boxes actually sit.
 *  Side by side → out the side. Below → out the bottom. Above → up the flank,
 *  which is what a loop back to an earlier step looks like on paper. */
export function handlesFor(a: FlowNode, b: FlowNode): { source: string; target: string } {
  const dy = b.y - a.y;
  const rightwards = b.x >= a.x;
  if (Math.abs(dy) < 60) return rightwards ? { source: "sr", target: "tl" } : { source: "sl", target: "tr" };
  if (dy > 0) return { source: "sb", target: "tt" };
  return rightwards ? { source: "sr", target: "tr" } : { source: "sl", target: "tl" };
}

function toRf(doc: FlowDoc, sel: Selection): { nodes: CardNode[]; edges: Edge[] } {
  const by = new Map(doc.nodes.map((n) => [n.id, n]));
  return {
    nodes: doc.nodes.map((n) => ({
      id: n.id,
      type: n.kind,
      position: { x: n.x, y: n.y },
      data: { node: n },
      selected: sel?.kind === "node" && sel.id === n.id,
    })),
    edges: doc.edges.flatMap((e) => {
      const from = by.get(e.from);
      const to = by.get(e.to);
      if (!from || !to) return []; // can't happen (removeNodes takes edges) — drawn as nothing rather than as a stray line
      const h = handlesFor(from, to);
      return [
        {
          id: e.id,
          source: e.from,
          target: e.to,
          sourceHandle: h.source,
          targetHandle: h.target,
          label: e.label || undefined,
          type: "smoothstep",
          selected: sel?.kind === "edge" && sel.id === e.id,
          className: e.label ? undefined : "fl-edge-bare",
        },
      ];
    }),
  };
}

// --- the canvas -------------------------------------------------------------

type CanvasProps = {
  doc: FlowDoc;
  mutate: (fn: (doc: FlowDoc) => FlowDoc, opts?: { record?: boolean }) => void;
  selection: Selection;
  onSelect: (sel: Selection) => void;
};

function CanvasInner({ doc, mutate, selection, onSelect }: CanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<CardNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const dragging = useRef(false);
  const { screenToFlowPosition } = useReactFlow();

  // The document is the truth; the canvas mirrors it — except while a node is
  // under the pointer, when re-syncing would fight the drag.
  const mirror = useMemo(() => toRf(doc, selection), [doc, selection]);
  useEffect(() => {
    if (dragging.current) return;
    setNodes(mirror.nodes);
    setEdges(mirror.edges);
  }, [mirror, setNodes, setEdges]);

  const addAt = useCallback(
    (clientX: number, clientY: number, kind: NodeKind = "step") => {
      const p = screenToFlowPosition({ x: clientX, y: clientY });
      const id = crypto.randomUUID().slice(0, 10);
      mutate((d) => ({
        ...d,
        nodes: [...d.nodes, { id, kind, title: "", x: Math.round(p.x - NODE_W / 2), y: Math.round(p.y - 40) }],
      }));
      onSelect({ kind: "node", id });
    },
    [screenToFlowPosition, mutate, onSelect],
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeDragStart={() => {
        dragging.current = true;
      }}
      onNodeDragStop={(_e, _node, dragged) => {
        dragging.current = false;
        mutate((d) =>
          moveNodes(
            d,
            dragged.map((n) => ({ id: n.id, x: Math.round(n.position.x), y: Math.round(n.position.y) })),
          ),
        );
      }}
      onConnect={(c: Connection) => {
        if (!c.source || !c.target) return;
        mutate((d) => connect(d, c.source!, c.target!));
      }}
      onNodesDelete={(ns) => {
        mutate((d) => removeNodes(d, ns.map((n) => n.id)));
        onSelect(null);
      }}
      onEdgesDelete={(es) => {
        mutate((d) => removeEdges(d, es.map((e) => e.id)));
        onSelect(null);
      }}
      onNodeClick={(_e, n) => onSelect({ kind: "node", id: n.id })}
      onEdgeClick={(_e, e) => onSelect({ kind: "edge", id: e.id })}
      onPaneClick={() => onSelect(null)}
      // Double-click on empty canvas drops a step where you clicked — the
      // fastest way to think out loud, and the reason there's no modal.
      onDoubleClick={(e) => {
        const target = e.target as HTMLElement;
        if (target.closest(".react-flow__node") || target.closest(".react-flow__edge")) return;
        addAt(e.clientX, e.clientY);
      }}
      onlyRenderVisibleElements
      fitView
      minZoom={0.08}
      maxZoom={2}
      proOptions={{ hideAttribution: false }}
      className="fl-flow"
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} className="fl-bg" />
      <Controls showInteractive={false} />
      {/* The mask and ground are passed as props, not CSS: react-flow writes
          them straight onto the SVG, and its light defaults make the minimap
          the one bright rectangle on a dark board. */}
      <MiniMap
        pannable
        zoomable
        className="fl-minimap"
        bgColor="var(--rv-card)"
        maskColor="color-mix(in srgb, var(--rv-bg) 72%, transparent)"
        nodeClassName={(n) => `fl-mini is-${n.type}`}
      />
    </ReactFlow>
  );
}

export function Canvas(props: CanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}

// --- the inspector ----------------------------------------------------------

export function Inspector({
  doc,
  selection,
  mutate,
  onSelect,
}: {
  doc: FlowDoc;
  selection: Selection;
  mutate: (fn: (doc: FlowDoc) => FlowDoc, opts?: { record?: boolean }) => void;
  onSelect: (sel: Selection) => void;
}) {
  const node = selection?.kind === "node" ? doc.nodes.find((n) => n.id === selection.id) : undefined;
  const edge = selection?.kind === "edge" ? doc.edges.find((e) => e.id === selection.id) : undefined;
  const titleRef = useRef<HTMLInputElement>(null);

  // A box added by double-clicking arrives empty and selected; landing the
  // caret in it means you can keep typing instead of aiming.
  useEffect(() => {
    if (node && !node.title) titleRef.current?.focus();
  }, [node]);

  if (!node && !edge) {
    return (
      <div className="fl-inspector is-empty">
        <p className="fl-hint">Nothing selected.</p>
        <ul className="fl-keys">
          <li>
            <kbd>Double-click</kbd> the canvas for a new box
          </li>
          <li>Drag from a box's edge to connect it</li>
          <li>
            <kbd>⌫</kbd> deletes what's selected · <kbd>⌘Z</kbd> undoes
          </li>
        </ul>
      </div>
    );
  }

  if (edge) {
    const from = doc.nodes.find((n) => n.id === edge.from);
    const to = doc.nodes.find((n) => n.id === edge.to);
    return (
      <div className="fl-inspector">
        <div className="fl-insp-head">
          <span className="fl-insp-kind">Branch</span>
          <button
            type="button"
            className="fl-danger"
            onClick={() => {
              mutate((d) => removeEdges(d, [edge.id]));
              onSelect(null);
            }}
          >
            Delete
          </button>
        </div>
        <p className="fl-insp-path">
          {from?.title || "?"} <span aria-hidden>→</span> {to?.title || "?"}
        </p>
        <label className="fl-field">
          <span>What sends a patient this way</span>
          <input
            className="fl-input"
            value={edge.label ?? ""}
            placeholder="yes · no · cash · above the cap…"
            onChange={(e) => mutate((d) => updateEdge(d, edge.id, { label: e.target.value }))}
          />
        </label>
        {from?.kind === "decision" ? (
          <p className="fl-hint">
            This leaves a decision, so the label is the decision. An unlabelled branch is invisible in a screenshot.
          </p>
        ) : null}
      </div>
    );
  }

  const n = node!;
  return (
    <div className="fl-inspector">
      <div className="fl-insp-head">
        <span className="fl-insp-kind">{KIND_LABEL[n.kind]}</span>
        <button
          type="button"
          className="fl-danger"
          onClick={() => {
            mutate((d) => removeNodes(d, [n.id]));
            onSelect(null);
          }}
        >
          Delete
        </button>
      </div>

      <label className="fl-field">
        <span>Title</span>
        <input
          ref={titleRef}
          className="fl-input"
          value={n.title}
          placeholder="What happens here"
          onChange={(e) => mutate((d) => updateNode(d, n.id, { title: e.target.value }))}
        />
      </label>

      <label className="fl-field">
        <span>Detail</span>
        <textarea
          className="fl-input fl-textarea"
          rows={6}
          value={n.body ?? ""}
          placeholder="What's asked, what's prefilled, what's still open…"
          onChange={(e) => mutate((d) => updateNode(d, n.id, { body: e.target.value }))}
        />
      </label>

      <div className="fl-field">
        <span>Kind</span>
        <div className="fl-kinds">
          {(Object.keys(KIND_LABEL) as NodeKind[]).map((k) => (
            <button
              key={k}
              type="button"
              className={k === n.kind ? "fl-kind is-on" : "fl-kind"}
              aria-pressed={k === n.kind}
              onClick={() => mutate((d) => updateNode(d, n.id, { kind: k }))}
            >
              <span className={`fl-swatch is-${k}`} aria-hidden />
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
        <p className="fl-hint">{KIND_HINT[n.kind]}</p>
      </div>
    </div>
  );
}
