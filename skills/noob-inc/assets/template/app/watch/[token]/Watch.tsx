"use client";
import { useCallback, useRef, useState } from "react";
import AgentBoard from "@/components/AgentBoard";
import Office from "@/components/office/Office";
import OfficeMenu, { type MenuAt } from "@/components/office/OfficeMenu";
import TopBar from "@/components/TopBar";
import { useTheme } from "@/components/theme";
import { EmoteBar, EmoteLayer, NameGate, useEmoteFloats, useViewer, ViewerLog } from "@/components/Viewers";
import { act, useLiveState } from "@/components/useLiveState";
import "../../dashboard.css";

const none = () => {};
// Matches the server: one skit per person every 15 seconds.
const SKIT_MS = 15_000;

/** The shared floor: the same board and office, fed by the scrubbed feed. A viewer picks a name, then can play with the office and emote. */
export default function Watch({ token }: { token: string }) {
  const live = useLiveState(token);
  const theme = useTheme();
  const [hover, setHover] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; at: MenuAt } | null>(null);
  const tapped = useRef(new Map<string, number>());
  const closeMenu = useCallback(() => setMenu(null), []);
  const { viewer, ready, join } = useViewer(token);
  const { floats, add: float } = useEmoteFloats(live.events, viewer?.name ?? null, live.loaded);
  const agents = live.agents;
  const menuAgent = menu ? agents.find((a) => a.id === menu.id) ?? null : null;
  // Busy while anyone's skit for this person is still playing, this viewer's included before the feed catches up.
  const busy =
    !!menuAgent &&
    (live.now - (tapped.current.get(menuAgent.id) ?? 0) < SKIT_MS ||
      live.events.some(
        (e) => e.agent_id === menuAgent.id && e.kind === "command" && ["harass", "coffee"].includes((e.payload as { kind?: string } | null)?.kind ?? "") && live.now - new Date(e.created_at).getTime() < SKIT_MS,
      ));
  const visit = async (what: "harass" | "coffee") => {
    if (!menuAgent) return false;
    const ok = (await act(`/api/watch/${encodeURIComponent(token)}`, { agent: menuAgent.id, act: what, key: viewer?.key })).ok;
    if (ok) tapped.current.set(menuAgent.id, Date.now());
    return ok;
  };

  if (live.revoked) {
    return (
      <div className="app view-only">
        <TopBar machines={[]} online loaded now={live.now} theme={theme} viewOnly />
        <main className="watch-off">
          <p className="empty-title display">This link is off</p>
          <p>The owner turned off sharing or made a new link. Ask them for the current one.</p>
        </main>
      </div>
    );
  }

  if (!viewer) {
    return (
      <div className="app view-only">
        <TopBar machines={[]} online loaded now={live.now} theme={theme} viewOnly />
        {ready && <NameGate onJoin={join} />}
      </div>
    );
  }

  return (
    <div className="app view-only">
      <TopBar machines={[]} online={live.online} loaded={live.loaded} now={live.now} theme={theme} viewOnly />
      <main className="main">
        <div className="col-left">
          <AgentBoard agents={agents} blockers={[]} machines={[]} now={live.now} hover={hover} selected={null} loaded={live.loaded} onHover={setHover} onSelect={none} readOnly />
        </div>
        <div className="col-right">
          <section className="office card" aria-label="The office">
            <Office look={live.look} agents={agents} events={live.events} theme={theme.resolved} hover={hover} selected={menu?.id ?? null} onHover={setHover} onSelect={(id, at) => setMenu(id && at ? { id, at } : null)}>
              <EmoteLayer floats={floats} />
              {menu && menuAgent && menuAgent.status !== "done" && menuAgent.status !== "stopped" && (
                <OfficeMenu key={menu.id} agent={menuAgent} at={menu.at} busy={busy} onVisit={visit} onClose={closeMenu} />
              )}
            </Office>
            <EmoteBar token={token} viewer={viewer} now={live.now} onSent={(e) => float(e, viewer.name, `me-${Date.now()}`)} />
            <div className="office-legend" aria-hidden>
              <span>
                <i className="dot" style={{ background: "var(--green)" }} /> typing = working
              </span>
              <span>
                <i className="dot" style={{ background: "var(--blue)" }} /> thought bubble = thinking
              </span>
              <span>
                <i className="dot" style={{ background: "var(--amber)" }} /> ! = needs input
              </span>
              <span>
                <i className="dot" style={{ background: "var(--fg-3)" }} /> coffee = idle
              </span>
            </div>
          </section>
          <ViewerLog events={live.events} agents={live.agents} me={viewer.name} />
        </div>
      </main>
    </div>
  );
}
