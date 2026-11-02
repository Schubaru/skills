import { NextResponse } from "next/server";
import { requireSession } from "@/auth";

/** Wraps an authenticated JSON route handler. The middleware already rejects anonymous requests; this is defense in depth. */
export function guarded<T extends unknown[]>(fn: (...args: T) => Promise<Response>) {
  return async (...args: T) => {
    const session = await requireSession();
    if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    try {
      return await fn(...args);
    } catch (e) {
      console.error(e);
      return NextResponse.json({ error: (e as Error).message ?? "error" }, { status: 500 });
    }
  };
}
