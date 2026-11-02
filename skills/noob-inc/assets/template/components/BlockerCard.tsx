"use client";
import { useEffect, useRef, useState } from "react";
import type { Blocker, Question } from "@/lib/types";
import { fmtDuration, timeAgo } from "@/lib/format";
import { act } from "./useLiveState";
import { IconBack, IconCheck, IconChevron, IconX } from "./Icons";

interface Props {
  blocker: Blocker;
  holdUntil: string | null;
  now: number;
  onDone(note: string): void;
}

/** One thing an agent is waiting on, shown at the top of its sheet. */
export default function BlockerCard({ blocker: b, holdUntil, now, onDone }: Props) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const holdLeft = holdUntil ? new Date(holdUntil).getTime() - now : 0;
  const held = holdLeft > 0;

  const decide = async (decision: string, note: string, extra: Record<string, unknown> = {}) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await act(`/api/blockers/${b.id}`, { decision, ...extra });
      if (r.ok) onDone(note);
      else setErr(r.error?.startsWith("already") ? "This was already answered in Claude." : "That didn't go through. Try again, or answer it in Claude.");
    } catch {
      setErr("Couldn't reach the dashboard. Check your connection, or answer it in Claude.");
    }
    setBusy(false);
  };
  const release = () => decide("release", "Left for you to answer in Claude.");

  const meta = (
    <span className="label ask-meta num">
      {timeAgo(b.created_at, now)}
      {held ? ` · ${fmtDuration(holdLeft)} left to answer here` : ""}
    </span>
  );

  return (
    <div className="ask-item">
      {b.kind === "question" ? (
        <QuestionFlow b={b} held={held} busy={busy} meta={meta} onAnswer={(answers) => decide("answer", "Answers sent. Claude is continuing.", { answers })} onRelease={release} />
      ) : (
        <>
          <div className="ask-head">
            <span className="label ask-kind">{b.kind === "permission" ? "Needs permission" : "Needs input in Claude"}</span>
            {meta}
          </div>
          {b.kind === "permission" ? (
            <>
              <p className="ask-perm">
                <b>{b.tool}</b> {b.prompt ? <span className="mono ask-perm-prompt">{b.prompt}</span> : null}
              </p>
              {b.input && (
                <details className="ask-detail">
                  <summary>Full input</summary>
                  <pre className="mono">{JSON.stringify(b.input, null, 2)}</pre>
                </details>
              )}
              {held ? (
                <div className="ask-actions">
                  <button className="btn primary" disabled={busy} onClick={() => decide("allow", "Allowed. Claude is continuing.")}>
                    <IconCheck /> Allow
                  </button>
                  <button className="btn" disabled={busy} onClick={() => decide("allow_session", `${b.tool} is allowed for the rest of this session.`)} title={`Allow ${b.tool} for the rest of this session`}>
                    Allow for session
                  </button>
                  <button className="btn danger" disabled={busy} onClick={() => decide("deny", "Denied. Claude won't run it.")}>
                    <IconX /> Deny
                  </button>
                  <button className="btn quiet ask-alt" disabled={busy} onClick={release}>
                    Answer in Claude
                  </button>
                </div>
              ) : (
                <NotHeld busy={busy} onDismiss={release} />
              )}
            </>
          ) : (
            <>
              <p className="ask-perm">{b.prompt || "An MCP server is asking for input."}</p>
              <NotHeld terminalOnly busy={busy} onDismiss={release} />
            </>
          )}
        </>
      )}
      {err && (
        <p className="form-error" role="alert">
          {err}
        </p>
      )}
    </div>
  );
}

function NotHeld({ onDismiss, busy, terminalOnly, top }: { onDismiss(): void; busy: boolean; terminalOnly?: boolean; top?: boolean }) {
  return (
    <div className={top ? "ask-readonly-note" : "ask-actions"} role={top ? "note" : undefined}>
      <span className="ask-note">
        {top ? <b>Answer this one in Claude. </b> : null}
        {terminalOnly ? "This one can only be answered in Claude." : top ? "Claude stopped waiting on the dashboard for it, so picks here can't be sent." : "Claude isn't waiting on the dashboard for this one, so answer it in Claude."}
      </span>
      <button className="btn quiet sm" disabled={busy} onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------

type Kind = "choice" | "text" | "number" | "lost";
interface Draft {
  picked: string[];
  other: string;
  num: number | null;
}

// Prompts saved by older bridges lost their option objects; keep only real ones.
const optionsOf = (q: Question) => (Array.isArray(q.options) ? q.options : []).filter((o) => o && typeof o.label === "string");

function kindOf(q: Question): Kind {
  if (q.kind === "number") return "number";
  if (q.kind === "text") return "text";
  if (optionsOf(q).length) return "choice";
  return Array.isArray(q.options) && q.options.length ? "lost" : "text";
}

function answerOf(q: Question, d: Draft): string {
  const kind = kindOf(q);
  if (kind === "number") return d.num == null ? "" : String(d.num);
  if (kind === "lost") return "";
  const other = d.other.trim();
  if (kind === "text") return other;
  return [...d.picked, ...(other ? [other] : [])].join(", ");
}

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

interface FlowProps {
  b: Blocker;
  held: boolean;
  busy: boolean;
  meta: React.ReactNode;
  onAnswer(a: Record<string, string>): void;
  onRelease(): void;
}

/** Claude's question form, one question at a time. Read-only (every option still shown) when no hook is waiting for the answer. */
function QuestionFlow({ b, held, busy, meta, onAnswer, onRelease }: FlowProps) {
  const input = (b.input ?? {}) as { questions?: Question[]; title?: string };
  const questions = Array.isArray(input.questions) ? input.questions.filter((q) => q && typeof q.question === "string") : [];
  const [step, setStep] = useState(0);
  const [drafts, setDrafts] = useState<Draft[]>(() => questions.map(() => ({ picked: [], other: "", num: null })));
  const primaryRef = useRef<HTMLButtonElement>(null);
  const otherRef = useRef<HTMLInputElement>(null);
  const advance = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});

  useEffect(() => () => clearTimeout(advance.current), []);
  // A number question counts as answered once you reach it, at its starting value.
  useEffect(() => {
    const q = questions[step];
    if (q && kindOf(q) === "number") setDrafts((ds) => ds.map((x, i) => (i === step && x.num == null ? { ...x, num: q.defaultValue ?? q.min ?? 0 } : x)));
  }, [step]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!questions.length) {
    return (
      <>
        <div className="ask-head">
          <span className="label ask-kind">Question</span>
          {meta}
        </div>
        <p className="ask-perm">{b.prompt || "Claude is asking you something."}</p>
        <NotHeld busy={busy} onDismiss={onRelease} />
      </>
    );
  }

  const q = questions[step];
  const d = drafts[step];
  const kind = kindOf(q);
  const opts = optionsOf(q);
  const last = step === questions.length - 1;
  const live = held && !busy;
  const answers: Record<string, string> = {};
  questions.forEach((qq, i) => {
    const a = answerOf(qq, drafts[i]);
    if (a) answers[qq.question] = a;
  });
  const answered = Object.keys(answers).length;
  const current = answerOf(q, d);

  const update = (patch: Partial<Draft>) => setDrafts((ds) => ds.map((x, i) => (i === step ? { ...x, ...patch } : x)));
  const go = (i: number) => {
    clearTimeout(advance.current);
    setStep(Math.max(0, Math.min(questions.length - 1, i)));
  };
  const pick = (label: string) => {
    if (!live) return;
    if (q.multiSelect) {
      setDrafts((ds) => ds.map((x, i) => (i === step ? { ...x, picked: x.picked.includes(label) ? x.picked.filter((p) => p !== label) : [...x.picked, label] } : x)));
      return;
    }
    update({ picked: [label], other: "" });
    // A single choice is the whole answer, so move on the way Claude's own form does.
    clearTimeout(advance.current);
    if (!last) advance.current = setTimeout(() => setStep((s) => Math.min(s + 1, questions.length - 1)), 220);
    else requestAnimationFrame(() => primaryRef.current?.focus());
  };
  const primary = () => {
    if (!live) return;
    if (!last) go(step + 1);
    else if (answered > 0) onAnswer(answers);
  };
  keys.current = (e) => {
    if (!live || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || kind !== "choice") return;
    const n = Number(e.key);
    if (n >= 1 && n <= opts.length) {
      e.preventDefault();
      pick(opts[n - 1].label);
    } else if (n === opts.length + 1) {
      e.preventDefault();
      otherRef.current?.focus();
    }
  };
  const enterSubmits = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (kind !== "text" || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      primary();
    }
  };
  const otherOn = !!d.other.trim();

  return (
    <>
      <div className="ask-head">
        <span className="label ask-kind">{questions.length > 1 ? `Question ${step + 1} of ${questions.length}` : "Question"}</span>
        {meta}
      </div>
      {!held && <NotHeld top busy={busy} onDismiss={onRelease} />}
      {input.title && <p className="ask-title">{input.title}</p>}
      {questions.length > 1 && (
        <div className="ask-tabs" role="group" aria-label="Questions">
          {questions.map((qq, i) => {
            const done = !!answerOf(qq, drafts[i]);
            return (
              <button
                type="button"
                key={i}
                className="ask-tab"
                data-state={i === step ? "current" : done ? "done" : "todo"}
                aria-current={i === step ? "step" : undefined}
                aria-label={`Question ${i + 1}${qq.header ? `, ${qq.header}` : ""}${done ? ", answered" : ""}`}
                onClick={() => go(i)}
              >
                {done ? <IconCheck /> : <span className="ask-tab-n num">{i + 1}</span>}
                <span className="ask-tab-label">{qq.header || `Question ${i + 1}`}</span>
              </button>
            );
          })}
        </div>
      )}

      <fieldset className={`ask-q${held ? "" : " readonly"}`} key={step} disabled={!live}>
        <legend className="ask-question">{q.question}</legend>
        {(q.description || (q.multiSelect && kind === "choice")) && <p className="ask-help">{q.description || "Pick any that apply."}</p>}

        {kind === "choice" && (
          <div className="choices" role={q.multiSelect ? "group" : "radiogroup"} aria-label={q.header || "Options"}>
            {opts.map((o, i) => {
              const on = d.picked.includes(o.label);
              return (
                <button
                  type="button"
                  key={o.label}
                  className="choice"
                  role={q.multiSelect ? "checkbox" : "radio"}
                  aria-checked={on}
                  onClick={() => pick(o.label)}
                >
                  <span className="choice-num num" aria-hidden>
                    {q.multiSelect && on ? <IconCheck /> : i + 1}
                  </span>
                  <span className="choice-text">
                    <span className="choice-label">{o.label}</span>
                    {o.description && <span className="choice-desc">{o.description}</span>}
                  </span>
                </button>
              );
            })}
            {held && (
              <label className="choice other" data-on={otherOn || undefined}>
                <span className="choice-num num" aria-hidden>
                  {opts.length + 1}
                </span>
                <input
                  ref={otherRef}
                  className="choice-input"
                  placeholder="Type something else…"
                  aria-label="Your own answer"
                  value={d.other}
                  onChange={(e) => update(q.multiSelect ? { other: e.target.value } : { other: e.target.value, picked: e.target.value.trim() ? [] : d.picked })}
                  onKeyDown={enterSubmits}
                />
              </label>
            )}
          </div>
        )}

        {kind === "text" && (
          <textarea
            className="textarea"
            placeholder={held ? q.placeholder || "Type your answer…" : "Answer this one in Claude."}
            aria-label="Your answer"
            value={d.other}
            onChange={(e) => update({ other: e.target.value })}
            onKeyDown={enterSubmits}
          />
        )}

        {kind === "number" && (
          <div className="ask-num">
            <span className="ask-num-end num">{q.min ?? 0}</span>
            <input
              type="range"
              min={q.min ?? 0}
              max={q.max ?? 100}
              step={q.step ?? 1}
              value={d.num ?? q.defaultValue ?? q.min ?? 0}
              aria-label={q.header || "Value"}
              onChange={(e) => update({ num: Number(e.target.value) })}
              onKeyDown={enterSubmits}
            />
            <span className="ask-num-end num">{q.max ?? 100}</span>
            <output className="ask-num-value num">
              {d.num ?? q.defaultValue ?? q.min ?? 0}
              {q.unit ? <span> {q.unit}</span> : null}
            </output>
          </div>
        )}

        {kind === "lost" && <p className="ask-help">This question's options didn't reach the dashboard. Answer it in Claude.</p>}
      </fieldset>

      {held ? (
        <div className="ask-actions">
          {step > 0 && (
            <button type="button" className="btn quiet" onClick={() => go(step - 1)} disabled={busy}>
              <IconBack /> Back
            </button>
          )}
          <button type="button" className="btn quiet ask-alt" onClick={onRelease} disabled={busy}>
            Answer in Claude
          </button>
          <button type="button" ref={primaryRef} className="btn primary" onClick={primary} disabled={busy || (last && answered === 0)}>
            {last ? (
              <>
                <IconCheck /> {busy ? "Sending…" : questions.length > 1 ? "Send answers" : "Send answer"}
              </>
            ) : (
              <>
                {current ? "Next" : "Skip"} <IconChevron />
              </>
            )}
          </button>
        </div>
      ) : (
        questions.length > 1 && (
          <div className="ask-actions">
            <button type="button" className="btn quiet" onClick={() => go(step - 1)} disabled={step === 0}>
              <IconBack /> Back
            </button>
            <button type="button" className="btn quiet ask-alt" onClick={() => go(step + 1)} disabled={last}>
              Next <IconChevron />
            </button>
          </div>
        )
      )}
    </>
  );
}
