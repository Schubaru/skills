"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOutAction } from "@/app/actions";
import { timeAgo } from "@/lib/format";
import { MODE, OFFICE_NAME } from "@/lib/mode";
import type { Machine } from "@/lib/types";
import { IconBack, IconEye, IconGear, IconMoon, IconSun } from "./Icons";
import ShareButton from "./ShareButton";
import { useTheme } from "./theme";

interface Props {
  machines: Machine[];
  online: boolean;
  loaded: boolean;
  now: number;
  theme: ReturnType<typeof useTheme>;
  user?: { name?: string | null; login?: string };
  /** The shared view: no home link, no bridge status, no account controls. */
  viewOnly?: boolean;
}

export default function TopBar({ machines, online, loaded, now, theme, user, viewOnly }: Props) {
  const path = usePathname();
  const onSettings = path === "/settings";
  const latest = machines.reduce<Machine | null>((a, m) => (!a || (m.last_seen_at ?? "") > (a.last_seen_at ?? "") ? m : a), null);
  const bridge = !loaded ? "connecting" : !online ? "dashboard offline" : !latest ? "no bridge installed" : latest.last_seen_at ? `${latest.name} · seen ${timeAgo(latest.last_seen_at, now)}` : `${latest.name} · never seen`;
  const bridgeState = !loaded ? "idle" : !online ? "stopped" : !latest?.last_seen_at ? "idle" : now - new Date(latest.last_seen_at).getTime() < 5 * 60_000 ? "working" : "idle";

  return (
    <header className="topbar">
      <div className="topbar-left">
        {viewOnly ? (
          <span className="wordmark">
            <span className="chip lg" style={{ background: "var(--fg)" }} />
            <span className="display">N00B Inc</span>
          </span>
        ) : (
          <Link href="/" className="wordmark" aria-label="N00B Inc home">
            <span className="chip lg" style={{ background: "var(--fg)" }} />
            <span className="display">N00B Inc</span>
          </Link>
        )}
        <span className="label topbar-sub">{OFFICE_NAME}</span>
      </div>
      <div className="topbar-center">
        {viewOnly ? (
          <span className="view-only-mark label" role="status" title="You can watch this floor but not talk to or change any agent">
            <IconEye /> {loaded && !online ? "View only · reconnecting" : "View only"}
          </span>
        ) : (
          <span className="status" data-s={bridgeState} title="Bridge status">
            <span className="dot" />
            <span className="topbar-bridge">{bridge}</span>
          </span>
        )}
      </div>
      <div className="topbar-right">
        <button className="btn icon quiet" type="button" onClick={theme.toggle} aria-label={`Switch to ${theme.resolved === "dark" ? "light" : "dark"} mode`} title="Theme">
          {theme.resolved === "dark" ? <IconSun /> : <IconMoon />}
        </button>
        {viewOnly ? null : onSettings ? (
          <Link href="/" className="btn quiet">
            <IconBack /> Floor
          </Link>
        ) : (
          <>
            {MODE === "both" && <ShareButton />}
            <Link href="/settings" className="btn icon quiet" aria-label="Account settings" title="Settings">
              <IconGear />
            </Link>
          </>
        )}
        {!viewOnly && (
          <form action={signOutAction}>
            <button className="btn" type="submit" title={user?.login ? `Signed in as ${user.login}` : "Sign out"}>
              Sign out
            </button>
          </form>
        )}
      </div>
    </header>
  );
}
