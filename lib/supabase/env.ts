function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is not set. Copy .env.example to .env.local and fill it in.`);
  return value;
}

/** Public Supabase settings, safe to expose to the browser. */
export function publicSupabaseEnv() {
  return {
    url: required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL),
    anonKey: required(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    ),
  };
}

/** Server-only settings. Never import this from a client component. */
export function serverEnv() {
  return {
    databaseUrl: required("DATABASE_URL", process.env.DATABASE_URL),
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
}
