import Link from "next/link";
import { redirect } from "next/navigation";
import { devBypass, requireSession } from "@/auth";
import { signInWithGitHub } from "@/app/actions";
import { IconGitHub } from "@/components/Icons";
import { MODE } from "@/lib/mode";
import "../dashboard.css";

const REASONS: Record<string, string> = {
  idle: "You were signed out after 15 minutes without activity.",
  expired: "Your session expired. Sign in again to continue.",
  AccessDenied: "That GitHub account isn't on the list. Only the owner can sign in.",
  OAuthSignin: "GitHub sign-in could not start. Check the OAuth app settings.",
  OAuthCallback: "GitHub sign-in failed on the way back. Try again.",
  Configuration: "Sign-in isn't configured yet. Set the GitHub OAuth environment variables.",
};

export default async function Login({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (MODE === "view") redirect("/");
  const session = await requireSession();
  if (session?.user) redirect("/");
  const sp = await searchParams;
  const reason = sp.reason ?? sp.error;
  const msg = reason ? REASONS[reason] ?? "Sign-in didn't complete. Try again." : null;

  return (
    <main className="login">
      <div className="login-card card">
        <div className="wordmark">
          <span className="chip lg" style={{ background: "var(--fg)" }} />
          <span className="display">N00B Inc</span>
        </div>
        <p className="login-lead">Command center for your Claude Code agents.</p>
        {msg && (
          <p className={`login-msg${reason === "AccessDenied" || reason === "Configuration" ? " err" : ""}`} role="status">
            {msg}
          </p>
        )}
        <form action={signInWithGitHub}>
          <button className="btn primary login-btn" type="submit">
            <IconGitHub /> Sign in with GitHub
          </button>
        </form>
        <p className="login-fine">One allowed account. Sessions end after 15 minutes idle.</p>
        {devBypass && (
          <p className="login-fine">
            Dev bypass is on. <Link href="/" className="link">Open the floor</Link>.
          </p>
        )}
      </div>
    </main>
  );
}
