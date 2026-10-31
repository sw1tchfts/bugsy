"use client";

import { createBrowserClient } from "@supabase/ssr";
import { publicSupabaseEnv } from "@/lib/supabase/env";
import type { Database } from "@/lib/supabase/types";

/** Supabase Auth client for client components. */
export function createSupabaseBrowserClient() {
  const { url, anonKey } = publicSupabaseEnv();
  return createBrowserClient<Database>(url, anonKey);
}
