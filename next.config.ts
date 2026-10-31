import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // CLAUDE.md is this repo's instruction file; do not generate a second one.
  agentRules: false,
  async rewrites() {
    // Development without the full Supabase local stack: forward Supabase Auth calls to a GoTrue server.
    const authTarget = process.env.SUPABASE_AUTH_INTERNAL_URL;
    if (!authTarget) return [];
    return [{ source: "/auth/v1/:path*", destination: `${authTarget}/:path*` }];
  },
};

export default nextConfig;
