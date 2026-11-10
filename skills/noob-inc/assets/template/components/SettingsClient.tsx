"use client";
import { useEffect, useState } from "react";
import type { Machine, Settings } from "@/lib/types";
import { timeAgo } from "@/lib/format";
import IdleGuard from "./IdleGuard";
import TopBar from "./TopBar";
import { useTheme } from "./theme";
import { useLiveState } from "./useLiveState";
import { IconKey, IconX } from "./Icons";

interface Props {
  user: { name: string | null; login: string; image: string | null };
}

export default function SettingsClient({ user }: Props) {
  const live = useLiveState();
  const theme = useTheme();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [newName, setNewName] = useState("");
  const [fresh, setFresh] = useState<{ name: string; token: string } | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  useEffect(() => {
    if (live.settings && !settings) setSettings(live.settings);
    setMachines(live.machines);
  }, [live.settings, live.machines, settings]);

  const patch = async (p: Partial<Settings>) => {
    const next = { ...(settings as Settings), ...p };
    setSettings(next);
    const r = await fetch("/api/settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(p) });
    setSaved(r.ok ? "Saved" : "Couldn't save");
    setTimeout(() => setSaved(null), 1500);
  };

  const addMachine = async () => {
    const r = await fetch("/api/machines", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: newName }) });
    if (!r.ok) return;
    const j = (await r.json()) as { id: string; name: string; token: string };
    setFresh({ name: j.name, token: j.token });
    setNewName("");
    setMachines((m) => [...m, { id: j.id, name: j.name, created_at: new Date().toISOString(), last_seen_at: null }]);
  };
  const revoke = async (id: string) => {
    if (!confirm("Revoke this machine's token? Its bridge stops reporting until you install a new one.")) return;
    await fetch(`/api/machines/${id}`, { method: "DELETE" });
    setMachines((m) => m.filter((x) => x.id !== id));
  };

  const installCmd = fresh ? `curl -fsSL ${origin}/bridge/install.sh | sh -s -- ${fresh.token} ${origin}` : "";

  return (
    <div className="app">
      <TopBar machines={live.machines} online={live.online} loaded={live.loaded} now={live.now} theme={theme} user={user} />
      <main className="settings">
        <h1 className="display settings-h1">Settings</h1>

        <section className="card setting">
          <h2 className="label">Account</h2>
          <div className="setting-row">
            <div>
              <p className="setting-title">{user.name || user.login || "Signed in"}</p>
              <p className="setting-sub">GitHub · {user.login || "dev bypass"}. Only this account can sign in. You're signed out after 15 minutes without activity.</p>
            </div>
          </div>
        </section>

        <section className="card setting">
          <h2 className="label">Machines and bridge tokens</h2>
          <p className="setting-sub">Each machine that runs Claude Code gets its own token. Install the bridge once per machine; it registers hooks in <code className="mono">~/.claude/settings.json</code> and starts reporting sessions.</p>
          <ul className="machines">
            {machines.map((m) => (
              <li key={m.id} className="setting-row">
                <span className="machine-ico" aria-hidden>
                  <IconKey />
                </span>
                <div>
                  <p className="setting-title">{m.name}</p>
                  <p className="setting-sub">
                    {m.last_seen_at ? `last seen ${timeAgo(m.last_seen_at, live.now)}` : "never reported"} · added {new Date(m.created_at).toLocaleDateString()}
                  </p>
                </div>
                <button className="btn quiet sm danger" type="button" onClick={() => revoke(m.id)}>
                  <IconX /> Revoke
                </button>
              </li>
            ))}
            {machines.length === 0 && <li className="setting-sub">No machines yet.</li>}
          </ul>
          <div className="setting-add">
            <input className="input" placeholder="Machine name, e.g. MacBook Pro" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addMachine()} />
            <button className="btn primary" type="button" onClick={addMachine}>
              Add machine
            </button>
          </div>
          {fresh && (
            <div className="token-box">
              <p className="setting-title">Install on “{fresh.name}”</p>
              <p className="setting-sub">Run this in a terminal on that machine. The token is shown once; revoke and re-add if you lose it.</p>
              <pre className="mono token-cmd">{installCmd}</pre>
              <div className="panel-btns">
                <button className="btn" type="button" onClick={() => navigator.clipboard?.writeText(installCmd)}>
                  Copy command
                </button>
                <button className="btn quiet" type="button" onClick={() => setFresh(null)}>
                  Done
                </button>
              </div>
            </div>
          )}
        </section>

        <section className="card setting">
          <h2 className="label">Prompt holding</h2>
          <p className="setting-sub">When an agent asks for permission or asks you a question, the bridge can hold it so you can answer it here as well as in Claude. Whichever you answer first wins. Questions are always held unless this is set to Never.</p>
          {settings && (
            <div className="setting-grid">
              <label>
                <span className="label">Hold prompts</span>
                <select className="select" value={settings.hold_mode} onChange={(e) => patch({ hold_mode: e.target.value as Settings["hold_mode"] })}>
                  <option value="open">While the dashboard is open</option>
                  <option value="always">Always</option>
                  <option value="never">Never (Claude only)</option>
                </select>
              </label>
              <label>
                <span className="label">Hold for at most</span>
                <select className="select" value={settings.hold_seconds} onChange={(e) => patch({ hold_seconds: Number(e.target.value) })}>
                  <option value={60}>1 minute</option>
                  <option value={300}>5 minutes</option>
                  <option value={600}>10 minutes</option>
                  <option value={1800}>30 minutes</option>
                  <option value={3600}>1 hour</option>
                </select>
              </label>
              <label className="setting-check">
                <input type="checkbox" checked={settings.hold_on_stop} onChange={(e) => patch({ hold_on_stop: e.target.checked })} />
                <span>
                  <span className="setting-title">Hold finished turns for a reply</span>
                  <span className="setting-sub">When an agent finishes, keep it waiting (same rules) so you can send the next instruction from here.</span>
                </span>
              </label>
            </div>
          )}
        </section>

        <section className="card setting">
          <h2 className="label">Data</h2>
          {settings && (
            <div className="setting-grid">
              <label>
                <span className="label">Keep finished sessions for</span>
                <select className="select" value={settings.retain_days} onChange={(e) => patch({ retain_days: Number(e.target.value) })}>
                  <option value={1}>1 day</option>
                  <option value={7}>7 days</option>
                  <option value={30}>30 days</option>
                  <option value={90}>90 days</option>
                </select>
              </label>
            </div>
          )}
          <p className="setting-sub">Events and token counts live in your own Supabase project. Tool inputs are stored truncated; transcripts never leave your machine.</p>
        </section>

        <section className="card setting">
          <h2 className="label">Appearance</h2>
          <div className="setting-pick">
            <div>
              <p className="setting-title">Theme</p>
              <p className="setting-sub">This browser only.</p>
            </div>
            <div className="seg" role="radiogroup" aria-label="Theme">
              {(["system", "light", "dark"] as const).map((p) => (
                <button key={p} type="button" role="radio" aria-checked={theme.pref === p} className={`seg-btn${theme.pref === p ? " on" : ""}`} onClick={() => theme.set(p)}>
                  {p[0].toUpperCase() + p.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div className="setting-pick">
            <div>
              <p className="setting-title">Office</p>
              <p className="setting-sub">The room your agents work in. Anyone on your share link sees the same one.</p>
            </div>
            <div className="seg" role="radiogroup" aria-label="Office">
              {(["office", "studio"] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  role="radio"
                  aria-checked={settings?.office_look === l}
                  disabled={!settings}
                  className={`seg-btn${settings?.office_look === l ? " on" : ""}`}
                  onClick={() => patch({ office_look: l })}
                >
                  {l === "office" ? "Office" : "Studio"}
                </button>
              ))}
            </div>
          </div>
        </section>
        {saved && (
          <p className="panel-note" role="status">
            {saved}
          </p>
        )}
      </main>
      <IdleGuard />
    </div>
  );
}
