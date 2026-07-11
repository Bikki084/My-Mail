import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isClientDashboardPreviewMode, isSupabaseAuthConfigured } from "@/lib/auth-config";
import { supabaseProjectUrl } from "@/lib/supabase/project-url";

type Role = "admin" | "client" | null;

function applyNoStoreHeaders(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  return response;
}

export async function updateSession(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // Dev UI preview for /client when Supabase env vars are not yet configured.
  if (path.startsWith("/client") && isClientDashboardPreviewMode()) {
    return NextResponse.next({ request });
  }

  if (!isSupabaseAuthConfigured()) {
    // Never expose dashboards without working auth (admin layout used to skip checks when misconfigured).
    if (path.startsWith("/admin") || path.startsWith("/client")) {
      const u = new URL("/login", request.url);
      u.searchParams.set("next", path);
      u.searchParams.set("auth", "required");
      return NextResponse.redirect(u);
    }
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    supabaseProjectUrl(process.env.NEXT_PUBLIC_SUPABASE_URL),
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }: { name: string; value: string }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(
            ({ name, value, options }: { name: string; value: string; options: CookieOptions }) =>
              supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Resolve the signed-in user's role once. Prefer the profiles table (canonical); fall back to
  // `user_metadata.role` so a freshly created user still routes correctly even if the
  // insert trigger hasn't run yet.
  async function resolveRole(): Promise<Role> {
    if (!user) return null;
    const { data } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    const dbRole = (data?.role as Role) ?? null;
    if (dbRole) return dbRole;
    const metaRole = (user.user_metadata as { role?: Role } | null)?.role ?? null;
    return metaRole;
  }

  // --- /admin: must be authenticated admin
  if (path.startsWith("/admin")) {
    if (!user) {
      const u = new URL("/login", request.url);
      u.searchParams.set("next", path);
      return NextResponse.redirect(u);
    }
    const role = await resolveRole();
    if (role !== "admin") {
      return NextResponse.redirect(new URL(role === "client" ? "/client" : "/login", request.url));
    }
  }

  // --- /client: must be authenticated client
  if (path.startsWith("/client")) {
    if (!user) {
      const u = new URL("/login", request.url);
      u.searchParams.set("next", path);
      return NextResponse.redirect(u);
    }
    const role = await resolveRole();
    if (role !== "client") {
      return NextResponse.redirect(new URL(role === "admin" ? "/admin" : "/login", request.url));
    }
  }

  if (path.startsWith("/admin") || path.startsWith("/client")) {
    return applyNoStoreHeaders(supabaseResponse);
  }

  return supabaseResponse;
}
