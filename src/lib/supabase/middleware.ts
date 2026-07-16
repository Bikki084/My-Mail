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

/** Help pages with mostly static RSC output — allow private stale-while-revalidate. */
const CLIENT_STATIC_HELP_PREFIXES = ["/client/recipients", "/client/deliverability"];

function applyAppShellCacheHeaders(response: NextResponse, path: string): NextResponse {
  if (CLIENT_STATIC_HELP_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) {
    response.headers.set("Cache-Control", "private, max-age=0, stale-while-revalidate=3600");
    return response;
  }
  if (path === "/admin" || path.startsWith("/admin/announcements")) {
    response.headers.set("Cache-Control", "private, max-age=0, stale-while-revalidate=60");
    return response;
  }
  return applyNoStoreHeaders(response);
}

export async function updateSession(request: NextRequest) {
  const path = request.nextUrl.pathname;

  if (process.env.NODE_ENV === "production") {
    const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "")
      .split(",")[0]
      ?.trim()
      .toLowerCase();
    const proto = (request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", ""))
      .split(",")[0]
      ?.trim()
      .toLowerCase();
    const isLocal =
      !host ||
      host.startsWith("localhost") ||
      host.startsWith("127.0.0.1") ||
      host.includes(":");

    if (!isLocal && proto === "http") {
      const url = request.nextUrl.clone();
      url.protocol = "https:";
      return NextResponse.redirect(url, 308);
    }
  }

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
    return applyAppShellCacheHeaders(supabaseResponse, path);
  }

  return supabaseResponse;
}
