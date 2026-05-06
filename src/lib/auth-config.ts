/**
 * Client-side check: sign-in only works after you set real Supabase env vars
 * (NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local).
 */
export function isSupabaseAuthConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url?.trim() || !key?.trim()) return false;
  if (url.includes("example.supabase.co")) return false;
  if (url.includes("placeholder") || key.includes("placeholder")) return false;
  // Real anon JWTs are long; placeholder keys from local setup are shorter
  if (key.length < 80) return false;
  return true;
}

/**
 * Development-only: allow `/client` UI when Supabase is not configured yet.
 * Never enable when `isSupabaseAuthConfigured()` is true.
 */
export function isClientDashboardPreviewMode(): boolean {
  return (
    process.env.NODE_ENV === "development" && !isSupabaseAuthConfigured()
  );
}
