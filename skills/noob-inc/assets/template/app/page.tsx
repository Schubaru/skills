"use client";
import { useCallback, useEffect, useState } from "react";
import AgentBoard from "@/components/AgentBoard";
import AgentPanel from "@/components/AgentPanel";
import IdleGuard from "@/components/IdleGuard";
import { EmoteLayer, useEmoteFloats, ViewerLog } from "@/components/Viewers";
import Office from "@/components/office/Office";
import OfficeMenu, { type MenuAt } from "@/components/office/OfficeMenu";
import TopBar from "@/components/TopBar";
import { useTheme } from "@/components/theme";
import { act, useLiveState } from "@/components/useLiveState";
import "./dashboard.css";


export default function Dashboard() {
  const live = useLiveState();
  const { floats } = useEmoteFloats(live.events, null, live.loaded);
  const theme = useTheme();
  const [hover, setHover] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  // Clicking someone in the office opens their menu; clicking a row in the board opens their sheet.
  const [menu, setMenu] = useState<{ id: string; at: MenuAt } | null>(null);
  const onSelect = useCallback((id: string | null) => setSelected((s) => (id === null ? null : id === s ? null : id)), []);
  const agents = live.agents;
  const blockers = live.blockers;
  const selectedAgent = selected ? agents.find((a) => a.id === selected) ?? null : null;
  const waiting = live.blockers.length;
  const menuAgent = menu ? agents.find((a) => a.id === menu.id) ?? null : null;
  const closeMenu = useCallback(() => setMenu(null), []);
  const pickRow = useCallback((id: string | null) => (setMenu(null), onSelect(id)), [onSelect]);

  // A waiting agent shows in the tab title, so a background tab still says so. Re-applied every render because navigation resets the title.
  useEffect(() => {
    const t = waiting ? `(${waiting}) N00B Inc` : "N00B Inc";
    if (document.title !== t) document.title = t;
  });

  return (
    <div className="app">
      <TopBar machines={live.machines} online={live.online} loaded={live.loaded} now={live.now} theme={theme} />
      <main className={`main${selectedAgent ? " with-panel" : ""}`}>
        <div className="col-left">
          <AgentBoard agents={agents} blockers={blockers} machines={live.machines} now={live.now} hover={hover} selected={selected} loaded={live.loaded} onHover={setHover} onSelect={pickRow} />
        </div>
        <div className="col-right">
          <section className="office card" aria-label="The office">
            <Office look={live.look} agents={agents} events={live.events} theme={theme.resolved} hover={hover} selected={menu?.id ?? selected} onHover={setHover} onSelect={(id, at) => setMenu(id && at ? { id, at } : null)}>
              <EmoteLayer floats={floats} />
              {menu && menuAgent && (
                <OfficeMenu
                  key={menu.id}
                  agent={menuAgent}
                  at={menu.at}
                  onClose={closeMenu}
                  onDetails={() => (setSelected(menu.id), setMenu(null))}
                  onFire={async () => (await act(`/api/agents/${encodeURIComponent(menu.id)}`, { action: "letgo" })).ok}
                />
              )}
            </Office>
            <div className="office-legend" aria-hidden>
              <span>
                <i className="dot" style={{ background: "var(--green)" }} /> typing = working
              </span>
              <span>
                <i className="dot" style={{ background: "var(--blue)" }} /> thought bubble = thinking
              </span>
              <span>
                <i className="dot" style={{ background: "var(--amber)" }} /> ! = waiting on you
              </span>
              <span>
                <i className="dot" style={{ background: "var(--fg-3)" }} /> coffee = idle
              </span>
            </div>
          </section>
          <ViewerLog events={live.events} agents={live.agents} />
        </div>
      </main>
      {selectedAgent && <AgentPanel agent={selectedAgent} agents={agents} liveEvents={live.events} waiting={blockers.filter((b) => b.agent_id === selectedAgent.id)} now={live.now} onClose={() => setSelected(null)} onSelect={(id) => setSelected(id)} />}
      <IdleGuard />
    </div>
  );
}
