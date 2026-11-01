import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { publicSupabaseEnv } from "@/lib/supabase/env";

// Refreshes the Supabase session cookie on every request, so server components always see a valid user.
export async function proxy(request: NextRequest) {
  // The page or download being opened, for the support access log (spec 13 rule 5).
  request.headers.set("x-bugsy-path", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  request.headers.set("x-bugsy-method", request.method);
  let response = NextResponse.next({ request });
  const { url, anonKey } = publicSupabaseEnv();
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });
  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|auth/v1|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
