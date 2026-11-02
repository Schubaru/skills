/* N00B Inc office engine: a 320×200 pixel-art office drawn in code, scaled up with no smoothing.
   Runs identically inside a Web Worker (OffscreenCanvas) or on the main thread. */

export interface OfficeAgent {
  id: string;
  title: string | null;
  status: string;
  livery: number;
  parent_id: string | null;
  kind: string;
  /** Let go by HR, or (a subagent) went home with its session's last turn: it stays out of the break area. */
  off?: boolean;
}
export interface OfficeMsg {
  id: number;
  from: string;
  to: string | null;
  text: string;
  kind: "message" | "spawn" | "report" | "letgo" | "harass" | "coffee";
}
export interface OfficeState {
  /** "office" or the reading-room "studio": same staff and moves, different room. */
  look?: "office" | "studio";
  agents: OfficeAgent[];
  messages: OfficeMsg[];
  theme: "light" | "dark";
  hover: string | null;
  selected: string | null;
  reduced: boolean;
  visible: boolean;
}
/** Where a clicked person's head sits on the canvas, in device pixels, and how big one office pixel is. */
export interface Spot {
  x: number;
  y: number;
  s: number;
}

export interface OfficeHandle {
  update(s: OfficeState): void;
  resize(w: number, h: number): void;
  pointer(x: number, y: number): void;
  click(x: number, y: number): void;
  destroy(): void;
}
type Canvas2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;

export const W = 320;
export const H = 200;

const LIVERY = ["#ff4d4d", "#ff9f1c", "#ffd400", "#2ed47a", "#19c3c6", "#3a86ff", "#a259ff", "#ff5da2"];
const HAIR = ["#2b1d14", "#6b3e1e", "#d9a441", "#1b1b1f", "#8c4a3c", "#e8e2d0"];
const SKIN = ["#f4c9a6", "#e0a67c", "#b8744a", "#8a5234"];

// Desk grid
// The desk grid grows with headcount: 2×2 for a quiet day, up to 4×3.
let COLS = 2;
let ROWS = 2;
let DESK_X0 = 52;
let DESK_DX = 140;
let DESK_Y0 = 72;
let CORRIDORS = [38, 178, 306];
let AISLES = [106, 152];
const DESK_DY = 46;
const DESK_W = 40;
const DESK_H = 12;
function gridFor(n: number) {
  const cols = n <= 4 ? 2 : 4;
  const rows = Math.min(3, Math.max(2, Math.ceil(Math.max(n, 1) / cols)));
  return { cols, rows };
}
const shade = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.round(v * 0.72));
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => f(v).toString(16).padStart(2, "0")).join("")}`;
};
const DOOR = { x: 306, y: 197 };
const COFFEE = { x: 288, y: 48 };
// HR is not an agent: a grey suit that walks in from the door, says its piece, and leaves with the person.
const HR_ID = "__hr";
const HR_LINES = [
  "Thank you for all your hard work today.",
  "You did great. Time to clock out and rest.",
  "Lovely work. I'll walk you out.",
  "All done here. Thanks for your help!",
  "We're wrapping up your shift. Thank you.",
  "Great job today. Go take a well-earned break.",
];
const HR_REPLIES = ["Thank you!", "It was a pleasure.", "Happy to help.", "See you next prompt.", "Have a good one!"];
// What HR tells a viewer who harassed someone, facing out at them. Each fits a two-line bubble.
const SCOLDS = ["Please be kind. They work hard.", "Hey now. Be nice to the staff.", "Kind words only, please.", "We don't do that here. Thanks."];
const THANKS = ["Thanks boss!", "Thanks hoss!", "Thanks chief!"];
// What a session says as it walks its team out. Each fits a two-line bubble; they rotate so no two exits in a row match.
const FAREWELLS = [
  "Our work here is done.",
  "That'll do, team.",
  "Done. Act natural.",
  "We were never here.",
  "Ship it. We're out.",
  "Clocking out. Don't touch it.",
  "Nothing left to break. Bye.",
];
// Where someone stands to use the coffee machine.
const BREW_SPOT = { x: 294, y: 74 };
const AT_WORK = ["working", "thinking", "blocked", "holding"];
// A tiny Claude spark, two frames so it twinkles while the AI carries on alone.
const SPARK = [
  ["10101", "01110", "11111", "01110", "10101"],
  ["00100", "01110", "11111", "01110", "00100"],
];
// Zigzag down two columns, so a crowd at the coffee machine reads as people hanging out, not a queue.
const COFFEE_SPOTS = [
  { x: 296, y: 84 },
  { x: 282, y: 94 },
  { x: 296, y: 104 },
  { x: 282, y: 114 },
  { x: 296, y: 124 },
  { x: 282, y: 134 },
  { x: 296, y: 144 },
  { x: 282, y: 154 },
];

export const FONT: Record<string, string[]> = {
  A: ["010", "101", "111", "101", "101"], B: ["110", "101", "110", "101", "110"], C: ["011", "100", "100", "100", "011"],
  D: ["110", "101", "101", "101", "110"], E: ["111", "100", "110", "100", "111"], F: ["111", "100", "110", "100", "100"],
  G: ["011", "100", "101", "101", "011"], H: ["101", "101", "111", "101", "101"], I: ["111", "010", "010", "010", "111"],
  J: ["001", "001", "001", "101", "010"], K: ["101", "101", "110", "101", "101"], L: ["100", "100", "100", "100", "111"],
  M: ["101", "111", "111", "101", "101"], N: ["110", "101", "101", "101", "101"], O: ["010", "101", "101", "101", "010"],
  P: ["110", "101", "110", "100", "100"], Q: ["010", "101", "101", "111", "011"], R: ["110", "101", "110", "101", "101"],
  S: ["011", "100", "010", "001", "110"], T: ["111", "010", "010", "010", "010"], U: ["101", "101", "101", "101", "111"],
  V: ["101", "101", "101", "101", "010"], W: ["101", "101", "111", "111", "101"], X: ["101", "101", "010", "101", "101"],
  Y: ["101", "101", "010", "010", "010"], Z: ["111", "001", "010", "100", "111"],
  "0": ["111", "101", "101", "101", "111"], "1": ["010", "110", "010", "010", "111"], "2": ["111", "001", "111", "100", "111"],
  "3": ["111", "001", "111", "001", "111"], "4": ["101", "101", "111", "001", "001"], "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"], "7": ["111", "001", "001", "001", "001"], "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "111"],
  " ": ["000", "000", "000", "000", "000"], ".": ["000", "000", "000", "000", "010"], ",": ["000", "000", "000", "010", "100"],
  "!": ["010", "010", "010", "000", "010"], "?": ["111", "001", "011", "000", "010"], "-": ["000", "000", "111", "000", "000"],
  "'": ["010", "010", "000", "000", "000"], ":": ["000", "010", "000", "010", "000"], "/": ["001", "001", "010", "100", "100"],
  _: ["000", "000", "000", "000", "111"], "(": ["010", "100", "100", "100", "010"], ")": ["010", "001", "001", "001", "010"],
  "+": ["000", "010", "111", "010", "000"], "#": ["101", "111", "101", "111", "101"], "@": ["010", "101", "111", "100", "011"],
};

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

interface Task {
  type: "goto" | "say" | "wait" | "home" | "leave" | "cup" | "tail";
  face?: "up";
  x?: number;
  y?: number;
  text?: string;
  ms?: number;
}
interface Person {
  id: string;
  title: string;
  status: string;
  livery: number;
  hair: string;
  skin: string;
  parent: string | null;
  desk: number | null; // index
  x: number;
  y: number;
  path: { x: number; y: number }[];
  facing: "down" | "left" | "right" | "up";
  moving: boolean;
  tasks: Task[];
  taskUntil: number;
  bubble: { kind: "say" | "!" | "..." | "zzz"; text?: string; until: number } | null;
  seated: boolean;
  gone: boolean;
  leaving: boolean;
  phase: number; // random anim offset
  idleSpot: number | null;
  born: number;
  /** Harassed until this time: red face, shaking, steam. */
  upset: number;
  /** Away on a coffee run: the desk keeps working without them. */
  brew: boolean;
  cupUntil: number;
  /** A subagent that walked out (with its session, or fired): it stays out until it works again. */
  out: boolean;
}

export function createOffice(canvas: AnyCanvas, makeCanvas: (w: number, h: number) => AnyCanvas, cb: { onHover(id: string | null): void; onSelect(id: string | null, at?: Spot): void }): OfficeHandle {
  const ctx = canvas.getContext("2d") as Canvas2D;
  const lo = makeCanvas(W, H);
  const g = lo.getContext("2d") as Canvas2D;
  let cw = W;
  let ch = H;
  let scale = 1;
  let ox = 0;
  let oy = 0;
  let state: OfficeState = { agents: [], messages: [], theme: "light", hover: null, selected: null, reduced: false, visible: true };
  const people = new Map<string, Person>();
  const seenMsgs = new Set<number>();
  let fired = 0;
  let farewell = Math.floor(Math.random() * FAREWELLS.length);
  let hoverId: string | null = null;
  let pointerLo = { x: -1, y: -1 };
  let raf = 0;
  let last = 0;
  let dirty = true;
  let destroyed = false;
  let clockText = "";

  const rafFn: (cb: (t: number) => void) => number =
    typeof requestAnimationFrame === "function" ? (c) => requestAnimationFrame(c) : (c) => setTimeout(() => c(performance.now()), 16) as unknown as number;
  const cafFn: (id: number) => void = typeof cancelAnimationFrame === "function" ? (i) => cancelAnimationFrame(i) : (i) => clearTimeout(i);

  const deskPos = (i: number) => ({ x: DESK_X0 + (i % COLS) * DESK_DX, y: DESK_Y0 + Math.floor(i / COLS) * DESK_DY });
  const seatOf = (i: number) => {
    const d = deskPos(i);
    return { x: d.x + 20, y: d.y - 1 };
  };

  // ---- routing (rectilinear, along corridors and aisles) ----
  const nearest = (arr: number[], v: number) => arr.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
  function route(from: { x: number; y: number }, to: { x: number; y: number }) {
    const pts: { x: number; y: number }[] = [];
    const c1 = nearest(CORRIDORS, from.x);
    const c2 = nearest(CORRIDORS, to.x);
    const ay = nearest(AISLES, Math.max(from.y, to.y));
    pts.push({ x: c1, y: from.y });
    pts.push({ x: c1, y: ay });
    pts.push({ x: c2, y: ay });
    pts.push({ x: c2, y: to.y });
    pts.push({ x: to.x, y: to.y });
    // drop zero-length legs
    return pts.filter((p, i) => i === 0 || p.x !== pts[i - 1].x || p.y !== pts[i - 1].y);
  }

  function relayout() {
    const seated = [...people.values()].filter((p) => !p.gone && p.desk != null).sort((a, b) => a.desk! - b.desk!);
    const { cols, rows } = gridFor(seated.length);
    if (cols === COLS && rows === ROWS) return;
    // Repack in whole rows: everyone keeps their order, the room resizes around them.
    seated.forEach((p, i) => {
      if (p.desk !== i) {
        p.desk = i;
        if (!p.leaving && !p.tasks.length) p.tasks.push({ type: "home" });
      }
    });
    COLS = cols;
    ROWS = rows;
    // The room is sized to the grid: a quiet 2×2 sits centered on a rug, 4 columns fill the floor.
    DESK_DX = cols === 2 ? 140 : 72;
    DESK_X0 = cols === 2 ? 52 : 20;
    DESK_Y0 = cols === 2 ? 72 : 64;
    CORRIDORS = [...Array(cols).keys()].map((c) => DESK_X0 + c * DESK_DX - 14).concat([306]);
    AISLES = [...Array(rows).keys()].map((r) => DESK_Y0 + r * DESK_DY + 34);
    dirty = true;
  }

  function freeDesk(prefer?: number | null): number | null {
    const used = new Set([...people.values()].filter((p) => !p.gone && p.desk != null).map((p) => p.desk));
    const { cols, rows } = gridFor(used.size + 1);
    const order = [...Array(cols * rows).keys()];
    if (prefer != null) order.sort((a, b) => Math.abs(a - prefer) - Math.abs(b - prefer) || a - b);
    for (const i of order) if (!used.has(i)) return i;
    return null;
  }

  function homeFor(p: Person): { x: number; y: number; seated: boolean } {
    const s = p.status;
    if (s === "idle") {
      if (p.idleSpot == null) {
        const used = new Set([...people.values()].filter((q) => !q.gone && q.idleSpot != null).map((q) => q.idleSpot));
        p.idleSpot = COFFEE_SPOTS.findIndex((_, i) => !used.has(i));
        if (p.idleSpot < 0) p.idleSpot = COFFEE_SPOTS.length - 1;
      }
      const sp = COFFEE_SPOTS[p.idleSpot];
      return { x: sp.x, y: sp.y, seated: false };
    }
    p.idleSpot = null;
    if (p.desk != null) {
      const seat = seatOf(p.desk);
      return { ...seat, seated: true };
    }
    // standing room along the bottom aisle
    const idx = [...people.values()].filter((q) => !q.gone && q.desk == null).indexOf(p);
    return { x: 30 + (idx % 10) * 26, y: AISLES[AISLES.length - 1], seated: false };
  }

  function setPath(p: Person, to: { x: number; y: number }) {
    if (state.reduced) {
      p.x = to.x;
      p.y = to.y;
      p.path = [];
      return;
    }
    p.path = route({ x: p.x, y: p.y }, to).slice(1);
  }

  // ---- state in ----
  function update(s: OfficeState) {
    const themeChanged = s.theme !== state.theme;
    state = s;
    const now = performance.now();
    const ids = new Set<string>();
    const byId = new Map(s.agents.map((a) => [a.id, a]));
    const finished = (st: string) => st === "done" || st === "stopped";
    // A finished subagent idles in the break area until its session finishes too, or HR lets it go.
    const benched = (a: OfficeAgent) => {
      const boss = a.parent_id ? byId.get(a.parent_id) : undefined;
      return a.kind === "subagent" && a.status === "done" && !a.off && !people.get(a.id)?.out && !!boss && !finished(boss.status);
    };
    // Sessions first, so a session that just finished still finds its team in the break area.
    for (const a of [...s.agents].sort((x, y) => +!!x.parent_id - +!!y.parent_id)) {
      ids.add(a.id);
      let p = people.get(a.id);
      const title = (a.title || (a.kind === "subagent" ? "subagent" : "agent")).toString();
      const bench = benched(a);
      const status = bench ? "idle" : a.status;
      if (!p) {
        const h = hash(a.id);
        const parent = a.parent_id ? people.get(a.parent_id) : null;
        const desk = finished(status) || bench ? null : freeDesk(parent?.desk);
        p = {
          id: a.id, title, status, livery: a.livery % LIVERY.length, hair: HAIR[h % HAIR.length], skin: SKIN[(h >>> 4) % SKIN.length],
          parent: a.parent_id, desk, x: DOOR.x, y: DOOR.y, path: [], facing: "down", moving: false, tasks: [], taskUntil: 0, bubble: null,
          seated: false, gone: finished(status), leaving: false, phase: (h % 1000) / 1000, idleSpot: null, born: now,
          upset: 0, brew: false, cupUntil: 0, out: finished(status),
        };
        people.set(a.id, p);
        if (!p.gone) p.tasks.push({ type: "home" });
        continue;
      }
      p.title = title;
      p.livery = a.livery % LIVERY.length;
      const active = !finished(status);
      if (active && !bench) p.out = false;
      // A finished session's next prompt hires it back: whoever walked out (or is still walking) comes back to a desk.
      // A walk-out still underway only turns around on a real status change, so HR's firing isn't undone by a stale idle.
      if (active && (p.gone || (p.leaving && status !== p.status))) {
        if (p.gone) {
          p.x = DOOR.x;
          p.y = DOOR.y;
          p.born = now;
        }
        p.gone = false;
        p.leaving = false;
        p.seated = false;
        p.bubble = null;
        p.path = [];
        p.taskUntil = 0;
        p.status = status;
        p.parent = a.parent_id;
        if (p.desk == null && !bench) p.desk = freeDesk(a.parent_id ? people.get(a.parent_id)?.desk : null);
        p.tasks = [{ type: "home" }];
      }
      if (status !== p.status) {
        const was = p.status;
        p.status = status;
        if (finished(status) && !p.leaving) {
          p.leaving = true;
          p.out = true;
          if (p.parent && was === "idle") {
            // Off the break area to line up along the exit aisle; it falls in behind the session as it walks past.
            const i = [...people.values()].filter((q) => q !== p && q.parent === p!.parent && q.leaving && q.tasks.some((t) => t.type === "tail")).length;
            p.tasks = [{ type: "goto", x: 292 - (i % 7) * 12, y: AISLES[AISLES.length - 1] }, { type: "tail" }, { type: "leave" }];
          } else {
            const team = !p.parent && !a.off && [...people.values()].some((q) => q.parent === p!.id && !q.gone && !q.leaving && q.status === "idle");
            p.tasks = p.tasks.filter((t) => t.type === "say" || t.type === "goto");
            if (team) p.tasks.push({ type: "say", text: FAREWELLS[farewell++ % FAREWELLS.length], ms: 2600 });
            p.tasks.push({ type: "leave" });
          }
        } else if (!p.leaving) {
          // A finished subagent hands back its desk on the way to the break area, and gets one again when it works.
          if (bench) p.desk = null;
          else if (p.desk == null && status !== "idle") p.desk = freeDesk(p.parent ? people.get(p.parent)?.desk : null);
          if ((was === "idle" || status === "idle") && !p.tasks.length) p.tasks.push({ type: "home" });
        }
      }
      if (p.bubble && p.bubble.kind !== "say") p.bubble = null;
    }
    // agents that vanished from the state leave quietly
    for (const p of people.values()) {
      if (!ids.has(p.id) && !p.gone && !p.leaving && p.id !== HR_ID) {
        p.leaving = true;
        p.tasks.push({ type: "leave" });
      }
    }
    relayout();
    // conversations
    for (const m of s.messages) {
      if (seenMsgs.has(m.id)) continue;
      seenMsgs.add(m.id);
      const from = people.get(m.from);
      if (!from || from.gone) continue;
      if (m.kind === "letgo") {
        letGo(from);
        continue;
      }
      if (m.kind === "harass" || m.kind === "coffee") {
        visit(from, m.kind, m.id);
        continue;
      }
      // A finished subagent reports from its own desk before it gets up, instead of walking the news over.
      if (m.kind === "report") {
        from.tasks.unshift({ type: "say", text: m.text, ms: 3000 });
        continue;
      }
      const target = m.to ? people.get(m.to) : null;
      const text = m.kind === "spawn" ? `NEW HIRE: ${m.text}` : m.text;
      if (target && !target.gone && target.desk != null && m.kind !== "spawn") {
        const d = deskPos(target.desk);
        from.tasks.push({ type: "goto", x: d.x - 8, y: d.y + 10 }, { type: "say", text, ms: 4200 }, { type: "home" });
      } else {
        from.tasks.push({ type: "say", text, ms: 3600 });
      }
    }
    if (themeChanged) dirty = true;
    dirty = true;
  }

  // HR walks from the door to stand beside the person, says its line, and leaves. Returns how long the walk in takes.
  function summonHR(target: Person, line: string, linger: number, side = -12) {
    let hr = people.get(HR_ID);
    if (!hr || hr.gone) {
      const h = hash(HR_ID + fired);
      hr = {
        id: HR_ID, title: "HR", status: "working", livery: 0, hair: HAIR[h % HAIR.length], skin: SKIN[(h >>> 4) % SKIN.length],
        parent: null, desk: null, x: DOOR.x, y: DOOR.y, path: [], facing: "up", moving: false, tasks: [], taskUntil: 0, bubble: null,
        seated: false, gone: false, leaving: false, phase: 0, idleSpot: null, born: performance.now(), upset: 0, brew: false, cupUntil: 0, out: false,
      };
      people.set(HR_ID, hr);
    }
    fired++;
    const spot = { x: target.x + side, y: target.y };
    // ponytail: travel time is a straight estimate from HR's current spot; a queued second visit just runs a little early.
    let travel = 0;
    if (!state.reduced) for (let prev = { x: hr.x, y: hr.y }, pts = route(prev, spot), i = 0; i < pts.length; prev = pts[i++]) travel += Math.hypot(pts[i].x - prev.x, pts[i].y - prev.y);
    hr.leaving = false;
    hr.tasks = hr.tasks.filter((t) => t.type !== "leave");
    hr.tasks.push({ type: "goto", x: spot.x, y: spot.y }, { type: "say", text: line, ms: 3400 }, { type: "wait", ms: linger }, { type: "leave" });
    return (travel / SPEED) * 1000;
  }

  // HR says something kind, and the person answers and leaves.
  function letGo(target: Person) {
    const travelMs = summonHR(target, HR_LINES[(hash(target.id) + fired) % HR_LINES.length], 1400);
    target.leaving = true;
    target.out = true;
    target.brew = false;
    target.tasks = [{ type: "wait", ms: travelMs + 3400 }, { type: "say", text: HR_REPLIES[hash(target.id) % HR_REPLIES.length], ms: 1400 }, { type: "leave" }];
    target.path = [];
    target.seated = false;
  }

  // A viewer's tap. Pure theater: nothing reaches the agent. Picks come from the event id, so every screen plays the same skit.
  function visit(p: Person, kind: "harass" | "coffee", id: number) {
    const now = performance.now();
    if (p.leaving || p.brew || p.upset > now) return;
    if (kind === "harass") {
      // HR stands on the right so its bubble never covers the upset face.
      p.upset = now + summonHR(p, SCOLDS[id % SCOLDS.length], 600, 14) + 3800;
      return;
    }
    p.brew = true;
    p.tasks = [{ type: "goto", x: BREW_SPOT.x, y: BREW_SPOT.y }, { type: "wait", ms: 1100, face: "up" }, { type: "cup" }, { type: "say", text: THANKS[id % THANKS.length], ms: 2600 }, { type: "home" }];
  }

  // ---- simulation ----
  const SPEED = 64; // px/s
  function step(dt: number, now: number) {
    for (const p of people.values()) {
      if (p.gone) continue;
      // walk
      if (p.path.length) {
        const t = p.path[0];
        const dx = t.x - p.x;
        const dy = t.y - p.y;
        const dist = Math.hypot(dx, dy);
        const stepLen = SPEED * dt;
        if (dist <= stepLen) {
          p.x = t.x;
          p.y = t.y;
          p.path.shift();
        } else {
          p.x += (dx / dist) * stepLen;
          p.y += (dy / dist) * stepLen;
        }
        p.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy < 0 ? "up" : "down";
        p.moving = true;
        p.seated = false;
        continue;
      }
      p.moving = false;
      // tasks
      if (p.taskUntil && now < p.taskUntil) continue;
      p.taskUntil = 0;
      const t = p.tasks.shift();
      if (t) dirty = true; // reduced motion only repaints on change
      if (!t) {
        if (!p.leaving) {
          const h = homeFor(p);
          if (Math.abs(h.x - p.x) > 0.5 || Math.abs(h.y - p.y) > 0.5) setPath(p, h);
          else {
            p.seated = h.seated;
            if (p.seated) p.facing = "down";
            if (p.brew) (p.brew = false), (dirty = true);
          }
        }
        continue;
      }
      switch (t.type) {
        case "goto":
          setPath(p, { x: t.x!, y: t.y! });
          break;
        case "say":
          p.bubble = { kind: "say", text: t.text ?? "", until: now + (t.ms ?? 3000) };
          p.taskUntil = now + (t.ms ?? 3000);
          p.facing = "down";
          break;
        case "wait":
          p.taskUntil = now + (t.ms ?? 500);
          if (t.face) p.facing = t.face;
          break;
        case "cup":
          p.cupUntil = now + 12_000;
          break;
        case "tail": {
          // Hold the spot in line until the session walks past on its way out (or is already gone).
          const boss = p.parent ? people.get(p.parent) : undefined;
          if (boss && !boss.gone && boss.leaving && !(boss.y >= p.y - 2 && boss.x >= p.x - 6)) {
            p.tasks.unshift(t);
            p.taskUntil = now + 150;
          }
          break;
        }
        case "home": {
          const h = homeFor(p);
          setPath(p, h);
          break;
        }
        case "leave":
          p.leaving = true;
          setPath(p, DOOR);
          p.tasks.push({ type: "goto", x: DOOR.x, y: DOOR.y + 8 });
          p.desk = null;
          p.idleSpot = null;
          break;
      }
    }
    let left = false;
    for (const p of people.values()) {
      if (p.leaving && !p.gone && !p.tasks.length && !p.path.length) {
        p.gone = true;
        left = true;
      }
      if (p.bubble && now > p.bubble.until) (p.bubble = null), (dirty = true);
      if (p.upset && now > p.upset) (p.upset = 0), (dirty = true);
    }
    if (left) relayout();
  }

  // ---- drawing ----
  const px = (x: number, y: number, w: number, h: number, c: string) => {
    g.fillStyle = c;
    g.fillRect(Math.round(x), Math.round(y), w, h);
  };

  function text(x: number, y: number, s: string, c: string) {
    let cx = x;
    for (const ch of s.toUpperCase()) {
      const gl = FONT[ch] ?? FONT["?"];
      for (let r = 0; r < 5; r++) for (let k = 0; k < 3; k++) if (gl[r][k] === "1") px(cx + k, y + r, 1, 1, c);
      cx += 4;
    }
  }
  const textW = (s: string) => s.length * 4 - 1;

  function wrap(s: string, max = 16): string[] {
    const words = s.replace(/\s+/g, " ").trim().split(" ");
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      if ((cur + " " + w).trim().length > max) {
        if (cur) lines.push(cur);
        cur = w.length > max ? w.slice(0, max - 1) + "…" : w;
      } else cur = (cur + " " + w).trim();
      if (lines.length === 2) break;
    }
    if (cur && lines.length < 2) lines.push(cur);
    if (lines.length === 2 && words.join(" ").length > lines.join(" ").length) lines[1] = lines[1].slice(0, max - 1) + ".";
    return lines.map((l) => l.replace("…", "."));
  }

  function drawRoom(dark: boolean, now: number) {
    const wall = dark ? "#2b2a36" : "#ddd6c4";
    const wallLo = dark ? "#23222c" : "#cfc7b3";
    const floorA = dark ? "#3b3540" : "#cdbf9f";
    const floorB = dark ? "#352f3a" : "#c3b492";
    px(0, 0, W, 40, wall);
    px(0, 36, W, 4, wallLo);
    px(0, 40, W, 2, dark ? "#1a1922" : "#8e8470");
    for (let y = 42; y < H; y += 8) for (let x = 0; x < W; x += 8) px(x, y, 8, 8, ((x + y) / 8) % 2 ? floorA : floorB);
    // windows
    for (const wx of [44, 116, 188]) {
      px(wx - 1, 7, 30, 24, dark ? "#15141c" : "#8e8470");
      if (dark) {
        px(wx, 8, 28, 22, "#121a33");
        for (const [sx, sy] of [[3, 3], [11, 7], [20, 4], [24, 14], [7, 16], [16, 18]]) px(wx + sx, 8 + sy, 1, 1, (Math.floor(now / 900 + sx) % 3) === 0 ? "#f6f1d4" : "#8c93b3");
        px(wx + 19, 10, 5, 5, "#e9e6c7");
        px(wx + 18, 11, 1, 3, "#e9e6c7");
      } else {
        px(wx, 8, 28, 22, "#9ed1ef");
        px(wx + 4, 13, 9, 3, "#ffffff");
        px(wx + 6, 11, 5, 2, "#ffffff");
        px(wx + 17, 20, 8, 3, "#ffffff");
        px(wx + 19, 18, 4, 2, "#ffffff");
      }
      px(wx + 13, 8, 2, 22, dark ? "#15141c" : "#8e8470");
      px(wx, 18, 28, 2, dark ? "#15141c" : "#8e8470");
    }
    // clock
    px(254, 10, 14, 14, dark ? "#e7e7ea" : "#fafaf8");
    px(253, 9, 16, 1, "#1a1922");
    px(253, 24, 16, 1, "#1a1922");
    px(253, 10, 1, 14, "#1a1922");
    px(268, 10, 1, 14, "#1a1922");
    px(260, 12, 1, 5, "#1a1922");
    px(260, 16, 4, 1, "#1a1922");
    text(272, 14, clockText, dark ? "#c3c3c9" : "#5b5b57");
    // poster: the N00B mark on the wall
    px(10, 10, 20, 20, dark ? "#1c1b24" : "#f4f4f2");
    px(13, 14, 4, 12, LIVERY[5]);
    px(18, 14, 4, 12, LIVERY[0]);
    px(23, 14, 4, 12, LIVERY[2]);
    // coffee machine
    px(COFFEE.x, COFFEE.y, 12, 18, dark ? "#55525e" : "#6e6a78");
    px(COFFEE.x + 2, COFFEE.y + 2, 8, 5, dark ? "#1f1e27" : "#2b2a36");
    px(COFFEE.x + 4, COFFEE.y + 3, 2, 1, LIVERY[0]);
    px(COFFEE.x + 7, COFFEE.y + 3, 2, 1, LIVERY[3]);
    px(COFFEE.x + 4, COFFEE.y + 10, 4, 4, "#f4f4f2");
    px(COFFEE.x - 2, COFFEE.y + 18, 16, 2, dark ? "#2e2c38" : "#8e8470");
    // plant
    px(300, 170, 8, 6, "#8a5234");
    px(298, 160, 12, 10, "#2e8b57");
    px(301, 156, 6, 5, "#3fb36b");
    // door mat + door frame
    px(DOOR.x - 12, 190, 24, 10, dark ? "#4a4452" : "#9c8f72");
    text(DOOR.x - 7, 192, "EXIT", dark ? "#c3c3c9" : "#3b3b38");
  }

  // ---- the studio: a reading-room take on the office ----
  const BOOKS = ["#b04a3a", "#d79a3b", "#3f6e8c", "#4f7d4f", "#7a4f8c", "#c9c2a8", "#2f3f5a", "#a8643a"];
  function drawStudio(dark: boolean, now: number) {
    const paper = dark ? "#1e2a25" : "#a9bf9a";
    const stripe = dark ? "#23312b" : "#b5c9a6";
    const wood = dark ? "#4a3426" : "#8a5a3a";
    const woodLo = dark ? "#3a291e" : "#734a2f";
    const plankA = dark ? "#4a3a30" : "#c29466";
    const plankB = dark ? "#43352c" : "#b5875a";
    const seam = dark ? "#2f251f" : "#946b45";
    px(0, 0, W, 40, paper);
    for (let x = 2; x < W; x += 6) px(x, 0, 2, 25, stripe);
    // wainscot with panels and a rail
    px(0, 25, W, 15, wood);
    px(0, 25, W, 1, dark ? "#5c4231" : "#a06e49");
    for (let x = 3; x < W; x += 16) {
      px(x, 28, 12, 9, woodLo);
      px(x, 28, 12, 1, shade(woodLo));
    }
    px(0, 40, W, 2, dark ? "#1a1612" : "#5e3d27");
    // plank floor, seams staggered row to row
    for (let y = 42, r = 0; y < H; y += 6, r++) {
      px(0, y, W, 6, r % 2 ? plankA : plankB);
      px(0, y + 5, W, 1, seam);
      for (let x = (r * 13) % 32; x < W; x += 32) px(x, y, 1, 5, seam);
    }
    // bookshelves
    for (const sx of [36, 176]) {
      px(sx, 3, 62, 37, dark ? "#2a1d14" : "#5b3b26");
      for (let row = 0; row < 3; row++) {
        const y = 5 + row * 11;
        px(sx + 2, y, 58, 9, dark ? "#160f0a" : "#3a2618");
        let bx = sx + 3;
        let k = sx + row * 7;
        while (bx < sx + 58) {
          const h = hash(String(k++));
          const bw = 2 + (h % 2);
          const bh = 6 + ((h >>> 3) % 3);
          if ((h >>> 6) % 9 === 0) {
            bx += 3; // a gap where a book is out
            continue;
          }
          const c = BOOKS[(h >>> 9) % BOOKS.length];
          px(bx, y + 9 - bh, bw, bh, dark ? shade(shade(c)) : c);
          px(bx, y + 9 - bh + 1, bw, 1, dark ? shade(c) : "#f1e6c8");
          bx += bw + ((h >>> 12) % 4 === 0 ? 1 : 0);
        }
        px(sx + 2, y + 9, 58, 2, dark ? "#3a291e" : "#6e4a30");
      }
    }
    // arched window between the shelves
    const wx = 116;
    px(wx - 1, 5, 42, 27, dark ? "#15141c" : "#5e3d27");
    px(wx, 8, 40, 23, dark ? "#121a33" : "#9ed1ef");
    px(wx + 3, 6, 34, 2, dark ? "#121a33" : "#9ed1ef");
    if (dark) {
      for (const [sx, sy] of [[5, 4], [14, 9], [26, 5], [33, 13], [9, 15]]) px(wx + sx, 6 + sy, 1, 1, (Math.floor(now / 900 + sx) % 3) === 0 ? "#f6f1d4" : "#8c93b3");
    } else {
      px(wx + 6, 13, 10, 3, "#ffffff");
      px(wx + 9, 11, 5, 2, "#ffffff");
      px(wx + 24, 20, 9, 3, "#ffffff");
    }
    px(wx + 19, 6, 2, 25, dark ? "#15141c" : "#5e3d27");
    px(wx, 18, 40, 2, dark ? "#15141c" : "#5e3d27");
    px(wx - 3, 31, 46, 2, dark ? "#3a291e" : "#d9c9a8");
    // the plaque by the door
    px(6, 9, 27, 11, dark ? "#2a1d14" : "#5b3b26");
    px(7, 10, 25, 9, dark ? "#6b5534" : "#d9a441");
    text(12, 12, "N00B", dark ? "#1a1612" : "#3a2618");
    // clock
    px(254, 10, 14, 14, dark ? "#e7e7ea" : "#fafaf8");
    px(253, 9, 16, 1, "#1a1922");
    px(253, 24, 16, 1, "#1a1922");
    px(253, 10, 1, 14, "#1a1922");
    px(268, 10, 1, 14, "#1a1922");
    px(260, 12, 1, 5, "#1a1922");
    px(260, 16, 4, 1, "#1a1922");
    text(272, 14, clockText, dark ? "#c3c3c9" : "#f4efe2");
    // tea station where the coffee machine stands downstairs
    px(COFFEE.x - 4, COFFEE.y + 8, 20, 10, dark ? "#3a291e" : "#6e4a30");
    px(COFFEE.x - 4, COFFEE.y + 8, 20, 1, dark ? "#5c4231" : "#a06e49");
    px(COFFEE.x - 2, COFFEE.y + 18, 2, 2, dark ? "#2a1d14" : "#4a301f");
    px(COFFEE.x + 12, COFFEE.y + 18, 2, 2, dark ? "#2a1d14" : "#4a301f");
    px(COFFEE.x, COFFEE.y + 2, 7, 6, "#c8743a");
    px(COFFEE.x + 1, COFFEE.y + 1, 5, 1, "#e0955a");
    px(COFFEE.x + 7, COFFEE.y + 3, 2, 1, "#c8743a");
    px(COFFEE.x + 3, COFFEE.y, 1, 1, "#1a1612");
    if (!state.reduced && Math.floor(now / 600) % 2) px(COFFEE.x + 9, COFFEE.y + 1, 1, 1, "#f4f4f2");
    px(COFFEE.x + 10, COFFEE.y + 5, 3, 3, "#f4f4f2");
    px(COFFEE.x + 10, COFFEE.y + 5, 3, 1, "#c9c2a8");
    // fiddle-leaf fig, in the corner away from the tea queue
    px(6, 178, 10, 7, "#b5603a");
    px(6, 178, 10, 1, "#d27a4e");
    px(10, 158, 2, 20, "#5a3a22");
    for (const [lx, ly] of [[3, 160], [12, 156], [4, 168], [13, 166], [7, 151]]) {
      px(lx, ly, 6, 5, "#2e7d4f");
      px(lx + 1, ly + 1, 3, 2, "#3fa36a");
    }
    px(DOOR.x - 12, 190, 24, 10, dark ? "#3a291e" : "#8a5a3a");
    text(DOOR.x - 7, 192, "EXIT", dark ? "#c3c3c9" : "#f4efe2");
  }

  function drawTable(i: number, occupant: Person | undefined, dark: boolean, now: number) {
    const d = deskPos(i);
    const top = dark ? "#6b5534" : "#c9a06a";
    const front = dark ? "#4a3a24" : "#8e6a44";
    px(d.x, d.y, DESK_W, DESK_H - 4, top);
    px(d.x + 2, d.y + 1, DESK_W - 4, DESK_H - 6, dark ? "#2c4a35" : "#3f6b4a");
    px(d.x, d.y + DESK_H - 4, DESK_W, 4, front);
    px(d.x + 2, d.y + DESK_H, 2, 4, front);
    px(d.x + DESK_W - 4, d.y + DESK_H, 2, 4, front);
    const on = !!occupant && !occupant.gone && (occupant.seated || occupant.brew) && AT_WORK.includes(occupant.status);
    const glow = !on ? null : occupant!.status === "blocked" ? "#f2b33d" : occupant!.status === "working" ? "#7fd9a6" : "#8fb8ff";
    // laptop, seen from behind: a low lid instead of a monitor
    px(d.x + 14, d.y - 7, 12, 8, dark ? "#5a5e68" : "#b8bcc4");
    px(d.x + 14, d.y - 7, 12, 1, dark ? "#6c707a" : "#d4d7dd");
    px(d.x + 19, d.y - 4, 2, 2, glow ?? (dark ? "#474b54" : "#9ea3ad"));
    if (glow) {
      px(d.x + 13, d.y - 8, 14, 1, glow);
      if (occupant!.status === "working" && Math.floor(now / 160 + occupant!.phase * 10) % 2 === 0) px(d.x + 15, d.y - 6, 10, 1, glow);
    }
    px(d.x + 14, d.y + 1, 12, 2, dark ? "#474b54" : "#8e939c");
    // banker's lamp: its light is the status
    px(d.x + 31, d.y + 2, 5, 1, "#c9a441");
    px(d.x + 33, d.y - 4, 1, 6, "#c9a441");
    px(d.x + 30, d.y - 7, 7, 3, "#2e7d4f");
    px(d.x + 30, d.y - 7, 7, 1, "#3fa36a");
    if (glow) px(d.x + 31, d.y - 4, 5, 1, glow);
    // papers
    px(d.x + 3, d.y + 1, 6, 4, "#f4f0e4");
    px(d.x + 4, d.y + 2, 4, 1, "#c9c2a8");
    if (occupant && !occupant.gone) {
      px(d.x + 3, d.y + 6, 7, 2, LIVERY[occupant.livery]);
    }
  }

  function drawDesk(i: number, occupant: Person | undefined, dark: boolean, now: number) {
    const d = deskPos(i);
    const top = dark ? "#6b5a47" : "#b78a5b";
    const front = dark ? "#4f4234" : "#8e6a44";
    px(d.x, d.y, DESK_W, DESK_H - 4, top);
    px(d.x, d.y + DESK_H - 4, DESK_W, 4, front);
    px(d.x + 2, d.y + DESK_H, 2, 4, front);
    px(d.x + DESK_W - 4, d.y + DESK_H, 2, 4, front);
    // monitor (we see its back)
    const on = !!occupant && !occupant.gone && (occupant.seated || occupant.brew) && AT_WORK.includes(occupant.status);
    px(d.x + 13, d.y - 9, 14, 10, dark ? "#2a2933" : "#3b3b38");
    px(d.x + 19, d.y + 1, 2, 2, dark ? "#2a2933" : "#3b3b38");
    if (on) {
      const glow = occupant!.status === "blocked" ? "#f2b33d" : occupant!.status === "working" ? "#7fd9a6" : "#8fb8ff";
      px(d.x + 12, d.y - 10, 16, 1, glow);
      px(d.x + 12, d.y - 10, 1, 11, glow);
      px(d.x + 27, d.y - 10, 1, 11, glow);
      if (occupant!.status === "working" && Math.floor(now / 160 + occupant!.phase * 10) % 2 === 0) px(d.x + 14, d.y - 8, 12, 1, glow);
    }
    // keyboard
    px(d.x + 15, d.y + 2, 10, 2, dark ? "#3d3b47" : "#55534f");
    // nameplate in livery color (the thread back to the board)
    if (occupant && !occupant.gone) {
      px(d.x + 3, d.y + 2, 7, 4, LIVERY[occupant.livery]);
      px(d.x + 3, d.y + 6, 7, 1, front);
    }
    // mug
    px(d.x + 31, d.y + 1, 3, 3, "#f4f4f2");
  }

  function drawSpark(seat: { x: number; y: number }, now: number) {
    const bx = seat.x;
    const by = Math.max(seat.y - 22, 53);
    px(bx + 5, by - 1, 1, 1, "#f4f4f2");
    px(bx + 6, by - 3, 2, 2, "#f4f4f2");
    px(bx + 6, by - 11, 11, 7, "#f4f4f2");
    const f = SPARK[state.reduced ? 0 : Math.floor(now / 420) % 2];
    f.forEach((row, r) => [...row].forEach((on, k) => on === "1" && px(bx + 9 + k, by - 10 + r, 1, 1, "#d97757")));
  }

  function drawPerson(p: Person, now: number, dark: boolean) {
    const upset = p.upset > now;
    const bx = Math.round(p.x) + (upset && !state.reduced ? (Math.floor(now / 60) % 2 ? 1 : -1) : 0);
    const by = Math.round(p.y);
    const liv = p.id === HR_ID ? (dark ? "#8b93a7" : "#5b6472") : LIVERY[p.livery];
    const pants = dark ? "#2d3148" : "#3a3f5c";
    const OUT = dark ? "#0b0b12" : "#1d1a24";
    const selected = p.id === state.hover || p.id === hoverId || p.id === state.selected;
    const walkF = p.moving && !state.reduced ? Math.floor(now / 95) % 4 : 1;
    const lf = [1, 0, -1, 0][walkF]; // leg offset for the 4-frame walk
    const bob = p.status === "thinking" && !p.moving && !state.reduced ? Math.floor(now / 500 + p.phase * 4) % 2 : 0;
    const top = by - 18 - bob;
    const typing = p.seated && p.status === "working" && !state.reduced;
    const tf = Math.floor(now / 140 + p.phase * 7) % 2;
    const ink = "#1a1922";

    // One figure description, painted four times offset in the outline color and once in its own colors.
    const figure = (paint: (x: number, y: number, w: number, h: number, c: string) => void) => {
      // legs
      if (p.seated) {
        paint(bx - 4, by - 5, 8, 4, pants);
        paint(bx - 4, by - 2, 8, 1, shade(pants));
      } else if (p.facing === "left" || p.facing === "right") {
        paint(bx - 3 + lf, by - 5, 3, 5, pants);
        paint(bx + 1 - lf, by - 5, 3, 5, shade(pants));
      } else {
        paint(bx - 4, by - 5 - (lf > 0 ? 1 : 0), 3, 5 + (lf > 0 ? 1 : 0), pants);
        paint(bx + 1, by - 5 - (lf < 0 ? 1 : 0), 3, 5 + (lf < 0 ? 1 : 0), shade(pants));
      }
      // body with a shading step at the bottom
      paint(bx - 5, top + 7, 10, 5, liv);
      paint(bx - 5, top + 12, 10, 2, shade(liv));
      // arms
      if (p.status === "blocked" && !p.moving) {
        paint(bx - 7, top + 3, 2, 5, p.skin);
        paint(bx + 5, top + 3, 2, 5, p.skin);
        paint(bx - 7, top + 7, 2, 2, liv);
        paint(bx + 5, top + 7, 2, 2, liv);
      } else if (typing) {
        paint(bx - 7, top + 9 + tf, 2, 4, liv);
        paint(bx + 5, top + 10 - tf, 2, 4, liv);
        paint(bx - 7, top + 13 + tf, 2, 1, p.skin);
        paint(bx + 5, top + 14 - tf, 2, 1, p.skin);
      } else if (p.status === "thinking" && !p.moving) {
        paint(bx - 7, top + 8, 2, 5, liv);
        paint(bx + 5, top + 5, 2, 5, liv);
        paint(bx + 4, top + 5, 2, 2, p.skin);
      } else if (p.status === "idle" && !p.moving) {
        paint(bx - 7, top + 8, 2, 5, liv);
        paint(bx + 5, top + 9, 2, 3, liv);
        paint(bx + 5, top + 12, 3, 3, "#f4f4f2");
        paint(bx + 6, top + 13, 1, 1, "#5a3a22");
      } else {
        const swing = p.moving ? (walkF === 0 ? 1 : walkF === 2 ? -1 : 0) : 0;
        paint(bx - 7, top + 8 + swing, 2, 5, liv);
        paint(bx + 5, top + 8 - swing, 2, 5, liv);
        paint(bx - 7, top + 13 + swing, 2, 1, p.skin);
        paint(bx + 5, top + 13 - swing, 2, 1, p.skin);
      }
      // head
      paint(bx - 4, top, 8, 7, p.skin);
      paint(bx - 4, top + 6, 8, 1, shade(p.skin));
      paint(bx - 4, top, 8, 3, p.hair);
      paint(bx - 4, top + 2, 8, 1, shade(p.hair));
      if (p.facing === "left") paint(bx - 5, top + 1, 1, 5, p.hair);
      if (p.facing === "right") paint(bx + 4, top + 1, 1, 5, p.hair);
      if (p.facing === "up") paint(bx - 4, top, 8, 7, p.hair);
    };
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) figure((x, y, w, h) => px(x + dx, y + dy, w, h, OUT));
    figure(px);
    // HR wears a suit and tie: white collar, red tie, darker lapels
    if (p.id === HR_ID && p.facing !== "up") {
      px(bx - 2, top + 7, 4, 1, "#f4f4f2");
      if (p.facing === "down") {
        px(bx - 3, top + 7, 1, 4, shade(liv));
        px(bx + 2, top + 7, 1, 4, shade(liv));
        px(bx - 1, top + 7, 2, 1, "#8e1f1a");
        px(bx - 1, top + 8, 2, 3, "#c8322a");
        px(bx - 1, top + 11, 1, 1, "#c8322a");
      }
    }
    // a coffee in hand on the way back
    if (p.cupUntil > now && p.facing !== "up" && !(p.status === "idle" && !p.moving)) {
      px(bx + 5, top + 11, 3, 3, "#f4f4f2");
      px(bx + 6, top + 11, 1, 1, "#5a3a22");
    }
    // harassed: flushed face, angry brows, frown, steam
    if (upset && p.facing !== "up") {
      px(bx - 4, top + 3, 8, 3, "#e0604a");
      if (p.facing === "down") {
        px(bx - 3, top + 3, 2, 1, ink);
        px(bx + 1, top + 3, 2, 1, ink);
        px(bx - 1, top + 6, 2, 1, ink);
      }
    }
    if (upset) {
      const t = state.reduced ? 2 : Math.floor(now / 90) % 8;
      // puffs shrink as they rise off each side of the head
      for (const [sx, k] of [[bx - 8, t], [bx + 5, (t + 4) % 8]]) {
        const n = k < 3 ? 3 : k < 6 ? 2 : 1;
        px(sx + 3 - n, top + 1 - k, n, n, "#ecebe7");
      }
    }
    // HR carries a clipboard
    if (p.id === HR_ID && !p.moving) {
      px(bx + 4, top + 8, 4, 5, "#f4f4f2");
      px(bx + 4, top + 8, 4, 1, "#9a9a95");
    }
    // face details are drawn last so the outline pass never covers them
    if (p.facing === "down") {
      px(bx - 2, top + 4, 1, 1, ink);
      px(bx + 1, top + 4, 1, 1, ink);
      if (p.status === "stopped") px(bx - 2, top + 6, 4, 1, ink);
    } else if (p.facing !== "up") {
      px(p.facing === "left" ? bx - 3 : bx + 2, top + 4, 1, 1, ink);
    }
    if (dark && p.seated && ["working", "thinking"].includes(p.status)) px(bx - 4, top + 3, 8, 1, p.status === "working" ? "#bfe9d0" : "#c7dbff");
    if (selected) {
      g.strokeStyle = dark ? "#f3f3f5" : "#121316";
      g.lineWidth = 1;
      g.strokeRect(bx - 8.5, top - 3.5, 17, 23 + bob);
    }

    // bubbles
    const bubbleY = Math.max(top - 4, 53);
    if (p.status === "blocked" && !p.moving) {
      const bb = state.reduced ? 0 : Math.floor(now / 300) % 2;
      px(bx - 3, bubbleY - 9 - bb, 7, 9, "#f2b33d");
      px(bx - 1, bubbleY - 8 - bb, 3, 1, "#f2b33d");
      text(bx - 1, bubbleY - 7 - bb, "!", "#121211");
    } else if (p.status === "holding" && !p.moving) {
      px(bx - 6, bubbleY - 7, 13, 7, "#f4f4f2");
      for (let k = 0; k < 3; k++) px(bx - 4 + k * 4, bubbleY - 4, 2, 2, Math.floor(now / 350) % 3 === k || state.reduced ? "#121211" : "#a6a6a1");
    } else if (p.status === "thinking" && !p.moving && !p.bubble) {
      const k = state.reduced ? 1 : Math.floor(now / 350) % 3;
      px(bx + 5, bubbleY - 1, 1, 1, "#f4f4f2");
      px(bx + 6, bubbleY - 3, 2, 2, "#f4f4f2");
      px(bx + 6, bubbleY - 11, 11, 7, "#f4f4f2");
      for (let i = 0; i < 3; i++) px(bx + 8 + i * 3, bubbleY - 8, 2, 2, i <= k ? "#121211" : "#cdcdc9");
    }
    if (p.bubble?.kind === "say") {
      const lines = wrap(p.bubble.text ?? "");
      const w = Math.max(...lines.map(textW)) + 4;
      const h = lines.length * 6 + 3;
      let x0 = bx - Math.floor(w / 2);
      let y0 = bubbleY - h - 2;
      if (y0 < 44) {
        // keep the bubble off the wall decor: sit it beside the head instead
        y0 = Math.max(44, top - 2);
        x0 = bx + 8;
      }
      x0 = Math.max(2, Math.min(W - w - 2, x0));
      px(x0 - 1, y0 - 1, w + 2, h + 2, "#121211");
      px(x0, y0, w, h, "#f4f4f2");
      px(bx - 1, y0 + h, 3, 1, "#f4f4f2");
      px(bx, y0 + h + 1, 1, 1, "#121211");
      lines.forEach((l, i) => text(x0 + 2, y0 + 2 + i * 6, l, "#121211"));
    }
  }

  function render(now: number) {
    const dark = state.theme === "dark";
    g.imageSmoothingEnabled = false;
    const studio = state.look === "studio";
    if (studio) drawStudio(dark, now);
    else drawRoom(dark, now);
    // a rug under the desk block, so the room reads as sized to the team
    {
      const rx = DESK_X0 - 14;
      // The studio's rug stays on the floor, clear of the bookshelves.
      const ry = studio ? Math.max(43, DESK_Y0 - 32) : DESK_Y0 - 32;
      const rw = (COLS - 1) * DESK_DX + DESK_W + 28;
      const rh = (ROWS - 1) * DESK_DY + DESK_H + 44 - (studio ? ry - (DESK_Y0 - 32) : 0);
      if (studio) {
        // a red runner with a gold-dotted border
        px(rx, ry, rw, rh, dark ? "#3d1a18" : "#7a2e2a");
        px(rx + 2, ry + 2, rw - 4, rh - 4, dark ? "#4e221f" : "#9c3b33");
        for (let x = rx + 3; x < rx + rw - 3; x += 4) {
          px(x, ry + 1, 1, 1, dark ? "#8a6a2c" : "#d9a441");
          px(x, ry + rh - 2, 1, 1, dark ? "#8a6a2c" : "#d9a441");
        }
        px(rx + 5, ry + 5, rw - 10, rh - 10, dark ? "#46201d" : "#8f3530");
      } else {
        px(rx, ry, rw, rh, dark ? "#2f2a3e" : "#b9a98a");
        px(rx + 1, ry + 1, rw - 2, rh - 2, dark ? "#3a3449" : "#c4b596");
        px(rx + 3, ry + 3, rw - 6, rh - 6, dark ? "#332e42" : "#bfb091");
      }
    }
    // chairs sit behind their desks and their people
    for (let i = 0; i < COLS * ROWS; i++) {
      const d = deskPos(i);
      const chair = studio ? (dark ? "#3a291e" : "#6b4a33") : dark ? "#3b3744" : "#4e4a5a";
      px(d.x + 14, d.y - 26, 12, 5, chair);
      px(d.x + 14, d.y - 26, 12, 1, shade(chair));
      px(d.x + 19, d.y - 21, 2, 3, shade(chair));
    }
    const byDesk = new Map<number, Person>();
    for (const p of people.values()) if (!p.gone && p.desk != null) byDesk.set(p.desk, p);
    const items: { y: number; draw: () => void }[] = [];
    for (let i = 0; i < COLS * ROWS; i++) {
      const d = deskPos(i);
      items.push({ y: d.y + DESK_H, draw: () => (studio ? drawTable : drawDesk)(i, byDesk.get(i), dark, now) });
    }
    for (const p of people.values()) if (!p.gone) items.push({ y: p.y + (p.seated ? -0.5 : 0.5), draw: () => drawPerson(p, now, dark) });
    // On a coffee run the AI keeps going: a Claude spark thinks in the empty chair.
    for (const [i, p] of byDesk) if (p.brew && !p.seated && (p.status === "working" || p.status === "thinking")) items.push({ y: deskPos(i).y + DESK_H + 0.1, draw: () => drawSpark(seatOf(i), now) });
    items.sort((a, b) => a.y - b.y);
    for (const it of items) it.draw();
    if (dark) {
      // night: dim the room, then let the monitors and the coffee machine light their corners
      g.fillStyle = "rgba(8, 8, 24, 0.28)";
      g.fillRect(0, 42, W, H - 42);
      g.globalCompositeOperation = "lighter";
      for (const [i, p] of byDesk) {
        if (!(p.seated || p.brew) || !AT_WORK.includes(p.status)) continue;
        const d = deskPos(i);
        const c = p.status === "blocked" ? "242, 179, 61" : p.status === "working" ? "127, 217, 166" : "143, 184, 255";
        for (let r = 0; r < 3; r++) {
          g.fillStyle = `rgba(${c}, ${0.05 + (2 - r) * 0.03})`;
          g.fillRect(d.x + 8 - r * 6, d.y - 22 - r * 4, 24 + r * 12, 36 + r * 8);
        }
      }
      g.globalCompositeOperation = "source-over";
    }
    // blit
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = dark ? "#0f0f11" : "#f5f5f3";
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(lo as unknown as CanvasImageSource, 0, 0, W, H, ox, oy, W * scale, H * scale);
    // hi-res name tag for the hovered or selected person
    const tagId = hoverId ?? state.hover ?? state.selected;
    const tp = tagId ? people.get(tagId) : null;
    if (tp && !tp.gone) {
      const fontPx = Math.max(10, Math.round(scale * 4.2));
      ctx.font = `600 ${fontPx}px ui-sans-serif, system-ui, sans-serif`;
      const label = tp.title.length > 34 ? tp.title.slice(0, 33) + "…" : tp.title;
      const tw = ctx.measureText(label).width + fontPx;
      let tx = ox + tp.x * scale - tw / 2;
      tx = Math.max(ox, Math.min(ox + W * scale - tw, tx));
      const ty = oy + (tp.y - 22) * scale - fontPx * 1.6;
      ctx.fillStyle = dark ? "#f3f3f5" : "#121211";
      ctx.fillRect(Math.round(tx), Math.round(ty), Math.round(tw), Math.round(fontPx * 1.5));
      ctx.fillStyle = dark ? "#0f0f11" : "#f5f5f3";
      ctx.textBaseline = "middle";
      ctx.fillText(label, Math.round(tx + fontPx / 2), Math.round(ty + fontPx * 0.78));
    }
  }

  function frame(now: number) {
    if (destroyed) return;
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
    last = now;
    const d = new Date();
    clockText = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    if (state.visible) {
      step(dt, now);
      if (!state.reduced || dirty) {
        render(now);
        dirty = false;
      }
    }
    raf = rafFn(frame);
  }
  raf = rafFn(frame);

  function resize(w: number, h: number) {
    cw = Math.max(1, Math.floor(w));
    ch = Math.max(1, Math.floor(h));
    canvas.width = cw;
    canvas.height = ch;
    scale = Math.max(1, Math.floor(Math.min(cw / W, ch / H)));
    ox = Math.floor((cw - W * scale) / 2);
    oy = Math.floor((ch - H * scale) / 2);
    dirty = true;
  }

  function hit(x: number, y: number): string | null {
    const lx = (x - ox) / scale;
    const ly = (y - oy) / scale;
    let best: Person | null = null;
    for (const p of people.values()) {
      if (p.gone || p.id === HR_ID) continue;
      if (lx >= p.x - 7 && lx <= p.x + 7 && ly >= p.y - 22 && ly <= p.y + 1) if (!best || p.y > best.y) best = p;
    }
    return best?.id ?? null;
  }

  return {
    update,
    resize,
    pointer(x, y) {
      pointerLo = { x, y };
      const id = x < 0 ? null : hit(x, y);
      if (id !== hoverId) {
        hoverId = id;
        cb.onHover(id);
        dirty = true;
      }
    },
    click(x, y) {
      const id = hit(x, y);
      const p = id ? people.get(id) : undefined;
      cb.onSelect(id, p && { x: ox + p.x * scale, y: oy + (p.y - 22) * scale, s: scale });
    },
    destroy() {
      destroyed = true;
      cafFn(raf);
      void pointerLo;
    },
  };
}
