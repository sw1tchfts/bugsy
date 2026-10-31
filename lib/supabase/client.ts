"use client";

import { createBrowserClient } from "@supabase/ssr";
import { publicSupabaseEnv } from "@/lib/supabase/env";

/** Supabase Auth client for client components. */
export function createSupabaseBrowserClient() {
  const { url, anonKey } = publicSupabaseEnv();
  return createBrowserClient(url, anonKey);
}
