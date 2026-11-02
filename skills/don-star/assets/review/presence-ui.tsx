// The visible half of review-board presence (presence.ts): the avatar row in
// the header, other people's cursors over the board, and the frame that says
// you are following someone. Palette colours are `--rv-p0…14` in review.css;
// a custom colour is a hex, carried the same way through `--rv-pc`.

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MutableRefObject } from "react";
import {
  avatarRow,
  burstSize,
  QUIET_REACTIONS,
  chatShown,
  cleanEmoji,
  EMOJI_SUGGESTIONS,
  onBox,
  surfaceBox,
  MAX_FLOATS_PER_TAB,
  colorCss,
  inkOn,
  PRESENCE_COLORS,
  type ChatMessage,
  type Cursor,
  type Peer,
  type PeerMeta,
  type PresenceColor,
  type Reaction,
} from "./presence";
import { CaretDown, CaretLeft, CaretRight, Check } from "./icons";
import { initialOf } from "./model";

/** A cursor that hasn't moved in this long fades out (still present). */
const IDLE_MS = 20_000;
/** A custom colour is saved once the picker has been still this long. */
const CUSTOM_SAVE_MS = 400;
/** The pointer arrow, tip at (2, 1.5). */
const ARROW_SVG =
  '<svg width="18" height="20" viewBox="0 0 18 20" aria-hidden="true"><path d="M2 1.5v15.2l4.2-4.1 2.7 6.1 2.6-1.1-2.7-6h5.9z" /></svg>';

/** A reaction floats this long, then goes (review.css `rv-react-float`). */
const REACTION_MS = 1600;
/** A burst's emoji leave this far apart. */
const BURST_GAP_MS = 85;
/** A touch swipe this far right on the edit page goes back. */
const SWIPE_BACK_PX = 60;

const color = colorCss;
const ink = inkOn;
const paint = (c: PresenceColor) => ({ ["--rv-pc" as string]: color(c), ["--rv-pi" as string]: ink(c) }) as CSSProperties;

const MODE_LABEL = { canvas: "Canvas", slides: "Single page", flow: "Flow" } as const;

/** What goes in an avatar circle: the chosen emoji, else the initial. */
function Face({ name, emoji }: { name: string; emoji: string | null }) {
  return <>{emoji ?? initialOf(name)}</>;
}
const avatarClass = (base: string, emoji: string | null) => (emoji ? `${base} is-emoji` : base);

export type PresenceSelf = {
  name: string;
  /** Resolved colour (picked or custom, else hashed). */
  color: PresenceColor;
  emoji: string | null;
};

/** "Show me to others", on both pages of the menu: a switch whose knob moves. */
function ShowMeSwitch({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={shown} className="rv-menu-item rv-presence-toggle" onClick={onToggle}>
      <span className="rv-grow">Show me to others</span>
      <span className="rv-presence-switch" aria-hidden />
    </button>
  );
}

/** Header: everyone on this board in one row: the others (whoever I follow
 *  first), then me, then "+N" for the others past the row, then a caret.
 *  The row is ONE button and opens ONE menu with two pages. The first is for
 *  following: my own row (with Edit) above the people here. Edit slides to
 *  the second page, my profile (name, colour, emoji). "Show me to others"
 *  sits at the foot of both pages. Back, Escape or a swipe right returns.
 *  Nothing follows on a click of the row. Past AVATARS_MAX others the row shows the two most recently active and "+N". */
export function PresenceMenu({
  self,
  peers,
  everyone,
  following,
  followers,
  shown,
  onToggleShown,
  onRename,
  onLook,
  onFollow,
  pageTitle,
}: {
  self: PresenceSelf;
  /** Others, most recently active first (the row). */
  peers: Peer[];
  /** The same people A to Z (the menu). */
  everyone: Peer[];
  following: Peer | null;
  followers: PeerMeta[];
  /** "Show me to others". Following needs the leader to know you're there, so
   *  with it off you can see people but not follow. */
  shown: boolean;
  onToggleShown: () => void;
  onRename: (name: string) => void;
  onLook: (patch: Partial<{ color: PresenceColor | null; emoji: string | null }>) => void;
  onFollow: (peer: Peer | null) => void;
  pageTitle: (pageId: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(self.name);
  const [paste, setPaste] = useState("");
  /** The custom colour while the picker is being dragged (saved on a pause). */
  const [draft, setDraft] = useState<string | null>(null);
  const [height, setHeight] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const peoplePage = useRef<HTMLDivElement>(null);
  const editPage = useRef<HTMLDivElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  const saveTimer = useRef<number>(0);
  const swipe = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => setName(self.name), [self.name]);

  // Every open starts on the people page.
  useEffect(() => {
    if (!open) setEditing(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Escape steps back a page before it closes the menu.
      if (editing) goBack();
      else setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, editing]);

  // The menu is as tall as the page on show, and eases between the two.
  useLayoutEffect(() => {
    if (!open) return;
    const el = (editing ? editPage : peoplePage).current;
    if (!el) return;
    const measure = () => setHeight(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, editing]);

  useEffect(() => () => window.clearTimeout(saveTimer.current), []);

  const goEdit = () => {
    setEditing(true);
    requestAnimationFrame(() => backButton.current?.focus({ preventScroll: true }));
  };
  function goBack() {
    setEditing(false);
    requestAnimationFrame(() => editButton.current?.focus({ preventScroll: true }));
  }

  const saveName = () => {
    const n = name.trim();
    if (!n) setName(self.name);
    else if (n !== self.name) onRename(n);
  };

  const pickCustom = (hex: string) => {
    setDraft(hex);
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      onLook({ color: hex.toLowerCase() });
      setDraft(null);
    }, CUSTOM_SAVE_MS);
  };

  const myColor: PresenceColor = draft ?? self.color;
  const custom = typeof myColor === "string" ? myColor : null;
  const row = avatarRow(peers, following?.uid ?? null);
  const followsMe = new Set(followers.map((f) => f.uid));
  const others =
    everyone.length === 0
      ? "No one else is here"
      : `${everyone.length} ${everyone.length === 1 ? "other person" : "other people"} on this board`;

  return (
    <div ref={ref} className="rv-presence rv-presence-ui">
      <button
        type="button"
        className="rv-presence-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`You${everyone.length ? ` and ${others}` : ""}. Open who's here`}
        title={["You", ...everyone.map((p) => p.name)].join(", ")}
        onClick={() => setOpen((o) => !o)}
      >
        {row.shown.map((p) => (
          <span
            key={p.uid}
            className={avatarClass(following?.uid === p.uid ? "rv-presence-avatar is-following" : "rv-presence-avatar", p.emoji)}
            style={paint(p.color)}
            aria-hidden
          >
            <Face name={p.name} emoji={p.emoji} />
          </span>
        ))}
        <span
          className={avatarClass(shown ? "rv-presence-avatar is-self" : "rv-presence-avatar is-self is-hidden", self.emoji)}
          style={paint(myColor)}
          aria-hidden
        >
          <Face name={self.name} emoji={self.emoji} />
        </span>
        {row.rest > 0 ? (
          <span className="rv-presence-more" aria-hidden>
            +{row.rest}
          </span>
        ) : null}
        <CaretDown size={13} className="rv-presence-caret" />
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label={editing ? "Edit profile" : "Who's here"}
          className="rv-menu rv-presence-menu"
          style={height == null ? undefined : { height: height + 3 }}
        >
          <div className={editing ? "rv-presence-track is-editing" : "rv-presence-track"}>
            {/* --- Page 1: who's here ------------------------------------- */}
            <div ref={peoplePage} className="rv-presence-page" inert={editing} aria-hidden={editing || undefined}>
              <button ref={editButton} type="button" className="rv-menu-item rv-presence-row is-me" onClick={goEdit}>
                <span className={avatarClass(shown ? "rv-presence-avatar is-small" : "rv-presence-avatar is-small is-hidden", self.emoji)} style={paint(myColor)} aria-hidden>
                  <Face name={self.name} emoji={self.emoji} />
                </span>
                <span className="rv-grow rv-presence-row-text">
                  <span className="rv-presence-row-name">{self.name}</span>
                  <span className="rv-presence-row-where">{shown ? "You" : "You, hidden from others"}</span>
                </span>
                <span className="rv-presence-row-edit">
                  Edit
                  <CaretRight size={13} />
                </span>
              </button>

              <div className="rv-menu-sep" aria-hidden />
              <div className="rv-presence-menu-head">{others}</div>
              {everyone.map((p) => {
                const active = following?.uid === p.uid;
                return (
                  <button
                    key={p.uid}
                    type="button"
                    aria-pressed={active}
                    aria-disabled={!shown || undefined}
                    className="rv-menu-item rv-presence-row"
                    title={active ? `Stop following ${p.name}` : shown ? `Follow ${p.name}` : undefined}
                    onClick={() => {
                      if (!shown) return;
                      onFollow(active ? null : p);
                      setOpen(false);
                    }}
                  >
                    <span className={avatarClass("rv-presence-avatar is-small", p.emoji)} style={paint(p.color)} aria-hidden>
                      <Face name={p.name} emoji={p.emoji} />
                    </span>
                    <span className="rv-grow rv-presence-row-text">
                      <span className="rv-presence-row-name">
                        {p.name}
                        {followsMe.has(p.uid) ? <span className="rv-presence-tag">Following you</span> : null}
                      </span>
                      <span className="rv-presence-row-where">
                        {pageTitle(p.pageId)} · {MODE_LABEL[p.mode]}
                      </span>
                    </span>
                    {active ? <span className="rv-presence-row-state">Following</span> : null}
                  </button>
                );
              })}
              {!shown && everyone.length ? (
                <p className="rv-presence-menu-note">You're hidden, so you can't follow anyone. Turn on Show me to others to follow.</p>
              ) : null}
              <div className="rv-menu-sep" aria-hidden />
              <ShowMeSwitch shown={shown} onToggle={onToggleShown} />
              {shown ? (
                <p className="rv-presence-keys">
                  Press <kbd>/</kbd> to chat on your cursor, <kbd>1</kbd> to <kbd>8</kbd> to react (<kbd>E</kbd> shows them), or right-click
                </p>
              ) : null}
            </div>

            {/* --- Page 2: edit profile ------------------------------------ */}
            <div
              ref={editPage}
              className="rv-presence-page"
              inert={!editing}
              aria-hidden={!editing || undefined}
              onPointerDown={(e) => {
                if (e.pointerType !== "mouse") swipe.current = { x: e.clientX, y: e.clientY };
              }}
              onPointerUp={(e) => {
                const s = swipe.current;
                swipe.current = null;
                if (s && e.clientX - s.x > SWIPE_BACK_PX && Math.abs(e.clientY - s.y) < SWIPE_BACK_PX) goBack();
              }}
            >
              <div className="rv-presence-page-head">
                <button ref={backButton} type="button" className="rv-presence-back" aria-label="Back to who's here" onClick={goBack}>
                  <CaretLeft size={18} />
                </button>
                <span>Edit profile</span>
              </div>

              <div className="rv-presence-self">
                <span className={avatarClass("rv-presence-avatar is-large", self.emoji)} style={paint(myColor)} aria-hidden>
                  <Face name={self.name} emoji={self.emoji} />
                </span>
                <label className="rv-presence-name">
                  <span className="rv-presence-label">Your name</span>
                  <input
                    value={name}
                    maxLength={60}
                    onChange={(e) => setName(e.target.value)}
                    onBlur={saveName}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        saveName();
                        (e.target as HTMLInputElement).blur();
                      }
                    }}
                  />
                </label>
              </div>
              <p className="rv-presence-hint">Your name shows on your avatar, your cursor and new comments.</p>

              <div className="rv-presence-label is-section">Colour</div>
              <div className="rv-presence-swatches" role="radiogroup" aria-label="Colour">
                {Array.from({ length: PRESENCE_COLORS }, (_, i) => {
                  const on = myColor === i;
                  return (
                    <button
                      key={i}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      aria-label={`Colour ${i + 1}`}
                      className="rv-presence-swatch"
                      style={paint(i)}
                      onClick={() => {
                        window.clearTimeout(saveTimer.current);
                        setDraft(null);
                        onLook({ color: i });
                      }}
                    >
                      {on ? <Check size={13} /> : null}
                    </button>
                  );
                })}
                {/* The last cell is any colour, from the system picker: a
                    spectrum until one is chosen, then that colour with a check. */}
                <label
                  className={custom ? "rv-presence-swatch is-custom is-on" : "rv-presence-swatch is-custom"}
                  style={custom ? paint(custom) : undefined}
                  title={custom ? `Custom colour ${custom.toUpperCase()}` : "Pick a custom colour"}
                >
                  {custom ? <Check size={13} /> : null}
                  <input
                    type="color"
                    className="rv-presence-custom-input"
                    aria-label={custom ? `Custom colour ${custom.toUpperCase()}` : "Pick a custom colour"}
                    value={custom ?? "#2563eb"}
                    onChange={(e) => pickCustom(e.target.value)}
                  />
                </label>
              </div>
              <div className="rv-presence-label is-section">Avatar</div>
              <div className="rv-presence-emojis" role="radiogroup" aria-label="Avatar">
                <button
                  type="button"
                  role="radio"
                  aria-checked={self.emoji === null}
                  aria-label="Your initial"
                  className="rv-presence-emoji is-initial"
                  onClick={() => onLook({ emoji: null })}
                >
                  {initialOf(self.name)}
                </button>
                {EMOJI_SUGGESTIONS.map((em) => (
                  <button
                    key={em}
                    type="button"
                    role="radio"
                    aria-checked={self.emoji === em}
                    className="rv-presence-emoji"
                    onClick={() => onLook({ emoji: em })}
                  >
                    {em}
                  </button>
                ))}
              </div>
              <input
                className="rv-presence-paste"
                value={paste}
                placeholder="Or paste any emoji"
                aria-label="Paste any emoji"
                onChange={(e) => {
                  const em = cleanEmoji(e.target.value);
                  if (em) {
                    onLook({ emoji: em });
                    setPaste("");
                  } else setPaste(e.target.value);
                }}
              />

              <ShowMeSwitch shown={shown} onToggle={onToggleShown} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}


/** Everyone else's pointer on the surface I'm looking at. Imperative: a rAF
 *  loop maps each cursor from surface space to the screen every frame, so a
 *  pan or zoom on MY side keeps their pointer glued to what it points at, and
 *  their movement is eased toward rather than jumped. While someone chats,
 *  their name label becomes the bubble. Reactions (everyone's, mine too) are
 *  drawn here, riding the sender's pointer as it moves. */
export function PresenceCursors({
  cursorsRef,
  entriesRef,
  chatsRef,
  reactionsRef,
  clearRef,
  pointerRef,
  myTab,
}: {
  cursorsRef: MutableRefObject<Map<string, Cursor>>;
  entriesRef: MutableRefObject<Map<string, PeerMeta>>;
  chatsRef: MutableRefObject<Map<string, ChatMessage>>;
  reactionsRef: MutableRefObject<Reaction[]>;
  clearRef: MutableRefObject<((tab: string) => void) | null>;
  /** My pointer, so my own bursts follow it too. */
  pointerRef: MutableRefObject<{ x: number; y: number } | null>;
  myTab: string;
}) {
  const layerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    const nodes = new Map<
      string,
      { el: HTMLDivElement; label: HTMLSpanElement; x: number; y: number; surface: string }
    >();
    type Burst = { tab: string; surface: string; x: number; y: number };
    const bursts = new Set<Burst>();
    const floats: { el: HTMLSpanElement; burst: Burst; launch: number }[] = [];
    // Escape: gone in the keypress, not on the next frame.
    clearRef.current = (tab) => {
      const all = tab === "*";
      reactionsRef.current = reactionsRef.current.filter((r) => !all && r.tab !== tab);
      for (let i = floats.length - 1; i >= 0; i--) {
        if (!all && floats[i]!.burst.tab !== tab) continue;
        floats[i]!.el.remove();
        floats.splice(i, 1);
      }
    };
    // My pointer on the measured box (the same one the loop draws with).
    const mine = (box: ReturnType<typeof surfaceBox>) => {
      const p = pointerRef.current;
      if (!box || !p) return null;
      const c = box.clip;
      if (c && (p.x < c.left || p.x > c.right || p.y < c.top || p.y > c.bottom)) return null;
      return { surface: box.surface, x: (p.x - box.left) / box.scale, y: (p.y - box.top) / box.scale };
    };
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const incoming = reactionsRef.current;
      if (cursorsRef.current.size === 0 && nodes.size === 0 && incoming.length === 0 && floats.length === 0) return;
      // Every read first, then only writes: one layout a frame, however many
      // cursors and emoji are on screen.
      const origin = layer.getBoundingClientRect();
      const box = surfaceBox();
      const now = Date.now();

      // Reactions: each is a burst, five to ten of the emoji streaming up
      // (a quiet one, 👎, is one that dips and fades); CSS does the float.
      for (const r of incoming.splice(0)) {
        const quiet = QUIET_REACTIONS.includes(r.emoji);
        const held = floats.reduce((n, f) => n + (f.burst.tab === r.tab ? 1 : 0), 0);
        const count = Math.min(burstSize(r.emoji, Math.random()), MAX_FLOATS_PER_TAB - held);
        if (count <= 0) continue;
        const burst: Burst = { tab: r.tab, surface: r.surface, x: r.x, y: r.y };
        bursts.add(burst);
        for (let i = 0; i < count; i++) {
          const el = document.createElement("span");
          el.className = quiet ? "rv-reaction is-quiet" : "rv-reaction";
          const inner = document.createElement("span");
          inner.textContent = r.emoji;
          const rand = (lo: number, hi: number) => `${Math.round(lo + Math.random() * (hi - lo))}px`;
          if (!quiet) {
            inner.style.left = rand(-26, 26);
            inner.style.fontSize = rand(20, 32);
          }
          inner.style.setProperty("--rv-drift", rand(-24, 24));
          inner.style.setProperty("--rv-rise", rand(-190, -120));
          el.appendChild(inner);
          floats.push({ el, burst, launch: now + i * BURST_GAP_MS });
        }
      }
      // A burst rides its sender's pointer while it lives: every frame its
      // spot moves to where their cursor is now (theirs, or mine for mine),
      // unless it has left the burst's surface.
      const myNow = mine(box);
      for (const b of bursts) {
        const c = b.tab === myTab ? myNow : cursorsRef.current.get(b.tab);
        if (c && c.surface === b.surface) {
          b.x = c.x;
          b.y = c.y;
        }
      }
      for (let i = floats.length - 1; i >= 0; i--) {
        const f = floats[i]!;
        if (now < f.launch) continue;
        if (!f.el.isConnected) layer.appendChild(f.el);
        const p = now - f.launch < REACTION_MS ? onBox(box, f.burst.surface, f.burst.x, f.burst.y) : null;
        if (!p) {
          f.el.remove();
          floats.splice(i, 1);
          continue;
        }
        f.el.style.transform = `translate(${p.x - origin.left}px, ${p.y - origin.top}px)`;
      }
      for (const b of bursts) if (!floats.some((f) => f.burst === b)) bursts.delete(b);

      const live = new Set<string>();
      for (const [tab, c] of cursorsRef.current) {
        const who = entriesRef.current.get(tab);
        if (!who || c.surface == null) continue;
        let n = nodes.get(tab);
        if (!n) {
          const el = document.createElement("div");
          el.className = "rv-cursor";
          el.innerHTML = ARROW_SVG;
          const label = document.createElement("span");
          label.className = "rv-cursor-label";
          label.setAttribute("dir", "auto");
          el.appendChild(label);
          layer.appendChild(el);
          n = { el, label, x: c.x, y: c.y, surface: c.surface };
          nodes.set(tab, n);
        }
        // A jump to another surface snaps; movement on one surface eases.
        if (n.surface !== c.surface) {
          n.x = c.x;
          n.y = c.y;
          n.surface = c.surface;
        } else {
          n.x += (c.x - n.x) * 0.35;
          n.y += (c.y - n.y) * 0.35;
        }
        const p = onBox(box, c.surface, n.x, n.y);
        const inside = p && (!p.clip || (p.x >= p.clip.left && p.x <= p.clip.right && p.y >= p.clip.top && p.y <= p.clip.bottom));
        if (!p || !inside) {
          n.el.style.display = "none";
          live.add(tab);
          continue;
        }
        live.add(tab);
        n.el.style.display = "";
        n.el.style.setProperty("--rv-pc", color(who.color));
        n.el.style.setProperty("--rv-pi", ink(who.color));
        n.el.style.transform = `translate(${p.x - origin.left}px, ${p.y - origin.top}px)`;
        const chat = chatsRef.current.get(tab);
        n.el.style.opacity = now - Math.max(c.at, chat?.at ?? 0) > IDLE_MS ? "0" : "1";
        const said = chatShown(chat, now);
        const text = said ?? (who.emoji ? `${who.emoji} ${who.name}` : who.name);
        n.label.classList.toggle("is-chat", said != null);
        n.label.classList.toggle("is-typing", said != null && Boolean(chat?.text));
        n.el.classList.toggle("is-chatting", said != null);
        if (n.label.textContent !== text) n.label.textContent = text;
      }
      for (const [tab, n] of nodes) {
        if (!live.has(tab)) {
          n.el.remove();
          nodes.delete(tab);
        }
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      clearRef.current = null;
      for (const n of nodes.values()) n.el.remove();
      for (const f of floats) f.el.remove();
    };
  }, [cursorsRef, entriesRef, chatsRef, reactionsRef, clearRef, pointerRef, myTab]);

  return <div ref={layerRef} className="rv-cursors" aria-hidden />;
}

/** While following: a frame in their colour around the board. Any pan, zoom
 *  or click of your own stops it. */
export function FollowFrame({ peer }: { peer: Peer }) {
  return <div className="rv-follow" style={paint(peer.color)} aria-hidden />;
}

/** The follow label: names who you're following and stops it. Lives in the
 *  toolbar dock, so it centres over the board with the toolbar. */
export function FollowPill({ peer, onStop }: { peer: Peer; onStop: () => void }) {
  return (
    <div className="rv-follow-pill rv-presence-ui" role="status" style={paint(peer.color)}>
      <span>Following {peer.name}</span>
      <button type="button" onClick={onStop}>
        Stop
      </button>
    </div>
  );
}
