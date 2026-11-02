// The single Supabase client for the app. Auth (email OTP) and the review
// board's data layer (src/review/db.ts) share it, so a sign-in immediately
// applies to data reads/writes and realtime. When the env vars are unset the
// app runs in the offline localStorage mode and never touches a remote.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export function isRemoteConfigured(): boolean {
  return Boolean(url && anonKey);
}

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!isRemoteConfigured()) return null;
  if (!client) client = createClient(url!, anonKey!);
  return client;
}
