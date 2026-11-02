// canvas-style spatial comments: teardrop pins projected from world space, a
// composer for new threads, and a draggable thread popover with replies,
// resolve, and image attachments (pasted screenshots re-encode small).

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Check, Cross, Link, Plus, Trash, Undo } from "./icons";
import { PersonAvatar } from "./person";
import { usePersonName } from "./people-directory";
import {
  applyMention,
  initialOf,
  isAgent,
  matchPeople,
  mentionQueryAt,
  mentionSegments,
  relTime,
  type AgentMeta,
  type CommentAnchor,
  type CommentThread,
  type Person,
} from "./model";

export type Transform = { x: number; y: number; scale: number };
export type Size = { w: number; h: number };

const POPOVER_W = 320;
/** Keep the popover (and its footer input) fully on-screen down to this height. */
const POPOVER_MIN_H = 168;
/** Fraction of the viewport height a thread popover may occupy at most. */
const POPOVER_MAX_VH = 0.67;
/** Longest edge of a stored image. Screenshots re-encode small so many fit in
 *  localStorage and the committed snapshot stays lean. */
const IMAGE_MAX_DIM = 1600;
/** Reject before decoding; downscaling brings the stored size far below this. */
const IMAGE_MAX_BYTES = 20 * 1024 * 1024;

/** Downscale + re-encode an image file to a compact data URL. Throws
 *  "unsupported" | "oversized" | "failed" so callers can map friendly copy. */
async function fileToImageData(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("unsupported");
  if (file.size > IMAGE_MAX_BYTES) throw new Error("oversized");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("failed");
  }
  const ratio = Math.min(1, IMAGE_MAX_DIM / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * ratio);
  const h = Math.round(bitmap.height * ratio);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("failed");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return canvas.toDataURL("image/webp", 0.82);
}

function attachErrorCopy(reason: string): string {
  if (reason === "unsupported") return "That file isn't an image.";
  if (reason === "oversized") return "Image is too large (max 20MB).";
  return "Couldn't attach that image.";
}

/** Local image-attachment state for a composer/reply box: pick, paste, clear. */
function useAttachment() {
  const [image, setImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const accept = useCallback(async (file: File | null | undefined) => {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      setImage(await fileToImageData(file));
    } catch (e) {
      setError(attachErrorCopy(e instanceof Error ? e.message : "failed"));
    } finally {
      setBusy(false);
    }
  }, []);

  const clear = useCallback(() => {
    setImage(null);
    setError(null);
  }, []);

  /** Pull an image out of a paste (screenshot → Cmd/Ctrl+V) if one is present. */
  const onPaste = useCallback(
    (e: React.ClipboardEvent) => {
      const item = Array.from(e.clipboardData.items).find((i) => i.type.startsWith("image/"));
      if (!item) return;
      e.preventDefault();
      void accept(item.getAsFile());
    },
    [accept],
  );

  return { image, error, busy, accept, clear, onPaste };
}

/** Icon button + hidden file input for picking an image. */
function AttachButton({
  onPick,
  disabled,
  small,
}: {
  onPick: (file: File | null | undefined) => void;
  disabled?: boolean;
  small?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          onPick(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        aria-label="Attach an image"
        title="Attach an image (or paste a screenshot)"
        className={small ? "rv-attach-btn is-small" : "rv-attach-btn"}
      >
        <Plus size={small ? 15 : 17} />
      </button>
    </>
  );
}

/** Thumbnail of a staged attachment with a remove control. */
function AttachPreview({ src, onRemove }: { src: string; onRemove: () => void }) {
  return (
    <div className="rv-attach-preview">
      <img src={src} alt="Attachment preview" />
      <button type="button" onClick={onRemove} aria-label="Remove attachment" className="rv-attach-remove">
        <Cross size={11} />
      </button>
    </div>
  );
}

// --- mentions -----------------------------------------------------------------
//
// Typing "@" opens a picker of everyone on the board. What gets stored is the
// person you PICKED (their verified email), not the text you typed — so a
// notification can never be conjured by typing an address into a comment, and
// editing the name back out of the body drops the mention with it.
//
// The menu renders in the popover's own flow rather than absolutely: .rv-popover
// is overflow:hidden (it has a 16px radius to protect), so a floating menu would
// be clipped at the top edge — and an in-flow list also can't drift when the
// popover is dragged mid-type.

/** How many names the picker offers before it stops being a menu and starts
 *  being a directory. Keep typing to narrow. */
const MENTION_MAX_ITEMS = 6;

/** The directory minus me: tagging yourself would only email yourself. */
function taggable(people: Person[], myEmail?: string): Person[] {
  const me = myEmail?.toLowerCase();
  return me ? people.filter((p) => p.email !== me) : people;
}

function useMentions(people: Person[], value: string, setValue: (v: string) => void) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<{ query: string; start: number } | null>(null);
  const [active, setActive] = useState(0);
  const [mentions, setMentions] = useState<string[]>([]);
  // Everyone picked in THIS box. Kept in a ref because it isn't rendered — it's
  // the lookup that turns the surviving "@Name" strings back into addresses.
  const picked = useRef<Person[]>([]);

  const matches = useMemo(
    () => (query ? matchPeople(people, query.query).slice(0, MENTION_MAX_ITEMS) : []),
    [people, query],
  );
  const open = query !== null && matches.length > 0;

  /** Recompute the stored addresses from what's actually left in the text. */
  const commit = useCallback(
    (next: string) => {
      setValue(next);
      setMentions(picked.current.filter((p) => next.includes(`@${p.name}`)).map((p) => p.email));
    },
    [setValue],
  );

  const sync = useCallback(
    (next: string, caret: number | null) => {
      const q = people.length > 0 && caret !== null ? mentionQueryAt(next, caret) : null;
      // A mention that's already been made is not a query. Picking inserts
      // "@Name " and the caret lands right after it, which reads back as the
      // query "Name " — so without this the menu re-opens on the name you just
      // chose, every time. Typing PAST it ("@Jane" → "@Jane Doe") no longer
      // matches, and the menu comes back, which is what you'd want.
      const done = q !== null && picked.current.some((p) => p.name.toLowerCase() === q.query.trim().toLowerCase());
      setQuery(done ? null : q);
      setActive(0);
    },
    [people.length],
  );

  const pick = useCallback(
    (person: Person) => {
      const el = ref.current;
      if (!el || !query) return;
      const { value: next, caret } = applyMention(value, query.start, el.selectionStart ?? value.length, person.name);
      if (!picked.current.some((p) => p.email === person.email)) picked.current.push(person);
      commit(next);
      setQuery(null);
      // After React writes the new value — setting the caret before it lands
      // puts the cursor back at the end of the old string.
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(caret, caret);
      });
    },
    [commit, query, value],
  );

  const onChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      commit(e.target.value);
      sync(e.target.value, e.target.selectionStart);
    },
    [commit, sync],
  );

  /** Arrow / caret moves: the query follows the cursor, not just typing. */
  const onCaret = useCallback(
    (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
      const el = e.currentTarget;
      sync(el.value, el.selectionStart);
    },
    [sync],
  );

  /** Returns true when the picker consumed the key, so the parent's own
   *  Enter-sends / Escape-closes handlers stay out of the way while it's open. */
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!open) return false;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => (i + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
        return true;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pick(matches[active] ?? matches[0]!);
        return true;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setQuery(null);
        return true;
      }
      return false;
    },
    [active, matches, open, pick],
  );

  const reset = useCallback(() => {
    picked.current = [];
    setMentions([]);
    setQuery(null);
  }, []);

  const menu = open ? (
    <div className="rv-mention-menu" role="listbox" aria-label="People">
      {matches.map((p, i) => (
        <button
          key={p.email}
          type="button"
          role="option"
          aria-selected={i === active}
          className={i === active ? "rv-mention-item is-active" : "rv-mention-item"}
          onMouseEnter={() => setActive(i)}
          // mousedown, not click: the default would blur the textarea first and
          // take the caret position the insert depends on with it.
          onMouseDown={(e) => {
            e.preventDefault();
            pick(p);
          }}
        >
          <Avatar name={p.name} email={p.email} size={22} />
          <span className="rv-mention-name">{p.name}</span>
          <span className="rv-mention-email">{p.email}</span>
        </button>
      ))}
    </div>
  ) : null;

  return { ref, menu, mentions, onChange, onCaret, onKeyDown, reset };
}

/** A message body with its mentions lit up. Names resolve from the item's own
 *  stored emails, so a hand-typed "@someone" renders as the plain text it is. */
function MsgBody({
  body,
  mentions,
  people,
  myEmail,
}: {
  body: string;
  mentions?: string[];
  people: Person[];
  myEmail?: string;
}) {
  const { segments, mine } = useMemo(() => {
    const byEmail = new Map(people.map((p) => [p.email, p.name]));
    const names: string[] = [];
    const self = new Set<string>();
    for (const email of mentions ?? []) {
      const name = byEmail.get(email);
      if (!name) continue;
      names.push(name);
      if (myEmail && email === myEmail.toLowerCase()) self.add(name);
    }
    return { segments: mentionSegments(body, names), mine: self };
  }, [body, mentions, people, myEmail]);

  return (
    <p className="rv-msg-body">
      {segments.map((s, i) =>
        s.mention ? (
          <span key={i} className={mine.has(s.text.slice(1)) ? "rv-mention is-me" : "rv-mention"}>
            {s.text}
          </span>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </p>
  );
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true,
  );
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return reduced;
}

/** Fades + rises a popover in on mount; rests at its pose under reduced motion. */
function useEnter(): boolean {
  const reduced = usePrefersReducedMotion();
  const [shown, setShown] = useState(reduced);
  useEffect(() => {
    if (reduced) return;
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, [reduced]);
  return shown;
}

function Avatar({ name, email, size = 28 }: { name: string; email?: string | null; size?: number }) {
  return <PersonAvatar name={name} email={email} size={size} className={`rv-avatar${isAgent(name) ? " is-agent" : ""}`} />;
}

/** A byline: the author's CURRENT name when the directory knows their email. */
function Author({ name, email }: { name: string; email?: string | null }) {
  const shown = usePersonName(email, name);
  return <span className={`rv-msg-author${isAgent(name) ? " is-agent" : ""}`}>{shown}</span>;
}

/** Provenance under an agent's message: what it ran, what it touched, how it was checked.
 *  Renders nothing for a human comment, which never carries meta. */
function MsgMeta({ meta }: { meta?: AgentMeta }) {
  if (!meta) return null;
  const { command, files, verified } = meta;
  if (!command && !files?.length && !verified) return null;
  return (
    <p className="rv-msg-meta">
      {command ? <span className="rv-meta-chip">{command}</span> : null}
      {files?.map((f) => (
        <span key={f} className="rv-meta-file">
          {f}
        </span>
      ))}
      {verified ? <span className="rv-meta-verified">{verified}</span> : null}
    </p>
  );
}

/** The teardrop marker. Bottom-left tip points at the anchored spot. Pointer
 *  events pass through raw so the overlay can arbitrate click-vs-drag. */
function Pin({
  label,
  selected,
  filled,
  agent,
  read,
  dragging,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  label?: string;
  selected?: boolean;
  filled?: boolean;
  /** Pinned by a skill rather than a person — tints the marker so agent threads
   *  are findable on the canvas without opening each one. */
  agent?: boolean;
  /** Seen by ME, personally (review_thread_reads). A read pin recedes — same
   *  shape and colour, less weight — so a lane of pins reads as "these three
   *  are new" at a glance without turning the canvas into a status board. */
  read?: boolean;
  dragging?: boolean;
  onPointerDown?: (e: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerMove?: (e: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerUp?: (e: React.PointerEvent<HTMLButtonElement>) => void;
}) {
  const enter = useEnter();
  return (
    <button
      type="button"
      title="Click to open · drag to move"
      onPointerDown={(e) => {
        e.stopPropagation();
        onPointerDown?.(e);
      }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className={`rv-pin${selected ? " is-selected" : ""}${agent ? " is-agent" : ""}${read ? " is-read" : ""}${dragging ? " is-dragging" : ""}`}
      style={{
        transform: enter ? (selected || dragging ? "scale(1.08)" : "scale(1)") : "scale(0.5) translateY(-4px)",
        opacity: enter ? 1 : 0,
      }}
    >
      {filled ? null : label}
    </button>
  );
}

/** Anchors a popover beside a pin, flipping to the left edge when it would
 *  overflow the viewport's right side. */
function popoverStyle(
  pinLeft: number,
  pinTop: number,
  size: Size,
): { left: number; top: number; width: number; maxHeight: number } {
  const flip = pinLeft + 20 + POPOVER_W > size.w;
  const left = flip ? pinLeft - 20 - POPOVER_W : pinLeft + 20;
  // Clamp the top so the whole popover fits between the margins, then cap its
  // height to whatever room is left below it — and never past 67% of the
  // viewport, so a long thread can't fill the screen.
  const top = Math.min(Math.max(12, pinTop - 20), Math.max(12, size.h - 12 - POPOVER_MIN_H));
  const maxHeight = Math.min(
    Math.round(size.h * POPOVER_MAX_VH),
    Math.max(POPOVER_MIN_H, size.h - top - 12),
  );
  return { left: Math.max(12, left), top, width: POPOVER_W, maxHeight };
}

function autoGrow(e: React.FormEvent<HTMLTextAreaElement>, max: number) {
  const el = e.currentTarget;
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, max)}px`;
}

/** One-time identity step, shown INSTEAD of the comment box on a reviewer's
 *  first comment — a titled ask, not another bare input that reads as the
 *  comment field (the reviewer, 2026-07-21). Committing the name reveals the composer. */
function NameStep({
  draft,
  onChange,
  onDone,
  onCancel,
}: {
  draft: string;
  onChange: (v: string) => void;
  onDone: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    ref.current?.focus();
  }, []);
  const can = draft.trim().length > 0;
  return (
    <div className="rv-name-step">
      <p className="rv-name-title">First, add your name</p>
      <p className="rv-name-hint">It appears next to every comment you leave — we only ask once.</p>
      <div className="rv-name-row">
        <input
          ref={ref}
          value={draft}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && can) onDone();
            if (e.key === "Escape") onCancel();
          }}
          placeholder="Your name"
          aria-label="Your name"
          className="rv-input"
        />
        <button type="button" onClick={onDone} disabled={!can} aria-label="Continue" className="rv-send">
          <Check size={15} />
        </button>
      </div>
    </div>
  );
}

function Composer({
  pinLeft,
  pinTop,
  size,
  reviewerName,
  people,
  myEmail,
  onSetReviewerName,
  onSubmit,
  onCancel,
}: {
  pinLeft: number;
  pinTop: number;
  size: Size;
  reviewerName: string;
  /** The whole directory; taggable() drops me before the picker sees it. */
  people: Person[];
  myEmail?: string;
  onSetReviewerName: (n: string) => void;
  onSubmit: (body: string, author: string, image?: string, mentions?: string[]) => void;
  onCancel: () => void;
}) {
  const enter = useEnter();
  const [body, setBody] = useState("");
  const [nameDraft, setNameDraft] = useState(reviewerName);
  const needsName = !reviewerName.trim();
  const attach = useAttachment();
  const mention = useMentions(taggable(people, myEmail), body, setBody);

  // NameStep focuses itself; once the name lands, focus flows to the comment.
  useLayoutEffect(() => {
    if (!needsName) mention.ref.current?.focus();
  }, [needsName, mention.ref]);

  const canSend = (body.trim().length > 0 || attach.image !== null) && !attach.busy && !needsName;

  const send = () => {
    if (!canSend) return;
    onSubmit(body.trim(), reviewerName, attach.image ?? undefined, mention.mentions);
  };

  return (
    <div
      role="dialog"
      aria-label="Add a comment"
      onPointerDown={(e) => e.stopPropagation()}
      className="rv-popover is-composer"
      style={{
        ...popoverStyle(pinLeft, pinTop, size),
        opacity: enter ? 1 : 0,
        transform: enter ? "translateY(0)" : "translateY(6px)",
      }}
    >
      {needsName ? (
        <NameStep
          draft={nameDraft}
          onChange={setNameDraft}
          onDone={() => {
            const n = nameDraft.trim();
            if (n) onSetReviewerName(n);
          }}
          onCancel={onCancel}
        />
      ) : (
        <>
          <div style={{ minHeight: 0, flex: 1, overflowY: "auto" }} data-rv-scroll>
            {attach.image ? <AttachPreview src={attach.image} onRemove={attach.clear} /> : null}
            {attach.error ? <p className="rv-error-text">{attach.error}</p> : null}
          </div>
          {mention.menu}
          <div className="rv-composer-row">
            <textarea
              ref={mention.ref}
              value={body}
              onChange={mention.onChange}
              onKeyUp={mention.onCaret}
              onClick={mention.onCaret}
              onPaste={attach.onPaste}
              onKeyDown={(e) => {
                if (mention.onKeyDown(e)) return;
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  onCancel();
                }
              }}
              rows={1}
              placeholder={people.length > 0 ? "Add a comment — @ to tag someone" : "Add a comment"}
              className="rv-textarea"
              style={{ height: "auto" }}
              onInput={(e) => autoGrow(e, 160)}
            />
            <AttachButton onPick={attach.accept} disabled={attach.busy} />
            <button type="button" onClick={send} disabled={!canSend} aria-label="Post comment" className="rv-send">
              <ArrowUp size={15} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** Copies a deep link to this thread; flashes a checkmark to confirm. */
function CopyLinkButton({ onCopy }: { onCopy: () => void | Promise<void> }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);
  useEffect(() => () => void (timerRef.current && window.clearTimeout(timerRef.current)), []);
  return (
    <button
      type="button"
      onClick={async () => {
        await onCopy();
        setCopied(true);
        if (timerRef.current) window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => setCopied(false), 1400);
      }}
      aria-label={copied ? "Link copied" : "Copy link to this comment"}
      title={copied ? "Link copied" : "Copy link to this comment"}
      className="rv-btn-icon"
    >
      {copied ? <Check size={14} /> : <Link size={14} />}
    </button>
  );
}

function ThreadPopover({
  thread,
  pinLeft,
  pinTop,
  size,
  reviewerName,
  people,
  myEmail,
  onSetReviewerName,
  onReply,
  onRemoveReply,
  onResolve,
  onRemove,
  onClose,
  onCopyLink,
}: {
  thread: CommentThread;
  pinLeft: number;
  pinTop: number;
  size: Size;
  reviewerName: string;
  /** The whole directory, me included — rendering an existing "@Jane" needs my
   *  name to resolve. The picker drops me; taggable() does that. */
  people: Person[];
  myEmail?: string;
  onSetReviewerName: (n: string) => void;
  onReply: (body: string, author: string, image?: string, mentions?: string[]) => void;
  onRemoveReply: (replyId: string) => void;
  onResolve: (resolved: boolean) => void;
  onRemove: () => void;
  onClose: () => void;
  onCopyLink: () => void | Promise<void>;
}) {
  const enter = useEnter();
  const [reply, setReply] = useState("");
  const [nameDraft, setNameDraft] = useState(reviewerName);
  const needsName = !reviewerName.trim();
  const attach = useAttachment();
  const mention = useMentions(taggable(people, myEmail), reply, setReply);

  // Drag offset from the pin-anchored position, so a low-opening thread can be
  // pulled up to read comfortably. Resets whenever a different thread opens.
  const [drag, setDrag] = useState({ dx: 0, dy: 0 });
  const dragFrom = useRef<{ x: number; y: number; dx: number; dy: number } | null>(null);
  useEffect(() => {
    setDrag({ dx: 0, dy: 0 });
  }, [thread.id]);

  const base = popoverStyle(pinLeft, pinTop, size);
  const clampN = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
  const left = clampN(base.left + drag.dx, 12 - POPOVER_W + 96, size.w - 96);
  const top = clampN(base.top + drag.dy, 12, Math.max(12, size.h - 12 - POPOVER_MIN_H));
  // Recompute the cap from the dragged position: pulling the modal up frees
  // room below, so a long thread grows back toward the 67% ceiling.
  const maxHeight = Math.min(
    Math.round(size.h * POPOVER_MAX_VH),
    Math.max(POPOVER_MIN_H, size.h - top - 12),
  );

  const canSendReply = (reply.trim().length > 0 || attach.image !== null) && !attach.busy && !needsName;

  const sendReply = () => {
    if (!canSendReply) return;
    onReply(reply.trim(), reviewerName, attach.image ?? undefined, mention.mentions);
    setReply("");
    attach.clear();
    mention.reset();
  };

  return (
    <div
      role="dialog"
      aria-label={`Comment by ${thread.author}`}
      onPointerDown={(e) => e.stopPropagation()}
      className="rv-popover"
      style={{
        left,
        top,
        width: base.width,
        maxHeight,
        opacity: enter ? 1 : 0,
        transform: enter ? "translateY(0)" : "translateY(6px)",
      }}
    >
      <div
        className="rv-popover-head"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("button")) return;
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          dragFrom.current = { x: e.clientX, y: e.clientY, dx: drag.dx, dy: drag.dy };
        }}
        onPointerMove={(e) => {
          const f = dragFrom.current;
          if (!f) return;
          setDrag({ dx: f.dx + (e.clientX - f.x), dy: f.dy + (e.clientY - f.y) });
        }}
        onPointerUp={(e) => {
          dragFrom.current = null;
          e.currentTarget.releasePointerCapture?.(e.pointerId);
        }}
      >
        <span className="rv-title">Comment</span>
        <div className="rv-actions">
          <CopyLinkButton onCopy={onCopyLink} />
          <button
            type="button"
            onClick={() => onResolve(!thread.resolved)}
            aria-label={thread.resolved ? "Reopen" : "Resolve"}
            title={thread.resolved ? "Reopen" : "Resolve (keeps the comment in the board file)"}
            className={thread.resolved ? "rv-btn-icon is-resolved" : "rv-btn-icon"}
          >
            {thread.resolved ? <Undo size={14} /> : <Check size={15} />}
          </button>
          <button
            type="button"
            onClick={() => {
              if (window.confirm("Delete this comment thread? It's removed for everyone.")) onRemove();
            }}
            aria-label="Delete comment"
            title="Delete this comment thread"
            className="rv-btn-icon is-danger"
          >
            <Trash size={14} />
          </button>
          <button type="button" onClick={onClose} aria-label="Close" className="rv-btn-icon">
            <Cross size={15} />
          </button>
        </div>
      </div>

      <div className="rv-popover-body" data-rv-scroll>
        <div className="rv-msg">
          <Avatar name={thread.author} email={thread.authorEmail} />
          <div className="rv-msg-main">
            <div className="rv-msg-head">
              <Author name={thread.author} email={thread.authorEmail} />
              <span className="rv-time">{relTime(thread.at)}</span>
            </div>
            {/* Byline, not a footnote — provenance sits above the body so it's readable
                without scrolling past a long finding. */}
            <MsgMeta meta={thread.meta} />
            {thread.body ? (
              <MsgBody body={thread.body} mentions={thread.mentions} people={people} myEmail={myEmail} />
            ) : null}
            {thread.image ? <img className="rv-attached-img" src={thread.image} alt="Attached screenshot" /> : null}
          </div>
        </div>

        {thread.replies.map((r) => (
          <div key={r.id} className="rv-msg">
            <Avatar name={r.author} email={r.email} size={24} />
            <div className="rv-msg-main">
              <div className="rv-msg-head">
                <Author name={r.author} email={r.email} />
                <span className="rv-time">{relTime(r.at)}</span>
                <button type="button" onClick={() => onRemoveReply(r.id)} className="rv-reply-delete">
                  Delete
                </button>
              </div>
              <MsgMeta meta={r.meta} />
              {r.body ? (
                <MsgBody body={r.body} mentions={r.mentions} people={people} myEmail={myEmail} />
              ) : null}
              {r.image ? <img className="rv-attached-img" src={r.image} alt="Attached screenshot" /> : null}
            </div>
          </div>
        ))}
      </div>

      <div className="rv-popover-foot">
        {needsName ? (
          <NameStep
            draft={nameDraft}
            onChange={setNameDraft}
            onDone={() => {
              const n = nameDraft.trim();
              if (n) onSetReviewerName(n);
            }}
            onCancel={onClose}
          />
        ) : (
          <>
            {attach.image ? <AttachPreview src={attach.image} onRemove={attach.clear} /> : null}
            {attach.error ? <p className="rv-error-text">{attach.error}</p> : null}
            {mention.menu}
            <div className="rv-reply-row">
              <Avatar name={reviewerName} email={myEmail} size={24} />
              <textarea
                ref={mention.ref}
                value={reply}
                onChange={mention.onChange}
                onKeyUp={mention.onCaret}
                onClick={mention.onCaret}
                onPaste={attach.onPaste}
                onKeyDown={(e) => {
                  if (mention.onKeyDown(e)) return;
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendReply();
                  }
                  if (e.key === "Escape") onClose();
                }}
                rows={1}
                placeholder="Reply"
                className="rv-textarea"
                style={{ maxHeight: 128, minHeight: 36 }}
                onInput={(e) => autoGrow(e, 128)}
              />
              <AttachButton onPick={attach.accept} disabled={attach.busy} small />
              <button
                type="button"
                onClick={sendReply}
                disabled={!canSendReply}
                aria-label="Send reply"
                className="rv-send is-small"
              >
                <ArrowUp size={13} />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function CommentsOverlay({
  transform,
  size,
  threads,
  showComments,
  showResolved,
  reviewerName,
  people,
  myEmail,
  unread,
  pending,
  onSetReviewerName,
  onCancelPending,
  onCreate,
  selectedId,
  onSelect,
  onReply,
  onRemoveReply,
  onResolve,
  onRemove,
  onMove,
  onCopyLink,
  anchorToWorld,
}: {
  transform: Transform;
  size: Size;
  threads: CommentThread[];
  /** When false, pins and open threads are hidden (composer for a new pin still shows). */
  showComments: boolean;
  showResolved: boolean;
  reviewerName: string;
  /** The board's people directory (me included — see MsgBody / taggable). */
  people: Person[];
  myEmail?: string;
  /** Thread ids with something in them I haven't seen. Personal, never shared. */
  unread: Set<string>;
  onSetReviewerName: (n: string) => void;
  pending: { anchor: CommentAnchor } | null;
  onCancelPending: () => void;
  onCreate: (anchor: CommentAnchor, body: string, author: string, image?: string, mentions?: string[]) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onReply: (id: string, body: string, author: string, image?: string, mentions?: string[]) => void;
  onRemoveReply: (id: string, replyId: string) => void;
  onResolve: (id: string, resolved: boolean) => void;
  onRemove: (id: string) => void;
  /** Reposition a pin; deltas are in anchor units (screen-space px). */
  onMove: (id: string, ddx: number, ddy: number) => void;
  onCopyLink: (id: string) => void | Promise<void>;
  anchorToWorld: (a: CommentAnchor) => { x: number; y: number };
}) {
  const project = (a: CommentAnchor) => {
    const w = anchorToWorld(a);
    return { left: w.x * transform.scale + transform.x, top: w.y * transform.scale + transform.y };
  };

  const selected = showComments ? (threads.find((t) => t.id === selectedId) ?? null) : null;

  // Click-vs-drag arbitration for pins: a press only becomes a move past the
  // slop, so plain clicks still open/close the thread. The pixel offset lives
  // in state for rendering; the ref is the ground truth for handlers.
  const DRAG_SLOP = 4;
  const pinDragRef = useRef<{ id: string; sx: number; sy: number; moved: boolean } | null>(null);
  const [pinDrag, setPinDrag] = useState<{ id: string; dx: number; dy: number } | null>(null);

  const pinHandlers = (t: CommentThread) => ({
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      pinDragRef.current = { id: t.id, sx: e.clientX, sy: e.clientY, moved: false };
    },
    onPointerMove: (e: React.PointerEvent<HTMLButtonElement>) => {
      const d = pinDragRef.current;
      if (!d || d.id !== t.id) return;
      const dx = e.clientX - d.sx;
      const dy = e.clientY - d.sy;
      if (!d.moved && Math.hypot(dx, dy) < DRAG_SLOP) return;
      d.moved = true;
      setPinDrag({ id: t.id, dx, dy });
    },
    onPointerUp: (e: React.PointerEvent<HTMLButtonElement>) => {
      const d = pinDragRef.current;
      pinDragRef.current = null;
      e.currentTarget.releasePointerCapture?.(e.pointerId);
      setPinDrag(null);
      if (!d) return;
      if (d.moved) {
        onMove(t.id, (e.clientX - d.sx) / transform.scale, (e.clientY - d.sy) / transform.scale);
      } else {
        onSelect(selectedId === t.id ? null : t.id);
      }
    },
  });

  return (
    <div className="rv-overlay">
      {/* Markers */}
      {showComments
        ? threads.map((t) => {
            if (t.resolved && !showResolved) return null;
            const p = project(t.anchor);
            const dragging = pinDrag?.id === t.id;
            const left = p.left + (dragging ? pinDrag.dx : 0);
            const top = p.top + (dragging ? pinDrag.dy : 0);
            // Cull markers well outside the viewport.
            if (left < -60 || top < -60 || left > size.w + 60 || top > size.h + 60) return null;
            return (
              <div
                key={t.id}
                className={t.resolved ? "rv-marker is-resolved" : "rv-marker"}
                style={{ left, top }}
              >
                <Pin
                  label={initialOf(t.author)}
                  agent={isAgent(t.author)}
                  read={!unread.has(t.id)}
                  selected={selectedId === t.id}
                  dragging={dragging}
                  {...pinHandlers(t)}
                />
              </div>
            );
          })
        : null}

      {/* Pending composer + its draft pin */}
      {pending
        ? (() => {
            const p = project(pending.anchor);
            return (
              <>
                <div className="rv-marker" style={{ left: p.left, top: p.top }}>
                  <Pin filled />
                </div>
                <Composer
                  pinLeft={p.left}
                  pinTop={p.top}
                  size={size}
                  reviewerName={reviewerName}
                  people={people}
                  myEmail={myEmail}
                  onSetReviewerName={onSetReviewerName}
                  onSubmit={(body, author, image, mentions) =>
                    onCreate(pending.anchor, body, author, image, mentions)
                  }
                  onCancel={onCancelPending}
                />
              </>
            );
          })()
        : null}

      {/* Open thread */}
      {selected && !pending
        ? (() => {
            const p = project(selected.anchor);
            return (
              <ThreadPopover
                thread={selected}
                pinLeft={p.left}
                pinTop={p.top}
                size={size}
                reviewerName={reviewerName}
                people={people}
                myEmail={myEmail}
                onSetReviewerName={onSetReviewerName}
                onReply={(body, author, image, mentions) => onReply(selected.id, body, author, image, mentions)}
                onRemoveReply={(replyId) => onRemoveReply(selected.id, replyId)}
                onResolve={(resolved) => onResolve(selected.id, resolved)}
                onRemove={() => {
                  onRemove(selected.id);
                  onSelect(null);
                }}
                onClose={() => onSelect(null)}
                onCopyLink={() => onCopyLink(selected.id)}
              />
            );
          })()
        : null}
    </div>
  );
}
