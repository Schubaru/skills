import NextAuth, { type Session } from "next-auth";
import GitHub from "next-auth/providers/github";

const IDLE_SECONDS = 15 * 60;

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [GitHub],
  trustHost: true,
  pages: { signIn: "/login", error: "/login" },
  // Sliding 15-minute window: every authenticated request re-issues the cookie.
  session: { strategy: "jwt", maxAge: IDLE_SECONDS, updateAge: 0 },
  callbacks: {
    signIn({ profile }) {
      const login = (profile as { login?: string } | undefined)?.login;
      return !!login && login === process.env.ALLOWED_GITHUB_LOGIN;
    },
    jwt({ token, profile }) {
      if (profile) token.login = (profile as { login?: string }).login;
      return token;
    },
    session({ session, token }) {
      (session.user as { login?: string }).login = token.login as string | undefined;
      return session;
    },
  },
});

/** Dev-only escape hatch so the UI can be built without a GitHub OAuth app. Never active in production builds. */
export const devBypass = process.env.NODE_ENV !== "production" && process.env.DEV_BYPASS_AUTH === "1";

export async function requireSession(): Promise<Session | null> {
  if (devBypass) {
    return { user: { name: "dev", login: process.env.ALLOWED_GITHUB_LOGIN } as Session["user"], expires: "" } as Session;
  }
  return auth();
}
