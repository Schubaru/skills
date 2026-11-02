import { NextResponse } from "next/server";
import { auth, devBypass } from "@/auth";
import { MODE, PUBLIC_TOKEN } from "@/lib/mode";

export default auth((req) => {
  const { pathname } = req.nextUrl;
  if (MODE === "view") {
    // No owner side: / is the public office, everything else the matcher catches is gone.
    if (pathname === "/") return NextResponse.rewrite(new URL(`/watch/${PUBLIC_TOKEN}`, req.nextUrl.origin));
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.redirect(new URL("/", req.nextUrl.origin));
  }
  if (devBypass || req.auth?.user) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL("/login", req.nextUrl.origin);
  return NextResponse.redirect(url);
});

export const config = {
  // Everything except: auth routes, the login page, the bridge, the connector and the shared view (token-authenticated), static files.
  matcher: ["/((?!api/auth|api/bridge|api/watch/|watch/|bridge/|login|_next/|favicon\\.ico|icon\\.svg).*)"],
};
