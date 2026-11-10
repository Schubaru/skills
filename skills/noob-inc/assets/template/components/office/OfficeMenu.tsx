"use client";
import { useEffect, useRef, useState } from "react";
import type { Agent } from "@/lib/types";
import { agentName, STATUS_WORD } from "@/lib/format";
import { FONT } from "./engine";

/** Where a clicked person stands inside the office box, in CSS px, plus one office pixel (u) and the box size. */
export interface MenuAt {
  x: number;
  y: number;
  u: number;
  w: number;
  h: number;
}

const CURSOR = ["100", "110", "111", "110", "100"];

/** Text in the office's own 3x5 bitmap font, so the menu reads as part of the canvas. Unknown characters are left blank. */
function Pix({ s, rows }: { s?: string; rows?: string[] }) {
  const glyphs = rows ? [rows] : [...(s ?? "").toUpperCase()].map((ch) => FONT[ch] ?? FONT[" "]);
  let d = "";
  glyphs.forEach((gl, i) => gl.forEach((row, r) => [...row].forEach((on, k) => on === "1" && (d += `M${i * 4 + k} ${r}h1v1h-1z`))));
  const w = glyphs.length * 4 - 1;
  return (
    <svg className="pix" viewBox={`0 0 ${w} 5`} style={{ width: `calc(var(--u) * ${w})` }} shapeRendering="crispEdges" aria-hidden>
      <path d={d} fill="currentColor" />
    </svg>
  );
}

interface Item {
  label: string;
  aria: string;
  run(): void;
  danger?: boolean;
  disabled?: boolean;
}

interface Props {
  agent: Agent;
  at: MenuAt;
  onDetails?(): void;
  onFire?(): Promise<boolean>;
  /** The shared view's menu instead: Harass or Get coffee. Resolves false when that person is mid-skit. */
  onVisit?(act: "harass" | "coffee"): Promise<boolean>;
  /** A skit is already playing for this person. */
  busy?: boolean;
  onClose(): void;
}

export default function OfficeMenu({ agent, at, onDetails, onFire, onVisit, busy, onClose }: Props) {
  const [confirm, setConfirm] = useState(false);
  const [failed, setFailed] = useState(false);
  const [cur, setCur] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const btns = useRef<(HTMLButtonElement | null)[]>([]);
  const name = agentName(agent);
  // The office already tags the person with their name, so the header says what they are doing.
  const head = confirm ? "Fire them?" : failed ? (onVisit ? "One sec" : "Couldn't fire") : onVisit && busy ? "Busy" : STATUS_WORD[agent.status] ?? agent.status;
  // A finished subagent idles in the break area, so it can be let go too.
  const canFire = agent.status === "idle" || (agent.kind === "subagent" && agent.status === "done");

  const visit = async (act: "harass" | "coffee") => {
    if (await onVisit!(act)) return onClose();
    setFailed(true);
  };
  const fire = async () => {
    if (await onFire!()) return onClose();
    setFailed(true);
    setConfirm(false);
    setCur(1);
  };
  const items: Item[] = onVisit
    ? [
        { label: "Harass", aria: busy ? `Harass: ${name} is busy right now` : `Harass ${name}`, run: () => visit("harass"), danger: true, disabled: busy },
        { label: "Get coffee", aria: busy ? `Get coffee: ${name} is busy right now` : `Send ${name} for coffee`, run: () => visit("coffee"), disabled: busy },
      ]
    : confirm
    ? [
        { label: "No", aria: "Keep them", run: () => (setConfirm(false), setCur(1)) },
        { label: "Yes, fire", aria: `Yes, fire ${name}`, run: fire, danger: true },
      ]
    : [
        { label: "Details", aria: `${name} details`, run: () => onDetails?.() },
        {
          label: "Fire",
          aria: canFire ? `Fire ${name}` : "Fire: only an idle agent can be fired",
          run: () => (setConfirm(true), setCur(0)),
          danger: true,
          disabled: !canFire,
        },
      ];

  useEffect(() => btns.current[cur]?.focus(), [cur, confirm]);
  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [onClose]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setCur((c) => (c + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length);
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (confirm) setConfirm(false), setCur(1);
      else onClose();
    } else if (e.key === "Tab") onClose();
  };

  // Opens beside the person, toward the roomier side of the office.
  const left = at.x > at.w * 0.55;
  const up = at.y > at.h * 0.45;
  return (
    <div
      ref={ref}
      className={`omenu${left ? " left" : ""}${up ? " up" : ""}`}
      style={{ left: at.x, top: at.y, "--u": `${at.u}px` } as React.CSSProperties}
      role="menu"
      aria-label={confirm ? `Fire ${name}?` : `${name}, ${head}`}
      onKeyDown={onKey}
    >
      <div className="omenu-head">
        <Pix s={head} />
      </div>
      {items.map((it, i) => (
        <button
          key={it.label}
          ref={(el) => {
            btns.current[i] = el;
          }}
          type="button"
          role="menuitem"
          className={`omenu-item${it.danger ? " danger" : ""}`}
          aria-label={it.aria}
          aria-disabled={it.disabled || undefined}
          onPointerEnter={() => setCur(i)}
          onFocus={() => setCur(i)}
          onClick={() => !it.disabled && it.run()}
        >
          <span className="omenu-cur" style={{ visibility: cur === i ? "visible" : "hidden" }}>
            <Pix rows={CURSOR} />
          </span>
          <Pix s={it.label} />
        </button>
      ))}
    </div>
  );
}
