// Cursor chat, reactions and the board's right-click menu.
//
//   · Press / (or right-click → Chat) and the bubble REPLACES your pointer:
//     what you type shows on your cursor for everyone AS you type, Enter sends
//     it (it stays five seconds), Escape or a click away closes it.
//   · Press 1 to 8 and a burst of that reaction floats up from your pointer
//     on everyone's screen (hold the key for more). E opens the same eight as
//     a wheel, with the numbers on it, for when you don't know them yet.
//   · Right-click the board for the menu: Chat, the reactions, whatever the
//     board offers for the spot under the pointer (`items`, from app.tsx).
//     Shift+right-click (or right-clicking again) is the browser's own menu.
// Nothing is stored (presence.ts).
//
// Keys and right-clicks are heard on the board and inside its same-origin
// frames (the slides stage takes the pointer there), never while typing.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  boardCenter,
  CHAT_MAX,
  CHAT_SENT_MS,
  colorCss,
  inkOn,
  REACTIONS,
  type PresenceApi,
  type PresenceColor,
} from "./presence";

/** An open, empty bubble closes after this long untouched. */
const CHAT_IDLE_MS = 8000;
/** The hidden note ("turn on Show me to others") shows this long. */
const NOTE_MS = 2600;
/** The wheel's radius, px, centre to each emoji's centre. */
const WHEEL_R = 58;
/** The menu keeps this far from the window's edges. */
const EDGE = 8;

const BOARD_SEL = ".rv-canvas, .rv-slides-stage";

type Point = { x: number; y: number };

/** One row the board adds to the right-click menu for the spot clicked. */
export type BoardMenuItem = {
  id: string;
  label: string;
  icon?: ReactNode;
  /** The shortcut, shown at the row's end. */
  kbd?: string;
  onSelect: () => void;
};
/** Rows in groups; the menu draws a line between groups. */
export type BoardMenuItems = (at: Point) => BoardMenuItem[][];

/** Widgets that take keys themselves (a screen's own form fields and pickers). */
const KEYED_ROLES = new Set(["textbox", "searchbox", "combobox", "spinbutton", "slider", "listbox", "radiogroup", "grid", "menu"]);

function keyed(el: Element | null): boolean {
  const e = el as HTMLElement | null;
  if (!e || typeof e.tagName !== "string") return false;
  if (e.tagName === "INPUT" || e.tagName === "TEXTAREA" || e.tagName === "SELECT" || e.isContentEditable) return true;
  const role = e.closest?.("[role]")?.getAttribute("role");
  return role != null && KEYED_ROLES.has(role);
}

/** Focus, followed down through same-origin frames to where it really is. */
function deepFocus(): Element | null {
  let el: Element | null = document.activeElement;
  for (let hops = 0; el?.tagName === "IFRAME" && hops < 4; hops++) {
    try {
      el = (el as HTMLIFrameElement).contentDocument?.activeElement ?? null;
    } catch {
      return el;
    }
  }
  return el;
}

/** Someone is using a field, on the board or in a screen: its keys are
 *  theirs, so / and 1 to 8 (and our right-click) leave it alone. Our own
 *  menu's buttons don't count. */
function typingIn(e: Event, focusToo = true): boolean {
  if ((e as KeyboardEvent).isComposing) return true;
  const target = (e.composedPath?.()[0] ?? e.target) as Element | null;
  const focus = focusToo ? deepFocus() : null;
  return [target, focus].some((el) => keyed(el) && !el?.closest?.(".rv-board-menu, .rv-wheel"));
}

/** Every same-origin frame's document, with its frame (to map points out). */
function frameDocs(): { doc: Document; frame: HTMLIFrameElement }[] {
  return Array.from(document.querySelectorAll("iframe")).flatMap((frame) => {
    try {
      return frame.contentDocument ? [{ doc: frame.contentDocument, frame }] : [];
    } catch {
      return [];
    }
  });
}

/** A point inside a frame, in the board's client coordinates. */
function outOfFrame(frame: HTMLIFrameElement, x: number, y: number): Point {
  const r = frame.getBoundingClientRect();
  const k = frame.offsetWidth ? r.width / frame.offsetWidth : 1;
  return { x: r.left + x * k, y: r.top + y * k };
}

/** Listen on the board's document and every same-origin frame, re-scanning
 *  for frames as they come and go (a slide change brings a new document). */
function useEverywhere<K extends keyof DocumentEventMap>(
  type: K,
  handler: (e: DocumentEventMap[K], frame: HTMLIFrameElement | null) => void,
) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const top = (e: Event) => ref.current(e as DocumentEventMap[K], null);
    window.addEventListener(type, top, true);
    const framed = new Map<Document, () => void>();
    const scan = () => {
      for (const { doc, frame } of frameDocs()) {
        if (framed.has(doc)) continue;
        const fn = (e: Event) => ref.current(e as DocumentEventMap[K], frame);
        doc.addEventListener(type, fn, true);
        framed.set(doc, () => doc.removeEventListener(type, fn, true));
      }
      for (const [doc, off] of framed) {
        if (!doc.defaultView) {
          off();
          framed.delete(doc);
        }
      }
    };
    scan();
    const id = window.setInterval(scan, 1500);
    return () => {
      window.removeEventListener(type, top, true);
      window.clearInterval(id);
      for (const off of framed.values()) off();
    };
  }, [type]);
}

/** Hide the pointer (board and frames) while something stands in for it. */
function useHideCursor(on: boolean) {
  useEffect(() => {
    if (!on) return;
    const tags = [document, ...frameDocs().map((f) => f.doc)].map((d) => {
      const tag = d.createElement("style");
      tag.textContent = "*, *::before, *::after { cursor: none !important; }";
      d.head?.appendChild(tag);
      return tag;
    });
    return () => tags.forEach((t) => t.remove());
  }, [on]);
}

/** Keep an element's top-left on the pointer each frame, inside the window. */
function useRidePointer(on: boolean, el: React.RefObject<HTMLElement | null>, pointer: () => Point | null) {
  const pointerFn = useRef(pointer);
  pointerFn.current = pointer;
  // A layout effect: placed before the first paint, so it never flashes at
  // the window's corner and slides in.
  useLayoutEffect(() => {
    if (!on) return;
    let raf = 0;
    const frame = () => {
      const p = pointerFn.current();
      const node = el.current;
      if (p && node) {
        const x = Math.max(EDGE, Math.min(p.x, window.innerWidth - node.offsetWidth - EDGE));
        const y = Math.max(EDGE, Math.min(p.y, window.innerHeight - node.offsetHeight - EDGE));
        node.style.transform = `translate(${x}px, ${y}px)`;
      }
      raf = requestAnimationFrame(frame);
    };
    frame();
    return () => cancelAnimationFrame(raf);
  }, [on, el]);
}

export function CursorChat({
  presence,
  color,
  hidden,
  items,
}: {
  presence: PresenceApi;
  color: PresenceColor;
  /** "Show me to others" off: nobody would see it, so say so instead. */
  hidden: boolean;
  /** The board's own right-click rows for the spot clicked. */
  items?: BoardMenuItems;
}) {
  const { pointerRef, park, sendChat, react, stopReactions } = presence;
  const [chat, setChat] = useState(false);
  const [text, setText] = useState("");
  const [sent, setSent] = useState<{ text: string; at: number } | null>(null);
  const [wheel, setWheel] = useState<Point | null>(null);
  const [menu, setMenu] = useState<{ at: Point; groups: BoardMenuItem[][] } | null>(null);
  const [note, setNote] = useState<Point | null>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const menuEl = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const idle = useRef<number | undefined>(undefined);
  const sentRef = useRef(sent);
  sentRef.current = sent;

  /** Where to open: my pointer if it's on the board, else the board's middle
   *  (and my cursor goes there, so others see the bubble). */
  const anchor = useCallback((): Point | null => {
    const p = pointerRef.current;
    const onBoard = p && document.elementFromPoint(p.x, p.y)?.closest(BOARD_SEL);
    if (p && onBoard) return p;
    const c = boardCenter();
    if (c) park(c.x, c.y);
    return c;
  }, [pointerRef, park]);

  const close = useCallback(
    (keepSent: boolean) => {
      window.clearTimeout(idle.current);
      setChat(false);
      setText("");
      const s = sentRef.current;
      const live = keepSent && s && Date.now() - s.at < CHAT_SENT_MS ? s.text : null;
      if (!live) {
        // Now, not at the next render: the field's blur on unmount closes
        // again and must not bring a withdrawn line back.
        sentRef.current = null;
        setSent(null);
      }
      sendChat("", live);
    },
    [sendChat],
  );

  const armIdle = useCallback(() => {
    window.clearTimeout(idle.current);
    idle.current = window.setTimeout(() => {
      if (!input.current?.value) close(true);
    }, CHAT_IDLE_MS);
  }, [close]);

  // Exactly where the mouse was.
  const fire = useCallback(
    (emoji: (typeof REACTIONS)[number], at: Point) => void react(emoji, at.x, at.y),
    [react],
  );

  const openChat = useCallback(() => {
    setWheel(null);
    setMenu(null);
    setChat(true);
  }, []);

  // The keys: / opens chat, 1 to 8 react at the pointer, E toggles the wheel.
  const stateRef = useRef({ chat, wheel, hidden, menu });
  stateRef.current = { chat, wheel, hidden, menu };
  useEverywhere("keydown", (e) => {
    // Escape stops every reaction at once, wherever the keyboard is.
    if (e.key === "Escape") stopReactions();
    if (e.metaKey || e.ctrlKey || e.altKey || typingIn(e)) return;
    const s = stateRef.current;
    if (s.chat) return;
    const i = /^[1-8]$/.test(e.key) ? Number(e.key) - 1 : -1;
    if (s.menu) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        setMenu(null);
      } else if (i >= 0 && !s.hidden) {
        e.preventDefault();
        setMenu(null);
        fire(REACTIONS[i]!, s.menu.at);
      }
      return;
    }
    if (i >= 0) {
      // From the wheel's spot while it's open, else from the pointer; off the
      // board there is nowhere to show it, so the key does nothing.
      const p = s.wheel ?? pointerRef.current;
      if (!p || !document.elementFromPoint(p.x, p.y)?.closest(BOARD_SEL + ", .rv-wheel")) return;
      e.preventDefault();
      if (s.hidden) {
        if (!e.repeat) setNote(p);
        return;
      }
      setWheel(null);
      fire(REACTIONS[i]!, p);
      return;
    }
    if (s.wheel) {
      if (e.key === "Escape" || e.key === "e" || e.key === "E") {
        e.preventDefault();
        e.stopImmediatePropagation();
        setWheel(null);
        return;
      }
    }
    if (e.key !== "/" && e.key !== "e" && e.key !== "E") return;
    if (e.repeat) return;
    const at = anchor();
    if (!at) return;
    e.preventDefault();
    if (s.hidden) setNote(at);
    else if (e.key === "/") openChat();
    else setWheel(at);
  });

  // Right-click on the board opens our menu. Shift+right-click, or a second
  // right-click while ours is open, is the browser's own (its Inspect).
  useEverywhere("contextmenu", (e, frame) => {
    if (e.shiftKey || typingIn(e, false)) return;
    if (stateRef.current.menu) {
      if ((e.target as Element | null)?.closest?.(".rv-board-menu")) return;
      setMenu(null);
      return;
    }
    const at = frame ? outOfFrame(frame, e.clientX, e.clientY) : { x: e.clientX, y: e.clientY };
    const onBoard = frame
      ? Boolean(frame.closest(BOARD_SEL))
      : Boolean((e.target as Element | null)?.closest?.(BOARD_SEL));
    if (!onBoard) return;
    e.preventDefault();
    if (stateRef.current.chat) close(true);
    setWheel(null);
    setMenu({ at, groups: (items?.(at) ?? []).filter((g) => g.length) });
  });

  // The menu and the wheel close on a press outside them (in a frame too).
  useEverywhere("pointerdown", (e) => {
    const inside = (e.target as Element | null)?.closest?.(".rv-wheel, .rv-board-menu");
    if (inside) return;
    setWheel(null);
    // A right-press is about to open a fresh menu; let it.
    if (e.button !== 2) setMenu(null);
  });

  // Open: focus the field (out of a frame, too) and start the idle clock.
  useEffect(() => {
    if (!chat) return;
    input.current?.focus({ preventScroll: true });
    armIdle();
    return () => window.clearTimeout(idle.current);
  }, [chat, armIdle]);

  // The bubble IS my cursor while I chat, and rides it after, like a label.
  const here = () => pointerRef.current ?? boardCenter();
  useRidePointer(chat || Boolean(sent), bubble, here);
  useHideCursor(chat);

  // A sent line outlives a closed bubble for its five seconds.
  useEffect(() => {
    if (!sent) return;
    const id = window.setTimeout(() => setSent(null), Math.max(0, CHAT_SENT_MS - (Date.now() - sent.at)));
    return () => window.clearTimeout(id);
  }, [sent]);

  useEffect(() => {
    if (!note) return;
    const id = window.setTimeout(() => setNote(null), NOTE_MS);
    return () => window.clearTimeout(id);
  }, [note]);

  // The menu opens at the pointer, flipped in from any edge it would cross,
  // and takes the keyboard (arrows walk it; Escape closes, above).
  useLayoutEffect(() => {
    const el = menuEl.current;
    if (!menu || !el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const x = menu.at.x + w + EDGE > window.innerWidth ? Math.max(EDGE, menu.at.x - w) : menu.at.x;
    const y = menu.at.y + h + EDGE > window.innerHeight ? Math.max(EDGE, window.innerHeight - h - EDGE) : menu.at.y;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.querySelector<HTMLElement>("[role=menuitem]")?.focus({ preventScroll: true });
  }, [menu]);
  const walkMenu = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const all = Array.from(menuEl.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? []);
    const i = all.indexOf(document.activeElement as HTMLElement);
    all[(i + (e.key === "ArrowDown" ? 1 : all.length - 1)) % all.length]?.focus();
  };
  const pick = (fn: () => void) => () => {
    setMenu(null);
    fn();
  };

  const paint = { ["--rv-pc" as string]: colorCss(color), ["--rv-pi" as string]: inkOn(color) } as CSSProperties;
  const showSent = sent && !text ? sent.text : null;

  return (
    <>
      {chat || showSent ? (
        <div ref={bubble} className={chat ? "rv-chat rv-presence-ui is-open" : "rv-chat rv-presence-ui"} style={paint}>
          {showSent && chat ? (
            <div className="rv-chat-sent" dir="auto">
              {showSent}
            </div>
          ) : null}
          {chat ? (
            // The whole line shows: the field grows with what's typed (its
            // twin in ::after sets the size), then wraps at the bubble's cap.
            <span className="rv-chat-grow" data-value={text || "Say something"}>
              <textarea
                ref={input}
                className="rv-chat-input"
                dir="auto"
                rows={1}
                value={text}
                maxLength={CHAT_MAX}
                placeholder="Say something"
                aria-label="Cursor chat. Enter sends, Escape closes."
                onChange={(e) => {
                  // Deleting it all takes it back: the bubble goes at once,
                  // here and on every screen, sent line and all.
                  if (!e.target.value && text) return close(false);
                  setText(e.target.value);
                  sendChat(e.target.value, sentRef.current?.text ?? null);
                  armIdle();
                }}
                onBlur={() => close(true)}
                onKeyDown={(e) => {
                  // Ours alone: the board's Escape (and its shortcuts) must
                  // not also fire while the bubble has the keyboard.
                  e.nativeEvent.stopImmediatePropagation();
                  if (e.key === "Escape") {
                    e.preventDefault();
                    stopReactions();
                    close(false);
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    const line = text.trim();
                    if (!line) return close(true);
                    setSent({ text: line, at: Date.now() });
                    setText("");
                    sendChat("", line);
                    armIdle();
                  }
                }}
              />
            </span>
          ) : (
            <div className="rv-chat-sent is-alone" dir="auto">
              {showSent}
            </div>
          )}
        </div>
      ) : null}

      {wheel ? (
        <div className="rv-wheel rv-presence-ui" style={{ left: wheel.x, top: wheel.y }} role="menu" aria-label="Reactions">
          {REACTIONS.map((emoji, i) => {
            const a = (i / REACTIONS.length) * Math.PI * 2 - Math.PI / 2;
            return (
              <button
                key={emoji}
                type="button"
                role="menuitem"
                className="rv-wheel-item"
                style={
                  {
                    ["--rv-wx" as string]: `${Math.round(Math.cos(a) * WHEEL_R)}px`,
                    ["--rv-wy" as string]: `${Math.round(Math.sin(a) * WHEEL_R)}px`,
                    ["--rv-wi" as string]: i,
                  } as CSSProperties
                }
                aria-label={`React ${emoji} (${i + 1})`}
                title={`Press ${i + 1}`}
                onClick={() => {
                  setWheel(null);
                  fire(emoji, wheel);
                }}
              >
                {emoji}
                <kbd aria-hidden>{i + 1}</kbd>
              </button>
            );
          })}
        </div>
      ) : null}

      {menu ? (
        <div
          ref={menuEl}
          className="rv-menu rv-board-menu rv-presence-ui"
          role="menu"
          aria-label="Board menu"
          style={{ left: menu.at.x, top: menu.at.y }}
          onKeyDown={walkMenu}
          onContextMenu={(e) => e.preventDefault()}
        >
          {hidden ? (
            <p className="rv-board-menu-note">Turn on Show me to others to chat and react</p>
          ) : (
            <>
              <button type="button" role="menuitem" className="rv-menu-item" onClick={pick(openChat)}>
                <span className="rv-board-menu-icon" aria-hidden>
                  💬
                </span>
                <span className="rv-grow">Chat</span>
                <kbd>/</kbd>
              </button>
              <div className="rv-board-menu-reactions" role="group" aria-label="React">
                {REACTIONS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    role="menuitem"
                    aria-label={`React ${emoji} (${REACTIONS.indexOf(emoji) + 1})`}
                    title={`Press ${REACTIONS.indexOf(emoji) + 1}`}
                    onClick={pick(() => fire(emoji, menu.at))}
                  >
                    {emoji}
                    <kbd aria-hidden>{REACTIONS.indexOf(emoji) + 1}</kbd>
                  </button>
                ))}
              </div>
            </>
          )}

          {menu.groups.map((group, gi) => (
            <div key={gi} role="group">
              <div className="rv-menu-sep" aria-hidden />
              {group.map((item) => (
                <button key={item.id} type="button" role="menuitem" className="rv-menu-item" onClick={pick(item.onSelect)}>
                  <span className="rv-board-menu-icon" aria-hidden>
                    {item.icon}
                  </span>
                  <span className="rv-grow">{item.label}</span>
                  {item.kbd ? <kbd>{item.kbd}</kbd> : null}
                </button>
              ))}
            </div>
          ))}

          <p className="rv-board-menu-foot">Right-click again for the browser menu</p>
        </div>
      ) : null}

      {note ? (
        <div className="rv-chat-note rv-presence-ui" style={{ left: note.x, top: note.y }} role="status">
          Turn on Show me to others to chat and react
        </div>
      ) : null}
    </>
  );
}
