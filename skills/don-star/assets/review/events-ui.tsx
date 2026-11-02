// The events layer (the reviewer, 2026-08-03, third pass): NOTHING is authored in
// code — a reviewer documents what the system does at a screen ("confirmation
// email fires here", "order-created webhook") by ADDING AN EVENT, and the
// events render directly below the frame on the canvas, always visible.
//
// An event is a comment thread carrying meta.docKind (see isDocNote in
// model.ts): it reuses the whole thread machinery — Supabase sync + realtime,
// the committed review-board.json snapshot, email notifications, the triage
// feed — but renders here, never as a pin or in the Comments tab.
//
// The list lives in WORLD space under each frame (it scales with zoom, like
// the sign-off bar above it); the composer opens in a popover that
// counter-scales by 1/zoom so typing works at any canvas scale — pass
// `popScale`.

import { useEffect, useRef, useState, type ComponentType } from "react";
import { Bell, Chat, Code, Envelope, Info, Plus, Trash, Zap } from "./icons";
import { isAgent, relTime, type CommentThread, type DocKind } from "./model";
import { PersonAvatar } from "./person";
import { usePersonName } from "./people-directory";

/** Color groups (the reviewer, 2026-08-03): outbound comms yellow, integration hooks
 *  orange, notes blue. `group` keys the .rv-event-card is-* class → --rv-ev. */
const EVENT_KIND_META: Record<
  DocKind,
  { label: string; group: "comms" | "hook" | "note"; Icon: ComponentType<{ size?: number }> }
> = {
  email: { label: "Email", group: "comms", Icon: Envelope },
  push: { label: "Push", group: "comms", Icon: Bell },
  sms: { label: "SMS", group: "comms", Icon: Chat },
  webhook: { label: "Webhook", group: "hook", Icon: Zap },
  api: { label: "API", group: "hook", Icon: Code },
  note: { label: "Note", group: "note", Icon: Info },
};

/** Kind order for the composer — outbound comms first. */
const KIND_ORDER: DocKind[] = ["email", "push", "sms", "webhook", "api", "note"];

/** Shared dismissal: outside pointerdown or Escape closes. */
function useDismiss(open: boolean, ref: React.RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}

function EventCard({ event, onRemove }: { event: CommentThread; onRemove: () => void }) {
  const kind = event.meta?.docKind ?? "note";
  const { label, group, Icon } = EVENT_KIND_META[kind];
  // Author identity in the comments grammar: same avatar (agent squircle +
  // hue included) and name treatment a thread renders, so a person reads the
  // same wherever they write.
  const agent = isAgent(event.author);
  const authorName = usePersonName(event.authorEmail, event.author);
  return (
    <article className={`rv-event-card is-${group}`}>
      <header className="rv-event-head">
        <span className="rv-event-kind">
          <Icon size={12} />
          {label}
        </span>
        <PersonAvatar name={event.author} email={event.authorEmail} size={18} className={agent ? "rv-avatar is-agent" : "rv-avatar"} />
        <span className={agent ? "rv-msg-author is-agent" : "rv-msg-author"} style={{ fontSize: 11.5 }} title={authorName}>
          {authorName}
        </span>
        <span className="rv-time" style={{ fontSize: 11 }}>{relTime(event.at)}</span>
        <button type="button" className="rv-event-del" title="Delete this event" onClick={onRemove}>
          <Trash size={12} />
        </button>
      </header>
      <p className="rv-event-body">{event.body}</p>
    </article>
  );
}

function EventComposer({
  reviewerName,
  onSetReviewerName,
  onSubmit,
  onCancel,
}: {
  reviewerName: string;
  onSetReviewerName: (n: string) => void;
  onSubmit: (kind: DocKind, body: string, author: string) => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<DocKind>("email");
  const [body, setBody] = useState("");
  const [name, setName] = useState(reviewerName);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    boxRef.current?.focus();
  }, []);

  const submit = () => {
    const text = body.trim();
    const author = (reviewerName || name).trim();
    if (!text || !author) return;
    if (!reviewerName) onSetReviewerName(author);
    onSubmit(kind, text, author);
  };

  return (
    <div className="rv-event-compose">
      <div className="rv-event-kinds" role="radiogroup" aria-label="Event kind">
        {KIND_ORDER.map((k) => {
          const { label, group, Icon } = EVENT_KIND_META[k];
          return (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              className={`rv-doc-chip is-${group}${kind === k ? " is-on" : ""}`}
              onClick={() => setKind(k)}
            >
              <Icon size={12} />
              {label}
            </button>
          );
        })}
      </div>
      <textarea
        ref={boxRef}
        className="rv-event-input"
        rows={3}
        placeholder="What happens at this screen? e.g. “Confirmation email — subject ‘Your order is confirmed’, sent on checkout.”"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
        }}
      />
      {!reviewerName ? (
        <input
          className="rv-event-input is-name"
          placeholder="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      ) : null}
      <div className="rv-event-compose-foot">
        <button type="button" className="rv-doc-chip" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="rv-doc-chip is-save"
          disabled={!body.trim() || !(reviewerName || name).trim()}
          onClick={submit}
        >
          Add event
        </button>
      </div>
    </div>
  );
}

/** The event list docked directly below a canvas frame, always visible, plus
 *  the + button any reviewer can use to add one. */
export function ScreenEvents({
  events,
  scope,
  popScale = 1,
  reviewerName,
  onSetReviewerName,
  onAdd,
  onRemove,
}: {
  /** Unresolved doc-note threads anchored to this screen, oldest first. */
  events: CommentThread[];
  scope: string;
  popScale?: number;
  reviewerName: string;
  onSetReviewerName: (n: string) => void;
  onAdd: (kind: DocKind, body: string, author: string) => void;
  onRemove: (id: string) => void;
}) {
  const [composing, setComposing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(composing, ref, () => setComposing(false));

  return (
    <div ref={ref} className="rv-events" onPointerDown={(e) => e.stopPropagation()}>
      {events.map((ev) => (
        <EventCard key={ev.id} event={ev} onRemove={() => onRemove(ev.id)} />
      ))}
      <button
        type="button"
        className={events.length ? "rv-event-add" : "rv-doc-chip is-ghost"}
        onClick={() => setComposing(true)}
        title={`Document an event on ${scope} — an email, push, webhook, or technical note`}
      >
        <Plus size={11} />
        Add event
      </button>
      {composing ? (
        <div
          className="rv-doc-pop"
          role="dialog"
          aria-label={`Add an event to ${scope}`}
          style={popScale !== 1 ? { transform: `scale(${popScale})`, transformOrigin: "top left" } : undefined}
        >
          <div className="rv-doc-pop-head">
            Event · <span>{scope}</span>
          </div>
          <EventComposer
            reviewerName={reviewerName}
            onSetReviewerName={onSetReviewerName}
            onSubmit={(kind, body, author) => {
              onAdd(kind, body, author);
              setComposing(false);
            }}
            onCancel={() => setComposing(false)}
          />
        </div>
      ) : null}
    </div>
  );
}
